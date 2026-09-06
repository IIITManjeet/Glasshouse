// Unit tests for the parts of src/book.ts that are not transcription: the top-2 replay
// of handleBidRevealed, and the three defects fixed in the same commit as this file.
//
// The top-2 replay is the highest-risk code in the subgraph. It reimplements
// GlasshouseBook.reveal() (src/book/GlasshouseBook.sol:196-206) in AssemblyScript, and
// nothing else in the repo checks that the reimplementation agrees with the original.
// The Solidity suite proves the CONTRACT is right; these tests prove the replay of it
// is. The properties asserted are the mechanism's own claims:
//
//   - the outcome does not depend on reveal order (max is order-independent, ties break
//     on commit index, which was fixed before anyone knew they were tying);
//   - a tie goes to the LOWEST commit index at any number of tied bidders;
//   - with reserveBps == 0 a bid of 0 is a real bid and wins an empty book, which is
//     the case the `best == address(0)` arm of the contract exists to handle.
//
// Blocks match test/GlasshouseBook.t.sol and test/ReserveMatrix.t.sol: opened at 1000,
// commitBlocks 30, revealBlocks 30, exclusiveBlocks 15.

import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";

import {
  AuctionFilled,
  AuctionOpened,
  AuctionSettled,
  BidCommitted,
  BidRevealed,
} from "../generated/GlasshouseBook/GlasshouseBook";
import { Auction, AuctionFilledEvent, Bid, Protocol, ReserveControl } from "../generated/schema";
import {
  handleAuctionFilled,
  handleAuctionOpened,
  handleAuctionSettled,
  handleBidCommitted,
  handleBidRevealed,
} from "../src/book";
import { auctionId, bidId, newEventId } from "../src/helpers";

// ---- fixtures ---------------------------------------------------------------------

const BOOK = Address.fromString("0xc4ea91Fe700918220423ac307C6B1c59650FFbfe");
const MAKER = Address.fromString("0x1111111111111111111111111111111111111111");
const BIDDER_A = Address.fromString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const BIDDER_B = Address.fromString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const BIDDER_C = Address.fromString("0xcccccccccccccccccccccccccccccccccccccccc");
const ORDER = Bytes.fromHexString(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const ORDER_2 = Bytes.fromHexString(
  "0x2222222222222222222222222222222222222222222222222222222222222222",
);
const ORDER_3 = Bytes.fromHexString(
  "0x3333333333333333333333333333333333333333333333333333333333333333",
);

// tokenIn is the zero address throughout: a zero-bond auction is legal (bond > 0 is
// what gates the transfer, GlasshouseBook.sol:171-172) and getOrCreateToken makes no
// eth_call for it, so no test needs a mocked ERC20 to exercise auction logic.
const NO_TOKEN = Address.zero();

const OPENED_AT: i32 = 1000;
const COMMIT_END: i32 = 1030;
const REVEAL_END: i32 = 1060;
const EXCLUSIVE_BLOCKS: i32 = 15;
const EXCLUSIVE_END: i32 = 1075;

// Every event needs a distinct (txHash, logIndex) or the immutable event entities
// collide on id. One counter, bumped per constructed event, is enough.
let nonce = 0;

function base(block: i32): ethereum.Event {
  const event = newMockEvent();
  nonce = nonce + 1;
  event.address = BOOK;
  event.block.number = BigInt.fromI32(block);
  event.block.timestamp = BigInt.fromI32(1767225600 + block * 2); // 2 s blocks, arbitrary epoch
  event.transaction.hash = Bytes.fromI32(nonce);
  event.logIndex = BigInt.fromI32(0);
  event.parameters = new Array<ethereum.EventParam>();
  return event;
}

function param(name: string, value: ethereum.Value): ethereum.EventParam {
  return new ethereum.EventParam(name, value);
}

function uint(value: i32): ethereum.Value {
  return ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value));
}

function open(order: Bytes, reserveBps: i32, maxBps: i32): void {
  openBy(MAKER, order, reserveBps, maxBps);
}

