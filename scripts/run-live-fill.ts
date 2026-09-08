import { network } from "hardhat";
import {
  createWalletClient,
  custom,
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
wimport { basePublicClient, baseTransport, waitForBlock, rpc } from "./lib/chain.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const BALANCE_WETH = 800_000_000_000_000n; // 0.0008 WETH, declared to Aqua
const BALANCE_USDC = 2_000_000n; // 2 USDC, declared AND actually held
const SWAP_AMOUNT = 10_000_000_000_000n; // 0.00001 WETH, what the winner pays in

// --- auction, the `advocated` set from config/auction.json ---------------------------
const COMMIT_BLOCKS = 30n;
const REVEAL_BLOCKS = 30n;
const EXCLUSIVE_BLOCKS = 15n;
const RESERVE_BPS = 50;
const MAX_BPS = 500;
const BOND = 0n;
const BIDS = [400, 250] as const; // the winner pays the second: 250

// What the fill must return, from the preflight against real Base state.
//
// The winning bid scales balanceIn UP by (1 + 250bps), and on the constant-product curve
// amountOut = amountIn * balanceOut / (balanceIn + amountIn), so a larger balanceIn means
// the taker receives LESS. That is the improvement: 24,096 USDC to the winner instead of
// the 24,691 the base price would have given, with the difference staying with the maker.
//
// Asserting the exact figure is what separates "a fill happened" from "the auction moved
// the price", and only the second is the claim.
const EXPECTED_AMOUNT_OUT = 24_096n;
const BASE_PRICE_AMOUNT_OUT = 24_691n;

// The winner sends five transactions (wrap, approve, commit, reveal, fill); the rival
// sends two. The float is ~10x what those cost at Base's usual sub-gwei gas, because a
// bidder that runs dry BETWEEN commit and reveal is stranded inside a 60-second window
// with no recovery path, and the whole run is then wasted. The unspent remainder is
// discarded with the ephemeral key, so this is the price of not losing the run.
const WINNER_GAS = parseEther("0.0002");
const RIVAL_GAS = parseEther("0.0001");

const KEYFILE = new URL("../.ephemeral-bidders.json", import.meta.url);
// EXPLICIT GAS LIMITS, SO NOTHING CALLS eth_estimateGas.
//
// viem and Hardhat both estimate at "latest" inside sendTransaction. On Base that read
// can land on a replica which has not applied the block we just wrote, and the estimate
// then reverts against stale state -- NotOpened right after open(), or
// GlasshouseAuctionInProgress right after the reveal window closes. The transaction is
// fine; the node simulating it is behind. That killed one run already, and it would kill
// this one at the two worst moments: the first commit, and the fill.
//
// These are roughly twice the measured cost. Unused gas is not charged, so generous
// limits cost nothing and buy the removal of an entire failure mode.
const GAS = {
  approve: 100_000n,
  transfer: 30_000n,
  wrap: 100_000n,
  ship: 400_000n,
  open: 300_000n,
  commit: 200_000n,
  reveal: 250_000n,
  fill: 700_000n,
  settle: 200_000n,
} as const;

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
// THE BOOK ABI IS LOADED, NOT HAND-WRITTEN.
//
// It used to be typed out here, and that produced a silent bug the dry run caught: the
// AuctionFilled entry carried a sixth parameter, fillByWinner, which the CONTRACT event
// does not have -- that field belongs to the subgraph entity, not the log. A wrong
// parameter list changes topic0, so parseEventLogs matched nothing and the script
// reported that the maker hook had failed to record a fill which had in fact been
// recorded perfectly.
//
// subgraph/abis/GlasshouseBook.json is generated from the compiled artifact and
// cross-checked against the deployed bytecode, so it cannot drift from the contract the
// way a hand-typed copy can. It also carries every custom error, so a revert prints its
// name instead of a bare selector.
const bookAbi = JSON.parse(
  readFileSync(new URL("../subgraph/abis/GlasshouseBook.json", import.meta.url), "utf8"),
) as any;

const order = { maker: MAKER, traits: ORDER_TRAITS, data: ORDER_DATA } as const;

// Connectivity, retry and block subscription all live in ./lib/chain.ts. Block waiting
// there is eth_subscribe("newHeads") over a WebSocket rather than a getBlockNumber poll,
// which is what earned "-32016 over rate limit" from Base's public endpoint: this run
// waits out 75 blocks across three windows, which was ~57 polls before.

let pub: ReturnType<typeof basePublicClient>;

/**
 * Read contract state AT A KNOWN BLOCK, never at "latest".
 *
 * Base's public endpoints are load balanced. A read at "latest" can land on a replica
 * that has not applied the block we just observed, and it answers from that older state
 * with no error at all -- a populated mapping reads back as zeros. That is exactly how
 * the first live run died. Pinning turns the failure loud: a node lacking the block
 * answers -32001 "block not found" (verified against mainnet.base.org) instead of lying,
 * and rpc() retries that.
 */
function pinned<T>(fn: (blockNumber: bigint) => Promise<T>, at: bigint, what: string): Promise<T> {
  return rpc(() => fn(at), what);
}

/** Every receipt is checked. viem resolves reverted receipts without throwing, so a
 *  transaction that estimates fine and reverts on inclusion would otherwise be printed
 *  as a success, with a Basescan link the reader is unlikely to click. */
async function mined(hash: `0x${string}`, what: string) {
  // Retried: viem's receipt loop rejects on any error other than not-found, so a rate
  // limit that survives the fallback chain would abandon a transaction that is already
  // mined. Waiting for a receipt is idempotent, so retrying is free.
  const r = await rpc(() => pub.waitForTransactionReceipt({ hash }), `receipt for ${what}`);
  if (r.status !== "success") {
    throw new Error(`${what} REVERTED on chain: https://basescan.org/tx/${hash}`);
  }
  return r;
}

const waitFor = (target: bigint, what: string) => waitForBlock(pub, target, what);

async function main() {
  const conn = await network.create();

  // DRY RUN: the whole sequence against a local Anvil fork of Base mainnet.
  //
  // Same chainId, so every address resolves to the real deployed contract and the order
  // hash is identical -- what is rehearsed is the actual run, not an approximation. The
  // maker is IMPERSONATED rather than signed for, so the keystore is never touched and
  // no key is exposed. It matters that the maker address is unchanged: the order hash
  // includes it, so impersonating is the only way to rehearse the real order.
  //
  //   anvil --fork-url https://mainnet.base.org --chain-id 8453
  //   DRY_RUN=1 BASE_RPC_URL=http://127.0.0.1:8545 npx hardhat run scripts/run-live-fill.ts --network baseFork
  const DRY_RUN = process.env.DRY_RUN === "1";
  if (DRY_RUN) {
    const version = String(await conn.provider.request({ method: "web3_clientVersion" }));
    if (!/anvil|hardhat/i.test(version)) {
      throw new Error(`DRY_RUN=1 but the node reports "${version}", which is not a local fork. Refusing to run: a dry run against real Base would spend real money.`);
    }
    if (!/127\.0\.0\.1|localhost/.test(process.env.BASE_RPC_URL ?? "")) {
      throw new Error(`DRY_RUN=1 requires BASE_RPC_URL to point at the local fork, otherwise the reads would come from real Base while the writes go to the fork. It is "${process.env.BASE_RPC_URL ?? "unset"}".`);
    }
    await conn.provider.request({ method: "anvil_impersonateAccount", params: [MAKER] } as any);

    // Top the maker up ON THE FORK ONLY.
    //
    // Anvil adds a default 1 gwei priority fee on top of the forked base fee, so gas on
    // the fork costs about 1.003 gwei against Base mainnet's measured 0.006 -- roughly
    // 167x. The first dry run ran out of ETH at open() purely because of that, which
    // says nothing about the real budget.
    //
    // So THE DRY RUN DOES NOT VALIDATE THE GAS BUDGET. It validates the sequence. The
    // mainnet cost is computed separately from real Base gas prices, and the maker is
    // checked against it before the real run.
    await conn.provider.request({ method: "anvil_setBalance", params: [MAKER, "0xde0b6b3a7640000"] } as any);
    console.log("  fork: maker topped up to 1 ETH (anvil gas is ~167x mainnet; this does NOT test the real budget)");
    console.log("\n  *** DRY RUN on a local Base fork. Nothing here is real money. ***");
  }

  const [nodeAccount] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];
  const account = DRY_RUN ? (MAKER as `0x${string}`) : nodeAccount;

  pub = basePublicClient();
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
  const head0 = await rpc(() => pub.getBlockNumber({ cacheTime: 0 }), "head");
  const onChainHash = await pinned(
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
  const usdcBal = await pinned(
    (blockNumber) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [maker], blockNumber }),
    head0, "maker USDC",
  );
  console.log(`  balance     ${formatEther(ethBal)} ETH, ${formatUnits(usdcBal, 6)} USDC\n`);
  if (usdcBal < BALANCE_USDC) {
    throw new Error(`the maker holds ${formatUnits(usdcBal, 6)} USDC but the strategy declares ${formatUnits(BALANCE_USDC, 6)}. Send USDC on Base to ${maker} first. The fill itself only pulls ~0.04 USDC; the rest backs a balance we should not advertise without holding.`);
  }

  // IS THIS ORDER STILL VIRGIN? Checked before a single wei is spent.
  //
  // The hash is deterministic and both Aqua.ship (StrategiesMustBeImmutable) and
  // Book.open (AlreadyOpened) are one-time for it. If an earlier attempt consumed either,
  // this run would fund bidders and wrap WETH and only then revert -- spending money to
  // discover something two reads could have told us.
  const existing = await pinned(
    (blockNumber) => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "auctions", args: [maker, orderHash], blockNumber }),
    head0, "existing auction",
  );
  if (BigInt((existing as any).commitEnd) !== 0n) {
    throw new Error(
      `an auction for this order hash was already opened (commitEnd ${(existing as any).commitEnd}). ` +
      "This order is spent: Book.open rejects a second one. Change MAX_BPS in " +
      "test/fork/LiveFillPreflight.t.sol, re-run the preflight, and paste the new " +
      "ORDER_DATA and EXPECTED_ORDER_HASH here.",
    );
  }

  // --- approvals ---------------------------------------------------------------------
  const allowance = await pinned(
    (blockNumber) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [maker, AQUA], blockNumber }),
    head0, "USDC allowance",
  );
  if (allowance < BALANCE_USDC) {
    console.log("  approving USDC to Aqua");
    const h = await makerWallet.sendTransaction({
      to: USDC, gas: GAS.approve, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AQUA, BALANCE_USDC] }),
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
  const bidders = BIDS.map((bps, i) => {
    const privateKey = generatePrivateKey();
    return {
      bps,
      privateKey,
      salt: toHex(randomBytes(32)),
      account: privateKeyToAccount(privateKey),
      role: i === 0 ? "winner" : "rival",
    };
  });

  // WRITTEN BEFORE ANY FUNDING, DELIBERATELY.
  //
  // These keys exist only in this process. An earlier attempt died AFTER funding the
  // bidders and BEFORE they spent anything, and 0.00031 ETH became unrecoverable --
  // not stranded, gone, because nothing outside memory knew the keys. Persisting them
  // first turns that into a sweepable inconvenience. The file is gitignored and the
  // keys are worth cents; the alternative is losing the funding of every failed run.
  // Refuse to clobber a previous run's keys while they still hold funds. Overwriting
  // them is the same permanent loss the file exists to prevent, just one run later.
  if (existsSync(KEYFILE)) {
    const prev = JSON.parse(readFileSync(KEYFILE, "utf8")) as { role: string; address: `0x${string}` }[];
    for (const old of prev) {
      const bal = await rpc(() => pub.getBalance({ address: old.address }), "previous bidder balance");
      if (bal > 0n) {
        throw new Error(
          `${KEYFILE.pathname} still holds keys for ${old.address} (${old.role}) with ` +
          `${formatEther(bal)} ETH. Sweep or delete it first -- overwriting loses that money.`,
        );
      }
    }
  }
  writeFileSync(
    KEYFILE,
    JSON.stringify(bidders.map((b) => ({ role: b.role, address: b.account.address, privateKey: b.privateKey, bps: b.bps })), null, 2),
  );
  console.log(`  bidder keys written to ${KEYFILE.pathname} (gitignored, sweepable if this run dies)`);
  const winner = bidders[0];
  const rival = bidders[1];
  const takerData = concat([TAKER_DATA_PREFIX, winner.account.address]) as `0x${string}`;

  console.log("  funding ephemeral bidders");
  for (const b of bidders) {
    const value = b.role === "winner" ? WINNER_GAS + SWAP_AMOUNT : RIVAL_GAS;
    const h = await makerWallet.sendTransaction({ to: b.account.address, value, gas: GAS.transfer });
    await mined(h, `funding ${b.role}`);
    console.log(`  ${b.account.address}  ${b.role}, bids ${b.bps} bps`);
  }

  // Same fork-gas caveat as the maker: anvil charges ~167x Base, so the real float of
  // 0.0002 ETH -- ample for five transactions at 0.006 gwei -- runs dry on the fork at
  // the reveal. Topped up here so the rehearsal exercises the SEQUENCE. The funding
  // transactions above still run, so that path is genuinely tested; only the amount is
  // unrealistic, and deliberately so.
  if (DRY_RUN) {
    for (const b of bidders) {
      await conn.provider.request({ method: "anvil_setBalance", params: [b.account.address, "0xde0b6b3a7640000"] } as any);
    }
    console.log("  fork: bidders topped up to 1 ETH each (gas artifact only)");
  }

  // Built ONCE per bidder. This used to construct a fresh fallback -- three WebSocket
  // connections -- on every call, seven times over a run, none of them ever closed.
  const wallets = new Map<string, ReturnType<typeof createWalletClient>>();
  const wallet = (b: (typeof bidders)[number]) => {
    let w = wallets.get(b.account.address);
    if (!w) {
      w = createWalletClient({ account: b.account, chain: base, transport: baseTransport() });
      wallets.set(b.account.address, w);
    }
    return w;
  };

  // --- the winner needs WETH and an approval to pay in --------------------------------
  console.log("\n  winner wraps ETH and approves the router");
  let h = await wallet(winner).sendTransaction({
    to: WETH, value: SWAP_AMOUNT, gas: GAS.wrap, data: encodeFunctionData({ abi: erc20Abi, functionName: "deposit", args: [] }),
  });
  await mined(h, "WETH deposit");
  h = await wallet(winner).sendTransaction({
    to: WETH, gas: GAS.approve, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, SWAP_AMOUNT] }),
  });
  await mined(h, "WETH approve");

  // --- ship the strategy to the official Aqua -----------------------------------------
  console.log("\n  shipping the strategy to Aqua");
  h = await makerWallet.sendTransaction({
    to: AQUA, gas: GAS.ship,
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
    to: BOOK, gas: GAS.open,
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
    const now = await rpc(() => pub.getBlockNumber({ cacheTime: 0 }), "head");
    if (now > commitEnd) throw new Error(`the commit window closed at block ${commitEnd} and the chain is at ${now}`);
    // Taken from the contract, never packed by hand: a wrongly packed commitment can
    // never be revealed, and with a bond posted that loses it.
    const commitment = await pinned(
      (blockNumber) => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "commitmentFor", args: [b.account.address, b.bps, b.salt], blockNumber }),
      now, "commitmentFor",
    );
    const t = await wallet(b).sendTransaction({
      to: BOOK, gas: GAS.commit, data: encodeFunctionData({ abi: bookAbi, functionName: "commit", args: [maker, orderHash, commitment] }),
    });
    await mined(t, `commit by ${b.role}`);
    console.log(`  ${b.account.address.slice(0, 10)}...  committed (sealed)`);
    console.log(link(t));
  }

  const duringBidding = await rpc(() => pub.getBlockNumber({ cacheTime: 0 }), "head");
  const o1 = await pinned(
    (blockNumber) => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "outcome", args: [maker, orderHash], blockNumber }),
    duringBidding, "outcome during bidding",
  );
  console.log(`\n  status during bidding: ${STATUS[o1.status]}  (nothing can fill, not even the winner)`);

  // --- reveal ----------------------------------------------------------------------------
  // waitFor resolves with a height some node has demonstrably produced. Re-reading
  // "latest" here would throw that away and could get an answer from a replica still
  // behind the boundary -- which would abort the run with two commits already on chain
  // and the auction unrevealable. Use what was proven.
  const atReveal = await waitFor(commitEnd + 1n, "the commit window to close");
  if (atReveal <= commitEnd || atReveal + BigInt(bidders.length) > revealEnd) {
    throw new Error(`the reveal window is blocks ${commitEnd + 1n}..${revealEnd} and ${bidders.length} reveals must fit; the chain is at ${atReveal}.`);
  }

  console.log("\n  revealing");
  for (const b of bidders) {
    const t = await wallet(b).sendTransaction({
      to: BOOK, gas: GAS.reveal, data: encodeFunctionData({ abi: bookAbi, functionName: "reveal", args: [maker, orderHash, b.bps, b.salt] }),
    });
    await mined(t, `reveal by ${b.role}`);
    console.log(`  ${b.account.address.slice(0, 10)}...  revealed ${b.bps} bps   salt ${b.salt}`);
    console.log(link(t));
  }

  // --- outcome, pinned to a block we have proven exists ------------------------------------
  const afterReveal = await waitFor(revealEnd + 1n, "the reveal window to close");
  const o = await pinned(
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
    to: ROUTER, gas: GAS.fill,
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
  console.log(`  recorded by     the Book, via the maker hook`);

  // THE TWO THINGS THAT MAKE THIS EVIDENCE RATHER THAN A TRANSACTION.
  //
  // A fill after exclusiveUntil still succeeds and still emits AuctionFilled -- it just
  // executes at the BASE price, because the gate has lapsed and the improvement is no
  // longer applied. Nothing errors. So a slow run could print a fill that quietly proves
  // the opposite of the claim. Both are asserted instead of assumed.
  if (fillReceipt.blockNumber > BigInt(o.exclusiveUntil)) {
    throw new Error(
      `the fill landed in block ${fillReceipt.blockNumber} but the exclusive window ended at ` +
      `${o.exclusiveUntil}. It filled at the BASE price, not the improved one, so it does not ` +
      "demonstrate the gate.",
    );
  }
  if (filled.args.amountOut !== EXPECTED_AMOUNT_OUT) {
    throw new Error(
      `expected ${EXPECTED_AMOUNT_OUT} USDC out, the improved price the preflight proved, ` +
      `but got ${filled.args.amountOut}. The base price would be ${BASE_PRICE_AMOUNT_OUT}.`,
    );
  }
  console.log(`  inside window   block ${fillReceipt.blockNumber} <= ${o.exclusiveUntil}`);
  console.log(`  improved price  ${filled.args.amountOut} out, against ${BASE_PRICE_AMOUNT_OUT} at the base price`);

  // --- settle -----------------------------------------------------------------------------
  await waitFor(revealEnd + EXCLUSIVE_BLOCKS + 1n, "the exclusive window to elapse");
  h = await makerWallet.sendTransaction({
    to: BOOK, gas: GAS.settle, data: encodeFunctionData({ abi: bookAbi, functionName: "settle", args: [maker, orderHash] }),
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
