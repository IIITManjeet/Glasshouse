#!/usr/bin/env node
// INDEPENDENT VERIFICATION OF AN AUCTION RUN, FROM THE LOGS ALONE.
//
//   node scripts/verify-run.mjs --rpc http://127.0.0.1:8545 --from 51176300
//   node scripts/verify-run.mjs --from 50965408     # mainnet, via BASE_RPC_URL or the public node
//
// WHY THIS EXISTS. Every other check in this repository verifies one implementation
// against its own intent: the Solidity tests check the Book against the spec, the JS tests
// check recommendReserve against a table, matchstick checks the mapping against fixtures.
// None of them catches the failure this project is most exposed to, which is THREE
// IMPLEMENTATIONS OF ONE RULE DRIFTING APART. The clearing rule lives in
// GlasshouseBook.sol:229, is transliterated in subgraph/src/helpers.ts, and is
// transliterated AGAIN in web/lib/reserve-window.ts -- whose own header calls that out as a
// live risk. A judge reading a receipt is reading the third copy.
//
// So this reads what the contract actually emitted, re-derives the outcome from the raw
// reveals WITHOUT consulting any of the three, and then asks whether each of them agrees.
// A disagreement is reported as a disagreement -- the same rule the page follows for
// settlementMatchesDerivation, applied to the toolchain rather than to one auction.
//
// It reads logs and nothing else: no key, no wallet, no write. Safe against mainnet. The
// point of running it against a fork first is that a rehearsal you cannot verify is not a
// rehearsal.

import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseEventLogs } from "viem";
import { base } from "viem/chains";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const RPC = arg("rpc", process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
const BOOK = arg("book", "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe");
const FROM = BigInt(arg("from", "50965408"));
const TO = arg("to", null);
const OUT = arg("out", null);
const CHUNK = 9_000n;

const bookAbi = JSON.parse(
  readFileSync(new URL("../subgraph/abis/GlasshouseBook.json", import.meta.url), "utf8"),
);

const ZERO = "0x0000000000000000000000000000000000000000";

// THREE OUTCOMES, NOT TWO.
//
// `ok: null` means the check did not run because there was nothing for it to run on -- no
// settlement to replay, no bond to account for, no row in the window. That is NOT a pass,
// and reporting it as one is how "6 of 8 passed" gets said about a chain that has never
// produced a reveal. A vacuous check is the most flattering possible result and the least
// informative, so it is printed as `n/a` with the reason it was vacuous, and it is counted
// separately in the summary.
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  const tag = ok === null ? "n/a " : ok ? "pass" : "FAIL";
  console.log("  " + tag + "  " + name + "\n        " + detail);
};

// ---------------------------------------------------------------------------------
// 1. Read the logs.
// ---------------------------------------------------------------------------------

// The chunk size is NEGOTIATED, not assumed.
//
// Public RPC log caps move without notice: mainnet.base.org allowed a 10,000 block range
// when scripts/make-snapshot.mjs was written and allows 2,000 today, which is enough to
// break a hard-coded scan with an error that names the new cap and nothing else. So the
// cap is parsed out of that error and the chunk retried at it, once per shrink. An
// archive endpoint that allows more is still used at the larger size.
async function readLogs() {
  const client = createPublicClient({
    chain: base,
    transport: http(RPC, { retryCount: 3, retryDelay: 800 }),
  });
  const head = TO ? BigInt(TO) : await client.getBlockNumber();
  const logs = [];
  let chunk = CHUNK;

  for (let from = FROM; from <= head; ) {
    const to = from + chunk > head ? head : from + chunk;
    try {
      logs.push(...(await client.getLogs({ address: BOOK, fromBlock: from, toBlock: to })));
      from = to + 1n;
    } catch (e) {
      // "eth_getLogs is limited to a 2,000 range" and its several phrasings.
      const m = /limited to (?:a )?([\d,_]+)\s*(?:block\s*)?range/i.exec(String(e?.message ?? e));
      const allowed = m ? BigInt(m[1].replace(/[,_]/g, "")) : null;
      const next = allowed && allowed > 0n ? allowed : chunk / 2n;
      if (next >= chunk || next < 1n) throw e;
      console.log("  note   the endpoint caps eth_getLogs at " + next + " blocks; rescanning at that size");
      chunk = next;
    }
  }
  return { head, decoded: parseEventLogs({ abi: bookAbi, logs }) };
}

