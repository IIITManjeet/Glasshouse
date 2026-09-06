// Handlers for the eight GlasshouseBook events.
//
// Transcribed from docs/design/subgraph-design.md section 5, against
// src/book/GlasshouseBook.sol. Every state change in the mechanism is a Book
// transaction that emits exactly one event, and the fill is reported to the Book by the
// router's maker hook (GlasshouseBook.sol:237-257), so the Book's log stream is the
// complete observable history of every auction.
//
// Every handler that loads an Auction or Bid that does not exist logs with
// log.critical and returns. The contract makes those states unreachable
// (GlasshouseBook.sol:158, :190); if one appears, the ABI or startBlock is wrong and
// the subgraph should fail loudly rather than fabricate.

import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";

import {
  AuctionFilled,
  AuctionOpened,
  AuctionSettled,
  BidCommitted,
  BidRevealed,
  BondClaimed,
  ForfeitClaimed,
  UnrevealedForfeited,
} from "../generated/GlasshouseBook/GlasshouseBook";
import {
  Auction,
  AuctionFilledEvent,
  AuctionOpenedEvent,
  AuctionSettledEvent,
  Bid,
  BidCommittedEvent,
  BidRevealedEvent,
  BondClaimedEvent,
  ForfeitClaimedEvent,
  UnrevealedForfeitedEvent,
} from "../generated/schema";

import {
  ADVOCATED_COMMIT_BLOCKS,
  ADVOCATED_EXCLUSIVE_BLOCKS,
  ADVOCATED_MAX_BPS,
  ADVOCATED_RESERVE_BPS,
  ADVOCATED_REVEAL_BLOCKS,
  BIGINT_ZERO,
  BondStatus,
  CompetitionClass,
  EventKind,
  FillPhase,
  HUMAN_DEMO_COMMIT_BLOCKS,
  HUMAN_DEMO_EXCLUSIVE_BLOCKS,
  HUMAN_DEMO_MAX_BPS,
  HUMAN_DEMO_RESERVE_BPS,
  HUMAN_DEMO_REVEAL_BLOCKS,
  ParameterSet,
  Provenance,
} from "./constants";
import {
  applyDerivedClearing,
  auctionId,
  bidId,
  getOrCreateAccount,
  getOrCreateProtocol,
  getOrCreateReserveControl,
  getOrCreateToken,
  newEventId,
  touchUsage,
} from "./helpers";

// ---- 5.1 handleAuctionOpened -----------------------------------------------------
// Source: open(), src/book/GlasshouseBook.sol:118-150.

