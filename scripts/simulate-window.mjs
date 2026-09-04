#!/usr/bin/env node
// Exclusive-window sizing, by Monte Carlo.
//
// The question: how many blocks should `exclusiveBlocks` be?
//
// The window is not just execution time. It is a free American call granted to the
// winner: they hold the right, not the obligation, to fill at the improved price for W
// blocks, and they will only exercise it when the market has moved their way -- which is
// when it has moved against the maker. So a longer window buys higher bids and pays for
// them in adverse selection, and the question is whether those cancel.
//
// Model, stated so it can be argued with:
//   - Mid price follows a driftless random walk in log space, one step per block.
//   - Bidder i has a private edge e_i (bps) drawn from an exponential: searcher edges are
//     right-skewed, a few large and many small.
//   - A bidder's break-even bid is e_i + O(W), where O(W) is the expected running maximum
//     of the walk over W blocks -- what the waiting right is worth. For a driftless walk
//     that is sigma * sqrt(2W/pi).
//   - Second-price sealed bid: winner is the highest bid, clearing = max(reserve, second).
//   - Maker's net improvement over not running an auction is clearing - dM at the fill
//     block: they captured `clearing` but sold into a mid that had moved by dM.
//
// TWO EXERCISE RULES, reported side by side, because the answer depends on how patient
// searchers are and we should not pretend to know:
//
//   EAGER   fills at the first block where it pays. A bot that wants its profit locked
//           in. This is a LOWER bound on adverse selection -- and note it is internally
//           generous to the mechanism, because bidders paid for a waiting right they
//           then decline to use.
//
//   PATIENT fills at the profit-maximising block, with perfect foresight over the
//           window. No real searcher is clairvoyant, so this is an UPPER bound on what
//           the option can cost the maker. It is the rule the bid model assumes, so it
//           is the internally consistent one.
//
// The truth is between them. If maker net is flat under PATIENT and only mildly rising
// under EAGER, then no window length is worth much revenue and lockup is pure cost.
//
// Reproducible: seeded PRNG, no dependencies.
//
//   node scripts/simulate-window.mjs

const TRIALS = 200_000;
const BLOCK_SECONDS = 2; // Base
const SECONDS_PER_YEAR = 31_536_000;
const MEAN_EDGE_BPS = 150; // mean searcher edge
const RESERVE_BPS = 10;

const WINDOWS = [1, 5, 10, 15, 30, 60, 150];
const VOLS = [
  { label: "ETH/USDC-like", annual: 0.6 },
  { label: "volatile pair", annual: 2.0 },
];
const BIDDER_COUNTS = [2, 3, 5];

// --- seeded PRNG ------------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(rand) {
  let spare = null;
  return function () {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u, v, s;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

// --- one configuration ------------------------------------------------------------

function run(windowBlocks, annualVol, nBidders, seed) {
  const rand = mulberry32(seed);
  const gauss = makeGauss(rand);

  // Per-block volatility in bps.
  const sigmaBlock = (annualVol / Math.sqrt(SECONDS_PER_YEAR / BLOCK_SECONDS)) * 10_000;

  // Expected running maximum of a driftless walk over W steps: sigma * sqrt(2W/pi).
  // This is what the right to wait is worth, and it is what bidders add to their edge.
  const optionValue = sigmaBlock * Math.sqrt((2 * windowBlocks) / Math.PI);

  const stats = {
    eager: { filled: 0, drift: 0, net: 0 },
    patient: { filled: 0, drift: 0, net: 0 },
  };
  let sumClearing = 0;

  const path = new Float64Array(windowBlocks + 1);

  for (let trial = 0; trial < TRIALS; trial++) {
    let best = -Infinity;
    let second = -Infinity;
    let bestEdge = 0;
    for (let i = 0; i < nBidders; i++) {
      const edge = -MEAN_EDGE_BPS * Math.log(1 - rand()); // exponential
      const bid = edge + optionValue;
      if (bid > best) {
        second = best;
        best = bid;
        bestEdge = edge;
      } else if (bid > second) {
        second = bid;
      }
    }
    const clearing = Math.max(RESERVE_BPS, second === -Infinity ? 0 : second);
    sumClearing += clearing;

    // One price path, shared by both exercise rules so they are compared like for like.
    path[0] = 0;
    for (let t = 1; t <= windowBlocks; t++) path[t] = path[t - 1] + sigmaBlock * gauss();

    // EAGER: first block where it pays.
    for (let t = 0; t <= windowBlocks; t++) {
      if (bestEdge + path[t] > clearing) {
        stats.eager.filled++;
        stats.eager.drift += path[t];
        stats.eager.net += clearing - path[t];
        break;
      }
    }

    // PATIENT: the best block in hindsight, if any of them pays.
    let bestT = 0;
    for (let t = 1; t <= windowBlocks; t++) if (path[t] > path[bestT]) bestT = t;
    if (bestEdge + path[bestT] > clearing) {
      stats.patient.filled++;
      stats.patient.drift += path[bestT];
      stats.patient.net += clearing - path[bestT];
    }
  }

  const summarise = (x) => ({
    fillRate: x.filled / TRIALS,
    meanDriftAtFill: x.filled ? x.drift / x.filled : 0,
    makerNet: x.net / TRIALS,
  });

  return {
    windowBlocks,
    seconds: windowBlocks * BLOCK_SECONDS,
    optionValue,
    meanClearing: sumClearing / TRIALS,
    eager: summarise(stats.eager),
    patient: summarise(stats.patient),
  };
}

// --- report -----------------------------------------------------------------------

const f = (x, w = 8, d = 2) => x.toFixed(d).padStart(w);

console.log("\nExclusive-window sizing");
console.log(`${TRIALS.toLocaleString("en-US")} trials per cell, ${BLOCK_SECONDS}s blocks, mean searcher edge ${MEAN_EDGE_BPS} bps, reserve ${RESERVE_BPS} bps`);
console.log("All figures in basis points.\n");

for (const vol of VOLS) {
  for (const n of BIDDER_COUNTS) {
    console.log(`  ${vol.label} (${(vol.annual * 100).toFixed(0)}% annual), ${n} bidders`);
    console.log("                              |        EAGER fill       |       PATIENT fill      |");
    console.log("    W    secs   option  clearing  fill%  drift  maker net  fill%  drift  maker net");
    console.log("    ------------------------------------------------------------------------------");
    let seed = 12345;
    for (const w of WINDOWS) {
      const r = run(w, vol.annual, n, seed++);
      console.log(
        `    ${String(w).padStart(3)}${String(r.seconds).padStart(7)}${f(r.optionValue, 9)}${f(r.meanClearing, 10)}` +
          `${f(r.eager.fillRate * 100, 7, 1)}${f(r.eager.meanDriftAtFill, 7)}${f(r.eager.makerNet, 11)}` +
          `${f(r.patient.fillRate * 100, 7, 1)}${f(r.patient.meanDriftAtFill, 7)}${f(r.patient.makerNet, 11)}`
      );
    }
    console.log("");
  }
}

console.log("  `maker net` = clearing captured minus how far the mid had moved when the");
console.log("  winner chose to fill, averaged over ALL trials including non-fills.");
console.log("  PATIENT is the internally consistent rule: it is the one the bid model");
console.log("  assumes. EAGER is generous to the mechanism, since bidders there pay for a");
console.log("  waiting right they decline to use.\n");
