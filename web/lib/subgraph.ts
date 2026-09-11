// Reading the Glasshouse subgraph over plain HTTP GraphQL.
//
// WHY THIS EXISTS WHEN chain.js ALREADY READS THE BOOK. The chain reader answers "what is
// happening right now" and is the correct source for a live phase -- an indexer is a block
// or two behind, and the board counts down in blocks. What it cannot answer is history:
// it reads a WINDOW of recent rounds, one eth_call each, so a bidder's full record is
// simply not available to it. `Account.bidsRevealed / bidsCommitted` over every round the
// Book has ever had is an indexer's job.
//
// It also carries the one thing the chain physically cannot: `Account.provenance`. Whether
// an address is on our list of team and invited wallets is OUR fact, not the chain's, and
// the mapping is where it lives. Reserve.tsx currently prints "unavailable" for that
// breakdown; this is what makes it answerable.
//
// AND IT CARRIES THE ORDER OF EVENTS, which no eth_call can reconstruct at all. See the
// per-event timeline further down: which reveal took the lead from whom, and what the
// clearing price was after each one.
//
// WHICH URL THIS MAY SEE. The subgraph is published to The Graph Network, but this path
// deliberately reads the Studio endpoint rather than the Gateway: the site is
// `output: "export"`, so NEXT_PUBLIC_SUBGRAPH_URL is inlined into a public chunk, and a
// Gateway URL carries its API key in the path. subgraph/README.md tabulates which of the
// three consumers may see which URL. This works as soon as the variable is set and
// degrades to nothing when it is not.
//
// EVERY FAILURE IS DISTINCT AND NAMED. "Not configured", "the indexer did not answer" and
// "the indexer answered and has no row for this address" are three different states, and
// collapsing them into null is how a page ends up saying "no bids" about someone whose
// query timed out. `SubgraphResult` keeps them apart so the UI can say which.

import { encodePacked, keccak256 } from "viem";

/** Inlined at build time by Next for a static export; unset means the path is simply off. */
const URL_ = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

export const subgraphConfigured = () => URL_.length > 0;

/** The three values `provenanceOf()` can return -- see subgraph/src/provenance.ts, which
 *  is the only place they are produced. UNKNOWN is "not on our list"; it does NOT mean
 *  external, and no consumer may present it as such. */
export type Provenance = "TEAM" | "INVITED" | "UNKNOWN";

/** `Account` from subgraph/schema.graphql. Counts only -- never a ratio, per the refusals
 *  list in subgraph/README.md. The page prints numerator and denominator itself. */
export interface SubgraphAccount {
  id: string;
  provenance: Provenance;
  auctionsOpened: number;
  bidsCommitted: number;
  bidsRevealed: number;
  auctionsWon: number;
  fillsRecorded: number;
  forfeits: number;
  unrevealedForfeits: number;
  firstSeenBlock: string;
  lastSeenBlock: string;
}

export interface IndexedAt {
  number: number;
  timestamp: number;
}

export type SubgraphResult<T> =
  | { state: "off" }
  | { state: "error"; message: string }
  | { state: "ok"; data: T | null; head: IndexedAt | null };

/**
 * One query, with `_meta` always attached.
 *
 * `_meta.block.number` is not decoration: it is the block the answer is AS OF, and the
 * provenance rule requires every figure derived from it to name that block rather than the
 * chain head. An indexer that is behind is still honest if it says which block it is at.
 */
async function query<T>(gql: string, variables: Record<string, unknown>): Promise<SubgraphResult<T>> {
  if (!subgraphConfigured()) return { state: "off" };
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: gql, variables }),
    });
    if (!res.ok) return { state: "error", message: `HTTP ${res.status}` };
    const body = await res.json();
    if (body.errors?.length) {
      return { state: "error", message: String(body.errors[0]?.message ?? "query rejected") };
    }
    const meta = body.data?._meta?.block ?? null;
    return {
      state: "ok",
      data: body.data ?? null,
      head: meta ? { number: Number(meta.number), timestamp: Number(meta.timestamp) } : null,
    };
  } catch (e) {
    return { state: "error", message: String((e as Error)?.message ?? e) };
  }
}

const ACCOUNT = `
  query Account($id: ID!) {
    _meta { block { number timestamp } }
    account(id: $id) {
      id
      provenance
      auctionsOpened
      bidsCommitted
      bidsRevealed
      auctionsWon
      fillsRecorded
      forfeits
      unrevealedForfeits
      firstSeenBlock
      lastSeenBlock
    }
  }
`;

/**
 * One address's whole record, across every round the Book has ever had.
 *
 * `data: null` with `state: "ok"` is a real and different answer from an error: the indexer
 * replied and has never seen this address. A profile for someone who has never bid should
 * say exactly that, not "could not load".
 */
export async function fetchAccount(address: string): Promise<SubgraphResult<SubgraphAccount>> {
  const r = await query<{ account: SubgraphAccount | null }>(ACCOUNT, {
    // The mapping keys Account by the raw address bytes, which graph-node lowercases.
    id: address.toLowerCase(),
  });
  if (r.state !== "ok") return r;
  return { state: "ok", data: r.data?.account ?? null, head: r.head };
}