function openBy(maker: Address, order: Bytes, reserveBps: i32, maxBps: i32): void {
  const event = changetype<AuctionOpened>(base(OPENED_AT));
  event.parameters.push(param("maker", ethereum.Value.fromAddress(maker)));
  event.parameters.push(param("orderHash", ethereum.Value.fromFixedBytes(order)));
  event.parameters.push(param("router", ethereum.Value.fromAddress(BOOK)));
  event.parameters.push(param("tokenIn", ethereum.Value.fromAddress(NO_TOKEN)));
  event.parameters.push(param("commitEnd", uint(COMMIT_END)));
  event.parameters.push(param("revealEnd", uint(REVEAL_END)));
  event.parameters.push(param("exclusiveBlocks", uint(EXCLUSIVE_BLOCKS)));
  event.parameters.push(param("reserveBps", uint(reserveBps)));
  event.parameters.push(param("maxBps", uint(maxBps)));
  event.parameters.push(param("bond", uint(0)));
  handleAuctionOpened(event);
}

/// commitIdx is passed explicitly rather than counted here, because it is the
/// tie-break key and every tie test needs to state it outright.
function commit(order: Bytes, bidder: Address, commitIdx: i32, block: i32): void {
  const event = changetype<BidCommitted>(base(block));
  event.parameters.push(param("maker", ethereum.Value.fromAddress(MAKER)));
  event.parameters.push(param("orderHash", ethereum.Value.fromFixedBytes(order)));
  event.parameters.push(param("bidder", ethereum.Value.fromAddress(bidder)));
  event.parameters.push(param("commitIdx", uint(commitIdx)));
  handleBidCommitted(event);
}

function reveal(order: Bytes, bidder: Address, bps: i32, block: i32): void {
  const event = changetype<BidRevealed>(base(block));
  event.parameters.push(param("maker", ethereum.Value.fromAddress(MAKER)));
  event.parameters.push(param("orderHash", ethereum.Value.fromFixedBytes(order)));
  event.parameters.push(param("bidder", ethereum.Value.fromAddress(bidder)));
  event.parameters.push(param("bps", uint(bps)));
  event.parameters.push(param("bond", uint(0)));
  handleBidRevealed(event);
}

/// Returns the AuctionFilledEvent id, so a test can read the immutable as-of-the-block
/// record and compare it with the auction's corrected copy.
function fill(order: Bytes, taker: Address, block: i32): Bytes {
  const event = changetype<AuctionFilled>(base(block));
  event.parameters.push(param("maker", ethereum.Value.fromAddress(MAKER)));
  event.parameters.push(param("orderHash", ethereum.Value.fromFixedBytes(order)));
  event.parameters.push(param("taker", ethereum.Value.fromAddress(taker)));
  event.parameters.push(param("amountIn", uint(1000)));
  event.parameters.push(param("amountOut", uint(999)));
  handleAuctionFilled(event);
  return newEventId(event);
}

function settle(
  order: Bytes,
  winner: Address,
  clearingBps: i32,
  winnerForfeited: boolean,
  block: i32,
): void {
  const event = changetype<AuctionSettled>(base(block));
  event.parameters.push(param("maker", ethereum.Value.fromAddress(MAKER)));
  event.parameters.push(param("orderHash", ethereum.Value.fromFixedBytes(order)));
  event.parameters.push(param("winner", ethereum.Value.fromAddress(winner)));
  event.parameters.push(param("clearingBps", uint(clearingBps)));
  event.parameters.push(param("winnerForfeited", ethereum.Value.fromBoolean(winnerForfeited)));
  handleAuctionSettled(event);
}

function auctionOf(order: Bytes): Auction {
  return Auction.load(auctionId(MAKER, order))!;
}

function bidOf(order: Bytes, bidder: Address): Bid {
  return Bid.load(bidId(auctionId(MAKER, order), bidder))!;
}

// ---- the top-2 replay --------------------------------------------------------------

