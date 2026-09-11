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
// NOT PUBLISHED, AND THAT IS FINE FOR THIS PATH. The Studio deployment answers queries
// today; publishing to The Graph Network (an Arbitrum One transaction) is what the Gateway
// and the Subgraph MCP need, which is the skill and scripts/reserve-advisor.mjs, not the
// page. So this works as soon as NEXT_PUBLIC_SUBGRAPH_URL is set, and degrades to nothing
// when it is not.
//
// EVERY FAILURE IS DISTINCT AND NAMED. "Not configured", "the indexer did not answer" and
// "the indexer answered and has no row for this address" are three different states, and
// collapsing them into null is how a page ends up saying "no bids" about someone whose
// query timed out. `SubgraphResult` keeps them apart so the UI can say which.

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
