import { network } from "hardhat";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  encodeAbiParameters,
  formatEther,
  formatUnits,
  getAddress,
  parseEventLogs,
  toHex,
} from "viem";
import { base } from "viem/chains";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { basePublicClient, waitForBlock, rpc } from "./lib/chain.ts";

/**
 * THE KEEPER: keeps a live auction on the board.
 *
 *   npx hardhat run scripts/keeper.ts --network base
 *   DRY_RUN=1 BASE_RPC_URL=http://127.0.0.1:8545 npx hardhat run scripts/keeper.ts --network baseFork
 *
 * WHY THIS EXISTS. A sealed-bid auction is only legible while it is happening: bids
 * sealing, then opening, then a clearing price resolving. A board showing one settled
 * auction from last Tuesday demonstrates nothing. So this opens a fresh round
 * continuously, and a visitor arriving at any moment finds one accepting bids.
 *
 * IT IS ALSO THE HOUSE BIDDER, and that is disclosed on the page rather than hidden.
 * A second-price auction with ONE bidder clears at the reserve, so a lone visitor would
 * never see the mechanism do the only thing that makes it interesting. The house bids
 * once, at commitIdx 0 -- the FIRST commit of every round, before any visitor can have
 * acted -- so it cannot react to anyone. Bids are sealed, so it could not read a rival's
 * bid even if it wanted to, and it never reveals early.
 *
 * WINDOWS are the `humanDemo` set from config/auction.json (60/60/15), not the advocated
 * 30/30/15. A person needs time for two wallet signatures; 60 blocks is two minutes.
 *
 * EVERY ROUND NEEDS A DISTINCT ORDER, because Aqua.ship and Book.open each reject a hash
 * they have already seen. config/rounds.json is the table of them, built by upstream's own
 * MakerTraitsLib in test/fork/GenerateRounds.t.sol. Nothing is packed here.
 */

const AQUA = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as const;
const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe" as const;
const ROUTER = "0x5c3baE054e8b4915a13726B397b1AeA864247DBf" as const;
const MAKER = "0xeEbf737F92C8F0d9070f35a7D9BAf416923bEcDf" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// config/auction.json, "humanDemo": longer windows because people sign with a wallet.
const COMMIT_BLOCKS = 60n;
const REVEAL_BLOCKS = 60n;
const EXCLUSIVE_BLOCKS = 15n;
const RESERVE_BPS = 50;
const MAX_BPS = 500;
const BOND = 0n;

// Declared depth per round. Deliberately small: several rounds are shippable at once and
// each one advertises this much, so the SUM must stay inside what the maker actually
// holds. Advertising depth we do not have would be the same dishonesty the page spends
// its provenance system avoiding.
const BALANCE_WETH = 400_000_000_000_000n; // 0.0004 WETH
const BALANCE_USDC = 1_000_000n; // 1 USDC, at ~2500 USDC/WETH

// The house bid, drawn from a band well under maxBps so a visitor can always outbid it.
// Disclosed on the page: this is a participant, not a thumb on the scale.
const HOUSE_MIN_BPS = 60;
const HOUSE_MAX_BPS = 200;

const GAS = {
  approve: 100_000n,
  ship: 400_000n,
  open: 300_000n,
  commit: 200_000n,
  reveal: 250_000n,
  settle: 200_000n,
  dock: 200_000n,
} as const;