describe("handleBidRevealed: the top-2 replay", () => {
  beforeEach(() => {
    clearStore();
  });

  // GlasshouseBook.sol:196: `bps == a.bestBps && b.commitIdx < a.bestCommitIdx`. The
  // commit index is assigned at commit time, before anyone can see they are tying, so
  // the tie-break is the same whichever order the two reveals land in. This is the
  // property the mechanism argues for; a replay that got it wrong would silently name
  // the wrong winner in exactly the case the design says is safe.
  test("a two-way tie goes to the lower commit index, revealed low-index first", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    reveal(ORDER, BIDDER_A, 250, 1040);
    reveal(ORDER, BIDDER_B, 250, 1041);

    const a = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_A, a.bestBidder!);
    assert.i32Equals(250, a.bestBps);
    assert.bigIntEquals(BigInt.zero(), a.bestCommitIdx);
    assert.i32Equals(250, a.secondBps); // the loser of a tie is the runner-up price
    assert.i32Equals(250, a.clearingBps); // max(secondBps, reserveBps)
    assert.i32Equals(0, a.winnerMarginBps);
    assert.stringEquals("CONTESTED", a.competition);
    assert.booleanEquals(false, a.thin);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_A).leading);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_B).leading);
    // B never led, so it never took the lead either.
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_B).tookLead);
  });

  test("a two-way tie goes to the lower commit index, revealed high-index first", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    reveal(ORDER, BIDDER_B, 250, 1040); // B leads an empty book
    reveal(ORDER, BIDDER_A, 250, 1041); // and is displaced on the tie-break

    const a = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_A, a.bestBidder!);
    assert.i32Equals(250, a.bestBps);
    assert.bigIntEquals(BigInt.zero(), a.bestCommitIdx);
    assert.i32Equals(250, a.secondBps);
    assert.i32Equals(250, a.clearingBps);
    assert.stringEquals("CONTESTED", a.competition);
    // Both bids took the lead at some point; only A still holds it.
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_B).tookLead);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_B).leading);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_A).tookLead);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_A).leading);
  });

  // Three at the same price, revealed worst-index-first, so the lead changes hands
  // twice. The chain of `secondBps = bestBps` assignments must not corrupt the price.
  test("a three-way tie goes to the lowest commit index, in either reveal order", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    commit(ORDER, BIDDER_C, 2, 1012);
    reveal(ORDER, BIDDER_C, 250, 1040);
    reveal(ORDER, BIDDER_B, 250, 1041);
    reveal(ORDER, BIDDER_A, 250, 1042);

    const descending = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_A, descending.bestBidder!);
    assert.i32Equals(250, descending.bestBps);
    assert.bigIntEquals(BigInt.zero(), descending.bestCommitIdx);
    assert.i32Equals(250, descending.secondBps);
    assert.i32Equals(3, descending.revealedCount);
    assert.stringEquals("CONTESTED", descending.competition);

    // Same three bids, same commit indices, reveals in the opposite order.
    open(ORDER_2, 50, 500);
    commit(ORDER_2, BIDDER_A, 0, 1010);
    commit(ORDER_2, BIDDER_B, 1, 1011);
    commit(ORDER_2, BIDDER_C, 2, 1012);
    reveal(ORDER_2, BIDDER_A, 250, 1040);
    reveal(ORDER_2, BIDDER_B, 250, 1041);
    reveal(ORDER_2, BIDDER_C, 250, 1042);

    const ascending = auctionOf(ORDER_2);
    assert.bytesEquals(BIDDER_A, ascending.bestBidder!);
    assert.i32Equals(250, ascending.bestBps);
    assert.bigIntEquals(BigInt.zero(), ascending.bestCommitIdx);
    assert.i32Equals(250, ascending.secondBps);
    assert.stringEquals("CONTESTED", ascending.competition);
  });

  // GlasshouseBook.sol:194-196: the `a.best == address(0)` arm exists precisely because
  // a valid `bps == 0` satisfies neither `bps > bestBps` nor `bps > secondBps`. Without
  // it the only revealed bidder would not win their own auction.
  test("with reserveBps 0, a bid of 0 wins an empty book and clears at 0", () => {
    open(ORDER, 0, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    reveal(ORDER, BIDDER_A, 0, 1040);

    const a = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_A, a.bestBidder!);
    assert.i32Equals(0, a.bestBps);
    assert.i32Equals(0, a.secondBps);
    assert.i32Equals(0, a.clearingBps); // max(secondBps 0, reserveBps 0)
    assert.i32Equals(0, a.winnerMarginBps);
    assert.stringEquals("SOLE", a.competition);
    assert.booleanEquals(true, a.thin); // one reveal is always thin, section 6.3
    // secondBps == reserveBps == 0, so the reserve did NOT raise the price.
    assert.booleanEquals(false, a.reserveBound);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_A).tookLead);
  });

  test("with reserveBps 0, a second bid of 0 does not take the lead from the first", () => {
    open(ORDER, 0, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    reveal(ORDER, BIDDER_A, 0, 1040);
    reveal(ORDER, BIDDER_B, 0, 1041); // ties at 0, higher commit index, so it loses

    const a = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_A, a.bestBidder!);
    assert.i32Equals(0, a.bestBps);
    assert.i32Equals(0, a.secondBps);
    assert.i32Equals(0, a.clearingBps);
    assert.stringEquals("CONTESTED", a.competition);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_B).tookLead);
  });

  // test_Competitive_SecondPriceDominatesTheReserve (test/ReserveMatrix.t.sol) uses
  // 400/250/100/60/30; the head of that ladder is enough to pin the replay.
  test("a descending ladder keeps the first reveal as best and the second as runner-up", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    commit(ORDER, BIDDER_C, 2, 1012);
    reveal(ORDER, BIDDER_A, 400, 1040);
    reveal(ORDER, BIDDER_B, 250, 1041);
    reveal(ORDER, BIDDER_C, 100, 1042);

    const a = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_A, a.bestBidder!);
    assert.i32Equals(400, a.bestBps);
    assert.i32Equals(250, a.secondBps); // the third reveal must not overwrite this
    assert.i32Equals(250, a.clearingBps);
    assert.i32Equals(150, a.winnerMarginBps);
    assert.booleanEquals(false, a.reserveBound);
    assert.stringEquals("CONTESTED", a.competition);
    assert.booleanEquals(false, a.thin); // margin 150 does not exceed clearing 250
    // Only the first reveal took the lead; nothing displaced it.
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_A).tookLead);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_B).tookLead);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_C).tookLead);
    assert.i32Equals(0, bidOf(ORDER, BIDDER_A).revealOrder);
    assert.i32Equals(2, bidOf(ORDER, BIDDER_C).revealOrder);
  });

  // The same three prices in the opposite order. Every reveal takes the lead, and the
  // displaced best has to become secondBps each time. Same outcome as descending, which
  // is the order-independence the mechanism claims.
  test("an ascending ladder reaches the same best and runner-up as a descending one", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    commit(ORDER, BIDDER_C, 2, 1012);
    reveal(ORDER, BIDDER_A, 100, 1040);
    reveal(ORDER, BIDDER_B, 250, 1041);
    reveal(ORDER, BIDDER_C, 400, 1042);

    const a = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_C, a.bestBidder!);
    assert.i32Equals(400, a.bestBps);
    assert.i32Equals(250, a.secondBps);
    assert.i32Equals(250, a.clearingBps);
    assert.i32Equals(150, a.winnerMarginBps);
    assert.stringEquals("CONTESTED", a.competition);
    assert.booleanEquals(false, a.thin);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_A).tookLead);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_B).tookLead);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_C).tookLead);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_A).leading);
    assert.booleanEquals(false, bidOf(ORDER, BIDDER_B).leading);
    assert.booleanEquals(true, bidOf(ORDER, BIDDER_C).leading);
  });
});

