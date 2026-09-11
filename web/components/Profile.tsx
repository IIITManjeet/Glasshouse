"use client";

import { type Auction, livePhase } from "@/lib/useAuctions";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

// Duplicated from components/Auction.tsx rather than imported, following the precedent set
// by components/RoundsTable.tsx: Auction.tsx exports no such helper, and this task's brief
// is to touch nothing outside its own two new files.
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const basescan = (a: string) => `https://basescan.org/address/${a}`;
const eq = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

function AddressLink({ addr }: { addr: string }) {
  return (
    <a
      href={basescan(addr)}
      target="_blank"
      rel="noopener noreferrer"
      title={addr}
      className="tnum text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
    >
      {short(addr)}
    </a>
  );
}

// The three the mapping emits, and ONLY those -- subgraph/src/provenance.ts is the single
// place these values are produced. This said "UNLISTED" until web/lib/subgraph.ts was
// corrected for the identical mistake: there is no such value, and the one an address not
// on our list actually gets is UNKNOWN, which is nearly every real visitor. Harmless only
// because today's chain source never sets the field; it would have mislabelled the moment
// anything subgraph-backed fed this component, which is now a thing that exists
// (components/Timeline.tsx).
export type Provenance = "TEAM" | "INVITED" | "UNKNOWN";

/**
 * `useAuctions()`'s `Auction`/`Bid` types (lib/useAuctions.ts) carry no provenance field --
 * chain.js and the checked-in snapshot both return bare addresses, because provenance is a
 * subgraph-computed field (subgraph/src/provenance.ts, checked against a constant list)
 * that GlasshouseBook itself never stores. This intersection type says the field MAY be
 * present without asserting it always is, so a bid object from a future provenance-aware
 * source is picked up automatically, and today's chain/snapshot source -- which never sets
 * it -- renders no chip at all rather than a defaulted "UNKNOWN". Defaulting would claim
 * "we checked our list and this is not on it" when the true statement is "this source
 * cannot say" (subgraph/README.md's "Provenance labels"; docs/design/ui-spec.md section 3.4,
 * which corrected this exact confusion once already).
 */
type Provenanced<T> = T & { provenance?: Provenance };

export type RoundOutcome = {
  round: number;
  orderHash: string;
  openedAtBlock: number;
  asMaker: boolean;
  bid: null | {
    committedAtBlock: number;
    /** null unless revealed. */
    bps: number | null;
    /** Reveal window still open. Not a fault -- see deriveAccount's rule 1. */
    sealed: boolean;
    /** Reveal window has provably closed and nothing arrived from this address. */
    neverRevealed: boolean;
  };
  /** settled === true and this address held the best bid. See deriveAccount's rule 2. */
  won: boolean;
  /** Holds the best bid in a round that has not settled -- "leading", never "won". */
  leading: boolean;
  settled: boolean;
  filled: boolean;
  filledByThem: boolean;
  filledBy: string | null;
  winnerForfeited: boolean;
  phase: string;
  provenance?: Provenance;
};

export type Account = {
  address: string;
  /** Only set if some loaded bid for this address actually carried one. See Provenanced. */
  provenance?: Provenance;
  auctionsOpened: number;
  bidsCommitted: number;
  bidsRevealed: number;
  /** Committed, reveal window still open. Not a fault. */
  bidsStillSealed: number;
  /** Committed, reveal window provably closed, nothing arrived. */
  bidsNeverRevealed: number;
  auctionsWon: number;
  /**
   * Denominator for the "won" figure: settled rounds where this address actually revealed
   * a bid (won or not). A round that has not settled contributes to neither side -- see
   * deriveAccount's rule 2.
   */
  settledRoundsRevealed: number;
  fillsRecorded: number;
  /** Every round touching this address, newest round first. */
  rounds: RoundOutcome[];
};