// THE FORK AND MAINNET MUST NOT SHARE A STATE FILE.
//
// `nextRound` is a cursor into config/rounds.json, and the fork deliberately runs at
// chainId 8453 with the same Book address as mainnet -- so nothing about the connection
// distinguishes a rehearsal from the real thing. With one shared file, rehearsing round 0
// on a fork advances the cursor to 1, and the next mainnet run silently skips round 0: the
// rehearsal would consume the very round it was rehearsing. DRY_RUN is the only signal
// that separates them, so it picks the file.
const STATE_FILE = new URL(
  process.env.DRY_RUN === "1" ? "../.keeper-state.dryrun.json" : "../.keeper-state.json",
  import.meta.url,
);
const ROUNDS = JSON.parse(readFileSync(new URL("../config/rounds.json", import.meta.url), "utf8"));
const bookAbi = JSON.parse(
  readFileSync(new URL("../subgraph/abis/GlasshouseBook.json", import.meta.url), "utf8"),
) as any;

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const orderTuple = {
  type: "tuple",
  components: [
    { name: "maker", type: "address" },
    { name: "traits", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

const aquaAbi = [
  { type: "function", name: "ship", stateMutability: "nonpayable", inputs: [{ name: "app", type: "address" }, { name: "strategy", type: "bytes" }, { name: "tokens", type: "address[]" }, { name: "amounts", type: "uint256[]" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "dock", stateMutability: "nonpayable", inputs: [{ name: "app", type: "address" }, { name: "strategyHash", type: "bytes32" }, { name: "tokens", type: "address[]" }], outputs: [] },
] as const;

const link = (h: string) => `    https://basescan.org/tx/${h}`;
const houseBid = () => HOUSE_MIN_BPS + Math.floor(Math.random() * (HOUSE_MAX_BPS - HOUSE_MIN_BPS + 1));

/**
 * The keeper's memory, written BEFORE the transaction it describes.
 *
 * A round's salt exists only in this process, and a reveal without it is impossible --
 * the bond would be forfeit and, worse, the round would sit unrevealed on the board
 * looking exactly like the withheld-reveal attack the mechanism exists to punish. So the
 * salt is persisted before the commit is sent, and a restart resumes rather than
 * abandoning.
 */
function loadState() {
  if (!existsSync(STATE_FILE)) return { nextRound: 0, active: [] as any[] };
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
function saveState(s: any) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function main() {
  const conn = await network.create();
  const DRY_RUN = process.env.DRY_RUN === "1";

  if (DRY_RUN) {
    const version = String(await conn.provider.request({ method: "web3_clientVersion" }));
    if (!/anvil|hardhat/i.test(version)) {
      throw new Error(`DRY_RUN=1 but the node reports "${version}". Refusing: this would spend real money.`);
    }
    await conn.provider.request({ method: "anvil_impersonateAccount", params: [MAKER] } as any);
    await conn.provider.request({ method: "anvil_setBalance", params: [MAKER, "0xde0b6b3a7640000"] } as any);
    console.log("\n  *** DRY RUN on a local fork. Nothing here is real money. ***");
  }

  const [nodeAccount] = (await conn.provider.request({ method: "eth_accounts" })) as `0x${string}`[];
  const account = DRY_RUN ? (MAKER as `0x${string}`) : nodeAccount;
  const maker = getAddress(account);
  if (maker !== getAddress(MAKER)) {
    throw new Error(`the keystore account is ${maker}, but every order in config/rounds.json was built for ${MAKER}. The order hash includes the maker, so these rounds are not yours to open.`);
  }

  const pub = basePublicClient();
  const wallet = createWalletClient({ account, chain: base, transport: custom(conn.provider) });
  const send = async (to: `0x${string}`, data: `0x${string}`, gas: bigint, what: string) => {
    const hash = await wallet.sendTransaction({ to, data, gas });
    const r = await rpc(() => pub.waitForTransactionReceipt({ hash }), `receipt for ${what}`);
    if (r.status !== "success") throw new Error(`${what} REVERTED: https://basescan.org/tx/${hash}`);
    return r;
  };

  const head0 = await rpc(() => pub.getBlockNumber(), "head");
  const eth = await rpc(() => pub.getBalance({ address: maker }), "eth");
  const usdc = await rpc(
    () => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [maker], blockNumber: head0 }),
    "usdc",
  );

  console.log("\n  Glasshouse keeper");
  console.log("  ------------------------------------------------------------");
  console.log(`  maker      ${maker}`);
  console.log(`  balance    ${formatEther(eth)} ETH, ${formatUnits(usdc, 6)} USDC`);
  console.log(`  windows    commit ${COMMIT_BLOCKS} / reveal ${REVEAL_BLOCKS} / exclusive ${EXCLUSIVE_BLOCKS} blocks (humanDemo)`);
  console.log(`  house bid  ${HOUSE_MIN_BPS}-${HOUSE_MAX_BPS} bps, always commitIdx 0, disclosed on the page`);
  console.log(`  rounds     ${ROUNDS.rounds.length} precomputed`);
  console.log("  ------------------------------------------------------------\n");

  // One approval covers every round: ship moves nothing, and each fill pulls only what it
  // needs. Sized to the declared depth, not to infinity.
  //
  // BOTH TOKENS, not just USDC. `ship` declares depth in the pair, so Aqua needs an
  // allowance for each side; this checked only USDC and the WETH leg was left to whatever
  // the maker happened to have approved previously. When that ran out the first round of a
  // session reverted with custom error 0x879f237b carrying the router and the order hash --
  // which reads like "this strategy was already shipped" and is not that at all. Found on a
  // fork after a fill had consumed the standing WETH allowance; on mainnet it would have hit
  // once, on the first round, and sent the operator hunting for a duplicate.
  for (const [token, label, depth] of [
    [USDC, "USDC", BALANCE_USDC],
    [WETH, "WETH", BALANCE_WETH],
  ] as const) {
    const allowance = await rpc(
      () => pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [maker, AQUA], blockNumber: head0 }),
      `${label} allowance`,
    );
    if (allowance < depth * 10n) {
      console.log(`  approving ${label} to Aqua`);
      const r = await send(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AQUA, depth * 100n] }), GAS.approve, `approve ${label}`);
      console.log(link(r.transactionHash));
    }
  }

  const state = loadState();
  // Bounded runs: a rehearsal wants one round, not three hundred, and an operator may
  // want a fixed session rather than something that runs until the table is exhausted.
  const maxRounds = Number(process.env.KEEPER_MAX_ROUNDS ?? ROUNDS.rounds.length);
  const stopAfter = state.nextRound + maxRounds;

  // PACING. Rounds run back to back by default, which is right while you are watching one
  // happen and wrong for the days afterwards: 300 rounds at ~135 blocks each is about 22
  // hours, so an unpaced keeper started on Friday has exhausted the table by Sunday and
  // leaves judges a dead board with no round to watch.
  //
  // KEEPER_PAUSE_BLOCKS spreads them. At ~2 s/block, 600 blocks is a round roughly every
  // 20 minutes and stretches the table across four or five days, with the board never
  // worse than "the last round settled a few minutes ago".
  //
  // Default 0 -- unpaced -- because that is what a rehearsal and a live demo both want, and
  // a pacing default that surprised someone mid-demo would be worse than none.
  const pauseBlocks = BigInt(process.env.KEEPER_PAUSE_BLOCKS ?? 0);
  if (pauseBlocks > 0n) {
    console.log(`  Pacing: ~${pauseBlocks} blocks between rounds (~${Number(pauseBlocks) * 2 / 60} min at 2 s/block).`);
  }
  let stop = false;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`\n  ${sig}: finishing the round in flight, then stopping.`);
      stop = true;
    });
  }

  // WHAT ONE ROUND COSTS, so the loop can refuse to start one it cannot finish.
  // Everything except `approve`, which is a one-off across the whole session.
  const ROUND_GAS = GAS.ship + GAS.open + GAS.commit + GAS.reveal + GAS.settle + GAS.dock;

  while (!stop && state.nextRound < ROUNDS.rounds.length && state.nextRound < stopAfter) {
    // STOP BETWEEN ROUNDS, NEVER INSIDE ONE.
    //
    // The balance was read once at startup and never again, so a long session simply ran
    // until a transaction failed for want of gas -- and where it failed decided how bad it
    // was. Dying after `commit` and before `reveal` leaves the house's bid sealed forever
    // on a live round: the board shows an auction nobody can settle, carrying exactly the
    // shape of the withheld-reveal attack this mechanism exists to punish, performed by
    // the house. The keeper's own header calls that the one failure worth engineering
    // against, and then the loop did not check.
    //
    // Checked per round rather than once, because the gas price moves and 227 rounds is
    // long enough for it to matter. The floor is two rounds' worth, so the run stops with
    // a round's margin in hand instead of on the exact wei.
    const gasPrice = await rpc(() => pub.getGasPrice(), "gas price");
    const roundCost = ROUND_GAS * gasPrice;
    const onHand = await rpc(() => pub.getBalance({ address: maker }), "balance before round");
    if (onHand < roundCost * 2n) {
      console.log(
        `\n  STOPPING BEFORE ROUND ${ROUNDS.rounds[state.nextRound].round}: ${formatEther(onHand)} ETH left, ` +
        `and one round costs about ${formatEther(roundCost)} at ${gasPrice} wei.`,
      );
      console.log("  Nothing is half-open: the previous round settled and docked before this check.");
      console.log(`  Top the maker up and re-run; the cursor is saved at ${state.nextRound}.\n`);
      break;
    }

    const spec = ROUNDS.rounds[state.nextRound];
    const order = { maker: MAKER, traits: BigInt(spec.traits), data: spec.data as `0x${string}` };
    const orderHash = spec.orderHash as `0x${string}`;
    console.log("");
    console.log(`  ROUND ${spec.round}  ${orderHash.slice(0, 18)}` + "\u2026");

    // WHAT ALREADY HAPPENED TO THIS ROUND, ASKED BEFORE ANYTHING IS SENT.
    //
    // `nextRound` only advances after settle AND dock, so any interruption -- Ctrl-C, a
    // laptop sleeping, a dropped RPC -- leaves the cursor pointing at a round that is
    // partly done. The loop used to restart such a round from `ship`, which Aqua rejects
    // for a strategy it already holds, and the keeper was then stuck on that round
    // forever. That is the "fork round generation is partly stuck" entry in TODO.md, and
    // it is the reason a long mainnet run could not be left unattended.
    //
    // THE REVERT SELECTOR CANNOT BE USED TO DETECT THIS. 0x879f237b carries the router and
    // the order hash and reads like a duplicate-strategy error, but a430add established it
    // ALSO fires for a missing token allowance -- the two are indistinguishable from the
    // error alone, and that ambiguity already cost this project an afternoon. So progress
    // is recorded in the state file and confirmed against the Book, never inferred from a
    // revert.
    const onChain = (await rpc(
      () => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "auctions", args: [maker, orderHash] }),
      "auction state",
    )) as any;
    const alreadyOpen = BigInt(onChain.commitEnd) !== 0n;
    const resumed = (state.active ?? []).find(
      (a: any) => String(a.orderHash).toLowerCase() === orderHash.toLowerCase(),
    );

    let salt: `0x${string}`;
    let bps: number;
    let commitEnd: bigint;
    let revealEnd: bigint;

    if (alreadyOpen) {
      commitEnd = BigInt(onChain.commitEnd);
      revealEnd = BigInt(onChain.revealEnd);
      console.log(`    RESUMING a round already open on chain (commit to ${commitEnd}, reveal to ${revealEnd})`);

      if (!resumed) {
        // THE SALT IS GONE, so the house can neither commit nor reveal on this round.
        // Saying so out loud matters: an unrevealed commit carries the withheld-reveal
        // shape this mechanism exists to punish, and a keeper that quietly moved on would
        // leave one on the board with no explanation. The round is still driven to settled
        // and docked rather than left open forever.
        console.error("    the salt for this round is not in the state file, so the house bid cannot be revealed.");
        console.error("    driving it to settled and docked anyway rather than leaving it open.");
        salt = ("0x" + "00".repeat(32)) as `0x${string}`;
        bps = 0;
      } else {
        salt = resumed.salt;
        bps = resumed.bps;
      }
    } else {
      // The salt is written down BEFORE the commit that depends on it.
      salt = toHex(randomBytes(32));
      bps = houseBid();
      state.active = [{ round: spec.round, orderHash, salt, bps, shipped: false }];
      saveState(state);

      // --- ship + open ---------------------------------------------------------------
      if (!resumed?.shipped) {
        try {
          await send(
            AQUA,
            encodeFunctionData({ abi: aquaAbi, functionName: "ship", args: [ROUTER, encodeAbiParameters([orderTuple], [order]), [WETH, USDC], [BALANCE_WETH, BALANCE_USDC]] }),
            GAS.ship, "ship",
          );
        } catch (e: any) {
          // SKIP THE ROUND, DO NOT RETRY IT. Whatever the cause -- a strategy Aqua already
          // holds from a run whose state file is gone, or anything else -- retrying is
          // exactly what turned one bad round into a permanently stuck keeper. There are
          // 300 rounds in the table and losing one costs nothing.
          console.error(`    ship failed for round ${spec.round}: ${String(e.message ?? e).slice(0, 120)}`);
          console.error("    SKIPPING this round. A strategy Aqua already holds can never be re-shipped.");
          state.nextRound = spec.round + 1;
          state.active = [];
          saveState(state);
          continue;
        }
        // Recorded BEFORE open, so an interruption in between is recoverable: the next run
        // reads `shipped` and goes straight to open instead of re-shipping.
        state.active = [{ round: spec.round, orderHash, salt, bps, shipped: true }];
        saveState(state);
      }

      const opened = await send(
        BOOK,
        encodeFunctionData({ abi: bookAbi, functionName: "open", args: [orderHash, ROUTER, WETH, COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND] }),
        GAS.open, "open",
      );
      const ev = parseEventLogs({ abi: bookAbi, eventName: "AuctionOpened", logs: opened.logs })[0] as any;
      if (!ev) throw new Error("open() emitted no AuctionOpened");
      commitEnd = BigInt(ev.args.commitEnd);
      revealEnd = BigInt(ev.args.revealEnd);
      console.log(`    open · commit to ${commitEnd}, reveal to ${revealEnd}`);
      console.log(link(opened.transactionHash));
    }

    // --- the house bid, first commit of the round ------------------------------------
    //
    // Skipped when this round already carries our commit, which is the normal state of a
    // resume. `commitment` reads zero for a bidder the Book has never seen on this round.
    const existingBid = (await rpc(
      () => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "bids", args: [maker, orderHash, maker] }),
      "existing house bid",
    )) as any;
    // `let`, NOT `const`. These describe what is sealed on chain RIGHT NOW, and the commit
    // below changes that. Read once into a const, the reveal step further down still saw
    // the pre-commit value, decided nothing of ours was sealed, skipped the reveal, and
    // let the round settle with NO WINNER -- every round, silently, on a keeper whose
    // whole job is to keep a live bid on the board. Caught by running a fresh round after
    // the resume path worked, which is the case that looked least likely to break.
    let hasCommitted = BigInt(existingBid.commitment) !== 0n;
    const hasRevealed = Boolean(existingBid.revealed);

    if (hasCommitted) {
      console.log(`    house bid already committed${hasRevealed ? " and revealed" : ""}, not re-sending`);
    } else if ((await rpc(() => pub.getBlockNumber(), "head before commit")) > commitEnd) {
      console.error("    the commit window closed before the house could bid on this round.");
    } else {
      const commitment = await rpc(
        () => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "commitmentFor", args: [maker, bps, salt] }),
        "commitmentFor",
      );
      const c = await send(BOOK, encodeFunctionData({ abi: bookAbi, functionName: "commit", args: [maker, orderHash, commitment] }), GAS.commit, "house commit");
      hasCommitted = true;
      console.log("    house bid sealed (commitIdx 0)");
      console.log(link(c.transactionHash));
    }

    // --- reveal ----------------------------------------------------------------------
    const atReveal = await waitForBlock(pub, commitEnd + 1n, `round ${spec.round} commit to close`);
    if (hasRevealed) {
      console.log("    house bid was already revealed before this run, nothing to send");
    } else if (!hasCommitted) {
      console.log("    no house bid sealed on this round, so there is nothing to reveal");
    } else if (atReveal > revealEnd) {
      console.error(`    MISSED the reveal window for round ${spec.round}. Moving on.`);
    } else {
      const r = await send(BOOK, encodeFunctionData({ abi: bookAbi, functionName: "reveal", args: [maker, orderHash, bps, salt] }), GAS.reveal, "house reveal");
      console.log(`    house bid revealed: ${bps} bps`);
      console.log(link(r.transactionHash));
    }

    // --- settle, then dock so the declared depth does not accumulate ------------------
    await waitForBlock(pub, revealEnd + EXCLUSIVE_BLOCKS + 1n, `round ${spec.round} exclusive to elapse`);
    // A resumed round may already be settled, and settle() reverts on a second call.
    const beforeSettle = (await rpc(
      () => pub.readContract({ address: BOOK, abi: bookAbi, functionName: "auctions", args: [maker, orderHash] }),
      "auction state before settle",
    )) as any;
    if (beforeSettle.settled) {
      console.log("    already settled before this run, not re-settling");
    } else {
      const s = await send(BOOK, encodeFunctionData({ abi: bookAbi, functionName: "settle", args: [maker, orderHash] }), GAS.settle, "settle");
      const settled = parseEventLogs({ abi: bookAbi, eventName: "AuctionSettled", logs: s.logs })[0] as any;
      console.log(`    settled · winner ${settled?.args.winner ?? "?"} at ${settled?.args.clearingBps ?? "?"} bps`);
      console.log(link(s.transactionHash));
    }

    // Docking returns the strategy's declared balance to zero. Without it every past
    // round stays fillable forever at the base price, and the depth this maker advertises
    // grows without bound while what it actually holds does not.
    try {
      await send(AQUA, encodeFunctionData({ abi: aquaAbi, functionName: "dock", args: [ROUTER, orderHash, [WETH, USDC]] }), GAS.dock, "dock");
      console.log("    docked");
    } catch (e: any) {
      console.error(`    dock failed (not fatal): ${String(e.message ?? e).slice(0, 90)}`);
    }

    state.nextRound = spec.round + 1;
    state.active = [];
    saveState(state);

    // AFTER the state write, so a keeper killed during the pause resumes at the next round
    // rather than replaying the one it just finished -- open() reverts AlreadyOpened, which
    // would strand the loop. And skipped when stopping, so Ctrl-C does not have to wait out
    // a twenty-minute sleep before the process exits.
    if (pauseBlocks > 0n && !stop && state.nextRound < ROUNDS.rounds.length && state.nextRound < stopAfter) {
      const resumeAt = (await pub.getBlockNumber()) + pauseBlocks;
      await waitForBlock(pub, resumeAt, `the pause before round ${state.nextRound}`);
    }
  }

  console.log(state.nextRound >= ROUNDS.rounds.length
    ? "\n  Out of precomputed rounds. Re-run test/fork/GenerateRounds.t.sol for more.\n"
    : "\n  Stopped.\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
