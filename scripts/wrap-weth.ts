import { network } from "hardhat";
import { createWalletClient, custom, encodeFunctionData, formatEther, getAddress, parseEther } from "viem";
import { base } from "viem/chains";
import { basePublicClient, rpc } from "./lib/chain.ts";

/**
 * Wrap a little of the maker's ETH into WETH on Base.
 *
 *   npx hardhat run scripts/wrap-weth.ts --network base
 *
 * WHY THIS EXISTS. `Aqua.ship` declares depth in BOTH legs of the pair, and the keeper
 * declares 0.0004 WETH per round. The maker holds USDC and ETH but zero WETH, so the
 * very first mainnet round reverts inside ship before anything interesting happens.
 * This is the one transaction standing between the keeper and its first real round.
 *
 * A `cast send --interactive` would do the same job in one line, at the cost of typing a
 * mainnet deployer key into a shell. The key lives in Hardhat's keystore, where the
 * deploy left it; this keeps it there, the same trade `get-usdc.ts` already makes.
 *
 * get-usdc.ts also wraps, but wraps in order to swap the WETH away again, and refuses
 * below 0.002 ETH -- both wrong here, where the WETH is the point and the balance is
 * smaller than that floor.
 *
 * IDEMPOTENT: wraps only the shortfall against TARGET. Re-running after a wrap that
 * landed does nothing rather than wrapping a second time.
 */

const WETH = "0x4200000000000000000000000000000000000006" as const;
const MAKER = "0xeEbf737F92C8F0d9070f35a7D9BAf416923bEcDf" as const;

// The keeper declares 0.0004 WETH of depth per round (BALANCE_WETH in keeper.ts). One
// round needs exactly that; the extra is headroom so a second round does not need a
// second trip to this script.
const TARGET = parseEther("0.0005");

// Keep enough behind for the keeper's own seven transactions. At Base's current ~0.006
// gwei that whole round costs well under 0.00002 ETH, so this is generous by two orders
// of magnitude -- deliberately, because running out of gas mid-round leaves an auction
// open on the board with no one able to settle it.
const MIN_ETH_LEFT = parseEther("0.0003");

const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const conn = await network.create();
  const [account] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];
  const me = getAddress(account);

  // The same guard the keeper makes: every order in config/rounds.json is built for this
  // maker and the order hash includes it, so wrapping for anyone else funds the wrong
  // wallet and the keeper still reverts.
  if (me !== getAddress(MAKER)) {
    throw new Error(`the keystore account is ${me}, but the keeper opens rounds as ${MAKER}. Wrapping here would fund the wrong wallet.`);
  }

  const pub = basePublicClient();
  const wallet = createWalletClient({ account, chain: base, transport: custom(conn.provider) });

  const eth = await rpc(() => pub.getBalance({ address: me }), "eth balance");
  const weth = await rpc(() => pub.readContract({ address: WETH, abi: wethAbi, functionName: "balanceOf", args: [me] }), "weth balance");

  console.log("\n  Glasshouse - wrap ETH so the keeper can back its declared depth");
  console.log("  ------------------------------------------------------------");
  console.log(`  account     ${me}`);
  console.log(`  ETH         ${formatEther(eth)}`);
  console.log(`  WETH        ${formatEther(weth)}`);
  console.log(`  target      ${formatEther(TARGET)} WETH`);
  console.log("  ------------------------------------------------------------");

  if (weth >= TARGET) {
    console.log(`\n  already holding ${formatEther(weth)} WETH. Nothing to do.\n`);
    return;
  }

  const shortfall = TARGET - weth;
  if (eth < shortfall + MIN_ETH_LEFT) {
    throw new Error(
      `balance ${formatEther(eth)} ETH cannot wrap ${formatEther(shortfall)} and still keep ${formatEther(MIN_ETH_LEFT)} for the keeper's gas.`,
    );
  }

  console.log(`\n  wrapping ${formatEther(shortfall)} ETH`);
  const hash = await wallet.sendTransaction({
    to: WETH,
    value: shortfall,
    data: encodeFunctionData({ abi: wethAbi, functionName: "deposit", args: [] }),
  });
  const r = await rpc(() => pub.waitForTransactionReceipt({ hash }), "receipt for deposit");
  if (r.status !== "success") throw new Error(`deposit REVERTED: https://basescan.org/tx/${hash}`);
  console.log(`  https://basescan.org/tx/${hash}`);

  const ethAfter = await rpc(() => pub.getBalance({ address: me }), "eth after");
  const wethAfter = await rpc(() => pub.readContract({ address: WETH, abi: wethAbi, functionName: "balanceOf", args: [me] }), "weth after");

  console.log("\n  ------------------------------------------------------------");
  console.log(`  ETH   ${formatEther(eth)}  ->  ${formatEther(ethAfter)}`);
  console.log(`  WETH  ${formatEther(weth)}  ->  ${formatEther(wethAfter)}`);
  console.log("  ------------------------------------------------------------\n");
  console.log("  Next: KEEPER_MAX_ROUNDS=1 npx hardhat run scripts/keeper.ts --network base\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