export function handleAuctionOpened(event: AuctionOpened): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  // It cannot already exist: open() requires a.commitEnd == 0 (:131).
  if (Auction.load(id) !== null) {
    log.critical("AuctionOpened for an auction that already exists: {}", [id.toHexString()]);
    return;
  }

  const makerResult = getOrCreateAccount(event.params.maker, event.block);
  const maker = makerResult.account;
  maker.auctionsOpened = maker.auctionsOpened + 1;
  maker.save();
  if (makerResult.isNew) {
    protocol.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers + 1;
    protocol.cumulativeUniqueMakers = protocol.cumulativeUniqueMakers + 1;
  }

  const bondToken = getOrCreateToken(event.params.tokenIn);

  const commitEnd = event.params.commitEnd;
  const revealEnd = event.params.revealEnd;
  const exclusiveBlocks = event.params.exclusiveBlocks;
  // commitBlocks is not emitted, only commitEnd (:149). Recovering it as
  // commitEnd - block.number is exact because both are set in the same transaction
  // (:137). revealBlocks likewise, from :138.
  const commitBlocks = commitEnd.minus(event.block.number);
  const revealBlocks = revealEnd.minus(commitEnd);

  const auction = new Auction(id);
  auction.protocol = protocol.id;
  auction.maker = maker.id;
  auction.orderHash = event.params.orderHash;
  auction.router = event.params.router;
  auction.bondToken = bondToken.id;
  auction.bond = event.params.bond;

  auction.reserveBps = event.params.reserveBps;
  auction.maxBps = event.params.maxBps;
  auction.commitBlocks = commitBlocks;
  auction.revealBlocks = revealBlocks;
  auction.exclusiveBlocks = exclusiveBlocks;
  auction.parameterSet = parameterSetOf(
    commitBlocks,
    revealBlocks,
    exclusiveBlocks,
    event.params.reserveBps,
    event.params.maxBps,
  );

  auction.openedAtBlock = event.block.number;
  auction.openedAtTimestamp = event.block.timestamp;
  auction.openedTx = event.transaction.hash;
  auction.commitEnd = commitEnd;
  auction.revealEnd = revealEnd;
  auction.exclusiveEnd = revealEnd.plus(exclusiveBlocks);

  auction.committedCount = 0;
  auction.revealedCount = 0;
  auction.unrevealedCount = 0;
  auction.teamRevealed = 0;
  auction.invitedRevealed = 0;
  auction.unknownRevealed = 0;

  auction.bestBidder = null;
  auction.bestBps = 0;
  auction.bestCommitIdx = BIGINT_ZERO;
  auction.secondBps = 0;

  auction.clearingBps = 0;
  auction.winnerMarginBps = 0;
  auction.reserveBound = false;
  auction.competition = CompetitionClass.NONE;
  auction.thin = false;

  auction.filled = false;
  auction.fillByWinner = false;

  auction.settled = false;
  auction.winnerForfeited = false;
  // settlementMatchesDerivation stays unset, i.e. null, until settle (section 6.2).

  auction.bondsReturnedCount = 0;
  auction.forfeitClaimed = false;
  auction.unrevealedForfeitedCount = 0;
  auction.unrevealedForfeitedAmount = BIGINT_ZERO;
  auction.save();

  // Exists from the maker's first auction so the advisor's query always resolves;
  // its counters move only at settle (section 5.5).
  const control = getOrCreateReserveControl(event.params.maker, event.block);
  control.save();

  const record = new AuctionOpenedEvent(newEventId(event));
  record.kind = EventKind.AUCTION_OPENED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.maker;
  record.reserveBps = event.params.reserveBps;
  record.maxBps = event.params.maxBps;
  record.commitEnd = commitEnd;
  record.revealEnd = revealEnd;
  record.exclusiveBlocks = exclusiveBlocks;
  record.bond = event.params.bond;
  record.save();

  protocol.cumulativeAuctionCount = protocol.cumulativeAuctionCount + 1;
  const snapshot = touchUsage(protocol, event, event.params.maker);
  snapshot.dailyAuctionsOpened = snapshot.dailyAuctionsOpened + 1;
  snapshot.save();
}

// ---- 5.2 handleBidCommitted ------------------------------------------------------
// Source: commit(), src/book/GlasshouseBook.sol:155-175. The bond moves HERE (:172),
// not at reveal, so BidCommitted is the event that marks money moving.

export function handleBidCommitted(event: BidCommitted): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("BidCommitted for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  const bidderResult = getOrCreateAccount(event.params.bidder, event.block);
  const bidder = bidderResult.account;
  bidder.bidsCommitted = bidder.bidsCommitted + 1;
  bidder.save();
  if (bidderResult.isNew) {
    protocol.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers + 1;
    protocol.cumulativeUniqueBidders = protocol.cumulativeUniqueBidders + 1;
  }

  const bid = new Bid(bidId(id, event.params.bidder));
  bid.auction = auction.id;
  bid.bidder = bidder.id;
  bid.commitIdx = event.params.commitIdx;
  bid.committedAtBlock = event.block.number;
  bid.committedAtTimestamp = event.block.timestamp;
  bid.committedTx = event.transaction.hash;
  bid.bondAmount = auction.bond;
  bid.revealed = false;
  // bps and revealOrder stay unset, i.e. null, until the reveal.
  bid.tookLead = false;
  bid.leading = false;
  bid.bondStatus = BondStatus.HELD;
  bid.save();

  auction.committedCount = auction.committedCount + 1;
  auction.unrevealedCount = auction.committedCount - auction.revealedCount;
  auction.save();

  const record = new BidCommittedEvent(newEventId(event));
  record.kind = EventKind.BID_COMMITTED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.bidder;
  record.bid = bid.id;
  record.commitIdx = event.params.commitIdx;
  record.save();

  protocol.cumulativeCommitCount = protocol.cumulativeCommitCount + 1;
  const snapshot = touchUsage(protocol, event, event.params.bidder);
  snapshot.dailyCommits = snapshot.dailyCommits + 1;
  snapshot.save();
}

