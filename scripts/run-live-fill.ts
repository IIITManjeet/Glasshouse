import { network } from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  encodeFunctionData,
  parseEventLogs,
  parseEther,
  formatEther,
  formatUnits,
  getAddress,
  encodeAbiParameters,
  toHex,
  concat,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { randomBytes } from "node:crypto";

/**
 * ONE COMPLETE AUCTION ON BASE MAINNET, ENDING IN A REAL FILL.
 *
 *   npx hardhat run scripts/run-live-fill.ts --network base
 *
 * This supersedes `run-auction.ts`, which ran the lifecycle against
 * `orderHash = Date.now()` in hex. Nothing hashes to that, so no SwapVM program ever
 * ran, opcode 0x2e never executed, and no fill was possible -- which is why that run
 * reported `winnerForfeited = false` for a winner who could never have filled. What it
 * demonstrated was that five functions can be called in the right order.
 *
 * Here the auction is opened against `router.hash(order)` for an order that is really
 * shipped to the official Aqua, and the winner really fills it. Tokens move.
 *
 * EVERY BYTE OF THE ORDER COMES FROM SOLIDITY. `test/fork/LiveFillPreflight.t.sol`
 * builds it with upstream's own MakerTraitsLib/TakerTraitsLib, runs this exact sequence
 * against real Base state through the real deployed contracts, and prints the encoding.
 * The constants below are that output. Re-implementing the bit packing here is how you
 * produce an order that can never be filled, so it is not done: the script asserts the
 * on-chain `router.hash(order)` equals the hash the preflight got, and stops if it does
 * not.
 *
 * ONE SHOT. `Aqua.ship` requires `balance.tokensCount == 0` (StrategiesMustBeImmutable)
 * and `Book.open` requires `commitEnd == 0` (AlreadyOpened), and this order's hash is
 * deterministic. So this exact order can be run once, ever. If it burns, change MAX_BPS
 * in the preflight, re-run it, and paste the new ORDER_DATA/ORDER_HASH here -- that is
 * the retry lever, and it is deliberate rather than a nonce nobody would notice.
 */

// --- the real deployment -------------------------------------------------------------
const AQUA = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as const;
const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe" as const;
const ROUTER = "0x5c3baE054e8b4915a13726B397b1AeA864247DBf" as const;
const MAKER = "0xeEbf737F92C8F0d9070f35a7D9BAf416923bEcDf" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// --- from LiveFillPreflight, printed by `forge test --match-contract LiveFillPreflight -vv`
const ORDER_TRAITS =
  32792681522311496102057670744360050598098787305545420834952732519728813178880n;
const ORDER_DATA =
  "0x4200000000000000000000000000000000000006833589fcd6edb6e08f4c7c32d4f71b54bda02913c4ea91fe700918220423ac307c6b1c59650ffbfe2e17c4ea91fe700918220423ac307c6b1c59650ffbfe0001f45000" as const;
const EXPECTED_ORDER_HASH =
  "0x58296d32e575d28f4213301b4a113ab8f92ab46afc48dcb8147ea7667e3efdf9" as const;
// Taker data is 42 bytes and differs between recipients ONLY in the trailing 20, which
// test_Preflight_TakerDataDiffersOnlyInTheRecipient pins. So the recipient is spliced in
// rather than the whole structure being rebuilt here.
const TAKER_DATA_PREFIX = "0x001400140014001400140014001400140014000000c1" as const;

// --- amounts, matching the preflight exactly -----------------------------------------
const BALANCE_WETH = 1_000_000_000_000_000n; // 0.001 WETH, declared to Aqua
const BALANCE_USDC = 4_000_000n; // 4 USDC, declared AND actually held
const SWAP_AMOUNT = 10_000_000_000_000n; // 0.00001 WETH, what the winner pays in

// --- auction, the `advocated` set from config/auction.json ---------------------------
const COMMIT_BLOCKS = 30n;
const REVEAL_BLOCKS = 30n;
const EXCLUSIVE_BLOCKS = 15n;
const RESERVE_BPS = 50;
const MAX_BPS = 500;
const BOND = 0n;
const BIDS = [400, 250] as const; // the winner pays the second: 250

// The winner sends five transactions (wrap, approve, commit, reveal, fill); the rival
// sends two. The float is ~10x what those cost at Base's usual sub-gwei gas, because a
// bidder that runs dry BETWEEN commit and reveal is stranded inside a 60-second window
// with no recovery path, and the whole run is then wasted. The unspent remainder is
// discarded with the ephemeral key, so this is the price of not losing the run.
const WINNER_GAS = parseEther("0.0002");
const RIVAL_GAS = parseEther("0.0001");

