"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Plain ESM, shared with the Node tests and the advisor. allowJs infers it, so no
// declaration file -- a .d.ts would be a second place for the shape to drift.
import { fromChain } from "./chain.js";
import { phase as computePhase } from "./phase.js";

export type Bid = {
  bidder: string;
  commitIdx: number;
  committedAtBlock: number;
  bps: number | null;
};

export type Auction = {
  round: number;
  orderHash: string;
  maker: string;
  openedAtBlock: number;
  commitEnd: number;
  revealEnd: number;
  exclusiveEnd: number;
  reserveBps: number;
  maxBps: number;
  committedCount: number;
  /** null when the log scan failed: "not read", which is not "nobody revealed". */
  revealedCount: number | null;
  bestBidder: string | null;
  bestBps: number;
  secondBps: number;
  clearingBps: number | null;
  bond?: string;
  filled: boolean;
  filledBy: string | null;
  settled: boolean;
  winnerForfeited: boolean;
  settlementMatchesDerivation: boolean | null;
  /** null when the log scan failed. Never render this as an empty list. */
  bids: Bid[] | null;
};

export type Source = "chain" | "snapshot" | "none";

export type Board = {
  auctions: Auction[];
  head: number;
  source: Source;
  isFork: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";

function rpcUrl() {
  if (typeof window === "undefined") return "https://mainnet.base.org";
  return new URLSearchParams(window.location.search).get("rpc") ?? "https://mainnet.base.org";
}

/** A phase that is not "open" means something is still happening and worth watching. */
export function livePhase(a: Auction, head: number): string {
  return computePhase(
    { commitEnd: a.commitEnd, revealEnd: a.revealEnd, exclusiveEnd: a.exclusiveEnd, bestBidder: a.bestBidder },
    head,
  );
}

/**
 * The board's data.
 *
 * POLLING IS TIERED, because a flat interval breaks the budget. Twelve seconds only while
 * a round is actually mid-flight and the tab is visible; two minutes otherwise; nothing at
 * all when hidden. A flat 12 s poll is 7,200 requests a day per open tab, which was the
 * first version of this and was wrong.
 *
 * Reads go straight to the Book over eth_call rather than to the subgraph. That is not a
 * shortcut: the subgraph is deployed to Studio but not published, so it cannot answer, and
 * even once it can, an indexer is a block or two behind and this card is counting down in
 * blocks. The chain is the correct source for a live phase; the subgraph's job is history.
 */
export function useAuctions(): Board {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [head, setHead] = useState(0);
  const [source, setSource] = useState<Source>("none");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const rpc = rpcUrl();

    async function tick() {
      let latest: Auction[] = [];
      let latestHead = 0;
      if (typeof document !== "undefined" && document.hidden) {
        timer.current = setTimeout(tick, 12_000);
        return;
      }
      try {
        const manifest = (window as any).GLASSHOUSE_ROUNDS;
        const got = await fromChain({ rpc, book: BOOK, manifest, limit: 6 });
        if (cancelled) return;

        if (got) {
          latest = got.auctions as Auction[];
          latestHead = got.head;
          setAuctions(latest);
          setHead(latestHead);
          setSource("chain");
          setError(null);
        } else {
          // No keeper round on chain yet. The snapshot is real history, labelled as such
          // -- never presented as live.
          const snap = (window as any).GLASSHOUSE_SNAPSHOT;
          if (snap) {
            latest = snap.auctions as Auction[];
            latestHead = snap.head;
            setAuctions(latest);
            setHead(latestHead);
            setSource("snapshot");
          } else {
            setSource("none");
          }
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;
      // Scheduled from what THIS tick fetched, not from the refs.
      //
      // The refs are assigned during render, which has not happened yet at this point, so
      // on the first tick they are still empty -- anyLive came out false and the next poll
      // was 120 s away. That is 60 blocks. A bidder who committed with 40 blocks left would
      // watch a frozen countdown through their entire reveal window under the advocated
      // 30/30 config, and have nothing to click. Found by an architecture review.
      const anyLive = latest.some((a) => livePhase(a, latestHead) !== "open");
      timer.current = setTimeout(tick, anyLive ? 12_000 : 120_000);
    }

    tick();
    const onVisible = () => {
      if (!document.hidden) {
        if (timer.current) clearTimeout(timer.current);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [nonce]);

  // Refs so the scheduler can read the latest values without re-subscribing every tick.
  const auctionsRef = useRef<Auction[]>([]);
  const headRef = useRef(0);
  auctionsRef.current = auctions;
  headRef.current = head;

  const isFork =
    typeof window !== "undefined" && /127\.0\.0\.1|localhost/.test(rpcUrl());

  return { auctions, head, source, isFork, loading, error, refresh };
}