// ---- 5.3 handleBidRevealed -------------------------------------------------------
// Source: reveal(), src/book/GlasshouseBook.sol:181-209. The top-2 update below is a
// transliteration of lines 199-206 and must not be "improved". Reveal order within a
// block is log order, and graph-node delivers events in (block, logIndex) order, so the
// replay is exact.

export function handleBidRevealed(event: BidRevealed): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("BidRevealed for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  const bid = Bid.load(bidId(id, event.params.bidder));
  if (bid === null) {
    log.critical("BidRevealed with no committed bid: auction {} bidder {}", [
      id.toHexString(),
      event.params.bidder.toHexString(),
    ]);
    return;
  }

  const bidderResult = getOrCreateAccount(event.params.bidder, event.block);
  const bidder = bidderResult.account;
  bidder.bidsRevealed = bidder.bidsRevealed + 1;
  bidder.save();
  if (bidderResult.isNew) {
    protocol.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers + 1;
    protocol.cumulativeUniqueBidders = protocol.cumulativeUniqueBidders + 1;
  }

  const bps = event.params.bps;
  bid.revealed = true;
  bid.bps = bps;
  bid.revealOrder = auction.revealedCount; // before the increment
  bid.revealedAtBlock = event.block.number;
  bid.revealedAtTimestamp = event.block.timestamp;
  bid.revealedTx = event.transaction.hash;

  // The `prev === null` arm must come first for the same reason the contract's does
  // (:196-198): with reserveBps == 0 a valid bps == 0 satisfies neither comparison.
  const prev = auction.bestBidder;
  if (
    prev === null ||
    bps > auction.bestBps ||
    (bps == auction.bestBps && bid.commitIdx.lt(auction.bestCommitIdx))
  ) {
    if (prev !== null) {
      const prevBid = Bid.load(bidId(id, prev));
      if (prevBid === null) {
        log.critical("Leading bid missing for auction {} bidder {}", [
          id.toHexString(),
          prev.toHexString(),
        ]);
        return;
      }
      prevBid.leading = false;
      prevBid.save();
    }
    auction.secondBps = auction.bestBps; // displaced best becomes the runner-up price
    auction.bestBidder = bidder.id;
    auction.bestBps = bps;
    auction.bestCommitIdx = bid.commitIdx;
    bid.tookLead = true;
    bid.leading = true;
  } else if (bps > auction.secondBps) {
    auction.secondBps = bps;
  }
  bid.save();

  auction.revealedCount = auction.revealedCount + 1;
  auction.unrevealedCount = auction.committedCount - auction.revealedCount;
  applyDerivedClearing(auction);

  if (bidder.provenance == Provenance.TEAM) {
    auction.teamRevealed = auction.teamRevealed + 1;
  } else if (bidder.provenance == Provenance.INVITED) {
    auction.invitedRevealed = auction.invitedRevealed + 1;
  } else {
    auction.unknownRevealed = auction.unknownRevealed + 1;
  }
  auction.save();

  const record = new BidRevealedEvent(newEventId(event));
  record.kind = EventKind.BID_REVEALED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.bidder;
  record.bid = bid.id;
  record.bps = bps;
  record.revealOrder = bid.revealOrder;
  record.tookLead = bid.tookLead;
  record.bestBpsAfter = auction.bestBps;
  record.secondBpsAfter = auction.secondBps;
  record.clearingBpsAfter = auction.clearingBps;
  record.revealedCountAfter = auction.revealedCount;
  record.save();

  protocol.cumulativeRevealCount = protocol.cumulativeRevealCount + 1;
  const snapshot = touchUsage(protocol, event, event.params.bidder);
  snapshot.dailyReveals = snapshot.dailyReveals + 1;
  snapshot.save();
}

// ---- 5.4 handleAuctionFilled -----------------------------------------------------
// Source: postTransferIn(), src/book/GlasshouseBook.sol:237-257. Fires at most once per
// auction (:253), and only if the maker's signed order set the hook at this Book and
// the router named at open() is the one that filled (:251).

