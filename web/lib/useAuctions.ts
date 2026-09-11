"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Plain ESM, shared with the Node tests and the advisor. allowJs infers it, so no
// declaration file -- a .d.ts would be a second place for the shape to drift.
import { fromChain } from "./chain.js";
import { phase as computePhase } from "./phase";
import { simulate, SIM_MS_PER_BLOCK, SIM_WARM_START_MS } from "./simulate";

export type Bid = {
  bidder: string;
  commitIdx: number;
  committedAtBlock: number;
  bps: number | null;
  /** The transactions that produced this bid, so the page can link rather than assert.
   *  null from the simulator, which has no transactions, and from the snapshot, which
   *  predates the field -- both render as no link rather than as a broken one. */
  commitTx?: string | null;
  revealTx?: string | null;
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

export type Source = "chain" | "snapshot" | "sim" | "none";

export type Board = {
  auctions: Auction[];
  head: number;
  source: Source;
  isFork: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Rehearsal mode: `lib/simulate.js` drives the board instead of the chain. */
  demo: boolean;
  setDemo: (on: boolean) => void;
};

/**
 * Whether the rehearsal is running, held outside React.
 *
 * It has to be shared: the header toggle and the board are different subtrees, and the
 * /rounds page reads it too. A context provider would work, but this is one boolean with
 * two writers, and the store is nine lines against a provider's thirty.
 *
 * It is NOT persisted. A visitor who lands on this page gets the chain, always -- a demo
 * flag that survives a reload is how someone ends up reading simulated numbers as live
 * ones a week later, which is the exact failure DESIGN.md section 2 exists to prevent.
 * The URL carries it (`?demo=1`) so a link into the rehearsal is still shareable, and a
 * link is a thing a person chose to click.
 */
let demoOn = false;
const demoListeners = new Set<() => void>();
function setDemoGlobal(on: boolean) {
  if (demoOn === on) return;
  demoOn = on;
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("demo", "1");
    else url.searchParams.delete("demo");
    window.history.replaceState(null, "", url);
  }
  for (const fn of demoListeners) fn();
}

/**
 * Subscribe to the flag WITHOUT subscribing to the board.
 *
 * The nav switch and the banner need to know whether the rehearsal is on; they do not
 * need auctions. Calling useAuctions() for the flag alone would mount a second and third
 * copy of the polling effect below -- three independent pollers against Base's public
 * endpoint, which rate-limits (-32016) and has already cost this project a day once.
 */
export function useDemoMode(): { demo: boolean; setDemo: (on: boolean) => void } {
  const [demo, setDemo] = useDemoFlag();
  return { demo, setDemo };
}

function useDemoFlag(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // Read the URL on mount, not during render: the server render of this static export
    // has no location, and disagreeing with it is a hydration mismatch.
    if (new URLSearchParams(window.location.search).get("demo") === "1") demoOn = true;
    const sync = () => setOn(demoOn);
    demoListeners.add(sync);
    sync();
    return () => {
      demoListeners.delete(sync);
    };
  }, []);
  return [on, setDemoGlobal];
}

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
 * shortcut and not a limitation: the subgraph is published and answers queries, but an
 * indexer is a block or two behind the head and this card is counting down in blocks. The
 * chain is the correct source for a live phase; the subgraph's job is history.
 */
export function useAuctions(): Board {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [head, setHead] = useState(0);
  const [source, setSource] = useState<Source>("none");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nonce, setNonce] = useState(0);

  const [demo, setDemo] = useDemoFlag();

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * The rehearsal. One interval, no network, and it starts part-way through a round so the
   * first frame a visitor sees is a live phase rather than an empty board they have to
   * wait thirty seconds to understand.
   *
   * Separate from the chain effect rather than a branch inside it, so that turning the
   * rehearsal off leaves no timer behind and the chain effect's own scheduling -- which is
   * tiered and easy to get wrong -- is not made conditional on anything.
   */
  useEffect(() => {
    if (!demo) return;
    const startedAt = Date.now();
    const paint = () => {
      const board = simulate(SIM_WARM_START_MS + (Date.now() - startedAt));
      setAuctions(board.auctions as Auction[]);
      setHead(board.head);
      setSource("sim");
      setError(null);
      setLoading(false);
    };
    paint();
    const id = setInterval(paint, SIM_MS_PER_BLOCK);
    return () => {
      clearInterval(id);
      // Clear the board on the way out. Without this, switching back to the chain leaves
      // the simulated rounds on screen for as long as the first eth_call takes -- the
      // banner already gone, because that follows the flag -- and simulated numbers under
      // a heading that no longer says they are simulated is the one state this whole
      // module exists to prevent.
      setAuctions([]);
      setHead(0);
      setSource("none");
      setLoading(true);
    };
  }, [demo]);

  useEffect(() => {
    // The rehearsal owns the board while it is on. Returning before the first fetch is
    // what keeps a real chain read from landing mid-demo and overwriting it with a
    // half-second of live data -- which would put unlabelled real numbers under a
    // SIMULATED chip, the one mislabelling worse than either state alone.
    if (demo) return;
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
  }, [nonce, demo]);

  // Refs so the scheduler can read the latest values without re-subscribing every tick.
  const auctionsRef = useRef<Auction[]>([]);
  const headRef = useRef(0);
  auctionsRef.current = auctions;
  headRef.current = head;

  const isFork =
    typeof window !== "undefined" && /127\.0\.0\.1|localhost/.test(rpcUrl());

  return { auctions, head, source, isFork, loading, error, refresh, demo, setDemo };
}
