"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readAuction } from "./bid";
import { bidsFor, chainHead } from "./chain";
import { livePhase } from "./useAuctions";
import type { Auction, Bid } from "./useAuctions";

/**
 * ONE AUCTION, READ DIRECTLY, BECAUSE THE BOARD CANNOT ENUMERATE IT.
 *
 * `useAuctions` walks `window.GLASSHOUSE_ROUNDS` -- the manifest of order hashes the keeper
 * ships -- and asks the Book about each one. That is the only way to enumerate auctions
 * without an indexer, and it is exactly why it cannot see a round somebody opened from the
 * browser: `GlasshouseBook.open()` has no access control and keys the auction by
 * `key(msg.sender, orderHash)` (GlasshouseBook.sol:118), so a stranger's round exists on the
 * same Book under a maker and a hash that appear in no manifest anywhere.
 *
 * So the round page needs a second read path: given a maker AND a hash -- both halves of the
 * mapping key, which is why `/r/<hash>` alone is not enough for these and the link carries
 * `?m=` -- ask the Book about that one auction. Nothing here touches the polling path the
 * board uses; this is additive, and deleting this file would restore the board exactly.
 *
 * THREE OUTCOMES, NOT TWO. `readAuction` returning null means the Book has no auction for
 * this (maker, hash) -- a real answer, and `notFound`. A read that THROWS means we did not
 * get an answer at all, which is `error`. They are rendered differently because "there is
 * nothing there" and "we could not look" are different claims, and this site fails its own
 * build rather than confuse them.
 */

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";

// The commit window the log scan is bounded by. Identical to `chain.ts`'s own constant and
// used for the same reason: if it is wrong the scan is merely wider or narrower, never
// incorrect. `open()` stores `commitEnd = block.number + commitBlocks`, so `commitEnd - 60`
// is the opening block for the 60-block window `OPEN_DEFAULTS` uses, and a lower bound that
// is too early for any other configuration -- which is the safe direction for a scan.
const COMMIT_WINDOW = 60;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** True for something that could be half of an auction key. Cheap, and it keeps a typo in
 *  a URL from becoming an eth_call with malformed calldata. */
export function isAddress(v: string | null | undefined): boolean {
  return typeof v === "string" && ADDR_RE.test(v);
}

/**
 * The same endpoint the board reads, chosen the same way and in the same order: `?rpc=`
 * first because a visitor pointing the page at their own node is being explicit, then
 * `NEXT_PUBLIC_RPC_URL`, then Base's public endpoint. Duplicated from `useAuctions.ts`
 * rather than exported from it because that file is on the poll path and must not be
 * touched by this change; it is five lines and it has no state.
 */
function rpcUrl(): string {
  const configured =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_RPC_URL || null : null;
  const fallback = configured ?? "https://mainnet.base.org";
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get("rpc") ?? fallback;
}

export type Pinned = {
  auction: Auction | null;
  head: number;
  loading: boolean;
  /** A read that failed. Never the same thing as `notFound`. */
  error: string | null;
  /** The Book answered, and has no auction for this maker and this hash. */
  notFound: boolean;
  refresh: () => void;
};