/**
 * Builds one address's record purely from the auctions this build has loaded. There is no
 * chain-path equivalent of subgraph/schema.graphql's `Account` entity to read -- the Book
 * stores no per-address rollup -- so every counter here is recomputed from `Auction.bids`
 * and each auction's settlement flags rather than fetched ready-made.
 *
 * Two rules carried over from subgraph/README.md's "what it refuses to compute", because
 * they are true of the underlying contract regardless of which layer reads it:
 *
 *  1. A sealed bid (`bps === null`) only becomes "never revealed" once the reveal window
 *     has PROVABLY closed against the block this data describes: `settled === true`, or
 *     `headBlock` has already passed `revealEnd`. Before that it is merely still sealed --
 *     not a fault, since the bidder may reveal on the very next block. Counting a live
 *     sealed bid as a forfeit accuses someone of an omission they have not committed yet.
 *  2. `auctionsWon` requires `settled === true`, matching schema.graphql's own comment that
 *     `Account.auctionsWon` "increments at AuctionSettled only". Holding the best bid in an
 *     open round is "leading" -- true now, reversible until settlement -- never "won".
 */
export function deriveAccount(address: string, auctions: Auction[], headBlock: number): Account {
  let auctionsOpened = 0;
  let bidsCommitted = 0;
  let bidsRevealed = 0;
  let bidsStillSealed = 0;
  let bidsNeverRevealed = 0;
  let auctionsWon = 0;
  let settledRoundsRevealed = 0;
  let fillsRecorded = 0;
  let provenance: Provenance | undefined;
  const rounds: RoundOutcome[] = [];

  for (const a of auctions) {
    const asMaker = eq(a.maker, address);
    if (asMaker) auctionsOpened++;

    // (a.bids ?? []) would silently treat an unread scan as "this address did not bid".
    // Skipping the round is the honest answer: we do not know either way.
    if (a.bids == null) continue;
    const rawBid = a.bids.find((b) => eq(b.bidder, address)) as
      | Provenanced<NonNullable<Auction["bids"]>[number]>
      | undefined;

    let bidOutcome: RoundOutcome["bid"] = null;
    let revealedThisRound = false;

    if (rawBid) {
      bidsCommitted++;
      const revealed = rawBid.bps !== null && rawBid.bps !== undefined;
      revealedThisRound = revealed;
      if (revealed) bidsRevealed++;

      // Rule 1 (see deriveAccount doc comment above).
      const revealWindowClosed = a.settled === true || headBlock > a.revealEnd;
      const sealed = !revealed && !revealWindowClosed;
      const neverRevealed = !revealed && revealWindowClosed;
      if (sealed) bidsStillSealed++;
      if (neverRevealed) bidsNeverRevealed++;

      bidOutcome = {
        committedAtBlock: rawBid.committedAtBlock,
        bps: revealed ? rawBid.bps : null,
        sealed,
        neverRevealed,
      };
      if (rawBid.provenance && !provenance) provenance = rawBid.provenance;
    }

    const isBest = eq(a.bestBidder, address);
    // Rule 2 (see deriveAccount doc comment above).
    const won = a.settled === true && isBest;
    const leading = a.settled !== true && isBest;
    if (won) auctionsWon++;
    // Every settled round this address actually revealed a bid in counts toward the
    // denominator, whether they won it or not -- it is a round contested to a decision.
    if (a.settled === true && revealedThisRound) settledRoundsRevealed++;

    const filledByThem = a.filled === true && eq(a.filledBy, address);
    if (filledByThem) fillsRecorded++;

    if (asMaker || bidOutcome || filledByThem) {
      rounds.push({
        round: a.round,
        orderHash: a.orderHash,
        openedAtBlock: a.openedAtBlock,
        asMaker,
        bid: bidOutcome,
        won,
        leading,
        settled: a.settled === true,
        filled: a.filled === true,
        filledByThem,
        filledBy: a.filledBy,
        winnerForfeited: a.winnerForfeited === true,
        phase: livePhase(a, headBlock),
        provenance: rawBid?.provenance,
      });
    }
  }

  rounds.sort((x, y) => y.round - x.round);

  return {
    address,
    provenance,
    auctionsOpened,
    bidsCommitted,
    bidsRevealed,
    bidsStillSealed,
    bidsNeverRevealed,
    auctionsWon,
    settledRoundsRevealed,
    fillsRecorded,
    rounds,
  };
}