// ---------------------------------------------------------------------------------
// 2. Rebuild each auction, and INDEPENDENTLY re-derive its outcome.
//
// The top-2 walk below is the contract's own rule (GlasshouseBook.sol reveal()) applied to
// the reveals in log order. It is written out here rather than imported on purpose: a
// replay that imports the implementation it is checking is not independent.
// ---------------------------------------------------------------------------------

function rebuild(decoded) {
  const auctions = new Map();
  const get = (maker, orderHash) => {
    const k = maker.toLowerCase() + "-" + orderHash.toLowerCase();
    if (!auctions.has(k)) {
      auctions.set(k, {
        id: k,
        maker: maker.toLowerCase(),
        orderHash: orderHash.toLowerCase(),
        openedAtBlock: null,
        commitEnd: null,
        revealEnd: null,
        exclusiveBlocks: null,
        reserveBps: null,
        maxBps: null,
        bond: null,
        commits: [],
        reveals: [],
        filled: false,
        filledBy: null,
        settled: false,
        settledWinner: null,
        settledClearingBps: null,
        winnerForfeited: null,
        bondsReturned: 0,
        forfeitClaimed: false,
        unrevealedForfeited: 0,
      });
    }
    return auctions.get(k);
  };

  for (const ev of decoded) {
    if (!ev.args || !ev.args.maker || !ev.args.orderHash) continue;
    const a = get(ev.args.maker, ev.args.orderHash);
    const at = Number(ev.blockNumber);
    switch (ev.eventName) {
      case "AuctionOpened":
        a.openedAtBlock = at;
        a.commitEnd = Number(ev.args.commitEnd);
        a.revealEnd = Number(ev.args.revealEnd);
        a.exclusiveBlocks = Number(ev.args.exclusiveBlocks);
        a.reserveBps = Number(ev.args.reserveBps);
        a.maxBps = Number(ev.args.maxBps);
        a.bond = ev.args.bond.toString();
        break;
      case "BidCommitted":
        a.commits.push({
          bidder: ev.args.bidder.toLowerCase(),
          commitIdx: Number(ev.args.commitIdx),
          at,
        });
        break;
      case "BidRevealed":
        a.reveals.push({ bidder: ev.args.bidder.toLowerCase(), bps: Number(ev.args.bps), at });
        break;
      case "AuctionFilled":
        a.filled = true;
        a.filledBy = ev.args.taker.toLowerCase();
        break;
      case "AuctionSettled":
        a.settled = true;
        a.settledWinner = ev.args.winner.toLowerCase();
        a.settledClearingBps = Number(ev.args.clearingBps);
        a.winnerForfeited = Boolean(ev.args.winnerForfeited);
        break;
      case "BondClaimed":
        a.bondsReturned++;
        break;
      case "ForfeitClaimed":
        a.forfeitClaimed = true;
        break;
      case "UnrevealedForfeited":
        a.unrevealedForfeited++;
        break;
    }
  }

  for (const a of auctions.values()) {
    // THE TIE-BREAK IS PART OF THE RULE, and leaving it out is how a replay produces a
    // different winner from the contract without producing a different price.
    // GlasshouseBook.sol:199 leads with `bps > a.bestBps || (bps == a.bestBps && b.commitIdx
    // < a.bestCommitIdx)` -- on an exact tie the EARLIER COMMIT wins, and commit order is
    // not reveal order, so walking the reveals with a strict `>` silently awards the tie to
    // whoever revealed first. secondBps comes out the same either way, so the symptom is a
    // wrong winner on a correct clearing price: a false REPLAY failure on a sound
    // settlement. subgraph/src/book.ts:327-331 gets this right; this now does too.
    const commitIdxOf = new Map(a.commits.map((c) => [c.bidder, c.commitIdx]));
    let best = null;
    let bestBps = 0;
    let bestCommitIdx = Infinity;
    let secondBps = 0;
    for (const r of a.reveals) {
      const idx = commitIdxOf.get(r.bidder) ?? Infinity;
      if (best === null || r.bps > bestBps || (r.bps === bestBps && idx < bestCommitIdx)) {
        if (best !== null) secondBps = bestBps;
        best = r.bidder;
        bestBps = r.bps;
        bestCommitIdx = idx;
      } else if (r.bps > secondBps) {
        secondBps = r.bps;
      }
    }
    const hasWinner = best !== null;
    const clearingBps = hasWinner ? Math.max(secondBps, a.reserveBps ?? 0) : 0;
    const winnerMarginBps = hasWinner ? bestBps - clearingBps : 0;
    const competition = a.reveals.length === 0 ? "NONE" : a.reveals.length === 1 ? "SOLE" : "CONTESTED";
    a.derived = {
      bestBidder: best,
      bestBps: hasWinner ? bestBps : 0,
      secondBps: hasWinner ? secondBps : 0,
      clearingBps,
      winnerMarginBps,
      competition,
      thin: competition === "SOLE" || (competition === "CONTESTED" && winnerMarginBps > clearingBps),
      revealedCount: a.reveals.length,
      committedCount: a.commits.length,
    };
  }
  return [...auctions.values()];
}

