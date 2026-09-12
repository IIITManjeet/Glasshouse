"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Settlement } from "./Settlement";
import type { Auction, Source } from "@/lib/useAuctions";

/**
 * THE ROUND, PLAYED BACK.
 *
 * The landing hero showed the settlement chart already finished: two columns, a price
 * line, done. That is the correct picture and it is the least interesting second of the
 * round it describes. The thing that makes a sealed-bid second-price auction worth looking
 * at is the ten seconds where the numbers are present and unreadable, then readable, and
 * the price lands somewhere nobody chose directly.
 *
 * THIS DRAWS NOTHING NEW. It renders <Settlement> — the same component, with the same
 * provenance caption and the same lint coverage — and simply hands it the round at earlier
 * moments of its own life. Every frame is a state that genuinely occurred: the bids were
 * sealed, then they opened in commit order, then settle() fixed the price. The last frame
 * is identical to what the page showed before this existed.
 *
 * That distinction is the whole reason this is allowed. An animation that invented
 * intermediate values would be a dramatisation of data, which on this project is worse
 * than decoration. This is playback.
 *
 * IT PASSES THE TEST EVERY ANIMATION HERE HAS TO PASS. Delete it and the page loses
 * nothing: the final frame carries all the numbers, and that frame is where it stops and
 * stays. Under prefers-reduced-motion it renders the final frame immediately and never
 * moves — not a faster version, no version. It plays once and does not loop, because a
 * chart that keeps restarting is a chart you cannot read.
 *
 * HEAD IS STAGED TOO, and it has to be. `Settlement` decides whether an unopened bid is
 * "sealed" or "never revealed · bond forfeit" by comparing the head against the reveal
 * window. Replaying the reveals while leaving the head at its settled value would paint
 * every not-yet-opened bid as a forfeit — accusing bidders, mid-animation, of the exact
 * withheld-reveal behaviour the mechanism exists to punish. So each frame carries the head
 * that frame actually had.
 */
export function SettlementReel({ a, head, source }: { a: Auction; head: number; source: Source }) {
  const reduced = useReducedMotion();
  const bids = a.bids ?? [];
  const revealable = bids.filter((b) => b.bps !== null && b.bps !== undefined).length;

  // step 0        : every bid sealed, reveal window open
  // step 1..n     : the first n bids opened, in commit order
  // step n + 1    : settled — the real auction, untouched
  const last = revealable + 1;
  const [step, setStep] = useState(reduced || revealable === 0 ? last : 0);

  // RUN ONCE, EVER. The board polls, and every poll hands this component a new auction
  // object -- which changed `revealable`, re-ran the effect, cleared the pending timers and
  // started the sequence again from sealed. Captured at eleven seconds the chart was still
  // showing one bid open and one sealed, because it had restarted twice: an animation that
  // silently loops back to "no price yet" on a page whose hero claims a price.
  //
  // The guard is a ref rather than a dependency list because the condition is not "have
  // the inputs changed" but "has this already played", and those are different questions.
  const started = useRef(false);

  useEffect(() => {
    if (reduced || revealable === 0) {
      setStep(last);
      return;
    }
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // A beat before the first opens, so the sealed state reads as a state rather than as
    // the chart still loading.
    for (let i = 1; i <= last; i++) {
      timers.push(
        setTimeout(() => {
          if (!cancelled) setStep(i);
        }, 900 + (i - 1) * 700),
      );
    }
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [reduced, revealable, last]);

  if (step >= last || revealable === 0) {
    return <Settlement a={a} head={head} source={source} />;
  }

  // The frame's own head: inside the reveal window, so nothing reads as forfeited.
  const stagedHead = Math.min(a.revealEnd, a.commitEnd + 1 + step);

  let opened = 0;
  const staged: Auction = {
    ...a,
    bids: bids.map((b) => {
      const isRevealed = b.bps !== null && b.bps !== undefined;
      if (!isRevealed) return b;
      opened += 1;
      return opened <= step ? b : { ...b, bps: null, revealTx: null };
    }),
    // Nothing is settled yet at these frames, and the price is not fixed until settle().
    settled: false,
    filled: false,
    filledBy: null,
    clearingBps: null,
    bestBidder: null,
    winnerForfeited: false,
  };

  return <Settlement a={staged} head={stagedHead} source={source} />;
}
