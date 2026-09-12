import Link from "next/link";

/**
 * THE FOOTER IS WHERE THE SITE SAYS WHAT IT IS, AND WHAT IT IS NOT.
 *
 * It replaces an inline `<footer>` in layout.tsx that printed two 42-character addresses
 * in full mono and one sentence about dependencies. Three problems with that, all of them
 * the same problem: it was the only place on the site carrying provenance-of-the-whole-
 * project, and it carried almost none of it.
 *
 * 1. The two addresses were printed in FULL, which is why `overflow-wrap: anywhere` had to
 *    exist at all and why the footer wrapped badly at phone width. Nobody reads a 42-
 *    character hex string; they check the first six and the last four against the one they
 *    already have. Truncated here, full in `title`, and the link goes to Basescan where the
 *    whole thing is authoritative anyway.
 * 2. `/ 1inch SwapVM / opcode 0x2e` was in the header on every page, competing with the
 *    wordmark for the one line a visitor actually reads. Lineage is worth claiming once,
 *    not above every screenful.
 * 3. There was no disclosure anywhere except inside the README and inside one bid card. The
 *    house bidder, the dust-sized orders, the missing audit and the licence are the four
 *    facts a judge is entitled to find without reading source, so they are a column.
 *
 * NO FIGURE, NO NUMBER THAT NEEDS A SOURCE. The one number here -- the deploy block -- is
 * prose, not a `.stat`, and it is the same 50,965,408 README.md:20 gives. Nothing in this
 * file is inside a `<figure>`, so scripts/lint-provenance.mjs has nothing to demand of it,
 * which is correct: a footer is not evidence.
 */

/** The same formula `components/Address.tsx` uses, so a truncation reads identically
 *  wherever it appears. First six and last four is what a person actually compares. */
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";
const ROUTER = "0x5c3baE054e8b4915a13726B397b1AeA864247DBf";
const AQUA = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a";
const SUBGRAPH_ID = "FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y";
const REPO = "https://github.com/IIITManjeet/Glasshouse";

const linkClass =
  "text-[0.8125rem] font-normal text-ink-soft underline-offset-2 hover:text-glass hover:underline";
const headingClass =
  "text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint";

/** An internal route. Nothing decorative: no arrow, because it does not leave the site. */
function In({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

/** Leaving the site is a fact a reader deserves before the click, not after it. The arrow
 *  says so, `target="_blank"` honours it, and `rel="noopener"` is the part that is not
 *  cosmetic. */
function Out({
  href,
  title,
  children,
}: {
  href: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} title={title} target="_blank" rel="noopener" className={linkClass}>
      {children}
      <span aria-hidden> ↗</span>
    </a>
  );
}

/** A truncated identifier that is a link. Mono + tabular, because it is a value you could
 *  copy and have it still mean the same thing -- the type rule, not decoration. */
function Ident({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Out href={href} title={value}>
      {label} <span className="tnum">{short(value)}</span>
    </Out>
  );
}

function Column({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className={headingClass}>{heading}</h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

/** A disclosure is a sentence, not a link. Italic so the column does not read as four more
 *  things to click, and it says the unflattering thing rather than gesturing at it. */
function Say({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-[0.8125rem] font-normal italic leading-relaxed text-ink-soft">
      {children}
    </li>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-rule pt-6">
      <p className="text-[0.9375rem] font-medium leading-relaxed text-ink">
        Glasshouse sells the right to fill an order by sealed bid, on Base. The winner pays
        the runner-up&rsquo;s price.
      </p>
      <p className="mt-2 text-[0.8125rem] font-normal text-ink-faint">
        A custom 1inch SwapVM instruction, opcode 0x2e. ETHOnline 2026.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        <Column heading="Glasshouse">
          <li>
            <In href="/">Live</In>
          </li>
          <li>
            <In href="/rounds">Rounds</In>
          </li>
          <li>
            <In href="/evidence">Evidence</In>
          </li>
          <li>
            <In href="/faq">FAQ</In>
          </li>
          <li>
            <In href="/account">Look up an address</In>
          </li>
          <li>
            {/* A plain <a>, not a <Link>: argument.html is a hand-written static file in
                public/ with no build step, and the client router has no route for it. */}
            <a href="/argument.html" className={linkClass}>
              The long version
            </a>
          </li>
        </Column>

        <Column heading="Verify">
          <li>
            <Ident
              label="GlasshouseBook"
              value={BOOK}
              href={`https://basescan.org/address/${BOOK}`}
            />
          </li>
          <li>
            <Ident
              label="GlasshouseRouter"
              value={ROUTER}
              href={`https://basescan.org/address/${ROUTER}`}
            />
          </li>
          <li>
            <Ident
              label="1inch Aqua"
              value={AQUA}
              href={`https://basescan.org/address/${AQUA}`}
            />
          </li>
          <li>
            <Out
              href={`https://thegraph.com/explorer/subgraphs/${SUBGRAPH_ID}`}
              title={SUBGRAPH_ID}
            >
              Subgraph <span className="tnum">{`${SUBGRAPH_ID.slice(0, 6)}…${SUBGRAPH_ID.slice(-4)}`}</span>
            </Out>
          </li>
          <li>
            <In href="/faq#check">Check a round yourself</In>
          </li>
        </Column>

        <Column heading="Source">
          <li>
            <Out href={REPO}>GitHub</Out>
          </li>
          <li>
            <Out href={`${REPO}#readme`}>README</Out>
          </li>
          <li>
            <Out href={`${REPO}/blob/main/DECISIONS.md`}>Every decision</Out>
          </li>
          <li>
            <Out href={`${REPO}/blob/main/AI-DISCLOSURE.md`}>AI disclosure</Out>
          </li>
          <li className="text-[0.8125rem] font-normal text-ink-faint">Licence — MIT</li>
        </Column>

        <Column heading="Disclosure">
          <Say>
            The demo maker bids in its own rounds and is labelled &ldquo;house&rdquo; on
            every card.
          </Say>
          <Say>
            Live rounds run with bond 0 and dust-sized orders. This is a working mechanism,
            not a market.
          </Say>
          <Say>Contracts are unaudited and have no owner, admin or upgrade path.</Say>
          <Say>
            Glasshouse&rsquo;s own code is MIT. 1inch Aqua and SwapVM are consumed as
            dependencies, never vendored.
          </Say>
        </Column>
      </div>

      <p className="mt-8 border-t border-rule pt-4 text-[0.75rem] text-ink-faint">
        Deployed at block <span className="tnum">50,965,408</span> ·{" "}
        <span className="tnum">Base (8453)</span>
      </p>
    </footer>
  );
}

export default Footer;
