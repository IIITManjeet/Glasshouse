#!/usr/bin/env node
// SEND THE EPHEMERAL BIDDERS' LEFTOVER ETH BACK TO THE MAKER.
//
//   node scripts/sweep-bidders.mjs                 # report only, sends nothing
//   node scripts/sweep-bidders.mjs --send          # actually sweep
//
// WHY THIS EXISTS. `scripts/run-live-fill.ts` funds two throwaway wallets and writes their
// private keys to `.ephemeral-bidders.json` BEFORE the funding, so that a run which dies
// midway leaves the money recoverable rather than lost. Its own log says the keys are
// "sweepable if this run dies" -- but nothing in the repo could sweep them, so that word
// was an assertion, not a capability. An earlier run had already lost 0.00031 ETH this way.
//
// It matters on a SUCCESSFUL run too, which is how this came to be written. The bidders are
// funded with a gas allowance sized so neither can run dry between commit and reveal -- a
// bidder stranded inside a 60-second window is the one failure that looks exactly like the
// withheld-reveal attack the mechanism exists to punish. Sizing it generously is correct,
// and it means most of the allowance is still there afterwards: after the first mainnet
// live fill, 0.000297 ETH was sitting in the two wallets, MORE than the maker had left.
//
// NO KEYSTORE. These are throwaway keys in a gitignored file, not the deployer key, so this
// runs without a password prompt -- unlike everything else here that spends.

import { existsSync, readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, formatEther, getAddress } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const MAKER = "0xeEbf737F92C8F0d9070f35a7D9BAf416923bEcDf";
const KEYFILE = new URL("../.ephemeral-bidders.json", import.meta.url);
const SEND = process.argv.includes("--send");

// A plain ETH transfer is 21,000 gas. The buffer covers Base's L1 data fee and any drift
// in the gas price between estimating and landing: sweeping is worth doing only if it
// succeeds, and a transaction that reverts for being a few wei short wastes the fee and
// leaves the balance where it was.
const TRANSFER_GAS = 21_000n;
const FEE_BUFFER = 4n;

async function main() {
  if (!existsSync(KEYFILE)) {
    console.log("\n  no .ephemeral-bidders.json -- nothing to sweep.\n");
    return;
  }

  const bidders = JSON.parse(readFileSync(KEYFILE, "utf8"));
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  const gasPrice = await pub.getGasPrice();
  const reserve = TRANSFER_GAS * gasPrice * FEE_BUFFER;

  console.log("\n  Glasshouse - sweep the ephemeral bidders back to the maker");
  console.log("  ------------------------------------------------------------");
  console.log(`  to          ${MAKER}`);
  console.log(`  gas price   ${gasPrice} wei, reserving ${formatEther(reserve)} ETH per wallet`);
  console.log(`  mode        ${SEND ? "SEND" : "report only (pass --send to sweep)"}`);
  console.log("  ------------------------------------------------------------\n");

  const balanceBefore = await pub.getBalance({ address: getAddress(MAKER) });

  let swept = 0n;
  let left = 0n;

  for (const b of bidders) {
    const account = privateKeyToAccount(b.privateKey);
    const balance = await pub.getBalance({ address: account.address });

    if (balance <= reserve) {
      // Not an error: a wallet that spent its whole allowance is the normal end state for
      // a run that went long, and sending a transaction to move less than it costs would
      // destroy value rather than recover it.
      console.log(`  ${b.role.padEnd(7)} ${account.address}  ${formatEther(balance)} ETH  -- below the fee, leaving it`);
      left += balance;
      continue;
    }

    const value = balance - reserve;
    console.log(`  ${b.role.padEnd(7)} ${account.address}  ${formatEther(balance)} ETH  -> sweeping ${formatEther(value)}`);

    if (!SEND) {
      swept += value;
      continue;
    }

    const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });
    const hash = await wallet.sendTransaction({ to: getAddress(MAKER), value, gas: TRANSFER_GAS });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") {
      console.log(`          REVERTED: https://basescan.org/tx/${hash}`);
      continue;
    }
    console.log(`          https://basescan.org/tx/${hash}`);
    swept += value;
  }

  console.log("\n  ------------------------------------------------------------");
  console.log(`  ${SEND ? "swept" : "recoverable"}  ${formatEther(swept)} ETH`);
  if (left > 0n) console.log(`  left behind  ${formatEther(left)} ETH (below the cost of moving it)`);
  if (SEND) {
    // POLL, DO NOT JUST READ. Base's public endpoint is load balanced, and the first run
    // of this printed 0.000446 ETH when the true figure was 0.000545 -- the second sweep's
    // receipt had been waited for, but the balance read landed on a replica that had not
    // applied that block yet. get-usdc.ts hit the same thing and documents it. Printing a
    // stale number is a poor look anywhere; on this project it is the thing we lint the
    // site for.
    const before = balanceBefore;
    let after = await pub.getBalance({ address: getAddress(MAKER) });
    for (let i = 0; i < 10 && after < before + swept; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      after = await pub.getBalance({ address: getAddress(MAKER) });
    }
    const settled = after >= before + swept;
    console.log(`  maker now    ${formatEther(after)} ETH${settled ? "" : "  (endpoint still behind; the sweeps are mined, this read is not caught up)"}`);
  } else {
    console.log("  nothing was sent. Re-run with --send to sweep.");
  }
  console.log("  ------------------------------------------------------------\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
