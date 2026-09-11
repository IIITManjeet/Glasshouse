#!/usr/bin/env node
// DOES THE PUBLISHED INDEX AGREE WITH AN INDEPENDENT REPLAY OF THE CHAIN?
//
//   GRAPH_API_KEY=... node scripts/cross-check-subgraph.mjs
//   GRAPH_API_KEY=... node scripts/cross-check-subgraph.mjs --from 50965408
//
// WHAT THIS IS FOR. `subgraph/src/book.ts` is an AssemblyScript reimplementation of the
// contract's clearing rule, and until now the only thing guarding it against drift was
// verify-run's TRANSLITERATION check -- a REGEX over two source files, which its own
// output calls "a textual guard, not a proof". Two files can express the same rule in
// text and still disagree on data.
//
// So this compares OUTPUTS instead of source. It re-derives every auction from the Book's
// raw logs, asks the deployed subgraph what it thinks about the same auctions, and diffs
// them field by field.
//
// THE DERIVATION IS IMPORTED FROM verify-run, NOT REWRITTEN. That file's entire value is
// that its replay imports none of the three implementations it checks; re-typing the top-2
// walk here would produce a fourth copy and quietly turn this into a test of whether two
// copies of one mistake match. `readLogs` and `rebuild` are exported for exactly this.
//
// WHAT IT CANNOT TELL YOU. Both sides read the same chain, so this catches a mapping that
// computes the wrong thing -- not a chain that emitted the wrong thing. That question is
// verify-run's REPLAY check, which compares the derivation against what `settle()`
// actually emitted. The two are complementary and neither replaces the other.