function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  const tone =
    provenance === "TEAM"
      ? "border-glass bg-glass-soft text-glass"
      : provenance === "INVITED"
        ? "border-amber bg-amber-soft text-amber"
        : "border-rule text-ink-faint";
  return (
    <span className={`inline-block border px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] ${tone}`}>
      {provenance}
    </span>
  );
}

function StatTiles({ account }: { account: Account }) {
  // Every ratio here shows both numbers -- subgraph/README.md's refusals list forbids a
  // share or a percentage, and "3 of 7" is the one honest way to print a partial count.
  const items: [string, string, string?][] = [
    ["opened as maker", num(account.auctionsOpened)],
    ["bids committed", num(account.bidsCommitted)],
    ["bids revealed", `${account.bidsRevealed} of ${account.bidsCommitted}`],
    ["still sealed", num(account.bidsStillSealed), account.bidsStillSealed > 0 ? "amber" : undefined],
    [
      "committed, never revealed",
      num(account.bidsNeverRevealed),
      account.bidsNeverRevealed > 0 ? "brick" : undefined,
    ],
    ["rounds won", `${account.auctionsWon} of ${account.settledRoundsRevealed}`],
    ["fills", num(account.fillsRecorded)],
  ];
  return (
    <div className="border border-rule bg-raised rounded-card shadow-card p-5">
      <div className="flex flex-wrap gap-6">
        {items.map(([k, v, tone]) => (
          <div key={k}>
            <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">{k}</div>
            <div
              className={`tnum mt-0.5 text-sm ${tone === "brick" ? "text-brick" : tone === "amber" ? "text-amber" : "text-ink"}`}
            >
              {v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The phase chip for one round row -- same computation the live board and the rounds table use. */
function PhaseChip({ phase, settled }: { phase: string; settled: boolean }) {
  const tone = settled
    ? "border-glass bg-glass-soft text-glass"
    : phase === "reveal"
      ? "border-amber bg-amber-soft text-amber"
      : "border-rule text-ink-faint";
  return (
    <span className={`inline-block border px-1.5 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] ${tone}`}>
      {settled ? "settled" : phase}
    </span>
  );
}

function RoundsList({ account }: { account: Account }) {
  return (
    <div className="overflow-x-auto border border-rule">
      <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-rule bg-sunk">
            {["round", "role", "your bid", "outcome", "filled"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3 py-2 font-mono text-[0.66rem] font-normal uppercase tracking-[0.12em] text-ink-faint"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {account.rounds.map((r) => {
            const roles = [r.asMaker ? "maker" : null, r.bid ? "bidder" : null, r.filledByThem ? "filler" : null]
              .filter(Boolean)
              .join(" · ");

            const bidLabel = !r.bid ? (
              <span className="text-ink-faint">no bid</span>
            ) : r.bid.bps !== null ? (
              <span className="tnum">{r.bid.bps} bps</span>
            ) : r.bid.sealed ? (
              // Hatched text rather than a bare word -- the same "exists, unreadable yet"
              // claim components/Auction.tsx's BidCards makes with the hatch pattern, just
              // in a table cell where a background swatch does not fit.
              <span className="text-ink-faint">sealed · window open</span>
            ) : (
              <span className="text-brick">never revealed · bond forfeitable</span>
            );

            const outcomeLabel = r.won ? (
              <span className="text-glass">won</span>
            ) : r.leading ? (
              <span className="text-amber">leading, not settled</span>
            ) : r.settled ? (
              <span className="text-ink-faint">settled, not won</span>
            ) : (
              <span className="text-ink-faint">running</span>
            );

            const filledLabel =
              r.filled && r.filledBy ? (
                r.filledByThem ? (
                  <span className="text-glass">filled by them</span>
                ) : (
                  <span className="tnum text-ink-soft">
                    filled · <AddressLink addr={r.filledBy} />
                  </span>
                )
              ) : r.winnerForfeited ? (
                <span className="text-brick">winner forfeited</span>
              ) : r.settled ? (
                <span className="text-ink-faint">not filled</span>
              ) : (
                <span className="text-ink-faint">not yet</span>
              );

            return (
              <tr key={r.orderHash} className="border-b border-rule last:border-b-0 hover:bg-raised">
                <td className="px-3 py-2">
                  <div className="tnum text-ink">{r.round}</div>
                  <PhaseChip phase={r.phase} settled={r.settled} />
                </td>
                <td className="px-3 py-2 text-ink-soft">{roles || <span className="text-ink-faint">—</span>}</td>
                <td className="px-3 py-2">{bidLabel}</td>
                <td className="px-3 py-2">{outcomeLabel}</td>
                <td className="px-3 py-2">{filledLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The account/profile view.
 *
 * A no-history address renders as a sentence, never as zeroed stat tiles: a tile reading
 * "0" claims a measurement was taken and came up empty, but for most addresses on Base the
 * true state is "this build's loaded rounds do not mention it", which is a coverage gap,
 * not a fact about the address. Only `deriveAccount` finding at least one round that names
 * this address (as maker, bidder, or filler) unlocks the stat tiles below.
 */
export function Profile({ address, auctions, head }: { address: string; auctions: Auction[]; head: number }) {
  const account = deriveAccount(address, auctions, head);
  const touched = account.rounds.length > 0;

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-normal">
          <AddressLink addr={address} />
        </h2>
        {account.provenance && <ProvenanceChip provenance={account.provenance} />}
      </header>

      {!touched ? (
        <div className="border border-rule bg-raised rounded-card shadow-card p-6">
          {auctions.length === 0 ? (
            <p className="text-ink-soft">Nothing has loaded from the chain or the fallback snapshot yet.</p>
          ) : (
            <p className="text-ink-soft">
              None of the {auctions.length} round{auctions.length === 1 ? "" : "s"} this build has loaded name{" "}
              {short(address)} as maker, bidder, or filler.
            </p>
          )}
          <p className="mt-2 text-sm text-ink-faint">
            That is a statement about what this page has loaded, not a claim that this address has no history on
            Glasshouse — the board only ever holds a recent window of rounds (lib/useAuctions.ts), and this address
            may simply have acted outside it. Zeroed stat tiles would read as a measurement that came up empty;
            this reads as what it actually is, a coverage gap.
          </p>
        </div>
      ) : (
        <>
          <figure data-src="derived" className="mb-4">
            <StatTiles account={account} />
            <figcaption className="mt-3 text-[0.78rem] text-ink-faint">
              <span className="text-ink-soft">What produced this:</span> every figure here is recomputed from the{" "}
              {auctions.length} round{auctions.length === 1 ? "" : "s"} this build has loaded (
              <code className="font-mono">Auction.bids</code> in lib/useAuctions.ts), as of block {num(head)} — there
              is no chain-path <code className="font-mono">Account</code> entity to read it from directly.
            </figcaption>
          </figure>

          {account.provenance && (
            <p className="mb-6 text-[0.78rem] text-ink-faint">
              <em className="not-italic text-ink-soft">Unlisted</em> means not on our list of team and invited
              wallets. It does not mean external, and we do not know who it is.
            </p>
          )}

          <figure data-src="derived">
            <h3 className="mb-2 font-display text-lg font-normal">Rounds</h3>
            <RoundsList account={account} />
            <figcaption className="mt-3 text-[0.78rem] text-ink-faint">
              Newest round first. &ldquo;sealed&rdquo; means the reveal window for that round is still open —
              nothing wrong has happened yet. &ldquo;never revealed&rdquo; means the window has closed with nothing
              arriving from this address.
            </figcaption>
          </figure>
        </>
      )}
    </div>
  );
}
