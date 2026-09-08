import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Glasshouse — taker priority by sealed bid",
  description:
    "A sealed-bid, second-price auction for the right to fill an order. A custom 1inch SwapVM instruction, live on Base.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
              <nav className="flex gap-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-faint">
                <Link href="/" className="hover:text-glass">Live</Link>
                <Link href="/rounds" className="hover:text-glass">Rounds</Link>
                <a href="https://basescan.org/address/0xc4ea91Fe700918220423ac307C6B1c59650FFbfe" target="_blank" rel="noopener" className="hover:text-glass">
                  Contract ↗
                </a>
                <a href="https://github.com/IIITManjeet/Glasshouse" target="_blank" rel="noopener" className="hover:text-glass">
                  Code ↗
                </a>
              </nav>
            </header>
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
