import { Address, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";

import { ERC20 } from "../generated/GlasshouseBook/ERC20";
import {
  Account,
  ActiveAccount,
  Auction,
  Protocol,
  ReserveControl,
  Token,
  UsageMetricsDailySnapshot,
} from "../generated/schema";

import {
  CompetitionClass,
  METHODOLOGY_VERSION,
  Network,
  PROTOCOL_NAME,
  PROTOCOL_SLUG,
  ProtocolType,
  SCHEMA_VERSION,
  SECONDS_PER_DAY,
  START_BLOCK,
  SUBGRAPH_VERSION,
} from "./constants";
import { provenanceOf } from "./provenance";

// ---- ids (design section 3.2) ----------------------------------------------------

/// keccak256(abi.encodePacked(maker, orderHash)); identical to GlasshouseBook.key()
/// (src/book/GlasshouseBook.sol:102-104), so a reader can paste a `cast call
/// key(address,bytes32)` result straight into a GraphQL query.
export function auctionId(maker: Address, orderHash: Bytes): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(maker.concat(orderHash)));
}

/// auction id ++ bidder, 52 bytes. One Bid per (auction, bidder), which is the
/// contract's own cardinality (src/book/GlasshouseBook.sol:63).
export function bidId(auction: Bytes, bidder: Bytes): Bytes {
  return auction.concat(bidder);
}

/// tx hash ++ logIndex.
export function newEventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

export function dayOf(event: ethereum.Event): i32 {
  return event.block.timestamp.toI32() / SECONDS_PER_DAY;
}

// ---- account get-or-create -------------------------------------------------------

/// AssemblyScript has no tuples, so the (Account, isNew) pair of design section 5 is a
/// tiny class.
///
/// `isNew` means "no Account entity existed", i.e. first sighting in ANY role. It is the
/// right gate for `protocol.cumulativeUniqueUsers` and the WRONG gate for the per-role
/// counters: an address that opens an auction and later bids is not new at its first
/// commit, so gating on `isNew` would never count it as a bidder. Use
/// `isFirstAsMaker` / `isFirstAsBidder` for those, before the per-role counter is bumped.
export class AccountResult {
  account: Account;
  isNew: boolean;

  constructor(account: Account, isNew: boolean) {
    this.account = account;
    this.isNew = isNew;
  }
}

export function getOrCreateProtocol(address: Address, block: ethereum.Block): Protocol {
  let protocol = Protocol.load(address);
  if (protocol === null) {
    protocol = new Protocol(address);
    protocol.name = PROTOCOL_NAME;
    protocol.slug = PROTOCOL_SLUG;
    protocol.schemaVersion = SCHEMA_VERSION;
    protocol.subgraphVersion = SUBGRAPH_VERSION;
    protocol.methodologyVersion = METHODOLOGY_VERSION;
    protocol.network = Network.BASE;
    protocol.type = ProtocolType.GENERIC;
    protocol.startBlock = START_BLOCK;
    protocol.cumulativeAuctionCount = 0;
    protocol.cumulativeCommitCount = 0;
    protocol.cumulativeRevealCount = 0;
    protocol.cumulativeFillCount = 0;
    protocol.cumulativeSettleCount = 0;
    protocol.cumulativeTransactionCount = 0;
    protocol.cumulativeUniqueUsers = 0;
    protocol.cumulativeUniqueMakers = 0;
    protocol.cumulativeUniqueBidders = 0;
  }
  protocol.lastUpdateBlock = block.number;
  protocol.lastUpdateTimestamp = block.timestamp;
  return protocol as Protocol;
}

export function getOrCreateAccount(address: Address, block: ethereum.Block): AccountResult {
  let account = Account.load(address);
  let isNew = false;
  if (account === null) {
    isNew = true;
    account = new Account(address);
    account.provenance = provenanceOf(address);
    account.auctionsOpened = 0;
    account.bidsCommitted = 0;
    account.bidsRevealed = 0;
    account.auctionsWon = 0;
    account.fillsRecorded = 0;
    account.forfeits = 0;
    account.unrevealedForfeits = 0;
    account.firstSeenBlock = block.number;
  }
  account.lastSeenBlock = block.number;
  return new AccountResult(account as Account, isNew);
}

/// True when this account has never opened an auction. Call BEFORE bumping
/// `auctionsOpened`; the caller then increments `protocol.cumulativeUniqueMakers`.
export function isFirstAsMaker(account: Account): boolean {
  return account.auctionsOpened == 0;
}

/// True when this account has never been seen as a bidder. Call BEFORE bumping
/// `bidsCommitted` / `bidsRevealed` / `unrevealedForfeits`.
///
/// Both counters are tested, not just `bidsCommitted`, so the gate stays correct if a
/// reveal or a forfeit ever arrives without the commit that must precede it on chain
/// (`src/book/GlasshouseBook.sol:190`) -- e.g. an indexer started past the commit block.
export function isFirstAsBidder(account: Account): boolean {
  return account.bidsCommitted == 0 && account.bidsRevealed == 0;
}

/// Bond denomination metadata, so the receipt can print "0.5 USDC bond" rather than an
/// address. Three eth_calls once per new token (design Q7). The zero address is a legal
/// tokenIn for a zero-bond auction, and is never called.
export function getOrCreateToken(address: Address): Token {
  let token = Token.load(address);
  if (token !== null) {
    return token as Token;
  }

  token = new Token(address);
  token.resolved = false;

  if (address.equals(Address.zero())) {
    token.save();
    return token as Token;
  }

  const contract = ERC20.bind(address);
  const name = contract.try_name();
  const symbol = contract.try_symbol();
  const decimals = contract.try_decimals();

  if (!name.reverted) {
    token.name = name.value;
  }
  if (!symbol.reverted) {
    token.symbol = symbol.value;
  }
  if (!decimals.reverted) {
    token.decimals = decimals.value;
  }
  token.resolved = !name.reverted && !symbol.reverted && !decimals.reverted;

  token.save();
  return token as Token;
}

