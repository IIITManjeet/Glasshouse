import { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, parseEther, formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

/**
 * Runs one complete auction on Base mainnet, end to end, from a single command:
 *
 *   npx hardhat run scripts/run-auction.ts --network base
 *
 * One keystore password prompt, not a dozen. The maker is the deployer, whose key lives in
 * the keystore and never leaves it -- Hardhat signs for that account through its own
 * provider. The bidders are ephemeral accounts generated here and funded with dust, so no
 * additional keys need to exist anywhere.
 *
 * WHAT THIS DOES AND DOES NOT DO. It runs the auction lifecycle: open, commit, reveal,
 * outcome, settle. That is what the Book emits and what the subgraph indexes. It does NOT
 * execute a fill, because a fill needs a two-sided position shipped through Aqua and so
 * needs the maker to hold both tokens. The fill through the official Aqua is demonstrated
 * against real Base state in `test/fork/AquaBaseFork.t.sol`.
 *
 * The ephemeral bidder keys exist only in memory for the length of this run. They are
 * funded with roughly a cent of ETH each and are worthless afterwards.
 */

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe" as const;
const ROUTER = "0x5c3baE054e8b4915a13726B397b1AeA864247DBf" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;

// config/auction.json, "advocated"
const COMMIT_BLOCKS = 30n;
const REVEAL_BLOCKS = 30n;
const EXCLUSIVE_BLOCKS = 15n;
const RESERVE_BPS = 50;
const MAX_BPS = 500;
const BOND = 0n; // ephemeral bidders hold no ERC20; bond mechanics are covered by tests

const BIDS = [400, 250] as const; // winner pays the second: 250
const SALT = "0x0000000000000000000000000000000000000000000000000000000000000073" as const;

const GAS_PER_BIDDER = parseEther("0.00002");

const bookAbi = [
  {
    type: "function", name: "open", stateMutability: "nonpayable", outputs: [],
    inputs: [
      { name: "orderHash", type: "bytes32" }, { name: "router", type: "address" },
      { name: "tokenIn", type: "address" }, { name: "commitBlocks", type: "uint40" },
      { name: "revealBlocks", type: "uint40" }, { name: "exclusiveBlocks", type: "uint40" },
      { name: "reserveBps", type: "uint24" }, { name: "maxBps", type: "uint24" },
      { name: "bond", type: "uint128" },
    ],
  },
  {
    type: "function", name: "commit", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }, { name: "commitment", type: "bytes32" }],
  },
  {
    type: "function", name: "reveal", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }, { name: "bps", type: "uint24" }, { name: "salt", type: "bytes32" }],
  },
  {
    type: "function", name: "settle", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }],
  },
  {
    type: "function", name: "commitmentFor", stateMutability: "pure",
    inputs: [{ name: "bidder", type: "address" }, { name: "bps", type: "uint24" }, { name: "salt", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "outcome", stateMutability: "view",
    inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }],
    outputs: [{
      type: "tuple", components: [
        { name: "status", type: "uint8" }, { name: "winner", type: "address" },
        { name: "clearingBps", type: "uint24" }, { name: "exclusiveUntil", type: "uint40" },
      ],
    }],
  },
  {
    type: "function", name: "auctions", stateMutability: "view",
    inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }],
    outputs: [{
      type: "tuple", components: [
        { name: "router", type: "address" }, { name: "tokenIn", type: "address" },
        { name: "commitEnd", type: "uint40" }, { name: "revealEnd", type: "uint40" },
        { name: "exclusiveBlocks", type: "uint40" }, { name: "reserveBps", type: "uint24" },
        { name: "maxBps", type: "uint24" }, { name: "bond", type: "uint128" },
        { name: "best", type: "address" }, { name: "bestBps", type: "uint24" },
        { name: "bestCommitIdx", type: "uint40" }, { name: "secondBps", type: "uint24" },
        { name: "commitCount", type: "uint40" }, { name: "filledBy", type: "address" },
        { name: "settled", type: "bool" }, { name: "winnerForfeited", type: "bool" },
      ],
    }],
  },
] as const;

const STATUS = ["None", "Bidding", "Closed"];
const link = (h: string) => `  https://basescan.org/tx/${h}`;