// ---- defect 1: Auction.fillByWinner is corrected once the winner is final -----------

describe("Auction.fillByWinner", () => {
  beforeEach(() => {
    clearStore();
  });

  // The review's failing sequence. A fill in the BIDDING phase reads a provisional
  // bestBidder; a later reveal moves the win. Before the fix the auction ended up
  // claiming bestBidder = B, filledBy = A, fillByWinner = true and winnerForfeited =
  // true at the same time, which cannot all be so.
  test("a BIDDING-phase fill is re-evaluated when a later reveal changes the winner", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    reveal(ORDER, BIDDER_A, 100, 1040);

    const filledEventId = fill(ORDER, BIDDER_A, 1045); // still inside the reveal window

    const atFill = auctionOf(ORDER);
    assert.stringEquals("BIDDING", atFill.fillPhase!);
    assert.booleanEquals(true, atFill.fillByWinner); // true as of block 1045

    reveal(ORDER, BIDDER_B, 300, 1050); // B takes the lead

    const afterReveal = auctionOf(ORDER);
    assert.bytesEquals(BIDDER_B, afterReveal.bestBidder!);
    assert.bytesEquals(BIDDER_A, afterReveal.filledBy!);
    assert.booleanEquals(false, afterReveal.fillByWinner);

    settle(ORDER, BIDDER_B, 100, true, 1080);

    const settled = auctionOf(ORDER);
    assert.booleanEquals(true, settled.winnerForfeited);
    assert.booleanEquals(false, settled.fillByWinner); // and it agrees with the forfeit
    assert.booleanEquals(true, settled.settlementMatchesDerivation);

    // The immutable event record keeps the as-of-the-fill answer, deliberately.
    const record = AuctionFilledEvent.load(filledEventId)!;
    assert.booleanEquals(true, record.fillByWinner);
    assert.stringEquals("BIDDING", record.fillPhase);
  });

  test("an EXCLUSIVE-phase fill by the winner stays true through settle", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER, BIDDER_B, 1, 1011);
    reveal(ORDER, BIDDER_A, 300, 1040);
    reveal(ORDER, BIDDER_B, 100, 1041);
    fill(ORDER, BIDDER_A, 1065); // inside the exclusive window

    const filled = auctionOf(ORDER);
    assert.stringEquals("EXCLUSIVE", filled.fillPhase!);
    assert.booleanEquals(true, filled.fillByWinner);

    settle(ORDER, BIDDER_A, 100, false, 1080);
    assert.booleanEquals(true, auctionOf(ORDER).fillByWinner);
    assert.booleanEquals(false, auctionOf(ORDER).winnerForfeited);
  });

  // Nobody revealed, so there is no winner to be. outcome() collapses the exclusive
  // window to zero length in this case (:222-225), which is why fillPhase is OPEN at a
  // block that would otherwise be inside it.
  test("a fill on an auction nobody revealed is never by the winner", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    fill(ORDER, BIDDER_B, 1065);

    const a = auctionOf(ORDER);
    assert.assertTrue(a.bestBidder === null);
    assert.stringEquals("OPEN", a.fillPhase!);
    assert.booleanEquals(false, a.fillByWinner);
  });
});

