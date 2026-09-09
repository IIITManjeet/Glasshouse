"use client";

import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

/**
 * A feature band: a claim, a sentence, and the thing itself.
 *
 * The structure a landing page actually needs, and the one this page was missing. It had
 * a hero and then six instrument panels in a row, which tells a visitor what the product
 * MEASURES without ever telling them what it DOES.
 *
 * Each band states one claim as a heading, explains it in two sentences, and then shows
 * the real component beside it -- not a screenshot and not a mockup. That is the honest
 * version of a product shot here: the card in the band is the same card the board renders,
 * so it cannot drift from the product the way an image would, and anything it displays is
 * either live or carries the rehearsal's label.
 *
 * `flip` alternates which side the visual sits on. On a narrow screen the visual always
 * comes second, because a reader who cannot see both at once needs the claim first.
 */
export function Feature({
  eyebrow,
  title,
  children,
  visual,
  flip = false,
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  children: ReactNode;
  visual: ReactNode;
  flip?: boolean;
  id?: string;
}) {
  return (
    <Reveal>
      <section id={id} className="scroll-mt-6 border-t border-rule py-14 sm:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className={flip ? "lg:order-2" : ""}>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-glass">
              {eyebrow}
            </p>
            <h2 className="mt-3 font-display text-2xl leading-snug font-light sm:text-3xl">
              {title}
            </h2>
            <div className="mt-4 space-y-3 text-ink-soft">{children}</div>
          </div>
          <div className={flip ? "lg:order-1" : ""}>{visual}</div>
        </div>
      </section>
    </Reveal>
  );
}

/**
 * The frame a sketch or a live card sits in.
 *
 * A 1px rule and a raised ground, matching every other panel -- ui-spec 2.2 still forbids
 * a shadow or a radius above 2px, and nothing here needs one to read as a card.
 */
export function Plate({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-rule bg-raised p-6 sm:p-8 ${className ?? ""}`}>{children}</div>
  );
}