const link = (h: string) => `  https://basescan.org/tx/${h}`;
const STATUS = ["None", "Bidding", "Closed"];

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

const orderTuple = {
  type: "tuple",
  components: [
    { name: "maker", type: "address" },
    { name: "traits", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

const routerAbi = [
  { type: "function", name: "hash", stateMutability: "view", inputs: [{ ...orderTuple, name: "order" }], outputs: [{ type: "bytes32" }] },
  {
    type: "function", name: "swap", stateMutability: "nonpayable",
    inputs: [{ ...orderTuple, name: "order" }, { name: "amount", type: "uint256" }, { name: "takerTraitsAndData", type: "bytes" }],
    outputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOut", type: "uint256" }, { name: "orderHash", type: "bytes32" }],
  },
] as const;

const aquaAbi = [
  {
    type: "function", name: "ship", stateMutability: "nonpayable",
    inputs: [{ name: "app", type: "address" }, { name: "strategy", type: "bytes" }, { name: "tokens", type: "address[]" }, { name: "amounts", type: "uint256[]" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

// Every custom error the Book can raise. Without these viem reports a bare
// "execution reverted" plus an undecoded selector, which is what made the first failed
// run take a chain query to diagnose instead of a glance at the message.
const bookAbi = [
  { type: "function", name: "open", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "orderHash", type: "bytes32" }, { name: "router", type: "address" }, { name: "tokenIn", type: "address" }, { name: "commitBlocks", type: "uint40" }, { name: "revealBlocks", type: "uint40" }, { name: "exclusiveBlocks", type: "uint40" }, { name: "reserveBps", type: "uint24" }, { name: "maxBps", type: "uint24" }, { name: "bond", type: "uint128" }] },
  { type: "function", name: "commit", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }, { name: "commitment", type: "bytes32" }] },
  { type: "function", name: "reveal", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }, { name: "bps", type: "uint24" }, { name: "salt", type: "bytes32" }] },
  { type: "function", name: "settle", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }] },
  { type: "function", name: "commitmentFor", stateMutability: "pure", inputs: [{ name: "bidder", type: "address" }, { name: "bps", type: "uint24" }, { name: "salt", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "outcome", stateMutability: "view", inputs: [{ name: "maker", type: "address" }, { name: "orderHash", type: "bytes32" }], outputs: [{ type: "tuple", components: [{ name: "status", type: "uint8" }, { name: "winner", type: "address" }, { name: "clearingBps", type: "uint24" }, { name: "exclusiveUntil", type: "uint40" }] }] },
  {
    type: "event", name: "AuctionOpened",
    inputs: [
      { name: "maker", type: "address", indexed: true }, { name: "orderHash", type: "bytes32", indexed: true },
      { name: "router", type: "address" }, { name: "tokenIn", type: "address" },
      { name: "commitEnd", type: "uint40" }, { name: "revealEnd", type: "uint40" },
      { name: "exclusiveBlocks", type: "uint40" }, { name: "reserveBps", type: "uint24" },
      { name: "maxBps", type: "uint24" }, { name: "bond", type: "uint128" },
    ],
  },
  {
    type: "event", name: "AuctionFilled",
    inputs: [
      { name: "maker", type: "address", indexed: true }, { name: "orderHash", type: "bytes32", indexed: true },
      { name: "taker", type: "address", indexed: true }, { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" }, { name: "fillByWinner", type: "bool" },
    ],
  },
  {
    type: "event", name: "AuctionSettled",
    inputs: [
      { name: "maker", type: "address", indexed: true }, { name: "orderHash", type: "bytes32", indexed: true },
      { name: "winner", type: "address", indexed: true }, { name: "clearingBps", type: "uint24" },
      { name: "winnerForfeited", type: "bool" },
    ],
  },
  { type: "error", name: "AlreadyOpened", inputs: [] },
  { type: "error", name: "NotOpened", inputs: [] },
  { type: "error", name: "BadWindow", inputs: [] },
  { type: "error", name: "CommitClosed", inputs: [] },
  { type: "error", name: "AlreadyCommitted", inputs: [] },
  { type: "error", name: "RevealNotOpen", inputs: [] },
  { type: "error", name: "RevealClosed", inputs: [] },
  { type: "error", name: "NoCommitment", inputs: [] },
  { type: "error", name: "AlreadyRevealed", inputs: [] },
  { type: "error", name: "BadReveal", inputs: [] },
  { type: "error", name: "AlreadySettled", inputs: [] },
  { type: "error", name: "NotSettled", inputs: [] },
  { type: "error", name: "WindowNotElapsed", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
] as const;

const order = { maker: MAKER, traits: ORDER_TRAITS, data: ORDER_DATA } as const;

// Both clients honour BASE_RPC_URL. `http()` with no argument silently uses viem's
// hardcoded default for the chain, which is the same load-balanced public endpoint whose
// replica lag broke the first run -- so setting BASE_RPC_URL had no effect on the reads
// that actually mattered. Now it does.
const rpc = () => http(process.env.BASE_RPC_URL);

let pub: ReturnType<typeof createPublicClient>;

/**
 * Read contract state AT A KNOWN BLOCK, never at "latest".
 *
 * Base's public endpoint is load balanced. A read at `latest` can land on a replica that
 * has not applied the block we just observed, and it answers from that older state with
 * no error at all -- a populated mapping reads back as zeros. That is precisely how the
 * first live run died. Pinning turns the failure loud: a node that lacks the block
 * answers `-32001 block not found` (verified against mainnet.base.org) rather than
 * lying, and viem does not retry that code, so we retry it here.
 */
async function readPinned<T>(fn: (blockNumber: bigint) => Promise<T>, at: bigint, what: string): Promise<T> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return await fn(at);
    } catch (e: any) {
      const msg = String(e?.details ?? e?.message ?? e);
      if (!/block not found|-32001|missing trie node|header not found/i.test(msg)) throw e;
      if (attempt === 8) throw new Error(`${what}: no replica had block ${at} after 8 tries`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("unreachable");
}

/** Every receipt is checked. viem resolves reverted receipts without throwing, so a
 *  transaction that estimates fine and reverts on inclusion would otherwise be printed
 *  as a success, with a Basescan link the reader is unlikely to click. */
async function mined(hash: `0x${string}`, what: string) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") {
    throw new Error(`${what} REVERTED on chain: https://basescan.org/tx/${hash}`);
  }
  return r;
}

async function waitFor(target: bigint, what: string) {
  let n = await pub.getBlockNumber({ cacheTime: 0 });
  if (n >= target) return n;
  console.log(`\n  waiting for ${what}: block ${n} -> ${target} (about ${Number(target - n) * 2}s)`);
  while (n < target) {
    await new Promise((r) => setTimeout(r, 4000));
    n = await pub.getBlockNumber({ cacheTime: 0 });
    process.stdout.write(`\r  block ${n}   `);
  }
  process.stdout.write("\n");
  return n;
}

async function main() {
  const conn = await network.create();
  const [account] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];

  pub = createPublicClient({ chain: base, transport: rpc() });
  const maker = getAddress(account);
  if (maker !== getAddress(MAKER)) {
    throw new Error(`the keystore account is ${maker}, but the order was built for ${MAKER}. The order hash depends on the maker, so this run would open an auction against an order nobody shipped.`);
  }
  const makerWallet = createWalletClient({ account, chain: base, transport: custom(conn.provider) });

  console.log("\n  Glasshouse - live auction AND fill on Base mainnet");
  console.log("  ------------------------------------------------------------");
  console.log(`  book        ${BOOK}`);
  console.log(`  router      ${ROUTER}`);
  console.log(`  aqua        ${AQUA}`);
  console.log(`  maker       ${maker}`);

  // --- the order is the one the preflight proved fillable ---------------------------
  const head0 = await pub.getBlockNumber({ cacheTime: 0 });
  const onChainHash = await readPinned(
    (blockNumber) => pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "hash", args: [order], blockNumber }),
    head0, "router.hash(order)",
  );
  if (onChainHash.toLowerCase() !== EXPECTED_ORDER_HASH.toLowerCase()) {
    throw new Error(`router.hash(order) is ${onChainHash}, but the preflight proved ${EXPECTED_ORDER_HASH}. The encoding has drifted; re-run LiveFillPreflight and update the constants rather than shipping this.`);
  }
  const orderHash = onChainHash;
  console.log(`  orderHash   ${orderHash}`);
  console.log(`              (router.hash(order), matching the preflight -- not a timestamp)`);

  const ethBal = await pub.getBalance({ address: maker });
  const usdcBal = await readPinned(
    (blockNumber) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [maker], blockNumber }),
    head0, "maker USDC",
  );
  console.log(`  balance     ${formatEther(ethBal)} ETH, ${formatUnits(usdcBal, 6)} USDC\n`);
  if (usdcBal < BALANCE_USDC) {
    throw new Error(`the maker holds ${formatUnits(usdcBal, 6)} USDC but the strategy declares ${formatUnits(BALANCE_USDC, 6)}. Send USDC on Base to ${maker} first. The fill itself only pulls ~0.04 USDC; the rest backs a balance we should not advertise without holding.`);
  }

  // --- approvals ---------------------------------------------------------------------
  const allowance = await readPinned(
    (blockNumber) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [maker, AQUA], blockNumber }),
    head0, "USDC allowance",
  );
  if (allowance < BALANCE_USDC) {
    console.log("  approving USDC to Aqua");
    const h = await makerWallet.sendTransaction({
      to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AQUA, BALANCE_USDC * 100n] }),
    });
    await mined(h, "USDC approve");
    console.log(link(h));
  }

  // --- ephemeral bidders, each with its OWN random salt -------------------------------
  //
  // The old script used one constant salt committed to a public repository. The
  // commitment is keccak256(bidder, bps, salt), and bps is bounded by [reserveBps,
  // maxBps], so a published salt unseals both "sealed" bids in 451 hashes -- on the one
  // run whose entire point is to show sealing work. These are generated here and printed
  // only after the reveals are on chain.
  const bidders = BIDS.map((bps, i) => ({
    bps,
    salt: toHex(randomBytes(32)),
    account: privateKeyToAccount(generatePrivateKey()),
    role: i === 0 ? "winner" : "rival",
  }));
  const winner = bidders[0];
  const rival = bidders[1];
  const takerData = concat([TAKER_DATA_PREFIX, winner.account.address]) as `0x${string}`;

  console.log("  funding ephemeral bidders");
  for (const b of bidders) {
    const value = b.role === "winner" ? WINNER_GAS + SWAP_AMOUNT : RIVAL_GAS;
    const h = await makerWallet.sendTransaction({ to: b.account.address, value });
    await mined(h, `funding ${b.role}`);
    console.log(`  ${b.account.address}  ${b.role}, bids ${b.bps} bps`);
  }

  const wallet = (b: (typeof bidders)[number]) =>
    createWalletClient({ account: b.account, chain: base, transport: rpc() });

  // --- the winner needs WETH and an approval to pay in --------------------------------
  console.log("\n  winner wraps ETH and approves the router");
  let h = await wallet(winner).sendTransaction({
    to: WETH, value: SWAP_AMOUNT, data: encodeFunctionData({ abi: erc20Abi, functionName: "deposit", args: [] }),
  });
  await mined(h, "WETH deposit");
  h = await wallet(winner).sendTransaction({
    to: WETH, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, SWAP_AMOUNT * 100n] }),
  });
  await mined(h, "WETH approve");

  // --- ship the strategy to the official Aqua -----------------------------------------
  console.log("\n  shipping the strategy to Aqua");
  h = await makerWallet.sendTransaction({
    to: AQUA,
    data: encodeFunctionData({
      abi: aquaAbi, functionName: "ship",
      args: [ROUTER, encodeAbiParameters([orderTuple], [order]), [WETH, USDC], [BALANCE_WETH, BALANCE_USDC]],
    }),
  });
  await mined(h, "ship");
  console.log(link(h));

  // --- open ----------------------------------------------------------------------------
  console.log("\n  opening the auction against the REAL order hash");
  h = await makerWallet.sendTransaction({
    to: BOOK,
    data: encodeFunctionData({
      abi: bookAbi, functionName: "open",
      args: [orderHash, ROUTER, WETH, COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND],
    }),
  });
  const openReceipt = await mined(h, "open");
  console.log(link(h));

  const opened = parseEventLogs({ abi: bookAbi, eventName: "AuctionOpened", logs: openReceipt.logs })[0];
  if (opened === undefined) throw new Error(`open() mined in block ${openReceipt.blockNumber} but emitted no AuctionOpened log`);
  const commitEnd = BigInt(opened.args.commitEnd);
  const revealEnd = BigInt(opened.args.revealEnd);
  if (commitEnd === 0n) throw new Error("AuctionOpened reported commitEnd 0, which open() cannot produce");
  console.log(`  opened in block ${openReceipt.blockNumber}; commitEnd ${commitEnd}, revealEnd ${revealEnd}`);

  // --- commit ---------------------------------------------------------------------------
  console.log("\n  committing sealed bids");
  for (const b of bidders) {
    const now = await pub.getBlockNumber({ cacheTime: 0 });
    if (now > commitEnd) throw new Error(`the commit window closed at block ${commitEnd} and the chain is at ${now}`);
    // Taken from the contract, never packed by hand: a wrongly packed commitment can
    // never be revealed, and with a bond posted that loses it.
    const commitment = await readPinned(
      (blockNumber) => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "commitmentFor", args: [b.account.address, b.bps, b.salt], blockNumber }),
      now, "commitmentFor",
    );
    const t = await wallet(b).sendTransaction({
      to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "commit", args: [maker, orderHash, commitment] }),
    });
    await mined(t, `commit by ${b.role}`);
    console.log(`  ${b.account.address.slice(0, 10)}...  committed (sealed)`);
    console.log(link(t));
  }

  const duringBidding = await pub.getBlockNumber({ cacheTime: 0 });
  const o1 = await readPinned(
    (blockNumber) => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "outcome", args: [maker, orderHash], blockNumber }),
    duringBidding, "outcome during bidding",
  );
  console.log(`\n  status during bidding: ${STATUS[o1.status]}  (nothing can fill, not even the winner)`);

  // --- reveal ----------------------------------------------------------------------------
  await waitFor(commitEnd + 1n, "the commit window to close");
  const atReveal = await pub.getBlockNumber({ cacheTime: 0 });
  if (atReveal <= commitEnd || atReveal + BigInt(bidders.length) > revealEnd) {
    throw new Error(`the reveal window is blocks ${commitEnd + 1n}..${revealEnd} and ${bidders.length} reveals must fit; the chain is at ${atReveal}.`);
  }

  console.log("\n  revealing");
  for (const b of bidders) {
    const t = await wallet(b).sendTransaction({
      to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "reveal", args: [maker, orderHash, b.bps, b.salt] }),
    });
    await mined(t, `reveal by ${b.role}`);
    console.log(`  ${b.account.address.slice(0, 10)}...  revealed ${b.bps} bps   salt ${b.salt}`);
    console.log(link(t));
  }

  // --- outcome, pinned to a block we have proven exists ------------------------------------
  const afterReveal = await waitFor(revealEnd + 1n, "the reveal window to close");
  const o = await readPinned(
    (blockNumber) => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "outcome", args: [maker, orderHash], blockNumber }),
    afterReveal, "final outcome",
  );

  console.log("\n  ------------------------------------------------------------");
  console.log(`  status          ${STATUS[o.status]}`);
  console.log(`  winner          ${o.winner}`);
  console.log(`  clearing        ${o.clearingBps} bps`);
  console.log(`  exclusive until ${o.exclusiveUntil}`);
  console.log("  ------------------------------------------------------------");
  if (getAddress(o.winner) !== getAddress(winner.account.address) || o.clearingBps !== BIDS[1]) {
    throw new Error(`expected ${winner.account.address} to win paying ${BIDS[1]} bps, got ${o.winner} at ${o.clearingBps}`);
  }
  console.log(`  The highest bidder won and pays ${BIDS[1]} bps -- the second bid, not its own.\n`);

  // --- THE FILL --------------------------------------------------------------------------
  console.log("  the winner fills, inside its exclusive window, through the official Aqua");
  const fillHash = await wallet(winner).sendTransaction({
    to: ROUTER,
    data: encodeFunctionData({ abi: routerAbi, functionName: "swap", args: [order, SWAP_AMOUNT, takerData] }),
  });
  const fillReceipt = await mined(fillHash, "fill");
  console.log(link(fillHash));

  const filled = parseEventLogs({ abi: bookAbi, eventName: "AuctionFilled", logs: fillReceipt.logs })[0];
  if (filled === undefined) {
    throw new Error("the fill was mined but the Book recorded no AuctionFilled: the maker hook did not report it");
  }
  console.log(`  WETH in         ${filled.args.amountIn}`);
  console.log(`  USDC out        ${filled.args.amountOut}`);
  console.log(`  by the winner   ${filled.args.fillByWinner}`);

  // --- settle -----------------------------------------------------------------------------
  await waitFor(revealEnd + EXCLUSIVE_BLOCKS + 1n, "the exclusive window to elapse");
  h = await makerWallet.sendTransaction({
    to: BOOK, data: encodeFunctionData({ abi: bookAbi, functionName: "settle", args: [maker, orderHash] }),
  });
  const settleReceipt = await mined(h, "settle");
  console.log(link(h));

  // From the contract's own emission, not a read that could be answered by a stale replica.
  const settled = parseEventLogs({ abi: bookAbi, eventName: "AuctionSettled", logs: settleReceipt.logs })[0];
  if (settled === undefined) throw new Error("settle() mined but emitted no AuctionSettled log");

  console.log("\n  ------------------------------------------------------------");
  console.log(`  settled winner  ${settled.args.winner}`);
  console.log(`  clearing        ${settled.args.clearingBps} bps`);
  console.log(`  forfeited       ${settled.args.winnerForfeited}  (the winner filled, so nothing is forfeit)`);
  console.log("  ------------------------------------------------------------");
  console.log(`\n  orderHash for the subgraph:  ${orderHash}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