import { readLogs, rebuild } from "./verify-run.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SUBGRAPH_ID = arg("id", "FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y");
const GATEWAY = `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;

const QUERY = `{
  _meta { block { number } hasIndexingErrors }
  auctions(first: 1000, orderBy: openedAtBlock, orderDirection: asc) {
    orderHash
    openedAtBlock
    reserveBps
    committedCount
    revealedCount
    bestBidder { id }
    bestBps
    secondBps
    clearingBps
    winnerMarginBps
    competition
    thin
    filled
    filledBy { id }
    settled
    settledClearingBps
    winnerForfeited
    settlementMatchesDerivation
  }
}`;

/**
 * The fields worth comparing, and how to read each side.
 *
 * Only fields BOTH sides genuinely compute are here. The subgraph stores plenty the replay
 * does not derive (timestamps, token entities, USD-free aggregates), and comparing those
 * would be comparing the index against itself.
 */
const FIELDS = [
  ["committedCount", (a) => a.derived.committedCount, (g) => g.committedCount],
  ["revealedCount", (a) => a.derived.revealedCount, (g) => g.revealedCount],
  ["bestBidder", (a) => a.derived.bestBidder, (g) => (g.bestBidder ? g.bestBidder.id.toLowerCase() : null)],
  ["bestBps", (a) => a.derived.bestBps, (g) => g.bestBps],
  ["secondBps", (a) => a.derived.secondBps, (g) => g.secondBps],
  ["clearingBps", (a) => a.derived.clearingBps, (g) => g.clearingBps],
  ["winnerMarginBps", (a) => a.derived.winnerMarginBps, (g) => g.winnerMarginBps],
  ["competition", (a) => a.derived.competition, (g) => g.competition],
  ["thin", (a) => a.derived.thin, (g) => g.thin],
  ["reserveBps", (a) => a.reserveBps, (g) => g.reserveBps],
  ["openedAtBlock", (a) => a.openedAtBlock, (g) => Number(g.openedAtBlock)],
  ["filled", (a) => a.filled, (g) => g.filled],
  ["filledBy", (a) => a.filledBy, (g) => (g.filledBy ? g.filledBy.id.toLowerCase() : null)],
  ["settled", (a) => a.settled, (g) => g.settled],
  ["winnerForfeited", (a) => a.winnerForfeited ?? false, (g) => g.winnerForfeited],
];

const same = (x, y) => (x === null || x === undefined ? y === null || y === undefined : x === y);
const show = (v) => (v === null || v === undefined ? "-" : String(v));

async function query() {
  const key = process.env.GRAPH_API_KEY;
  if (!key) {
    throw new Error(
      "GRAPH_API_KEY is not set. Create a Gateway API key in Subgraph Studio, restricted to " +
        "this subgraph, and export it. The index is public but the Gateway is not free.",
    );
  }
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: QUERY }),
  });
  const body = await res.json();
  if (body.errors) throw new Error("gateway: " + JSON.stringify(body.errors));
  if (!body.data) throw new Error("gateway returned no data: " + JSON.stringify(body).slice(0, 300));
  return body.data;
}

async function main() {
  console.log("\n  cross-check-subgraph\n  " + "-".repeat(70));
  console.log("  subgraph  " + SUBGRAPH_ID);

  const [{ head, decoded }, data] = await Promise.all([readLogs(), query()]);
  const replayed = rebuild(decoded);
  const indexed = new Map(data.auctions.map((a) => [a.orderHash.toLowerCase(), a]));

  console.log("  chain     head " + head + ", " + replayed.length + " auction(s) replayed from logs");
  console.log("  index     block " + data._meta.block.number + ", " + data.auctions.length + " auction(s) indexed");
  console.log("  " + "-".repeat(70) + "\n");

  if (data._meta.hasIndexingErrors) {
    console.log("  WARNING the subgraph reports hasIndexingErrors: true. Anything below is suspect.\n");
  }

  let compared = 0;
  let behind = 0;
  const disagreements = [];

  for (const a of replayed) {
    const g = indexed.get(a.orderHash.toLowerCase());

    // THE INDEXER BEING BEHIND IS NOT A DISAGREEMENT. An auction the chain has and the
    // index has not reached yet is the normal state of any indexer, and counting it as a
    // mismatch would make this fail loudest exactly when it has least to say.
    if (!g) {
      if (a.openedAtBlock !== null && a.openedAtBlock > Number(data._meta.block.number)) {
        behind++;
        continue;
      }
      disagreements.push({
        orderHash: a.orderHash,
        field: "(entity)",
        replay: "present, opened at " + a.openedAtBlock,
        index: "MISSING, though the index has passed that block",
      });
      continue;
    }

    compared++;
    for (const [name, fromReplay, fromIndex] of FIELDS) {
      const mine = fromReplay(a);
      const theirs = fromIndex(g);
      if (!same(mine, theirs)) {
        disagreements.push({ orderHash: a.orderHash, field: name, replay: show(mine), index: show(theirs) });
      }
    }

    // The subgraph's OWN replay, which is a different claim from ours agreeing with it:
    // this is the mapping checking itself against what settle() emitted. False is a real
    // failure; null on a settled auction means the mapping never ran the check at all.
    if (a.settled && g.settlementMatchesDerivation !== true) {
      disagreements.push({
        orderHash: a.orderHash,
        field: "settlementMatchesDerivation",
        replay: "settled, so the mapping should have checked",
        index: g.settlementMatchesDerivation === null ? "null (never checked)" : "false (mapping disagrees with settle())",
      });
    }
  }

  const short = (h) => h.slice(0, 10) + "…";

  for (const a of replayed) {
    const g = indexed.get(a.orderHash.toLowerCase());
    if (!g) continue;
    const bad = disagreements.filter((d) => d.orderHash === a.orderHash).length;
    console.log(
      `  ${bad === 0 ? "agree" : "DIFFER"}  ${short(a.orderHash)}  opened ${a.openedAtBlock}  ` +
        `${a.derived.competition.toLowerCase()}, ${a.derived.revealedCount}/${a.derived.committedCount} revealed, ` +
        `clearing ${a.derived.clearingBps} bps${a.filled ? ", filled" : ""}` +
        (bad ? `  -- ${bad} field(s) differ` : ""),
    );
  }

  if (disagreements.length) {
    console.log("\n  DISAGREEMENTS");
    for (const d of disagreements) {
      console.log(`    ${short(d.orderHash)}  ${d.field}`);
      console.log(`        replay  ${d.replay}`);
      console.log(`        index   ${d.index}`);
    }
  }

  console.log("\n  " + "-".repeat(70));
  const fieldCount = compared * FIELDS.length;
  if (disagreements.length === 0) {
    console.log(
      `  AGREE on ${fieldCount} field comparison(s) across ${compared} auction(s)` +
        (behind ? `, with ${behind} not yet indexed` : "") + ".",
    );
    console.log("  Both sides read the same chain, so this checks the MAPPING, not the chain.");
    console.log("  Whether the chain itself is right is verify-run's REPLAY check.");
  } else {
    console.log(`  ${disagreements.length} DISAGREEMENT(S) over ${compared} auction(s).`);
    console.log("  The index and an independent replay of the same logs do not match.");
  }
  console.log("  " + "-".repeat(70) + "\n");

  if (disagreements.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\n  cross-check failed to complete: " + (e?.message ?? e) + "\n");
  process.exitCode = 2;
});
