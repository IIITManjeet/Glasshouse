#!/usr/bin/env node
// What would this trade have got on Uniswap? -- an external anchor for Glasshouse's price
// -improvement claim, which is otherwise measured only against SwapVM's OWN other
// instructions (test/solidity/Comparison.t.sol, per run.md's Fri-05 gate: identity 10000,
// clock 10618, bid 9756 bps of base -- lower is better for the maker). That is an internal
// yardstick. A judge's sharpest question is "improvement against what?", and this answers
// it with a number nobody on this team computed.
//
// run.md F-96, verbatim: "Build on or integrate any part of the Uniswap stack, including
// the Uniswap API, the Uniswap AMM (v2, v3, or v4), CCA, or any other Uniswap protocol."
// Quoting the deployed Uniswap v3 QuoterV2 on Base -- the same contract scripts/get-usdc.ts
// already calls to fund the maker -- qualifies, and it strengthens the core argument rather
// than bolting a checkbox onto it.
//
//   node scripts/uniswap-benchmark.mjs
//   node scripts/uniswap-benchmark.mjs --weth 0.00001 --block 51000000
//   node scripts/uniswap-benchmark.mjs --weth 0.001
//   BASE_RPC_URL=https://your-archive-node node scripts/uniswap-benchmark.mjs --block 50000000
//
// WHAT THIS DOES NOT CLAIM AND WILL NOT HIDE.
//
// Glasshouse's live order declares 0.0008 WETH / 2 USDC to Aqua as its curve's reserves
// (run-live-fill.ts:71-72, LiveFillPreflight.t.sol:56-62) -- sized so the maker's wallet
// can actually cover a fill, not sized as market-making inventory. Uniswap's WETH/USDC
// 0.05% pool on Base holds real liquidity many orders of magnitude deeper. This script
// reads the pool's own token balances at the SAME block as the quote so that is a chain
// fact printed alongside the numbers, not an assertion. A constant-product curve this thin
// will show more slippage than a deep AMM pool at any size that is a meaningful fraction of
// it, full stop -- and Glasshouse's own "improvement" bps is measured against ITS OWN
// unauctioned base price (maker-side extraction), never against Uniswap. The two are not
// interchangeable, and printing them side by side is not a claim that they are.
//
// The comparison below is computed once and printed with a sign, not with an if/else that
// only has words for the outcome that flatters Glasshouse. When Uniswap's quote is larger,
// this script says Uniswap's quote is larger -- see "computeVerdict" and its output.

import { createPublicClient, http, fallback, formatEther, formatUnits, parseEther } from "viem";
import { base } from "viem/chains";
import { pathToFileURL } from "node:url";

import { rpc } from "./lib/chain.ts";

// --- connectivity ----------------------------------------------------------------------
//
// Deliberately NOT lib/chain.ts's baseTransport(). That helper puts WebSocket
// subscriptions first because the write-and-wait scripts (run-live-fill.ts, get-usdc.ts)
// need to watch for blocks across a lockup window that can run minutes long. This script
// makes a handful of eth_call requests and exits; an open WebSocket left behind would keep
// the event loop alive and the process would hang after printing its answer instead of
// returning. Plain HTTP, spread over the same public Base endpoints preflight.mjs and the
// pre-chain.ts get-usdc.ts used, with retry through rpc()'s backoff for the rate limiting
// and replica lag those endpoints are known to produce (lib/chain.ts:36-48).
//
// BASE_RPC_URL, when set, is used EXCLUSIVELY, matching baseTransport()'s own rule: an
// override that silently widens back out to the public internet on a failure is not an
// override.
const HTTP_ENDPOINTS = process.env.BASE_RPC_URL
  ? [process.env.BASE_RPC_URL]
  : [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.drpc.org",
      "https://1rpc.io/base",
      "https://base.meowrpc.com",
    ];

function makeClient() {
  return createPublicClient({
    chain: base,
    transport: fallback(HTTP_ENDPOINTS.map((u) => http(u, { retryCount: 2, retryDelay: 800 }))),
  });
}

