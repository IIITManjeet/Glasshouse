import {
  createPublicClient,
  fallback,
  http,
  webSocket,
  type PublicClient,
} from "viem";
import { base } from "viem/chains";

/**
 * Shared Base connectivity for the operational scripts.
 *
 * WHY THIS EXISTS. The scripts used to poll: `getBlockNumber` every four seconds while
 * waiting out a 30-block window, plus a read after every write. Against Base's own public
 * endpoint that earns `-32016 over rate limit`, and it is wasteful even when it does not
 * -- the chain already knows when a block arrives and will say so if asked properly.
 *
 * So block waiting is a SUBSCRIPTION, not a poll. Over a WebSocket transport viem's
 * `watchBlockNumber` issues `eth_subscribe("newHeads")` and the node pushes each head as
 * it is produced: one request for an entire wait, instead of one every four seconds.
 *
 * Two further problems this addresses:
 *
 *   - `mainnet.base.org` does NOT support WebSocket (verified: the connection is refused),
 *     which is presumably why polling was the default in the first place. Three public
 *     providers do, and are used here.
 *   - That endpoint is also load balanced across replicas a block or two apart, so a read
 *     at "latest" can be answered from a state older than one already observed. Reads that
 *     matter are pinned to a block by the callers; this module gives them a transport that
 *     spreads load and fails over instead of dying.
 *
 * HTTP endpoints are kept in the fallback chain BELOW the sockets, so if every WebSocket
 * is unreachable the scripts degrade to polling rather than stopping.
 */

const WS_ENDPOINTS = [
  "wss://base-rpc.publicnode.com",
  "wss://base.drpc.org",
  "wss://base.gateway.tenderly.co",
];

const HTTP_ENDPOINTS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "https://base.meowrpc.com",
];

/**
 * BASE_RPC_URL overrides everything when set. A `wss://` value is used as a socket, an
 * `https://` one as HTTP; either way the public providers stay in the chain behind it, so
 * one flaky private endpoint cannot strand a run that is mid-auction.
 */
export function baseTransport() {
  const override = process.env.BASE_RPC_URL;
  const ws = WS_ENDPOINTS.map((u) => webSocket(u, { retryCount: 2, keepAlive: true, reconnect: true }));
  const rest = HTTP_ENDPOINTS.map((u) => http(u, { retryCount: 2, retryDelay: 800 }));

  if (override) {
    const first = override.startsWith("wss://") || override.startsWith("ws://")
      ? webSocket(override, { retryCount: 2, keepAlive: true, reconnect: true })
      : http(override, { retryCount: 3, retryDelay: 800 });
    return fallback([first, ...ws, ...rest]);
  }
  return fallback([...ws, ...rest]);
}

export function basePublicClient(): PublicClient {
  return createPublicClient({ chain: base, transport: baseTransport() });
}

/**
 * Retry a read through rate limiting and replica lag.
 *
 * viem retries a few JSON-RPC codes but not `-32016`, which is the one Base returns, so a
 * burst of reads dies on the public endpoint. `-32001 block not found` is retried too:
 * that is what a pinned read gets from a replica which has not caught up, and it is the
 * failure we WANT, because the alternative -- a read at "latest" answered from stale state
 * -- returns zeros and no error at all.
 */
export async function rpc<T>(fn: () => Promise<T>, what: string, tries = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e);
      const transient = /over rate limit|-32016|429|too many requests|block not found|-32001|header not found|missing trie node|socket|timeout/i.test(msg);
      if (!transient || attempt >= tries) throw e;
      const wait = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.log(`  ${what}: ${msg.slice(0, 60)} - retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Wait until the chain reaches `target`, driven by pushed heads rather than polling.
 *
 * Resolves with the block number actually observed, which the caller should use as the
 * pin for any read that follows: it is a height some node has demonstrably produced.
 *
 * `watchBlockNumber` falls back to polling by itself if the active transport is HTTP, so
 * this is correct either way -- it is just far quieter over a socket. `emitOnBegin` gives
 * us the current head immediately, so a target already reached returns without waiting.
 */
export function waitForBlock(client: PublicClient, target: bigint, what: string): Promise<bigint> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let announced = false;

    const done = (n: bigint) => {
      if (settled) return;
      settled = true;
      unwatch();
      clearTimeout(guard);
      process.stdout.write("\n");
      resolve(n);
    };

    // A subscription that silently stops delivering would hang the run forever, so there
    // is an upper bound. Base produces a block every ~2s; 20 minutes is far beyond any
    // window these scripts wait for, and is a fault rather than a slow chain.
    const guard = setTimeout(() => {
      if (settled) return;
      settled = true;
      unwatch();
      reject(new Error(`waiting for ${what}: no block >= ${target} within 20 minutes`));
    }, 20 * 60 * 1000);

    const unwatch = client.watchBlockNumber({
      emitOnBegin: true,
      emitMissed: true,
      onBlockNumber: (n) => {
        if (n >= target) return done(n);
        if (!announced) {
          announced = true;
          console.log(`\n  waiting for ${what}: block ${n} -> ${target} (about ${Number(target - n) * 2}s)`);
        }
        process.stdout.write(`\r  block ${n}   `);
      },
      onError: (e) => {
        // A dropped socket is not fatal: viem's fallback moves to the next transport and
        // the watcher re-establishes. Only report it.
        console.log(`\n  block watcher: ${String(e).slice(0, 80)}`);
      },
    });
  });
}
