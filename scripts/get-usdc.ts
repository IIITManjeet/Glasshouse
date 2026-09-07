import { network } from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
  fallback,
} from "viem";
import { base } from "viem/chains";

/**
 * Swap a little of the maker's ETH into USDC on Base, through Uniswap v3.
 *
 *   npx hardhat run scripts/get-usdc.ts --network base
 *
 * WHY THIS EXISTS. The live fill is a real trade: the winner pays WETH and receives
 * USDC, so the maker has to hold the USDC it pays out. That is inventory, not a fee --
 * the fill itself moves about 0.04 USDC and the rest stays in the wallet. But it has to
 * be there, and `MakerTraitsLib.build` requires tokenA < tokenB, so a WETH-only order is
 * not expressible and some second token is unavoidable.
 *
 * The maker already holds ETH on Base, so nothing needs to be sent from outside. The
 * alternative -- exporting the deployer key into a browser wallet to use a swap UI --
 * moves a mainnet deployer key somewhere it does not need to be. This keeps it in the
 * Hardhat keystore, where the deploy left it, at the cost of one small script.
 *
 * Deliberately conservative: it swaps a fixed small amount, quotes first, and refuses to
 * proceed if the quote implies a price far from the pool's own.
 */

const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
// Uniswap v3 on Base. Verified on chain: both have code, and the 0.05% WETH/USDC pool at
// 0xd0b53D9277642d899DF5C87A3966A349A798F224 is the deepest venue for this pair.
const SWAP_ROUTER_02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
const QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
const POOL_FEE = 500;

// Base's own public endpoint rate limits (-32016 "over rate limit") and is load balanced
// across replicas a block or two apart, so one endpoint is both a throughput ceiling and
// a correctness hazard. BASE_RPC_URL wins when set; otherwise requests spread over
// several public providers, each verified reachable, and viem's fallback moves on when
// one errors.
const ENDPOINTS = process.env.BASE_RPC_URL
  ? [process.env.BASE_RPC_URL]
  : [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.drpc.org",
      "https://1rpc.io/base",
      "https://base.meowrpc.com",
    ];
const transport = () => fallback(ENDPOINTS.map((u) => http(u, { retryCount: 2, retryDelay: 800 })));

/** Retry a read through rate limiting. viem retries some codes but not -32016, which is
 *  what Base returns, so a burst of polling reads dies on the public endpoint. */