// ---------------------------------------------------------------------------------
// 3. The checks.
// ---------------------------------------------------------------------------------

async function main() {
  console.log("\n  verify-run\n  " + "-".repeat(70));
  console.log("  rpc    " + RPC);
  console.log("  book   " + BOOK);

  const { head, decoded } = await readLogs();
  const auctions = rebuild(decoded);
  console.log("  range  " + FROM + " .. " + head);
  console.log("  found  " + decoded.length + " log(s), " + auctions.length + " auction(s)\n");

  if (auctions.length === 0) {
    console.log("  nothing to verify in this range.\n");
    return;
  }

  // --- LIFECYCLE ------------------------------------------------------------------
  const complete = auctions.filter(
    (a) => a.openedAtBlock !== null && a.commits.length > 0 && a.reveals.length > 0 && a.settled,
  );
  const totals =
    auctions.length +
    " opened, " +
    auctions.reduce((n, a) => n + a.commits.length, 0) +
    " commits, " +
    auctions.reduce((n, a) => n + a.reveals.length, 0) +
    " reveals, " +
    auctions.filter((a) => a.filled).length +
    " fills, " +
    auctions.filter((a) => a.settled).length +
    " settlements";
  check(
    "LIFECYCLE",
    complete.length > 0,
    complete.length > 0
      ? complete.length +
          " of " +
          auctions.length +
          " auction(s) ran open -> commit -> reveal -> settle. Totals: " +
          totals +
          "."
      : "no auction in this range got past commit. Totals: " + totals + ".",
  );

  // --- REPLAY ---------------------------------------------------------------------
  const settled = auctions.filter((a) => a.settled);
  const mismatches = settled.filter(
    (a) =>
      (a.derived.bestBidder ?? ZERO) !== a.settledWinner ||
      a.derived.clearingBps !== a.settledClearingBps,
  );
  check(
    "REPLAY",
    settled.length > 0 && mismatches.length === 0,
    settled.length === 0
      ? "no settlement in this range to replay. This is the check that has never run against mainnet."
      : mismatches.length === 0
        ? settled.length +
          " settlement(s) re-derived from the raw reveals match what settle() emitted, winner and clearing price both. e.g. " +
          settled[0].derived.clearingBps +
          " bps to " +
          String(settled[0].settledWinner).slice(0, 10) +
          "…"
        : mismatches.length +
          " of " +
          settled.length +
          " settlement(s) DISAGREE with the replay: " +
          mismatches
            .map(
              (a) =>
                a.orderHash.slice(0, 10) +
                "… emitted " +
                a.settledClearingBps +
                " bps to " +
                String(a.settledWinner).slice(0, 10) +
                "…, replay says " +
                a.derived.clearingBps +
                " bps to " +
                String(a.derived.bestBidder ?? "nobody").slice(0, 10) +
                "…",
            )
            .join("; "),
  );

  // --- WHICH TERM SET THE PRICE ---------------------------------------------------
  //
  // This replaces a check that could not fail. It used to recompute
  // `max(reserveBps, secondBps)` and compare it to the value this file had just assigned
  // from that same expression -- a tautology that passed on a chain with zero reveals and
  // told nobody anything.
  //
  // The question worth asking is the one the product claims: WAS THE PRICE SET BY THE
  // RUNNER-UP, or by the reserve? A second-price auction whose clearing price is always the
  // reserve has never demonstrated the thing that makes it a second-price auction. So this
  // reports the split, and passes only when the chain has actually shown the runner-up arm
  // (`secondBps > reserveBps`) at least once.
  const withWinner = settled.filter((a) => a.derived.bestBidder !== null);
  const bySecond = withWinner.filter((a) => a.derived.secondBps > (a.reserveBps ?? 0));
  const byReserve = withWinner.filter((a) => a.derived.secondBps <= (a.reserveBps ?? 0));
  check(
    "PRICE_SET_BY",
    withWinner.length === 0 ? null : bySecond.length > 0,
    withWinner.length === 0
      ? "n/a: no settled auction has a winner in this range, so no price was set by anything."
      : bySecond.length > 0
        ? bySecond.length +
          " of " +
          withWinner.length +
          " settled auction(s) cleared at the RUNNER-UP's bid, which is the second-price claim actually happening. " +
          byReserve.length +
          " cleared at the reserve. " +
          withWinner
            .map((a) => "reserve " + a.reserveBps + " / second " + a.derived.secondBps + " -> " + a.derived.clearingBps)
            .slice(0, 3)
            .join("; ")
        : "every one of the " +
          withWinner.length +
          " settled auction(s) cleared at the RESERVE, not at a runner-up bid: " +
          withWinner
            .map((a) => "reserve " + a.reserveBps + " / second " + a.derived.secondBps + " -> " + a.derived.clearingBps)
            .join("; ") +
          ". The second-price arm (secondBps > reserveBps) has not been exercised here, so this run does not demonstrate it.",
  );

  // --- THE SITE'S OWN DERIVATION vs THIS ONE --------------------------------------
  const { reserveWindow } = await import("../web/lib/reserve-window.ts");
  const { recommendReserve } = await import("../web/lib/reserve-rule.ts");

  const asBoardRows = auctions.map((a, i) => ({
    round: i,
    orderHash: a.orderHash,
    maker: a.maker,
    openedAtBlock: a.openedAtBlock,
    commitEnd: a.commitEnd,
    revealEnd: a.revealEnd,
    exclusiveEnd: (a.revealEnd ?? 0) + (a.exclusiveBlocks ?? 0),
    reserveBps: a.reserveBps,
    maxBps: a.maxBps,
    committedCount: a.derived.committedCount,
    revealedCount: a.derived.revealedCount,
    bestBidder: a.derived.bestBidder,
    bestBps: a.derived.bestBps,
    secondBps: a.derived.secondBps,
    clearingBps: a.derived.clearingBps,
    filled: a.filled,
    filledBy: a.filledBy,
    settled: a.settled,
    winnerForfeited: a.winnerForfeited ?? false,
    settlementMatchesDerivation: null,
    bids: [],
  }));

  const win = reserveWindow(asBoardRows, Number(head));
  const byRound = new Map(auctions.map((a, i) => [i, a]));
  const siteDisagrees = [];
  for (const row of win.rows) {
    const mine = byRound.get(row.round);
    if (!mine) continue;
    if (row.competition !== mine.derived.competition) {
      siteDisagrees.push("round " + row.round + " competition " + row.competition + " vs " + mine.derived.competition);
    }
    if (row.thin !== mine.derived.thin) {
      siteDisagrees.push("round " + row.round + " thin " + row.thin + " vs " + mine.derived.thin);
    }
    if (row.winnerMarginBps !== mine.derived.winnerMarginBps) {
      siteDisagrees.push("round " + row.round + " margin " + row.winnerMarginBps + " vs " + mine.derived.winnerMarginBps);
    }
    if (row.clearingBps !== mine.derived.clearingBps) {
      siteDisagrees.push("round " + row.round + " clearing " + row.clearingBps + " vs " + mine.derived.clearingBps);
    }
  }
  check(
    "SITE_DERIVATION",
    siteDisagrees.length === 0,
    siteDisagrees.length === 0
      ? "web/lib/reserve-window.ts derives the same clearing price, competition class, thinness and winner margin as this independent replay, over " +
          win.rows.length +
          " settled row(s). " +
          win.unreadable +
          " row(s) dropped as unreadable."
      : "the page's derivation disagrees with the replay: " + siteDisagrees.join("; "),
  );

  // --- TRANSLITERATION DRIFT ------------------------------------------------------
  // The mapping is AssemblyScript and cannot be imported here, so this guard is textual:
  // the two classify/isThin rules must still say the same thing. It is what the header of
  // web/lib/reserve-window.ts warns about, turned into a check rather than a comment.
  const mapping = readFileSync(new URL("../subgraph/src/helpers.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../web/lib/reserve-window.ts", import.meta.url), "utf8");
  const drift = [];
  const hasClassify = (src) => /revealedCount\s*===?\s*0/.test(src) && /revealedCount\s*===?\s*1/.test(src);
  if (!hasClassify(mapping)) drift.push("classify()'s two thresholds not found in subgraph/src/helpers.ts");
  if (!hasClassify(page)) drift.push("classify()'s two thresholds not found in web/lib/reserve-window.ts");
  const thinArm = /winnerMarginBps\s*>\s*clearingBps/;
  if (thinArm.test(mapping) !== thinArm.test(page)) {
    drift.push("isThin()'s contested arm differs between the mapping and the page");
  }
  check(
    "TRANSLITERATION",
    drift.length === 0,
    drift.length === 0
      ? "subgraph/src/helpers.ts and web/lib/reserve-window.ts still express the same classify()/isThin() rule. A textual guard, not a proof -- the real fix is for the page to read the index instead of re-deriving."
      : drift.join("; "),
  );

  // --- PHASE ----------------------------------------------------------------------
  const { phase } = await import("../web/lib/phase.ts");
  const phaseOf = (a) =>
    phase(
      {
        commitEnd: a.commitEnd,
        revealEnd: a.revealEnd,
        exclusiveEnd: (a.revealEnd ?? 0) + (a.exclusiveBlocks ?? 0),
        bestBidder: a.derived.bestBidder,
      },
      Number(head),
    );
  const settledButNotOpen = auctions.filter((a) => a.settled && phaseOf(a) !== "open");
  check(
    "PHASE",
    settled.length === 0 ? null : settledButNotOpen.length === 0,
    settled.length === 0
      ? "n/a: nothing is settled in this range. Note this check is weak even when it runs -- settle() requires n > exclusiveEnd, so a settled auction reads as open at any later head almost by construction. " +
          auctions.map((a) => a.orderHash.slice(0, 10) + "… " + phaseOf(a)).slice(0, 3).join(", ")
      : settledButNotOpen.length === 0
        ? 'every settled auction reads as phase "open" at block ' +
          head +
          ", which is what settle() requires (n > exclusiveEnd) -- near-tautological, and kept only to catch a boundary regression in web/lib/phase.ts. " +
          auctions.map((a) => a.orderHash.slice(0, 10) + "… " + phaseOf(a)).slice(0, 3).join(", ")
        : settledButNotOpen.length +
          " auction(s) are settled but do not read as open -- settle() should have been impossible for them.",
  );

  // --- RESERVE RULE ---------------------------------------------------------------
  const rec = recommendReserve(win.rows);
  check(
    "RESERVE_RULE",
    win.rows.length === 0 ? null : Boolean(rec) && typeof rec.bps === "number",
    win.rows.length === 0
      ? "n/a: no auction in this range is past its reveal window, so the rule ran over an empty window and returned its floor by definition. That is not evidence the rule works."
      : "recommendReserve() over " +
      win.rows.length +
      " settled row(s): " +
      rec.bps +
      " bps, band " +
      rec.band[0] +
      "-" +
      rec.band[1] +
      ", reason " +
      rec.reason +
      ". A heuristic splitting a known-safe floor from a known-unsafe ceiling, not an optimal reserve.",
  );

  // --- BONDS ----------------------------------------------------------------------
  const bondRows = auctions.map((a) => ({
    id: a.orderHash.slice(0, 10),
    committed: a.derived.committedCount,
    revealed: a.derived.revealedCount,
    unrevealed: a.derived.committedCount - a.derived.revealedCount,
    returned: a.bondsReturned,
    forfeited: a.unrevealedForfeited,
  }));
  const overClaimed = bondRows.filter((r) => r.returned + r.forfeited > r.committed);
  const anyBond = auctions.some((a) => BigInt(a.bond ?? "0") > 0n);
  const anyClaim = bondRows.some((r) => r.returned + r.forfeited > 0);
  check(
    "BONDS",
    !anyBond && !anyClaim ? null : overClaimed.length === 0,
    !anyBond && !anyClaim
      ? "n/a: every auction in this range was opened with bond = 0 and nothing was ever claimed, so there is no bond accounting to check. claimBond/claimForfeit/claimUnrevealed are unexercised here."
      : overClaimed.length === 0
      ? "bond dispositions never exceed commitments. " +
          bondRows
            .map(
              (r) =>
                r.id +
                "… " +
                r.committed +
                " committed / " +
                r.revealed +
                " revealed / " +
                r.returned +
                " returned / " +
                r.forfeited +
                " forfeited",
            )
            .join("; ")
      : overClaimed.length + " auction(s) claimed more bonds than were committed.",
  );

  // ---------------------------------------------------------------------------------
  // The summary never folds n/a into passed. "6 of 8 passed" about a chain with no reveals
  // is the exact shape of overstatement this project refuses everywhere else.
  const failed = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === null);
  const passed = results.filter((r) => r.ok === true);
  console.log("\n  " + "-".repeat(70));
  console.log(
    "  " +
      passed.length +
      " passed, " +
      failed.length +
      " failed, " +
      skipped.length +
      " not applicable, of " +
      results.length +
      " checks at block " +
      head,
  );
  if (skipped.length > 0) {
    console.log("  not applicable: " + skipped.map((r) => r.name).join(", ") + " -- see each line above for why.");
  }
  console.log("");

  if (OUT) {
    writeFileSync(
      OUT,
      JSON.stringify(
        { rpc: RPC, book: BOOK, from: FROM.toString(), head: head.toString(), checks: results, auctions },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
      "utf8",
    );
    console.log("  evidence bundle written to " + OUT + "\n");
  }
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\n  verify-run failed to complete: " + (e?.message ?? e) + "\n");
  process.exitCode = 2;
});