export function handleAuctionFilled(event: AuctionFilled): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("AuctionFilled for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  const takerResult = getOrCreateAccount(event.params.taker, event.block);
  const taker = takerResult.account;
  taker.fillsRecorded = taker.fillsRecorded + 1;
  taker.save();
  if (takerResult.isNew) {
    protocol.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers + 1;
  }

  auction.filled = true;
  auction.filledBy = taker.id;
  auction.fillBlock = event.block.number;
  auction.fillTimestamp = event.block.timestamp;
  auction.fillTx = event.transaction.hash;
  auction.fillAmountIn = event.params.amountIn;
  auction.fillAmountOut = event.params.amountOut;

  const best = auction.bestBidder;
  // From the block alone. The bestBidder test mirrors outcome() returning
  // exclusiveUntil = revealEnd when nobody revealed (:222-225).
  let fillPhase = FillPhase.OPEN;
  if (event.block.number.le(auction.revealEnd)) {
    fillPhase = FillPhase.BIDDING;
  } else if (best !== null && event.block.number.le(auction.exclusiveEnd)) {
    fillPhase = FillPhase.EXCLUSIVE;
  }
  auction.fillPhase = fillPhase;

  // The derived best is final at any fill block > revealEnd; a BIDDING fill is the one
  // case where it is not, and the field is still set from the state at that moment.
  const fillByWinner = best !== null && best.equals(event.params.taker);
  auction.fillByWinner = fillByWinner;
  auction.save();

  const record = new AuctionFilledEvent(newEventId(event));
  record.kind = EventKind.AUCTION_FILLED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.taker;
  record.amountIn = event.params.amountIn;
  record.amountOut = event.params.amountOut;
  record.fillPhase = fillPhase;
  record.fillByWinner = fillByWinner;
  record.save();

  protocol.cumulativeFillCount = protocol.cumulativeFillCount + 1;
  const snapshot = touchUsage(protocol, event, event.params.taker);
  snapshot.dailyFills = snapshot.dailyFills + 1;
  snapshot.save();
}

// ---- 5.5 handleAuctionSettled ----------------------------------------------------
// Source: settle(), src/book/GlasshouseBook.sol:262-281. The only event carrying the
// contract's own clearingBps, and it is permissionless and may never happen.

