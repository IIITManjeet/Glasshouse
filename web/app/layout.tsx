import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { DemoBanner } from "@/components/DemoMode";
import { StatusBar } from "@/components/StatusBar";

/**
 * The three faces ui-spec.md section 2.1 specifies, actually loaded.
 *
 * They were not. `globals.css` named Newsreader and IBM Plex in its font stacks and
 * nothing ever fetched them, so every visitor got the fallbacks -- Georgia for the
 * display face, the system UI sans for body, and Consolas for every chain value. The
 * mono fallback is the one that mattered: `font-variant-numeric: tabular-nums` is why
 * a countdown does not shuffle its neighbours as digits change, and Consolas gives
 * that only by accident of being fixed-width.
 *
 * `next/font` self-hosts them at build time, so the shipped page makes no request to
 * Google -- which the static essay does, and which is a third-party dependency a page
 * arguing for verifiability should not need. The cost is that `next build` needs the
 * network once; that fails loudly and immediately, which is the failure mode to prefer.
 */
const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"], // the h1 sets one clause in italic
  variable: "--font-newsreader",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"], // not a variable font: the weights must be named
  variable: "--font-plex-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

/**
 * The origin the link card is resolved against.
 *
 * og:image has to be absolute, so Next needs a base. NEXT_PUBLIC_SITE_URL wins if it is
 * set; otherwise Vercel's own VERCEL_URL, which it injects per deployment, including
 * previews. Falling back to localhost rather than guessing a production domain is
 * deliberate: a wrong absolute URL in og:image is worse than an obviously local one,
 * because it fails silently in someone else's chat window instead of in your own.
 */
const origin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "Glasshouse — taker priority by sealed bid",
  description:
    "A sealed-bid, second-price auction for the right to fill an order. A custom 1inch SwapVM instruction, live on Base.",
  openGraph: {
    type: "website",
    siteName: "Glasshouse",
    title: "Glasshouse — taker priority by sealed bid",
    description:
      "The winner bids 400 bps and pays 250, the runner-up's price. The difference goes to the maker. A custom 1inch SwapVM instruction, live on Base.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Glasshouse — taker priority by sealed bid",
    description:
      "The winner bids 400 bps and pays 250, the runner-up's price. The difference goes to the maker.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="bg-ground text-ink antialiased">
        {/* The round manifest and the cold-fallback snapshot are classic scripts, loaded
            before hydration, because they assign globals the data layer reads. They are
            generated files (scripts/make-snapshot.mjs) and deliberately not imported as
            modules: the snapshot must also work when opened from a file, where fetch of a
            sibling fails. */}
        <Script src="/data/rounds.js" strategy="beforeInteractive" />
        <Script src="/data/snapshot.js" strategy="beforeInteractive" />
        <Providers>
          <div className="mx-auto max-w-6xl px-5 py-6">
            <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4">
              <Link href="/" className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint hover:text-glass">
                Glasshouse <span className="text-glass">/</span> 1inch SwapVM <span className="text-glass">/</span> opcode 0x2e
              </Link>
              <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-faint">
                <Link href="/board" className="hover:text-glass">Board</Link>
                <Link href="/rounds" className="hover:text-glass">Rounds</Link>
                <Link href="/evidence" className="hover:text-glass">Evidence</Link>
              </nav>
            </header>
            {/* The provenance line, on every page, so any screenshot carries it. The
                rehearsal toggle and the connected address live in it -- the control that
                changes the source belongs on the line that names the source. */}
            <StatusBar />
            {/* Not dismissible. ui-spec.md 3.5 rule 3: a data state that is not live
                raises a banner, not just a chip. */}
            <DemoBanner />
            {children}
            <footer className="mt-16 border-t border-rule pt-5 font-mono text-[0.72rem] leading-relaxed text-ink-faint">
              <p>
                Book{" "}
                <a className="text-glass" href="https://basescan.org/address/0xc4ea91Fe700918220423ac307C6B1c59650FFbfe" target="_blank" rel="noopener">
                  0xc4ea91Fe700918220423ac307C6B1c59650FFbfe
                </a>
              </p>
              <p>
                Router{" "}
                <a className="text-glass" href="https://basescan.org/address/0x5c3baE054e8b4915a13726B397b1AeA864247DBf" target="_blank" rel="noopener">
                  0x5c3baE054e8b4915a13726B397b1AeA864247DBf
                </a>
              </p>
              <p className="mt-2">
                Built on the official 1inch Aqua and SwapVM contracts, consumed as dependencies and not vendored.
              </p>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