// --- addresses, verified on chain (see scripts/get-usdc.ts's own header comment) -------
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const POOL = "0xd0b53D9277642d899DF5C87A3966A349A798F224"; // WETH/USDC 0.05%
const POOL_FEE = 500;

// --- Glasshouse's live order, from run-live-fill.ts (the constants that are actually
// broadcast) and LiveFillPreflight.t.sol (the fork test that proves they fill) --------
const DEFAULT_SWAP_AMOUNT = 10_000_000_000_000n; // 0.00001 WETH -- run-live-fill.ts:73
const DECLARED_WETH = 800_000_000_000_000n; // 0.0008 WETH -- run-live-fill.ts:71
const DECLARED_USDC = 2_000_000n; // 2 USDC -- run-live-fill.ts:72
const DEFAULT_CLEARING_BPS = 250n; // the rival's bid, what the winner actually paid -- run-live-fill.ts:82,94
const RESERVE_BPS = 50n; // config/auction.json "advocated"
const MAX_BPS = 500n; // config/auction.json "advocated"

// The two numbers LiveFillPreflight.t.sol / run-live-fill.ts assert for this exact input.
// Used below as a sanity check on the JS reimplementation of the Solidity math, not as a
// value this script ever substitutes in place of computing it.
const KNOWN_GOOD = { amountIn: DEFAULT_SWAP_AMOUNT, base: 24_691n, improved: 24_096n };

const erc20Abi = [
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }],
  },
];

