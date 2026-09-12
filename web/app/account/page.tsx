"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useBoard } from "@/components/BoardProvider";
import { SourceChip } from "@/components/Auction";
import { Profile } from "@/components/Profile";
import { IdentityCard, rolesOf } from "@/components/Identity";
import { Loading } from "@/components/Loading";
import { Record } from "@/components/Record";
import { Search } from "@/components/Icon";

// Static export (next.config.mjs: output: "export") means no dynamic route segment can
// exist -- there is no server at request time to resolve `/account/[address]` against, only
// the one HTML shell this build produces. The address travels as a query parameter instead
// and is read client-side, same as `?rpc=` already is in web/lib/useAuctions.ts and
// web/app/providers.tsx.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * LOOK UP AN ADDRESS -- and, when one is already on screen, look up a DIFFERENT one.
 *
 * The bug this fixes was reported from the live site: "the same look up on the profile page
 * redirects me on the same page". It did, and it had to. The field was seeded with
 * `initial={raw}` -- the address the page is already showing -- so on any populated profile
 * the input arrived pre-filled with the answer, and pressing `Look up` navigated to the URL
 * you were already on. A full page reload, back to exactly the same place, which reads as a
 * broken control rather than as the no-op it was.
 *
 * Seeding made sense on the EMPTY branches, where there is nothing else to put in the field
 * and a malformed address is worth handing back for correction. It is wrong on a profile,
 * where the only reason to reach for this control is to go somewhere else. So `current` says
 * what is already on screen: the field starts empty, the placeholder says what it is for,
 * and re-submitting the address you are already reading does nothing instead of reloading.
 *
 * VALIDATION MOVED IN FRONT OF THE NAVIGATION for the same reason. A typo used to cost a
 * round trip to reach the "Not an address" page; it is now answered in place, and only a
 * well-formed address is worth a reload.
 */
function AddressForm({ initial, current }: { initial: string; current?: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [hint, setHint] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = value.trim();
        if (!next) {
          setHint("Paste an address to look up.");
          return;
        }
        if (!ADDRESS_RE.test(next)) {
          setHint("That is not a 42-character 0x address.");
          return;
        }
        if (current && next.toLowerCase() === current.toLowerCase()) {
          setHint("That is the address you are already looking at.");
          return;
        }
        // A full navigation, not router.push. /profile/<addr> is a Vercel edge rewrite
        // rather than an exported route, and the client router cannot resolve it -- it
        // would 404 without making a request. The reload is the cost of the pretty URL,
        // and this is a deliberate lookup action rather than idle navigation.
        window.location.assign(`/profile/${encodeURIComponent(next)}`);
      }}
      className="mt-4 flex flex-wrap items-center gap-2"
    >
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (hint) setHint(null);
        }}
        aria-invalid={hint ? true : undefined}
        placeholder={current ? "Look up another address — 0x…" : "0x…"}
        spellCheck={false}
        // `.input`, not a hand-composed field. It is the primitive globals.css was
        // missing: the recipe here was a near-copy of `.card`'s, and a 34px raised box
        // beside a 36px `.btn-secondary` in the same flex row is exactly the misaligned
        // pair this pass exists to remove. The variant owns the height now, both of them.
        className="input tnum min-w-[16rem] flex-1"
      />
      {/* A .btn, not a hand-rolled bordered span with uppercase mono in it -- that exact
          shape is the DESIGN.md F-3 regression, where a label and a control became
          indistinguishable. Secondary rather than primary because the wallet control in the
          layout is this view's one filled thing. */}
      <button type="submit" className="btn btn-secondary">
        <Search />
        Look up
      </button>
      {hint ? (
        <p role="status" className="w-full text-[0.8125rem] text-amber">
          {hint}
        </p>
      ) : null}
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
  // Read here, with the other hooks, because everything below it returns early. It feeds
  // the `you` role on the header: the one label on this page that is about the reader
  // rather than about the address, and the reason a person can tell their own profile from
  // somebody else's at a glance.
  const { address: connected } = useAccount();

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
      <div className="card">
        {/* The page's h1 lives on the subject, which here is the absence of one. Exactly one
            h1 per branch: the alternative was a standing "Account" heading competing with
            the address underneath it. */}
        <h1 className="font-sans text-2xl font-semibold text-ink">No address in the URL</h1>
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
      <div className="rounded-control border border-brick bg-brick-soft p-4">
        <h1 className="font-sans text-2xl font-semibold text-brick">Not an address</h1>
        <p className="mt-2 text-brick">
          <span className="tnum break-all">{raw}</span> is not a well-formed address.
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          Expected 0x followed by 40 hex characters. Nothing was looked up — a malformed value is shown honestly
          rather than silently coerced into some other address, or dropped and rendered as if nothing had been
          typed at all.
        </p>
        <AddressForm initial="" current={raw} />
      </div>
    );
  }

  const address = raw.toLowerCase();

  // The two roles a header can honestly carry with no round in hand. `maker` is read from
  // the loaded rounds rather than assumed, and it is deliberately NOT shown when the board
  // has loaded nothing -- an empty board would otherwise silently mean "not a maker".
  const opened = auctions.some((a) => a.maker?.toLowerCase() === address);
  const headerRoles = rolesOf({ addr: address, you: connected, opened });

  return (
    <>
      {/* Who this is, before what they did. ENS is read from mainnet, where the registry
          lives; an address with no name renders as the address, which is the truth. The
          card foot carries the sentence that used to sit under the route heading -- it
          describes what the figures below are computed from, so it belongs against them. */}
      <div className="card mb-6">
        <IdentityCard address={raw} roles={headerRoles} />
        <p className="card-foot">
          What one address has done across the rounds this build has loaded — as maker,
          bidder, or filler.
        </p>
      </div>

      {/* The indexer's answer -- every round the Book has ever had -- above the board's
          window. Renders nothing at all when NEXT_PUBLIC_SUBGRAPH_URL is unset, so the
          page is complete either way rather than showing an empty shape. */}
      <div className="mb-6">
        <Record address={raw} />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {head > 0 && <SourceChip source={source} head={head} isFork={isFork} />}
        <AddressForm initial="" current={raw} />
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
    <main>
      {/* THE ROUTE NAME IS AN EYEBROW HERE, AND IT IS THE ONLY PAGE WHERE THAT IS TRUE.
          /rounds, /board and /round are named by what they show; this page's subject is one
          participant, so the address (or its ENS name) is the h1 and "Account" is the label
          above it. Two headings both claiming to name the page -- "Account", then the
          address immediately beneath it -- is what this replaced. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
          Account
        </p>
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