export function usePinnedAuction(maker: string | null, orderHash: string | null): Pinned {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [head, setHead] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Normalised outside the effect so the dependency list is two strings rather than two
  // strings and a case. A URL that arrives upper-cased must not re-run the effect forever.
  const m = maker && ADDR_RE.test(maker) ? maker.toLowerCase() : null;
  const h = orderHash && HASH_RE.test(orderHash) ? orderHash.toLowerCase() : null;

  useEffect(() => {
    if (!m || !h) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const rpc = rpcUrl();

    async function tick() {
      // Nothing is read while the tab is hidden -- the same rule the board follows, for the
      // same reason: a flat 12 s poll from every backgrounded tab is how this project got
      // rate limited by Base's public endpoint once already.
      if (typeof document !== "undefined" && document.hidden) {
        timer.current = setTimeout(tick, 12_000);
        return;
      }

      let next: Auction | null = null;
      let nextHead = 0;

      try {
        // One eth_call and one eth_blockNumber, in parallel. The head is allowed to fail:
        // it only bounds a log scan and decides a poll interval, and neither is worth
        // refusing to show the auction over.
        const [raw, hd] = await Promise.all([
          readAuction(m!, h!),
          chainHead(rpc).catch(() => null),
        ]);
        if (cancelled) return;

        nextHead = hd ?? 0;
        if (hd !== null) setHead(hd);

        if (!raw) {
          // THE BOOK ANSWERED, AND THE ANSWER IS "NO SUCH AUCTION". `decodeAuction` returns
          // null on `commitEnd == 0`, which is what an unwritten struct decodes to. This is
          // a fact about the chain, not about our connection, and it gets its own state.
          setAuction(null);
          setNotFound(true);
          setError(null);
        } else {
          const openedAtBlock = raw.commitEnd - COMMIT_WINDOW;
          // With no head there is no upper bound to clamp to, so the scan runs to the end
          // of the round. A node will simply return fewer logs for blocks that do not
          // exist yet; clamping to a head of 0 would ask for an empty range and report
          // "no bids" on every poll, which is the flattering lie this file must not tell.
          const scanTo = nextHead > 0 ? Math.min(nextHead, raw.exclusiveEnd + 5) : raw.exclusiveEnd + 5;

          let bids: Bid[] | null = null;
          let revealedCount: number | null = null;
          try {
            bids = await bidsFor(rpc, BOOK, h!, openedAtBlock, scanTo);
            revealedCount = bids.filter((b) => b.bps !== null).length;
          } catch {
            // NULL, NOT ZERO, AND NOT AN EMPTY LIST. `revealedCount = 0` is a claim about
            // bidders; a failed log scan is a claim about us. `Auction.bids` documents the
            // same rule -- "null when the log scan failed. Never render this as an empty
            // list" -- and every consumer already branches on it.
            bids = null;
            revealedCount = null;
          }

          // `Auction.round` is typed `number`, but the board has carried auctions with no
          // round number since the live-fill order (useAuctions.ts's `roundLabel` exists
          // for exactly that case and every consumer goes through it). A round opened from
          // a browser is not an index into config/rounds.json and must not claim to be, so
          // it is null, and the cast records a fact the type predates rather than inventing
          // one. `useAuctions.ts` is on the poll path and is not edited by this change.
          next = {
            round: null,
            orderHash: h!,
            maker: m!,
            openedAtBlock,
            commitEnd: raw.commitEnd,
            revealEnd: raw.revealEnd,
            exclusiveEnd: raw.exclusiveEnd,
            reserveBps: raw.reserveBps,
            maxBps: raw.maxBps,
            committedCount: raw.committedCount,
            revealedCount,
            bestBidder: raw.bestBidder,
            bestBps: raw.bestBps,
            secondBps: raw.secondBps,
            clearingBps: raw.bestBidder ? Math.max(raw.secondBps, raw.reserveBps) : null,
            bond: raw.bond,
            filled: raw.filled,
            filledBy: raw.filledBy,
            settled: raw.settled,
            winnerForfeited: raw.winnerForfeited,
            // The chain cannot answer this: it is the subgraph's independent replay. Null,
            // not false -- "not checked" and "checked and disagreed" are different claims.
            settlementMatchesDerivation: null,
            bids,
          } as unknown as Auction;

          setAuction(next);
          setNotFound(false);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          // A THROW IS NOT AN ABSENCE. `notFound` is deliberately untouched here: the last
          // thing this page should do is tell a visitor their round does not exist because
          // an endpoint rate limited us.
          setError(String((e as { message?: unknown })?.message ?? e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;
      // Scheduled from what THIS tick read, not from state that has not rendered yet --
      // the bug useAuctions.ts records, where a first tick always scheduled 120 s out and
      // froze a bidder's countdown through their whole reveal window.
      const live = next ? livePhase(next, nextHead) !== "open" : false;
      timer.current = setTimeout(tick, live ? 12_000 : 120_000);
    }

    void tick();

    const onVisible = () => {
      if (!document.hidden) {
        if (timer.current) clearTimeout(timer.current);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [m, h, nonce]);

  return { auction, head, loading, error, notFound, refresh };
}