export function handleAuctionSettled(event: AuctionSettled): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("AuctionSettled for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  auction.settled = true;
  auction.settledAtBlock = event.block.number;
  auction.settledTimestamp = event.block.timestamp;
  auction.settledTx = event.transaction.hash;
  auction.settledWinner = event.params.winner;
  auction.settledClearingBps = event.params.clearingBps;
  auction.winnerForfeited = event.params.winnerForfeited;

  // The subgraph's self-test. The contract emits 0 for a winnerless auction (:280) and
  // our derived clearingBps is 0 in that case (section 6.2), so the comparison is exact.
  const best = auction.bestBidder;
  let derivedWinner: Bytes = Address.zero();
  if (best !== null) {
    derivedWinner = best;
  }
  const matches =
    derivedWinner.equals(event.params.winner) &&
    auction.clearingBps == event.params.clearingBps;
  auction.settlementMatchesDerivation = matches;
  if (!matches) {
    log.error(
      "settle disagrees with the replay for auction {}: emitted winner {} clearingBps {}, derived winner {} clearingBps {}",
      [
        id.toHexString(),
        event.params.winner.toHexString(),
        BigInt.fromI32(event.params.clearingBps).toString(),
        derivedWinner.toHexString(),
        BigInt.fromI32(auction.clearingBps).toString(),
      ],
    );
  }

  auction.unrevealedCount = auction.committedCount - auction.revealedCount; // now final
  auction.save();

  if (!event.params.winner.equals(Address.zero())) {
    const winnerResult = getOrCreateAccount(event.params.winner, event.block);
    const winner = winnerResult.account;
    winner.auctionsWon = winner.auctionsWon + 1;
    if (event.params.winnerForfeited) {
      winner.forfeits = winner.forfeits + 1;
    }
    winner.save();
    if (winnerResult.isNew) {
      protocol.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers + 1;
    }
  }

  // ReserveControl moves only here. Nothing fires when revealEnd passes, so settle is
  // the one event guaranteed to be after exclusiveEnd (:266) and therefore the one
  // moment the mapping knows an auction's reveal set is final. Section 5.5.
  const control = getOrCreateReserveControl(event.params.maker, event.block);
  control.settledAuctions = control.settledAuctions + 1;
  if (auction.competition == CompetitionClass.NONE) {
    control.settledEmpty = control.settledEmpty + 1;
  } else if (auction.competition == CompetitionClass.SOLE) {
    control.settledSole = control.settledSole + 1;
  } else {
    control.settledContested = control.settledContested + 1;
  }
  if (auction.thin) {
    control.settledThin = control.settledThin + 1;
  }
  if (auction.reserveBound) {
    control.settledReserveBound = control.settledReserveBound + 1;
  }
  control.revealedBidderSum = control.revealedBidderSum + auction.revealedCount;
  if (best !== null) {
    control.clearingBpsSum = control.clearingBpsSum + auction.clearingBps;
    control.winnerMarginBpsSum = control.winnerMarginBpsSum + auction.winnerMarginBps;
    if (control.minBestBps == 0 || auction.bestBps < control.minBestBps) {
      control.minBestBps = auction.bestBps;
    }
    if (auction.bestBps > control.maxBestBps) {
      control.maxBestBps = auction.bestBps;
    }
  }
  control.lastSettledAuction = auction.id;
  control.lastUpdateBlock = event.block.number;
  control.save();

  const record = new AuctionSettledEvent(newEventId(event));
  record.kind = EventKind.AUCTION_SETTLED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.transaction.from; // settle is permissionless (:260-261)
  record.winner = event.params.winner;
  record.clearingBps = event.params.clearingBps;
  record.winnerForfeited = event.params.winnerForfeited;
  record.matchesDerivation = matches;
  record.save();

  protocol.cumulativeSettleCount = protocol.cumulativeSettleCount + 1;
  const snapshot = touchUsage(protocol, event, event.transaction.from);
  snapshot.dailySettles = snapshot.dailySettles + 1;
  snapshot.save();
}

// ---- 5.6 handleBondClaimed -------------------------------------------------------
// Source: claimBond(), src/book/GlasshouseBook.sol:284-298.

export function handleBondClaimed(event: BondClaimed): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("BondClaimed for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  const bid = Bid.load(bidId(id, event.params.bidder));
  if (bid === null) {
    log.critical("BondClaimed with no bid: auction {} bidder {}", [
      id.toHexString(),
      event.params.bidder.toHexString(),
    ]);
    return;
  }

  bid.bondStatus = BondStatus.RETURNED;
  bid.bondClaimedAtBlock = event.block.number;
  bid.bondClaimedTx = event.transaction.hash;
  bid.save();

  auction.bondsReturnedCount = auction.bondsReturnedCount + 1;
  auction.save();

  const record = new BondClaimedEvent(newEventId(event));
  record.kind = EventKind.BOND_CLAIMED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.bidder;
  record.bid = bid.id;
  record.amount = event.params.amount;
  record.save();

  const snapshot = touchUsage(protocol, event, event.params.bidder);
  snapshot.save();
}

// ---- 5.7 handleForfeitClaimed ----------------------------------------------------
// Source: claimForfeit(), src/book/GlasshouseBook.sol:306-320. The event does not name
// the bidder (:82); the contract charges _bids[k][a.best] (:312), and a.best is what
// AuctionSettled emitted as winner. One extra load, never wrong.