async function rl<T>(fn: () => Promise<T>, what: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e);
      if (attempt >= 6 || !/over rate limit|-32016|429|too many requests/i.test(msg)) throw e;
      const wait = 1000 * 2 ** (attempt - 1);
      console.log(`  ${what}: rate limited, waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** ~$2 at $2,500/ETH. The live run needs about 0.04 USDC; the declared strategy balance
 *  is what makes this larger, and all of it stays in the wallet. */
const SPEND = parseEther("0.0009");
/** Leave far more than the ~0.00005 ETH the live run costs in gas. */
const MIN_ETH_LEFT = parseEther("0.002");
/** The swap is 0.0009 ETH against ~1e18 of pool liquidity, so price impact is nil. A 1%
 *  bound is slippage protection, not an expectation. */
const SLIPPAGE_BPS = 100n;

const erc20Abi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

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
] as const;

// SwapRouter02's ExactInputSingleParams has NO deadline field, unlike the original
// SwapRouter. Getting this wrong produces an ABI mismatch rather than a clear error.
const routerAbi = [
  {
    type: "function", name: "exactInputSingle", stateMutability: "payable",
    inputs: [{
      type: "tuple", name: "params", components: [
        { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
        { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

async function main() {
  const conn = await network.create();
  const [account] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];
  const me = getAddress(account);

  const pub = createPublicClient({ chain: base, transport: transport() });
  const wallet = createWalletClient({ account, chain: base, transport: custom(conn.provider) });

  const mined = async (hash: `0x${string}`, what: string) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    // viem resolves reverted receipts without throwing.
    if (r.status !== "success") throw new Error(`${what} REVERTED: https://basescan.org/tx/${hash}`);
    console.log(`  https://basescan.org/tx/${hash}`);
    return r;
  };

  const ethBefore = await rl(() => pub.getBalance({ address: me }), "eth balance");
  const usdcBefore = await rl(() => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [me] }), "usdc balance");

  console.log("\n  Glasshouse - fund the maker with USDC on Base");
  console.log("  ------------------------------------------------------------");
  console.log(`  account     ${me}`);
  console.log(`  ETH         ${formatEther(ethBefore)}`);
  console.log(`  USDC        ${formatUnits(usdcBefore, 6)}`);
  console.log(`  swapping    ${formatEther(SPEND)} ETH -> USDC via Uniswap v3 (${POOL_FEE / 10000}% pool)\n`);

  if (ethBefore < SPEND + MIN_ETH_LEFT) {
    throw new Error(`balance ${formatEther(ethBefore)} ETH is too low to spend ${formatEther(SPEND)} and still keep ${formatEther(MIN_ETH_LEFT)} for gas`);
  }

  // Quote first. quoteExactInputSingle is nonpayable by signature but is meant to be
  // simulated, so it is called rather than sent.
  const { result: quote } = await pub.simulateContract({
    address: QUOTER_V2, abi: quoterAbi, functionName: "quoteExactInputSingle",
    args: [{ tokenIn: WETH, tokenOut: USDC, amountIn: SPEND, fee: POOL_FEE, sqrtPriceLimitX96: 0n }],
    account: me,
  });
  const expectedOut = quote[0] as bigint;
  const minOut = (expectedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const impliedPrice = (expectedOut * 10n ** 12n) / SPEND;
  console.log(`  quote       ${formatUnits(expectedOut, 6)} USDC  (implied ${impliedPrice} USDC/ETH)`);
  console.log(`  minimum     ${formatUnits(minOut, 6)} USDC at ${Number(SLIPPAGE_BPS) / 100}% slippage`);

  if (impliedPrice < 500n || impliedPrice > 20_000n) {
    throw new Error(`the quote implies ${impliedPrice} USDC/ETH, which is not a plausible price. Refusing to swap into a pool this far from the market.`);
  }

  // Idempotent: wrap only the shortfall. A re-run after a failed swap must not wrap a
  // second SPEND on top of WETH that is already sitting there.
  const wethHeld = await rl(() => pub.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [me] }), "weth balance");
  if (wethHeld >= SPEND) {
    console.log(`\n  already holding ${formatEther(wethHeld)} WETH, skipping the wrap`);
  } else {
    const shortfall = SPEND - wethHeld;
    console.log(`\n  wrapping ${formatEther(shortfall)} ETH`);
    await mined(await wallet.sendTransaction({
      to: WETH, value: shortfall, data: encodeFunctionData({ abi: erc20Abi, functionName: "deposit", args: [] }),
    }), "deposit");
  }

  const allowance = await rl(() => pub.readContract({ address: WETH, abi: erc20Abi, functionName: "allowance", args: [me, SWAP_ROUTER_02] }), "allowance");
  if (allowance < SPEND) {
    console.log("\n  approving WETH to the Uniswap router");
    await mined(await wallet.sendTransaction({
      to: WETH, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER_02, SPEND * 10n] }),
    }), "approve");
  }

  // WAIT FOR THE APPROVAL TO BE VISIBLE BEFORE SWAPPING.
  //
  // viem runs eth_estimateGas at "latest" inside sendTransaction, and Base's public
  // endpoint is load balanced. The first attempt at this script died exactly here: the
  // approve was mined, but the estimate landed on a replica that had not applied that
  // block, so the allowance read as zero and Uniswap's TransferHelper reverted with
  // "STF". That message points at the token transfer and says nothing about the real
  // cause -- the transaction was correct and the node answering was behind. The same
  // call simulated clean seconds later.
  for (let i = 0; i < 10; i++) {
    const a = await rl(() => pub.readContract({ address: WETH, abi: erc20Abi, functionName: "allowance", args: [me, SWAP_ROUTER_02] }), "allowance poll");
    const b = await rl(() => pub.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [me] }), "balance poll");
    if (a >= SPEND && b >= SPEND) break;
    if (i === 9) throw new Error(`after 10 tries the endpoints still report allowance ${a} and balance ${b}, needing ${SPEND}`);
    console.log(`  waiting for the approval to be visible (${i + 1}/10)`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n  swapping");
  const swapData = encodeFunctionData({
    abi: routerAbi, functionName: "exactInputSingle",
    args: [{
      tokenIn: WETH, tokenOut: USDC, fee: POOL_FEE, recipient: me,
      amountIn: SPEND, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
    }],
  });
  // And retry STF anyway: the estimate can be served by a different replica than the
  // reads above, so confirming visibility on one endpoint does not bind the next call.
  for (let attempt = 1; ; attempt++) {
    try {
      await mined(await wallet.sendTransaction({ to: SWAP_ROUTER_02, data: swapData }), "swap");
      break;
    } catch (e: any) {
      const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e);
      if (!/STF/.test(msg) || attempt === 5) throw e;
      console.log(`  attempt ${attempt} hit STF (a replica behind on the approval); retrying in 4s`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  const ethAfter = await rl(() => pub.getBalance({ address: me }), "eth after");
  const usdcAfter = await rl(() => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [me] }), "usdc after");

  console.log("\n  ------------------------------------------------------------");
  console.log(`  ETH   ${formatEther(ethBefore)}  ->  ${formatEther(ethAfter)}`);
  console.log(`  USDC  ${formatUnits(usdcBefore, 6)}  ->  ${formatUnits(usdcAfter, 6)}`);
  console.log("  ------------------------------------------------------------\n");

  if (usdcAfter < 1_000_000n) {
    console.log("  NOTE: under 1 USDC. Run again, or lower the declared strategy balance\n");
  } else {
    console.log("  Enough for the live run. Next: npx hardhat run scripts/run-live-fill.ts --network base\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
