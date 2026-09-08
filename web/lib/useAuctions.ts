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
  revealedCount: number;
  bestBidder: string | null;
  bestBps: number;
  secondBps: number;
  clearingBps: number | null;
  filled: boolean;
  filledBy: string | null;
  settled: boolean;
  winnerForfeited: boolean;
  settlementMatchesDerivation: boolean | null;
  bids: Bid[];
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
      if (typeof document !== "undefined" && document.hidden) {
        timer.current = setTimeout(tick, 12_000);
        return;
      }
      try {
        const manifest = (window as any).GLASSHOUSE_ROUNDS;
        const got = await fromChain({ rpc, book: BOOK, manifest, limit: 6 });
        if (cancelled) return;

        if (got) {
          setAuctions(got.auctions as Auction[]);
          setHead(got.head);
          setSource("chain");
          setError(null);
        } else {
          // No keeper round on chain yet. The snapshot is real history, labelled as such
          // -- never presented as live.
          const snap = (window as any).GLASSHOUSE_SNAPSHOT;
          if (snap) {
            setAuctions(snap.auctions as Auction[]);
            setHead(snap.head);
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
      const anyLive = auctionsRef.current.some(
        (a) => livePhase(a, headRef.current) !== "open",
      );
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
