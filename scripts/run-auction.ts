import { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, parseEventLogs, parseEther, formatEther } from "viem";
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
 * SUPERSEDED BY scripts/run-live-fill.ts, AND KEPT ONLY AS A FALLBACK.
 *
 * This script opens an auction against a SYNTHETIC orderHash derived from Date.now().
 * No SwapVM order hashes to that value, so opcode 0x2e never runs, no gate is exercised
 * and no fill is possible. The events it produces are real, but what they demonstrate is
 * that the Book's five functions can be called in order -- not that the instruction
 * works. Do not present its output as evidence that it does.
 *
 * Use run-live-fill.ts, which opens against router.hash(order) for an order really
 * shipped to Aqua and ends in a real fill. This one exists because that one is
 * single-shot (its order hash is deterministic, and both ship and open are one-time), so
 * if it burns mid-run this still produces indexable auction events.
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
  {
    type: "event", name: "AuctionOpened",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "orderHash", type: "bytes32", indexed: true },
      { name: "router", type: "address" }, { name: "tokenIn", type: "address" },
      { name: "commitEnd", type: "uint40" }, { name: "revealEnd", type: "uint40" },
      { name: "exclusiveBlocks", type: "uint40" }, { name: "reserveBps", type: "uint24" },
      { name: "maxBps", type: "uint24" }, { name: "bond", type: "uint128" },
    ],
  },
] as const;

const STATUS = ["None", "Bidding", "Closed"];
const link = (h: string) => `  https://basescan.org/tx/${h}`;

async function main() {
  const conn = await network.create();
  const [maker] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];

  // http() with no argument silently uses viem's hardcoded default for the chain, so
  // BASE_RPC_URL never reached the reads -- including the one whose stale answer broke
  // the first run. Both this client and the bidders' now honour it.
  const pub = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
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
      wallet: createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL) }),
    };
  });

  console.log("  funding ephemeral bidders");
  for (const b of bidders) {
    const hash = await makerWallet.sendTransaction({ to: b.account.address, value: GAS_PER_BIDDER });
    await mined(pub, hash, "transaction");
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
  const openReceipt = await mined(pub, hash, "open");
  console.log(link(hash));

  // The window boundaries are read out of the AuctionOpened log in THIS receipt, never
  // from a readContract against the Book.
  //
  // Base's public endpoint is load balanced. A read issued immediately after a write can
  // land on a replica that has not yet applied the block the write is in, and it answers
  // from that older state: the mapping entry does not exist there yet, so a struct that
  // is populated on chain reads back as all zeros. Nothing errors. That is what happened
  // on the first live run -- commitEnd came back 0, the wait for it returned immediately,
  // and the script revealed while still inside the commit phase, reverting with
  // RevealNotOpen (GlasshouseBook.sol:185). The receipt carries the contract's own
  // emitted numbers and is by definition from the block that produced them.
  const opened = parseEventLogs({ abi: bookAbi, eventName: "AuctionOpened", logs: openReceipt.logs })[0];
  if (opened === undefined) {
    throw new Error(`open() was mined in block ${openReceipt.blockNumber} but emitted no AuctionOpened log`);
  }
  const commitEnd = BigInt(opened.args.commitEnd);
  const revealEnd = BigInt(opened.args.revealEnd);
  // open() sets commitEnd = block.number + commitBlocks and requires commitBlocks > 0
  // (:134), so zero is not a value it can emit. If it appears, stop rather than race.
  if (commitEnd === 0n) throw new Error("AuctionOpened reported commitEnd 0, which open() cannot produce");
  console.log(`  opened in block ${openReceipt.blockNumber}`);
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
    await mined(pub, h, "transaction");
    console.log(`  ${b.account.address.slice(0, 10)}...  committed`);
    console.log(link(h));
  }

  const o1 = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "outcome", args: [maker, orderHash] });
  console.log(`\n  status during bidding: ${STATUS[o1.status]}  (nothing can fill)`);

  // --- wait, reveal --------------------------------------------------------------
  await waitFor(pub, commitEnd + 1n, "commit window to close");

  // reveal() needs commitEnd < block <= revealEnd (:185-186). Checking it here turns a
  // bare "execution reverted" from the node into a message naming the window we are in
  // and why -- which is what the first live run needed and did not have.
  const atReveal = await pub.getBlockNumber();
  if (atReveal <= commitEnd || atReveal > revealEnd) {
    throw new Error(
      `the reveal window is blocks ${commitEnd + 1n}..${revealEnd}, but the chain is at ${atReveal}. ` +
      (atReveal > revealEnd
        ? "It has closed, so this auction can no longer be revealed. Re-run for a fresh one."
        : "It has not opened yet."),
    );
  }
  console.log("\n  revealing");
  for (const b of bidders) {
    const h = await b.wallet.sendTransaction({
      to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "reveal", args: [maker, orderHash, b.bps, SALT] }),
    });
    await mined(pub, h, "transaction");
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
  await mined(pub, hash, "transaction");
  const final = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "auctions", args: [maker, orderHash] });
  console.log("  settled");
  console.log(link(hash));
  console.log(`  winnerForfeited ${final.winnerForfeited}  (no fill was recorded, and silence is not evidence)\n`);
  console.log(`  orderHash for the subgraph:  ${orderHash}\n`);
}

/** viem resolves REVERTED receipts without throwing, so an unchecked receipt lets a
 *  transaction that estimated fine and reverted on inclusion print as a success -- with
 *  a Basescan link the reader is unlikely to open. Every receipt goes through here. */
async function mined(pub: any, hash: `0x${string}`, what: string) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${what} REVERTED: https://basescan.org/tx/${hash}`);
  return r;
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