export function getOrCreateReserveControl(maker: Address, block: ethereum.Block): ReserveControl {
  let control = ReserveControl.load(maker);
  if (control === null) {
    control = new ReserveControl(maker);
    control.maker = maker;
    control.settledAuctions = 0;
    control.settledEmpty = 0;
    control.settledSole = 0;
    control.settledContested = 0;
    control.settledThin = 0;
    control.settledReserveBound = 0;
    control.revealedBidderSum = 0;
    control.clearingBpsSum = 0;
    control.winnerMarginBpsSum = 0;
    control.hasWinnerSeen = false;
    control.minBestBps = 0;
    control.maxBestBps = 0;
    control.lastUpdateBlock = block.number;
  }
  return control as ReserveControl;
}

// ---- usage (Messari common conventions, counts only) ------------------------------

/// Bumps the transaction counters and the day's active-user set, and returns the day's
/// snapshot so the caller can bump the one per-kind counter it owns and save it.
///
/// The caller must apply its own protocol counter increments BEFORE calling this: this
/// function saves the protocol.
export function touchUsage(
  protocol: Protocol,
  event: ethereum.Event,
  actor: Bytes,
): UsageMetricsDailySnapshot {
  const day = dayOf(event);

  protocol.cumulativeTransactionCount = protocol.cumulativeTransactionCount + 1;

  const snapshotId = Bytes.fromI32(day);
  let snapshot = UsageMetricsDailySnapshot.load(snapshotId);
  if (snapshot === null) {
    snapshot = new UsageMetricsDailySnapshot(snapshotId);
    snapshot.day = day;
    snapshot.protocol = protocol.id;
    snapshot.dailyActiveUsers = 0;
    snapshot.dailyTransactionCount = 0;
    snapshot.dailyAuctionsOpened = 0;
    snapshot.dailyCommits = 0;
    snapshot.dailyReveals = 0;
    snapshot.dailyFills = 0;
    snapshot.dailySettles = 0;
  }

  const activeId = Bytes.fromI32(day).concat(actor);
  if (ActiveAccount.load(activeId) === null) {
    const active = new ActiveAccount(activeId);
    active.save();
    snapshot.dailyActiveUsers = snapshot.dailyActiveUsers + 1;
  }

  snapshot.dailyTransactionCount = snapshot.dailyTransactionCount + 1;
  snapshot.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
  snapshot.cumulativeTransactionCount = protocol.cumulativeTransactionCount;
  snapshot.timestamp = event.block.timestamp;
  snapshot.blockNumber = event.block.number;

  protocol.save();
  return snapshot as UsageMetricsDailySnapshot;
}

// ---- derived state (design section 6.2, 6.3) --------------------------------------

export function classify(revealedCount: i32): string {
  if (revealedCount == 0) {
    return CompetitionClass.NONE;
  }
  if (revealedCount == 1) {
    return CompetitionClass.SOLE;
  }
  return CompetitionClass.CONTESTED;
}

/// Two signatures of thin competition (design section 6.3): a sole reveal, or a
/// contested auction whose runner-up bid less than half of what the winner bid. The
/// factor of two is a threshold and is labelled as one wherever it is displayed.
export function isThin(competition: string, winnerMarginBps: i32, clearingBps: i32): boolean {
  if (competition == CompetitionClass.SOLE) {
    return true;
  }
  return competition == CompetitionClass.CONTESTED && winnerMarginBps > clearingBps;
}

/// The clearing rule, verbatim from the contract (src/book/GlasshouseBook.sol:229,
/// :279): `clearingBps = secondBps > reserveBps ? secondBps : reserveBps` when a winner
/// exists, and 0 when nobody revealed.
export function applyDerivedClearing(auction: Auction): void {
  if (auction.bestBidder === null) {
    auction.clearingBps = 0;
    auction.winnerMarginBps = 0;
    auction.reserveBound = false;
  } else {
    const clearing =
      auction.secondBps > auction.reserveBps ? auction.secondBps : auction.reserveBps;
    auction.clearingBps = clearing;
    auction.winnerMarginBps = auction.bestBps - clearing;
    // Strict: "the reserve raised the price above what competition set". With two or
    // more reveals this is always false, because reveal() rejects sub-reserve bids
    // (src/book/GlasshouseBook.sol:187).
    auction.reserveBound = auction.secondBps < auction.reserveBps;
  }
  auction.competition = classify(auction.revealedCount);
  auction.thin = isThin(auction.competition, auction.winnerMarginBps, auction.clearingBps);
}

/// Recomputes `Auction.fillByWinner` from the CURRENT best bidder.
///
/// The value written at the fill can be wrong. A fill in the BIDDING phase
/// (`block <= revealEnd`) sees a provisional `bestBidder`, so a later reveal can move
/// the win to someone else and leave the auction claiming `fillByWinner = true` for a
/// taker who is no longer the winner -- next to `winnerForfeited = true`, which says the
/// opposite. Calling this on every reveal and again at settle keeps the auction's own
/// answer consistent with its own `bestBidder` at all times, and makes it final once
/// `block > revealEnd` freezes the top-2.
///
/// This deliberately does NOT touch `AuctionFilledEvent.fillByWinner`, which is
/// immutable and correct as a statement about its own block.
export function applyFillByWinner(auction: Auction): void {
  const filledBy = auction.filledBy;
  const best = auction.bestBidder;
  if (filledBy === null || best === null) {
    auction.fillByWinner = false;
    return;
  }
  auction.fillByWinner = best.equals(filledBy);
}
