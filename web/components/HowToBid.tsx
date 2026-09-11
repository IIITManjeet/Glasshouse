"use client";

import Link from "next/link";

/**
 * WHERE DO I START.
 *
 * The board could always tell you the truth about the round in front of you -- sealed,
 * opening, decided, finished -- and never once told you how a person takes part. When no
 * round is live it says "there is nothing to bid on", which is honest and leaves a visitor
 * with no idea what they would have done if there had been. Someone who arrives wanting to
 * bid has nowhere to begin.
 *
 * So this is the missing half: the shape of a round from the bidder's side, present whether
 * or not a round is live, because the question "how does this work" does not wait for the
 * commit window.
 *
 * WHAT IT IS NOT. Not a figure -- it carries no measured value, so there is nothing here for
 * scripts/lint-provenance.mjs to demand a source for, and nothing that could be mistaken for
 * data. The window sizes are named as the ones this Book is opened with rather than as a
 * property of the mechanism, because a different maker could choose differently.
 *
 * IT MUST NOT PROMISE A ROUND. The keeper is not always running, and the honest state today
 * is that Base has no live round. Telling someone to go and bid when there is nothing to bid
 * on is how a page loses the reader's trust in one click, so the last line says what is
 * actually true and the caller passes in whether a round is open.
 */
export function HowToBid({ liveRound }: { liveRound: boolean }) {
  return (
    <section id="how-to-take-part" className="scroll-mt-6 rounded-card border border-rule bg-raised p-5 shadow-card">
      <h2 className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
        How to take part
      </h2>
      <p className="lede mt-2 max-w-2xl text-[0.86rem] text-ink-soft">
        Bidding is for the right to <em>fill</em> an order — to be the one who trades against
        it. You bid in basis points of improvement you are willing to give the maker, and the
        winner pays the runner-up&rsquo;s bid, not their own.
      </p>

      <ol className="mt-4 space-y-3">
        {[
          [
            "Connect a wallet on Base",
            "A browser wallet — MetaMask, Rabby — on Base mainnet. You need a little ETH for gas. Reading the board needs no wallet at all; only bidding does.",
          ],
          [
            "Seal a bid while the commit window is open",
            "You send a hash of your number and a secret, never the number. Nobody — not other bidders, not the maker, not us — can read it. Your position in the queue is fixed the moment you commit, so bidding early cannot be punished and cannot be gamed.",
          ],
          [
            "Open it while the reveal window is open",
            "You send the number and the secret, and the contract checks they match the hash you committed. A bid that is never opened cannot win. This is the step people forget, and the one your record on this site remembers.",
          ],
          [
            "If you win, fill inside your exclusive window",
            "The highest revealed bid wins and pays the second-highest — or the reserve, if there was no second. For a short window only you may fill at that improved price. After it, anyone may fill at the base price instead.",
          ],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span
              aria-hidden
              className="tnum mt-0.5 shrink-0 text-[0.72rem] text-glass"
            >
              {i + 1}
            </span>
            <div>
              <div className="text-[0.86rem] text-ink">{title}</div>
              <p className="lede mt-0.5 max-w-2xl text-[0.82rem] leading-relaxed text-ink-faint">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="lede mt-4 max-w-2xl border-t border-rule pt-3 text-[0.8rem] text-ink-faint">
        {liveRound ? (
          <>
            A round is open right now — the panel above is where you bid on it.
          </>
        ) : (
          <>
            <span className="text-amber">There is no round open right now</span>, so there is
            nothing to bid on this minute. Rounds are opened by a keeper that is not always
            running; the board says which phase the most recent one reached.
          </>
        )}{" "}
        The windows this Book is opened with are 30 blocks to commit, 30 to open and 15
        exclusive — about a minute each at Base&rsquo;s block time. Want the mechanism rather
        than the instructions?{" "}
        <Link href="/evidence" className="text-glass underline underline-offset-2">
          The evidence page
        </Link>{" "}
        shows a settled round with every number checkable.
      </p>
    </section>
  );
}

export default HowToBid;
