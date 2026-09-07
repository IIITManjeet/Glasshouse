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
 * BASE_RPC_URL, when set, is used EXCLUSIVELY -- the public providers are dropped, not
 * kept as a fallback behind it.
 *
 * That is deliberate and it matters for more than tidiness. The dry run points this at a
 * local Anvil fork of Base. If the public endpoints stayed in the chain, one failed
 * request against the fork would fail over to REAL MAINNET mid-run: reads would answer
 * from a different chain state than the one being written to, and a transaction meant
 * only as a rehearsal could be broadcast for real. An override that silently widens to
 * the public internet is not an override.
 *
 * A wss:// or ws:// value is used as a socket, anything else as HTTP.
 */
export function baseTransport() {
  const override = process.env.BASE_RPC_URL;
  if (override) {
    return override.startsWith("wss://") || override.startsWith("ws://")
      ? webSocket(override, { retryCount: 2, keepAlive: true, reconnect: true })
      : http(override, { retryCount: 3, retryDelay: 800 });
  }
  return fallback([
    ...WS_ENDPOINTS.map((u) => webSocket(u, { retryCount: 2, keepAlive: true, reconnect: true })),
    ...HTTP_ENDPOINTS.map((u) => http(u, { retryCount: 2, retryDelay: 800 })),
  ]);
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
 * Wait until the chain reaches `target`, driven by pushed heads, with a polling backstop.
 *
 * Resolves with the block number actually observed, which the caller MUST use as the pin
 * for any read that follows: it is a height some node has demonstrably produced. Throwing
 * that away and re-reading "latest" reintroduces exactly the replica-lag bug this exists
 * to avoid.
 *
 * WHY BOTH A SUBSCRIPTION AND A POLL. Over a `fallback`, viem pins the newHeads
 * subscription to the FIRST WebSocket transport and does not move to another if that one
 * fails -- it only retries the same URL a handful of times. So a socket that connects and
 * then goes quiet would hang the run until the guard fires, which for a 60-second auction
 * window is far too late. The ticker below is cheap (one read every 6s, against a wait
 * measured in minutes) and turns a dead socket into a slower success rather than a burned
 * auction.
 */
export function waitForBlock(client: PublicClient, target: bigint, what: string): Promise<bigint> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let announced = false;

    const finish = (n: bigint) => {
      if (settled) return;
      settled = true;
      unwatch();
      clearInterval(ticker);
      clearTimeout(guard);
      process.stdout.write("\n");
      resolve(n);
    };

    const saw = (n: bigint) => {
      if (settled) return;
      if (n >= target) return finish(n);
      if (!announced) {
        announced = true;
        console.log(`\n  waiting for ${what}: block ${n} -> ${target} (about ${Number(target - n) * 2}s)`);
      }
      process.stdout.write(`\r  block ${n}   `);
    };

    // Five minutes, not twenty. The longest wait here is 30 blocks -- about 60 seconds on
    // Base -- so five minutes is already generous, and failing fast matters when the step
    // after this one has its own deadline measured in blocks.
    const guard = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        unwatch();
        clearInterval(ticker);
        reject(new Error(`waiting for ${what}: no block >= ${target} in time`));
      },
      5 * 60_000,
    );

    const ticker = setInterval(() => {
      if (settled) return;
      rpc(() => client.getBlockNumber({ cacheTime: 0 }), `${what} poll`, 2).then(saw).catch(() => {});
    }, 6000);

    const unwatch = client.watchBlockNumber({
      emitOnBegin: true,
      emitMissed: true,
      onBlockNumber: saw,
      onError: (e) => {
        // Not fatal: the polling ticker above is the backstop. Report and carry on.
        console.log(`\n  block watcher: ${String(e).slice(0, 80)}`);
      },
    });
  });
}