// ---------------------------------------------------------------------------------
// THE PER-EVENT TIMELINE
//
// The chain reader gives a round's CURRENT state: who leads, what clears, whether it
// settled. What it cannot give is the ORDER in which that became true -- which reveal took
// the lead from whom, and what the clearing price was after each one. That ordering is the
// single most convincing thing a sealed-bid auction has to show, because it is what
// demonstrates that the price was set by the runner-up rather than chosen, and it is
// precisely what the Book's logs carry and an eth_call does not.
//
// `BidRevealedEvent` stores the state AFTER each reveal was applied (bestBpsAfter,
// secondBpsAfter, clearingBpsAfter) for exactly this reason -- see schema.graphql: "lets
// the UI replay without re-implementing the rule". This is the consumer that comment was
// written for. Nothing below re-derives anything; it renders what the mapping recorded.
// ---------------------------------------------------------------------------------

export type EventKind =
  | "AUCTION_OPENED"
  | "BID_COMMITTED"
  | "BID_REVEALED"
  | "AUCTION_FILLED"
  | "AUCTION_SETTLED"
  | "BOND_CLAIMED"
  | "FORFEIT_CLAIMED"
  | "UNREVEALED_FORFEITED";

/** `BondStatus` from subgraph/schema.graphql. HELD is the default, not a judgment. */
export type BondStatus = "HELD" | "RETURNED" | "FORFEITED_TO_MAKER" | "UNREVEALED_FORFEITED";

export interface TimelineEvent {
  id: string;
  kind: EventKind;
  blockNumber: string;
  timestamp: string;
  txHash: string;
  logIndex: number;
  actor: string;
  /** BidRevealedEvent only. The state AFTER this reveal, recorded by the mapping. */
  bps?: number | null;
  revealOrder?: number | null;
  tookLead?: boolean | null;
  bestBpsAfter?: number | null;
  secondBpsAfter?: number | null;
  clearingBpsAfter?: number | null;
  revealedCountAfter?: number | null;
  /** BidCommittedEvent only. */
  commitIdx?: string | null;
  /** AuctionSettledEvent only. */
  winner?: string | null;
  clearingBps?: number | null;
  winnerForfeited?: boolean | null;
  matchesDerivation?: boolean | null;
}

export interface TimelineBid {
  bidder: { id: string; provenance: Provenance };
  commitIdx: string;
  revealed: boolean;
  bps: number | null;
  revealOrder: number | null;
  tookLead: boolean;
  leading: boolean;
  bondStatus: BondStatus;
  committedAtBlock: string;
  revealedAtBlock: string | null;
  committedTx: string;
  revealedTx: string | null;
}

export interface AuctionTimeline {
  id: string;
  orderHash: string;
  maker: { id: string; provenance: Provenance };
  reserveBps: number;
  maxBps: number;
  commitEnd: string;
  revealEnd: string;
  exclusiveEnd: string;
  committedCount: number;
  revealedCount: number;
  unrevealedCount: number;
  teamRevealed: number;
  invitedRevealed: number;
  unknownRevealed: number;
  bestBps: number;
  secondBps: number;
  clearingBps: number;
  competition: "NONE" | "SOLE" | "CONTESTED";
  thin: boolean;
  settled: boolean;
  settlementMatchesDerivation: boolean | null;
  bids: TimelineBid[];
  events: TimelineEvent[];
}

const TIMELINE = `
  query Timeline($id: ID!) {
    _meta { block { number timestamp } }
    auction(id: $id) {
      id
      orderHash
      maker { id provenance }
      reserveBps maxBps commitEnd revealEnd exclusiveEnd
      committedCount revealedCount unrevealedCount
      teamRevealed invitedRevealed unknownRevealed
      bestBps secondBps clearingBps competition thin
      settled settlementMatchesDerivation
      bids(orderBy: commitIdx) {
        bidder { id provenance }
        commitIdx revealed bps revealOrder tookLead leading bondStatus
        committedAtBlock revealedAtBlock committedTx revealedTx
      }
      events(orderBy: blockNumber) {
        id kind blockNumber timestamp txHash logIndex actor
        ... on AuctionOpenedEvent { reserveBps maxBps commitEnd revealEnd }
        ... on BidCommittedEvent { commitIdx }
        ... on BidRevealedEvent {
          bps revealOrder tookLead
          bestBpsAfter secondBpsAfter clearingBpsAfter revealedCountAfter
        }
        ... on AuctionSettledEvent { winner clearingBps winnerForfeited matchesDerivation }
      }
    }
  }
`;

/**
 * The Auction id is the Book's own key: `keccak256(abi.encodePacked(maker, orderHash))`,
 * identical to `GlasshouseBook.key()` (subgraph/schema.graphql, section 3.2). The page
 * holds both halves, so it computes the id rather than querying by a filter -- an
 * `auction(id:)` lookup is the one query shape that cannot accidentally return somebody
 * else's round.
 */
export function auctionId(maker: string, orderHash: string): string {
  return keccak256(
    encodePacked(["address", "bytes32"], [maker as `0x${string}`, orderHash as `0x${string}`]),
  );
}

/**
 * One round's ordered event log and full bid ladder.
 *
 * `data: null` with `state: "ok"` means the indexer replied and has no row for this round
 * -- which for a round the board is showing live is the ordinary case, because the indexer
 * is a block or two behind. The caller must say "not indexed yet", never "did not happen".
 */
export async function fetchAuctionTimeline(
  maker: string,
  orderHash: string,
): Promise<SubgraphResult<AuctionTimeline>> {
  const r = await query<{ auction: AuctionTimeline | null }>(TIMELINE, {
    id: auctionId(maker, orderHash).toLowerCase(),
  });
  if (r.state !== "ok") return r;
  return { state: "ok", data: r.data?.auction ?? null, head: r.head };
}
