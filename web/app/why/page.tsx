"use client";

import Link from "next/link";
import { Comparison } from "@/components/Comparison";
import { LatencyLens } from "@/components/Lens";
import { Reveal } from "@/components/Reveal";

/**
 * The argument, in figures.
 *
 * Split off the front door because six full-width figures stacked in one column read as a
 * wall rather than as a product -- the front door now carries the hero, the mechanism and
 * the live round, and the evidence lives on two pages a visitor chooses to open.
 *
 * Nothing here needs the network. Both figures come from a Foundry unit test, so this page
 * renders identically whether the chain answers or not, which also makes it the safest
 * thing to open on a conference wifi.
 */
export default function WhyPage() {
  return (
    <main>
      <section className="mb-10 max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
          The argument
        </p>
        <h1 className="mt-3 font-display text-3xl leading-tight font-light sm:text-4xl">
          Both existing gates hand the fill to the participant who values it{" "}
          <em className="text-glass">least</em>.
        </h1>
        <p className="mt-4 text-ink-soft">
          One order, three programs, the same three participants with the same valuations each
          time. The only variable is how the right to fill is decided. Every number on this page
          came from a unit test with mock tokens and assigned valuations — it is labelled that way
          throughout, and nothing here was observed on a network.
        </p>
      </section>

      <Reveal className="mb-12">
        <Comparison />
      </Reveal>

      <Reveal className="mb-12">
        <LatencyLens />
      </Reveal>

      <nav className="border-t border-rule pt-5 text-sm">
        <Link href="/proof" className="text-glass underline underline-offset-2">
          See a round that finished →
        </Link>
        {" · "}
        <a href="/argument.html" className="text-glass underline underline-offset-2">
          The long version
        </a>
        {" · "}
        <Link href="/" className="text-glass underline underline-offset-2">
          Back to the live board
        </Link>
      </nav>
    </main>
  );
}
