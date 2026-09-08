#!/usr/bin/env node
// Build site/data/snapshot.js -- the page's cold fallback -- from the Book's own logs.
//
// WHAT THIS IS AND IS NOT. The page's data source is the subgraph (subgraph-design
// section 8.2). This is the third rung of the precedence ladder in ui-spec section 5.1:
// live -> cache -> snapshot, each labelled with its own tag. The snapshot exists so a
// judge who opens the page with no network, or before the subgraph is published, still
// sees real indexed history rather than an empty page or a spinner. It is never presented
// as live data; the page tags it SOURCE - SNAPSHOT IN REPO - AS OF BLOCK N.
//
// It reads the CHAIN rather than the subgraph on purpose: the subgraph is deployed to
// Studio but not yet published to The Graph Network, and the Studio query URL carries an
// account id that is not in this repository. Reading logs directly needs neither, and the
// shapes below match the Q1 fields exactly, so swapping the source later changes nothing
// on the page.
//
//   node scripts/make-snapshot.mjs
//
// Deliberately NOT a substitute for the subgraph: it computes only what a log stream
// plainly says. Everything the subgraph derives -- competition class, thinness, the
// reserve window -- stays the subgraph's job.

import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, parseEventLogs } from "viem";
import { base } from "viem/chains";
import { readFileSync } from "node:fs";

import { baseTransport, rpc } from "./lib/chain.ts";

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";
const DEPLOY_BLOCK = 50_965_408n;
const OUT = new URL("../site/data/snapshot.js", import.meta.url);

const bookAbi = JSON.parse(
  readFileSync(new URL("../subgraph/abis/GlasshouseBook.json", import.meta.url), "utf8"),
);