const quoterAbi = [
  {
    type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
    inputs: [{
      type: "tuple", name: "params", components: [
        { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
        { name: "amountIn", type: "uint256" }, { name: "fee", type: "uint24" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    outputs: [
      { name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" }, { name: "gasEstimate", type: "uint256" },
    ],
  },
];

// --- Glasshouse's own curve, reimplemented in JS from the Solidity it mirrors ----------
//
// XYCSwap.exec (node_modules/@1inch/swap-vm/src/instructions/XYCSwap.sol:38-40), exact-in:
//   amountOut = amountIn * balanceOut / (balanceIn + amountIn)     -- floor division
//
// GlasshouseAuctionLib.applyOutcome (src/lib/GlasshouseAuctionLib.sol:70), for a fill
// inside the winner's exclusive window:
//   balanceIn := ceilDiv(balanceIn * (BPS + clearingBps), BPS)     -- BPS = 10_000
//
// So the winner's price is the base-price curve run against a balanceIn inflated by the
// clearing bps; a base-price ("nobody bid, or outside the exclusive window") fill is the
// same curve at clearingBps = 0. BigInt throughout: no floating point, same rounding
// direction (floor / ceil) as the Solidity, on the same integers.
export function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

export function xycAmountOut(amountIn, balanceIn, balanceOut, clearingBps) {
  const effectiveBalanceIn = clearingBps === 0n ? balanceIn : ceilDiv(balanceIn * (10_000n + clearingBps), 10_000n);
  return (amountIn * balanceOut) / (effectiveBalanceIn + amountIn);
}

// USDC (6 decimals) per WETH (18 decimals), as an integer -- matches get-usdc.ts:131's
// impliedPrice convention exactly, so the numbers in this script's output and that
// script's are directly comparable.
function impliedPrice(amountOutUsdc, amountInWeth) {
  if (amountInWeth === 0n) return 0n;
  return (amountOutUsdc * 10n ** 12n) / amountInWeth;
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function usage() {
  console.error(
    [
      "usage: node scripts/uniswap-benchmark.mjs [--weth <amount>] [--block <number|latest>]",
      "                                          [--clearing-bps <n>] [--declared-weth <amount>] [--declared-usdc <amount>]",
      "",
      "  --weth           WETH amount to trade, in ether units (default 0.00001, the live fill's SWAP_AMOUNT)",
      "  --block           block to pin BOTH quotes to, for a fair snapshot-in-time comparison (default: latest)",
      "  --clearing-bps    the auction's clearing premium to apply to Glasshouse's improved price (default 250, the real settled bid)",
      "  --declared-weth   override Glasshouse's declared WETH reserve (default 0.0008, the live order's)",
      "  --declared-usdc   override Glasshouse's declared USDC reserve, in USDC units, i.e. 6 decimals (default 2000000 = 2 USDC)",
    ].join("\n"),
  );
}

export function parseArgs(argv) {
  const args = {
    weth: DEFAULT_SWAP_AMOUNT,
    block: null, // null = latest, resolved at run time
    clearingBps: DEFAULT_CLEARING_BPS,
    declaredWeth: DECLARED_WETH,
    declaredUsdc: DECLARED_USDC,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--weth") args.weth = parseEther(argv[++i]);
    else if (a === "--block") {
      const v = argv[++i];
      args.block = v === "latest" ? null : BigInt(v);
    } else if (a === "--clearing-bps") args.clearingBps = BigInt(argv[++i]);
    else if (a === "--declared-weth") args.declaredWeth = parseEther(argv[++i]);
    else if (a === "--declared-usdc") args.declaredUsdc = BigInt(argv[++i]);
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`uniswap-benchmark: unrecognised argument "${a}"`);
    }
  }
  if (args.weth <= 0n) throw new Error("--weth must be positive");
  return args;
}

// Symmetric by construction: one signed subtraction, one piece of code that renders it,
// no branch that only has words for the direction that flatters Glasshouse. Used twice
// below, once against the base price and once against the improved price, so a reader
// gets both comparisons in the same honest shape.
function verdictLine(label, glasshouseOut, uniswapOut, amountIn) {
  const diff = glasshouseOut - uniswapOut;
  const bps = amountIn === 0n ? 0n : (diff * 10_000n) / (uniswapOut === 0n ? 1n : uniswapOut);
  if (diff === 0n) return `  ${label}: identical to Uniswap's quote at this size`;
  const who = diff > 0n ? "Glasshouse" : "Uniswap";
  const abs = diff > 0n ? diff : -diff;
  const absBps = bps > 0n ? bps : -bps;
  return `  ${label}: ${who} gives MORE USDC out — by ${abs} units (${absBps} bps of Uniswap's quote)`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = makeClient();

  const head = await rpc(() => client.getBlockNumber(), "head");
  const block = args.block ?? head;
  if (args.block !== null && args.block > head) {
    throw new Error(`--block ${args.block} is ahead of the current head ${head}`);
  }

  console.log("\n  Glasshouse vs Uniswap v3 — an external benchmark, not an internal one");
  console.log("  ------------------------------------------------------------------------");
  console.log(`  WETH in       ${formatEther(args.weth)} (${args.weth} wei)`);
  console.log(`  block         ${block}${args.block === null ? `  (latest, was ${head} when this ran)` : ""}`);
  console.log(`  clearing bps  ${args.clearingBps}  (0 = base/unauctioned price, 250 = the live fill's settled clearing bid)`);
  console.log("");

  // --- Uniswap v3, pinned to `block` ----------------------------------------------------
  const { result: uniswapQuote } = await rpc(
    () =>
      client.simulateContract({
        address: QUOTER_V2,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: WETH, tokenOut: USDC, amountIn: args.weth, fee: POOL_FEE, sqrtPriceLimitX96: 0n }],
        blockNumber: block,
      }),
    "uniswap quote",
  );
  const uniswapOut = uniswapQuote[0];

  // Pool's own token balances, at the SAME block as the quote -- not a claim about
  // Uniswap's concentrated-liquidity depth (that is tick-distributed, not a flat
  // reserve), but a real, checkable lower bound on how much bigger this pool is than
  // Glasshouse's declared curve.
  const [poolWeth, poolUsdc] = await Promise.all([
    rpc(() => client.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [POOL], blockNumber: block }), "pool weth balance"),
    rpc(() => client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [POOL], blockNumber: block }), "pool usdc balance"),
  ]);

  // --- Glasshouse's synthetic curve, computed (not looked up) at the same amountIn -----
  const glasshouseBaseOut = xycAmountOut(args.weth, args.declaredWeth, args.declaredUsdc, 0n);
  const glasshouseImprovedOut = xycAmountOut(args.weth, args.declaredWeth, args.declaredUsdc, args.clearingBps);

  // Ground-truth check: if this ever disagrees with LiveFillPreflight.t.sol's own
  // asserted numbers for the exact input that test uses, the JS reimplementation of the
  // Solidity math above has drifted from the contracts, and that is a bug in THIS
  // script, not a new finding about Glasshouse. Fail loudly rather than print a wrong
  // number with a straight face.
  if (args.weth === KNOWN_GOOD.amountIn && args.declaredWeth === DECLARED_WETH && args.declaredUsdc === DECLARED_USDC && args.clearingBps === DEFAULT_CLEARING_BPS) {
    if (glasshouseBaseOut !== KNOWN_GOOD.base || glasshouseImprovedOut !== KNOWN_GOOD.improved) {
      throw new Error(
        `sanity check failed: recomputed base=${glasshouseBaseOut} improved=${glasshouseImprovedOut}, ` +
          `but LiveFillPreflight.t.sol / run-live-fill.ts assert base=${KNOWN_GOOD.base} improved=${KNOWN_GOOD.improved} ` +
          `for this exact input. The XYCSwap/GlasshouseAuctionLib reimplementation above has drifted from the Solidity.`,
      );
    }
  }

  console.log("  QUOTES (all for the same WETH-in amount, at the same block where it matters)");
  console.log(`    Uniswap v3 (${POOL_FEE / 10000}% pool)   ${uniswapOut} USDC units   (implied ${impliedPrice(uniswapOut, args.weth)} USDC/WETH)`);
  console.log(`    Glasshouse, base price      ${glasshouseBaseOut} USDC units   (implied ${impliedPrice(glasshouseBaseOut, args.weth)} USDC/WETH)`);
  console.log(`    Glasshouse, improved price  ${glasshouseImprovedOut} USDC units   (implied ${impliedPrice(glasshouseImprovedOut, args.weth)} USDC/WETH)  — what the auction's winner actually receives`);
  console.log("");

  console.log("  DEPTH (why this is not apples to apples)");
  console.log(`    Uniswap pool ${short(POOL)} holds   ${formatEther(poolWeth)} WETH / ${formatUnits(poolUsdc, 6)} USDC at block ${block}`);
  console.log(`    Glasshouse declares               ${formatEther(args.declaredWeth)} WETH / ${formatUnits(args.declaredUsdc, 6)} USDC (run-live-fill.ts:71-72, what was actually shipped to Aqua)`);
  const depthRatio = args.declaredWeth === 0n ? null : poolWeth / args.declaredWeth;
  if (depthRatio !== null) {
    console.log(`    that is roughly ${depthRatio}x more WETH on the Uniswap side — a synthetic curve this thin will show more slippage than a deep AMM pool at any size that is a meaningful fraction of it`);
  }
  console.log("");

  console.log("  COMPARISON, computed with a sign so a Uniswap win prints exactly as plainly as a Glasshouse one");
  console.log(verdictLine("vs Glasshouse base price    ", glasshouseBaseOut, uniswapOut, args.weth));
  console.log(verdictLine("vs Glasshouse improved price", glasshouseImprovedOut, uniswapOut, args.weth));
  console.log("");

  console.log("  WHAT THIS DOES AND DOES NOT SHOW");
  console.log("    - Glasshouse's own \"price improvement\" (bid vs base, Comparison.t.sol) is measured against its OWN");
  console.log("      unauctioned price, i.e. how much of the auction premium the maker captures. It is a maker-side number.");
  console.log("    - This script instead asks a taker-side question: at this size and this block, would a taker have done");
  console.log("      better on Uniswap? The pools are different sizes (see DEPTH above), so the answer here is a fact about");
  console.log("      THESE two specific pools at THIS size — not a general claim that either mechanism is better.");
  console.log("    - If Uniswap's quote comes out ahead, that is not hidden: the COMPARISON lines above say so, unconditionally.");
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exitCode = 1;
  });
}