// ---- defect 2: per-role unique counters --------------------------------------------

describe("Protocol unique-role counters", () => {
  beforeEach(() => {
    clearStore();
  });

  // The address that opens our demo auctions is also a wallet that can bid
  // (src/provenance.ts names the deployer as maker). Gating on "no Account entity
  // existed" counted it once, as a maker, and never as a bidder.
  test("an address that opens an auction and then bids counts in both roles", () => {
    open(ORDER, 50, 500);
    commit(ORDER, MAKER, 0, 1010);

    const protocol = Protocol.load(BOOK)!;
    assert.i32Equals(1, protocol.cumulativeUniqueUsers); // one address
    assert.i32Equals(1, protocol.cumulativeUniqueMakers);
    assert.i32Equals(1, protocol.cumulativeUniqueBidders);
  });

  test("an address that bids and then opens an auction counts in both roles", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    openBy(BIDDER_A, ORDER_2, 50, 500);

    const protocol = Protocol.load(BOOK)!;
    assert.i32Equals(2, protocol.cumulativeUniqueUsers); // MAKER and BIDDER_A
    assert.i32Equals(2, protocol.cumulativeUniqueMakers);
    assert.i32Equals(1, protocol.cumulativeUniqueBidders);
  });

  test("repeat activity in the same role is counted once", () => {
    open(ORDER, 50, 500);
    open(ORDER_2, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    commit(ORDER_2, BIDDER_A, 0, 1011);
    reveal(ORDER, BIDDER_A, 100, 1040);

    const protocol = Protocol.load(BOOK)!;
    assert.i32Equals(2, protocol.cumulativeUniqueUsers);
    assert.i32Equals(1, protocol.cumulativeUniqueMakers);
    assert.i32Equals(1, protocol.cumulativeUniqueBidders);
  });
});