export function handleForfeitClaimed(event: ForfeitClaimed): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("ForfeitClaimed for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  // claimForfeit requires settled && winnerForfeited (:309-310), and winnerForfeited is
  // only ever true when a.best != 0 (:277), so settledWinner is set and non-zero here.
  const winner = auction.settledWinner;
  if (winner === null || winner.equals(Address.zero())) {
    log.critical("ForfeitClaimed with no settled winner for auction {}", [id.toHexString()]);
    return;
  }

  const bid = Bid.load(bidId(id, winner));
  if (bid === null) {
    log.critical("ForfeitClaimed with no winning bid: auction {} winner {}", [
      id.toHexString(),
      winner.toHexString(),
    ]);
    return;
  }

  bid.bondStatus = BondStatus.FORFEITED_TO_MAKER;
  bid.bondClaimedAtBlock = event.block.number;
  bid.bondClaimedTx = event.transaction.hash;
  bid.save();

  auction.forfeitClaimed = true;
  auction.forfeitAmount = event.params.amount;
  auction.save();

  const record = new ForfeitClaimedEvent(newEventId(event));
  record.kind = EventKind.FORFEIT_CLAIMED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.maker;
  record.bid = bid.id;
  record.amount = event.params.amount;
  record.save();

  const snapshot = touchUsage(protocol, event, event.params.maker);
  snapshot.save();
}

// ---- 5.8 handleUnrevealedForfeited -----------------------------------------------
// Source: claimUnrevealed(), src/book/GlasshouseBook.sol:329-342. This event names the
// bidder, so no join is needed.

export function handleUnrevealedForfeited(event: UnrevealedForfeited): void {
  const protocol = getOrCreateProtocol(event.address, event.block);

  const id = auctionId(event.params.maker, event.params.orderHash);
  const auction = Auction.load(id);
  if (auction === null) {
    log.critical("UnrevealedForfeited for an unknown auction: {}", [id.toHexString()]);
    return;
  }

  const bid = Bid.load(bidId(id, event.params.bidder));
  if (bid === null) {
    log.critical("UnrevealedForfeited with no bid: auction {} bidder {}", [
      id.toHexString(),
      event.params.bidder.toHexString(),
    ]);
    return;
  }

  bid.bondStatus = BondStatus.UNREVEALED_FORFEITED;
  bid.bondClaimedAtBlock = event.block.number;
  bid.bondClaimedTx = event.transaction.hash;
  bid.save();

  auction.unrevealedForfeitedCount = auction.unrevealedForfeitedCount + 1;
  auction.unrevealedForfeitedAmount = auction.unrevealedForfeitedAmount.plus(
    event.params.amount,
  );
  auction.save();

  const bidderResult = getOrCreateAccount(event.params.bidder, event.block);
  const bidder = bidderResult.account;
  bidder.unrevealedForfeits = bidder.unrevealedForfeits + 1;
  bidder.save();
  if (bidderResult.isNew) {
    protocol.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers + 1;
    protocol.cumulativeUniqueBidders = protocol.cumulativeUniqueBidders + 1;
  }

  const record = new UnrevealedForfeitedEvent(newEventId(event));
  record.kind = EventKind.UNREVEALED_FORFEITED;
  record.auction = auction.id;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.logIndex = event.logIndex.toI32();
  record.actor = event.params.maker;
  record.bid = bid.id;
  record.amount = event.params.amount;
  record.save();

  const snapshot = touchUsage(protocol, event, event.params.maker);
  snapshot.save();
}

// ---- parameter set label ----------------------------------------------------------

function parameterSetOf(
  commitBlocks: BigInt,
  revealBlocks: BigInt,
  exclusiveBlocks: BigInt,
  reserveBps: i32,
  maxBps: i32,
): string {
  if (
    commitBlocks.equals(ADVOCATED_COMMIT_BLOCKS) &&
    revealBlocks.equals(ADVOCATED_REVEAL_BLOCKS) &&
    exclusiveBlocks.equals(ADVOCATED_EXCLUSIVE_BLOCKS) &&
    reserveBps == ADVOCATED_RESERVE_BPS &&
    maxBps == ADVOCATED_MAX_BPS
  ) {
    return ParameterSet.ADVOCATED;
  }
  if (
    commitBlocks.equals(HUMAN_DEMO_COMMIT_BLOCKS) &&
    revealBlocks.equals(HUMAN_DEMO_REVEAL_BLOCKS) &&
    exclusiveBlocks.equals(HUMAN_DEMO_EXCLUSIVE_BLOCKS) &&
    reserveBps == HUMAN_DEMO_RESERVE_BPS &&
    maxBps == HUMAN_DEMO_MAX_BPS
  ) {
    return ParameterSet.HUMAN_DEMO;
  }
  return ParameterSet.OTHER;
}
