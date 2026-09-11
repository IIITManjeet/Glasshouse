"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBoard } from "@/components/BoardProvider";
import { SourceChip } from "@/components/Auction";
import { Profile } from "@/components/Profile";
import { IdentityCard } from "@/components/Identity";
import { Loading } from "@/components/Loading";
import { Record } from "@/components/Record";

// Static export (next.config.mjs: output: "export") means no dynamic route segment can
// exist -- there is no server at request time to resolve `/account/[address]` against, only
// the one HTML shell this build produces. The address travels as a query parameter instead
// and is read client-side, same as `?rpc=` already is in web/lib/useAuctions.ts and
// web/app/providers.tsx.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function AddressForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = value.trim();
        // A full navigation, not router.push. /profile/<addr> is a Vercel edge rewrite
        // rather than an exported route, and the client router cannot resolve it -- it
        // would 404 without making a request. The reload is the cost of the pretty URL,
        // and this is a deliberate lookup action rather than idle navigation.
        if (next) window.location.assign(`/profile/${encodeURIComponent(next)}`);
      }}
      className="mt-4 flex flex-wrap gap-2"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
        className="tnum min-w-[16rem] flex-1 border border-rule bg-raised rounded-card shadow-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-glass focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-control border border-rule px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-soft hover:border-glass hover:text-glass"
      >
        Look up
      </button>
    </form>
  );
}

/**
 * `useSearchParams` must sit behind a Suspense boundary in a statically exported route: the
 * shell prerenders once at build time with no query string to read, and the value only
 * exists once a visitor's browser actually loads the page with one attached (Next's own
 * docs, node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md,
 * "During production builds, a static page that calls useSearchParams from a Client
 * Component must be wrapped in a Suspense boundary"). Everything that needs the parameter
 * lives in this inner component so the outer shell has something to render immediately.
 */
function AccountView() {
  const params = useSearchParams();
  const pathname = usePathname() ?? "";

  // THE ADDRESS CAN ARRIVE BY TWO ROUTES, AND ONLY ONE OF THEM IS A QUERY STRING.
  //
  // This read `?a=` and nothing else, which meant /profile/<address> -- the pretty URL, the
  // one the status bar links to, the one the address form navigates to, and the one every
  // address link in the app now points at -- rendered "No address in the URL" in production.
  // It had been broken the whole time and looked like a page that simply failed to load.
  //
  // The reason is worth writing down because the rewrite LOOKS like it should work. Vercel
  // rewrites /profile/:address to /account/?a=:address on the EDGE: it decides which file to
  // serve. It does not change the browser's location, so the client still sees
  // /profile/0x.../ with an empty search string, and useSearchParams -- which reads the
  // browser, not the edge -- correctly reports no parameter. Nothing is misconfigured; the
  // query string genuinely does not exist on the client.
  //
  // So the path is read as a first-class source. `?a=` still wins when present, because that
  // is the form the lookup box submits and the only one that exists under `next dev` for a
  // hand-typed URL.
  const fromPath = /^\/profile\/(0x[0-9a-fA-F]{40})\/?$/.exec(pathname)?.[1] ?? null;
  const raw = params.get("a") ?? fromPath;
  const { auctions, head, source, isFork, loading, error } = useBoard();

  if (!raw) {
    return (
      <div className="border border-rule bg-raised rounded-card shadow-card p-6">
        <p className="text-ink-soft">No address in the URL.</p>
        <p className="mt-2 text-sm text-ink-faint">
          This page reads an address from <code className="font-mono">?a=0x…</code> — there is no per-address route,
          because the build is a fully static export with no server to resolve one against.
        </p>
        <AddressForm initial="" />
      </div>
    );
  }

  if (!ADDRESS_RE.test(raw)) {
    return (
      <div className="border border-rule bg-brick-soft p-6">
        <p className="text-brick">
          <span className="font-mono">{raw}</span> is not a well-formed address.
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          Expected 0x followed by 40 hex characters. Nothing was looked up — a malformed value is shown honestly
          rather than silently coerced into some other address, or dropped and rendered as if nothing had been
          typed at all.
        </p>
        <AddressForm initial={raw} />
      </div>
    );
  }

  const address = raw.toLowerCase();

  return (
    <>
      {/* Who this is, before what they did. ENS is read from mainnet, where the registry
          lives; an address with no name renders as the address, which is the truth. */}
      <div className="mb-6 border border-rule bg-raised rounded-card shadow-card p-5 sm:p-6">
        <IdentityCard address={raw} />
      </div>

      {/* The indexer's answer -- every round the Book has ever had -- above the board's
          window. Renders nothing at all when NEXT_PUBLIC_SUBGRAPH_URL is unset, so the
          page is complete either way rather than showing an empty shape. */}
      <div className="mb-6">
        <Record address={raw} />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {head > 0 && <SourceChip source={source} head={head} isFork={isFork} />}
        <AddressForm initial={raw} />
      </div>

      {loading && auctions.length === 0 ? (
        <Loading
          what="Reading this address&rsquo;s rounds"
          detail="Every round on the board is scanned for commitments and reveals from this address. Nothing about it is stored anywhere; it is derived from the chain each time."
        />
      ) : error && auctions.length === 0 ? (
        <p className="border border-brick bg-brick-soft px-3 py-2 text-sm text-brick">
          Could not read any round: {error}
        </p>
      ) : (
        <Profile address={address} auctions={auctions} head={head} />
      )}

      {error && auctions.length > 0 ? (
        <p className="mt-3 text-[0.78rem] text-brick">
          Last refresh failed ({error}) — showing the most recent successful read.
        </p>
      ) : null}
    </>
  );
}

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-[62rem] px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-display text-3xl text-ink">Account</h1>
          <p className="mt-1 text-sm text-ink-soft">
            What one address has done across the rounds this build has loaded — as maker, bidder, or filler.
          </p>
        </div>
        <Link
          href="/rounds"
          className="whitespace-nowrap text-sm text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
        >
          ← all rounds
        </Link>
      </div>

      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-ink-faint">Loading…</p>}>
          <AccountView />
        </Suspense>
      </div>
    </main>
  );
}