// ---- defect 3: ReserveControl.minBestBps and a genuine bestBps of 0 -----------------

describe("ReserveControl.minBestBps", () => {
  beforeEach(() => {
    clearStore();
  });

  // The review's sequence: 300, then a real 0, then 100. With 0 as the "unset"
  // sentinel the third settle overwrote the true minimum and reported 100.
  test("a genuine bestBps of 0 is kept as the minimum", () => {
    open(ORDER, 0, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    reveal(ORDER, BIDDER_A, 300, 1040);
    settle(ORDER, BIDDER_A, 0, false, 1080);

    const afterFirst = ReserveControl.load(MAKER)!;
    assert.booleanEquals(true, afterFirst.hasWinnerSeen);
    assert.i32Equals(300, afterFirst.minBestBps);
    assert.i32Equals(300, afterFirst.maxBestBps);

    open(ORDER_2, 0, 500);
    commit(ORDER_2, BIDDER_B, 0, 1010);
    reveal(ORDER_2, BIDDER_B, 0, 1040);
    settle(ORDER_2, BIDDER_B, 0, false, 1080);

    assert.i32Equals(0, ReserveControl.load(MAKER)!.minBestBps);

    open(ORDER_3, 0, 500);
    commit(ORDER_3, BIDDER_C, 0, 1010);
    reveal(ORDER_3, BIDDER_C, 100, 1040);
    settle(ORDER_3, BIDDER_C, 0, false, 1080);

    const control = ReserveControl.load(MAKER)!;
    assert.i32Equals(0, control.minBestBps); // not 100
    assert.i32Equals(300, control.maxBestBps);
    assert.i32Equals(3, control.settledAuctions);
    assert.i32Equals(3, control.settledSole);
  });

  test("a settled auction nobody revealed leaves the min and max unrecorded", () => {
    open(ORDER, 50, 500);
    commit(ORDER, BIDDER_A, 0, 1010);
    settle(ORDER, Address.zero(), 0, false, 1080);

    const control = ReserveControl.load(MAKER)!;
    assert.booleanEquals(false, control.hasWinnerSeen);
    assert.i32Equals(1, control.settledAuctions);
    assert.i32Equals(1, control.settledEmpty);
    // unrevealedCount is final at settle: one commitment, no reveal.
    assert.i32Equals(1, auctionOf(ORDER).unrevealedCount);
  });
});

// ---- boundaries carried into the schema --------------------------------------------

describe("handleAuctionOpened", () => {
  beforeEach(() => {
    clearStore();
  });

  // exclusiveEnd is stored as revealEnd + exclusiveBlocks at every bidder count, even
  // though outcome() collapses the window to revealEnd when nobody reveals. That is
  // what makes it the right boundary for canSettle() in site/phase.js, which needs the
  // arithmetic value and not the collapsed one (GlasshouseBook.sol:266).
  test("stores the three boundaries and recovers the window lengths", () => {
    open(ORDER, 50, 500);

    const a = auctionOf(ORDER);
    assert.bigIntEquals(BigInt.fromI32(COMMIT_END), a.commitEnd);
    assert.bigIntEquals(BigInt.fromI32(REVEAL_END), a.revealEnd);
    assert.bigIntEquals(BigInt.fromI32(EXCLUSIVE_END), a.exclusiveEnd);
    assert.bigIntEquals(BigInt.fromI32(30), a.commitBlocks);
    assert.bigIntEquals(BigInt.fromI32(30), a.revealBlocks);
    assert.stringEquals("ADVOCATED", a.parameterSet);
    assert.booleanEquals(false, a.fillByWinner);
    assert.assertTrue(a.bestBidder === null);
  });
});