async function main() {
  const conn = await network.create();
  const [maker] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];

  const pub = createPublicClient({ chain: base, transport: http() });
  const makerWallet = createWalletClient({ account: maker, chain: base, transport: custom(conn.provider) });

  // A distinct order per run, so repeated demos do not collide: one auction may exist per
  // (maker, orderHash) and `commitEnd` is never reset.
  const orderHash = (process.env.ORDER_HASH ??
    `0x${Date.now().toString(16).padStart(64, "0")}`) as `0x${string}`;

  console.log("\n  Glasshouse - live auction on Base mainnet");
  console.log("  ------------------------------------------------------------");
  console.log(`  book        ${BOOK}`);
  console.log(`  maker       ${maker}`);
  console.log(`  orderHash   ${orderHash}`);
  console.log(`  parameters  commit ${COMMIT_BLOCKS} / reveal ${REVEAL_BLOCKS} / exclusive ${EXCLUSIVE_BLOCKS} blocks`);
  console.log(`              reserve ${RESERVE_BPS} bps, max ${MAX_BPS} bps, bond ${BOND}`);
  console.log(`  balance     ${formatEther(await pub.getBalance({ address: maker }))} ETH\n`);

  // --- ephemeral bidders ---------------------------------------------------------
  const bidders = BIDS.map((bps) => {
    const account = privateKeyToAccount(generatePrivateKey());
    return {
      bps,
      account,
      wallet: createWalletClient({ account, chain: base, transport: http() }),
    };
  });

  console.log("  funding ephemeral bidders");
  for (const b of bidders) {
    const hash = await makerWallet.sendTransaction({ to: b.account.address, value: GAS_PER_BIDDER });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${b.account.address}  bids ${b.bps} bps`);
  }

  // --- open ----------------------------------------------------------------------
  console.log("\n  opening the auction");
  let hash = await makerWallet.sendTransaction({
    to: BOOK,
    data: encodeFunctionData({
      abi: bookAbi, functionName: "open",
      args: [orderHash, ROUTER, WETH, COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND],
    }),
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(link(hash));

  const auction = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "auctions", args: [maker, orderHash] });
  const commitEnd = BigInt(auction.commitEnd);
  const revealEnd = BigInt(auction.revealEnd);
  console.log(`  commitEnd ${commitEnd}, revealEnd ${revealEnd}`);

  // --- commit --------------------------------------------------------------------
  console.log("\n  committing sealed bids");
  for (const b of bidders) {
    // Taken from the contract rather than packed by hand: a wrongly packed commitment can
    // never be revealed.
    const commitment = await pub.readContract({
      address: BOOK, abi: bookAbi, functionName: "commitmentFor", args: [b.account.address, b.bps, SALT],
    });
    const h = await b.wallet.sendTransaction({
      to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "commit", args: [maker, orderHash, commitment] }),
    });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  ${b.account.address.slice(0, 10)}...  committed`);
    console.log(link(h));
  }

  const o1 = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "outcome", args: [maker, orderHash] });
  console.log(`\n  status during bidding: ${STATUS[o1.status]}  (nothing can fill)`);

  // --- wait, reveal --------------------------------------------------------------
  await waitFor(pub, commitEnd + 1n, "commit window to close");
  console.log("\n  revealing");
  for (const b of bidders) {
    const h = await b.wallet.sendTransaction({
      to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "reveal", args: [maker, orderHash, b.bps, SALT] }),
    });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  ${b.account.address.slice(0, 10)}...  revealed ${b.bps} bps`);
    console.log(link(h));
  }

  // --- outcome -------------------------------------------------------------------
  await waitFor(pub, revealEnd + 1n, "reveal window to close");
  const o = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "outcome", args: [maker, orderHash] });

  console.log("\n  ------------------------------------------------------------");
  console.log(`  status          ${STATUS[o.status]}`);
  console.log(`  winner          ${o.winner}`);
  console.log(`  clearing        ${o.clearingBps} bps`);
  console.log(`  exclusive until block ${o.exclusiveUntil}`);
  console.log("  ------------------------------------------------------------");

  const expectedWinner = bidders[0].account.address.toLowerCase();
  const ok = o.winner.toLowerCase() === expectedWinner && o.clearingBps === BIDS[1];
  console.log(ok
    ? `  The highest bidder won and pays ${BIDS[1]} bps -- the second bid, not its own.\n`
    : `  UNEXPECTED: expected winner ${expectedWinner} paying ${BIDS[1]} bps.\n`);

  // --- settle --------------------------------------------------------------------
  await waitFor(pub, revealEnd + EXCLUSIVE_BLOCKS + 1n, "exclusive window to elapse");
  hash = await makerWallet.sendTransaction({
    to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "settle", args: [maker, orderHash] }),
  });
  await pub.waitForTransactionReceipt({ hash });
  const final = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "auctions", args: [maker, orderHash] });
  console.log("  settled");
  console.log(link(hash));
  console.log(`  winnerForfeited ${final.winnerForfeited}  (no fill was recorded, and silence is not evidence)\n`);
  console.log(`  orderHash for the subgraph:  ${orderHash}\n`);
}

async function waitFor(pub: ReturnType<typeof createPublicClient>, target: bigint, what: string) {
  let n = await pub.getBlockNumber();
  if (n >= target) return;
  console.log(`\n  waiting for ${what}: block ${n} -> ${target} (about ${Number(target - n) * 2}s)`);
  while (n < target) {
    await new Promise((r) => setTimeout(r, 4000));
    n = await pub.getBlockNumber();
    process.stdout.write(`\r  block ${n}   `);
  }
  process.stdout.write("\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