// eth_getLogs NEEDS ITS OWN ENDPOINT, not the shared fallback in lib/chain.ts.
//
// That fallback is tuned for reads and newHeads subscriptions and is wrong for log
// scans, which this script found the hard way by producing an empty snapshot for a Book
// that demonstrably has events. Checked each one directly:
//   base-rpc.publicnode.com  -32602  archive requests require a personal token
//   base.drpc.org            temporary internal error
//   1rpc.io/base             -32602  eth_getLogs is limited to a 0-50 block range
//   base.meowrpc.com         -32000  eth_getLogs is not supported
//   mainnet.base.org         works, capped at a 10,000 block range
//
// So this uses Base's own endpoint, chunked under its cap. BASE_RPC_URL overrides it for
// anyone with an archive provider.
const LOGS_RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const CHUNK = 9_000n;

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function main() {
  const client = createPublicClient({ chain: base, transport: http(LOGS_RPC, { retryCount: 3, retryDelay: 1000 }) });
  const head = await rpc(() => client.getBlockNumber(), "head");

  console.log(`  scanning ${BOOK} from ${DEPLOY_BLOCK} to ${head}`);
  const logs = [];
  for (let from = DEPLOY_BLOCK; from <= head; from += CHUNK + 1n) {
    const to = from + CHUNK > head ? head : from + CHUNK;
    const chunk = await rpc(
      () => client.getLogs({ address: BOOK, fromBlock: from, toBlock: to }),
      `logs ${from}-${to}`,
    );
    logs.push(...chunk);
  }
  console.log(`  ${logs.length} log(s)`);

  const decoded = parseEventLogs({ abi: bookAbi, logs });
  const auctions = new Map();

  const key = (maker, orderHash) => `${maker.toLowerCase()}-${orderHash.toLowerCase()}`;
  const get = (maker, orderHash) => {
    const k = key(maker, orderHash);
    if (!auctions.has(k)) {
      auctions.set(k, {
        id: k,
        maker: maker.toLowerCase(),
        orderHash: orderHash.toLowerCase(),
        openedAtBlock: null,
        commitEnd: null,
        revealEnd: null,
        exclusiveEnd: null,
        reserveBps: null,
        maxBps: null,
        bond: null,
        committedCount: 0,
        revealedCount: 0,
        bestBidder: null,
        bestBps: null,
        secondBps: null,
        clearingBps: null,
        filled: false,
        filledBy: null,
        amountIn: null,
        amountOut: null,
        settled: false,
        settledAtBlock: null,
        winnerForfeited: null,
        // The same independent-replay check the subgraph runs. Null until settled.
        settlementMatchesDerivation: null,
        settledWinner: null,
        settledClearingBps: null,
        bids: [],
      });
    }
    return auctions.get(k);
  };

  for (const e of decoded) {
    const a = get(e.args.maker, e.args.orderHash);
    const n = Number(e.blockNumber);
    switch (e.eventName) {
      case "AuctionOpened":
        a.openedAtBlock = n;
        a.commitEnd = Number(e.args.commitEnd);
        a.revealEnd = Number(e.args.revealEnd);
        a.exclusiveEnd = Number(e.args.revealEnd) + Number(e.args.exclusiveBlocks);
        a.reserveBps = Number(e.args.reserveBps);
        a.maxBps = Number(e.args.maxBps);
        a.bond = e.args.bond.toString();
        break;
      case "BidCommitted":
        a.committedCount += 1;
        a.bids.push({ bidder: e.args.bidder.toLowerCase(), commitIdx: a.bids.length, committedAtBlock: n, bps: null });
        break;
      case "BidRevealed": {
        a.revealedCount += 1;
        const bid = a.bids.find((b) => b.bidder === e.args.bidder.toLowerCase());
        if (bid) bid.bps = Number(e.args.bps);
        // Replay of the contract's own top-2 rule, the same one the mapping runs.
        const bps = Number(e.args.bps);
        if (a.bestBps === null || bps > a.bestBps) {
          a.secondBps = a.bestBps;
          a.bestBps = bps;
          a.bestBidder = e.args.bidder.toLowerCase();
        } else if (a.secondBps === null || bps > a.secondBps) {
          a.secondBps = bps;
        }
        a.clearingBps = Math.max(a.secondBps ?? 0, a.reserveBps ?? 0);
        break;
      }
      case "AuctionFilled":
        a.filled = true;
        a.filledBy = e.args.taker.toLowerCase();
        a.amountIn = e.args.amountIn.toString();
        a.amountOut = e.args.amountOut.toString();
        break;
      case "AuctionSettled": {
        a.settled = true;
        a.settledAtBlock = n;
        a.winnerForfeited = e.args.winnerForfeited;
        a.settledWinner = e.args.winner.toLowerCase();
        a.settledClearingBps = Number(e.args.clearingBps);

        // INDEPENDENT REPLAY, not a read-back.
        //
        // The emitted values are NOT copied over the derived ones. The point is that
        // this file computed the winner and clearing price itself, from the raw reveals,
        // using the contract's own top-2 rule -- so comparing them is a real check and
        // not a tautology. Same check the subgraph mapping runs (subgraph/src/book.ts:503).
        // A disagreement is left visible, never patched over.
        const derivedWinner = a.bestBidder ?? "0x0000000000000000000000000000000000000000";
        const derivedClearing = a.bestBidder ? (a.clearingBps ?? 0) : 0;
        a.settlementMatchesDerivation =
          derivedWinner.toLowerCase() === a.settledWinner && derivedClearing === a.settledClearingBps;
        if (!a.settlementMatchesDerivation) {
          console.error(
            `  MISMATCH on ${a.orderHash}: emitted ${a.settledWinner} at ${a.settledClearingBps} bps, ` +
            `derived ${derivedWinner} at ${derivedClearing} bps`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  const list = [...auctions.values()].sort((x, y) => (y.openedAtBlock ?? 0) - (x.openedAtBlock ?? 0));
  for (const a of list) {
    console.log(
      `  auction ${short(a.orderHash)}  opened ${a.openedAtBlock}  commits ${a.committedCount}  ` +
      `reveals ${a.revealedCount}  filled ${a.filled}  settled ${a.settled}` +
      (a.settlementMatchesDerivation === null ? "" : `  replay=${a.settlementMatchesDerivation ? "matches" : "MISMATCH"}`),
    );
  }

  const snapshot = {
    producedAt: new Date().toISOString(),
    producedBy: "scripts/make-snapshot.mjs, from GlasshouseBook logs on Base",
    head: Number(head),
    book: BOOK,
    auctions: list,
  };

  mkdirSync(new URL("../site/data/", import.meta.url), { recursive: true });
  writeFileSync(
    OUT,
    "// GENERATED by scripts/make-snapshot.mjs. Do not edit.\n" +
      "//\n" +
      "// The page's COLD FALLBACK: what renders when the subgraph cannot be reached and\n" +
      "// nothing is cached. It is labelled as a snapshot wherever it is shown, never as live\n" +
      "// data. A .js file rather than .json on purpose -- fetch() of a sibling file fails\n" +
      "// under file://, and a judge opening index.html directly is a case that has to work.\n" +
      `window.GLASSHOUSE_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`,
    "utf8",
  );
  console.log(`\n  wrote ${OUT.pathname} at block ${head} with ${list.length} auction(s)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
