# frontend-architecture.md — Glasshouse frontend, decided

> **Status:** DECIDED (architect, D-007 role), 2026-09-08. Supersedes the stack line in
> `run.md` §9 ("single static page, no framework, no build step") and `DESIGN.md` §6 **only
> to the extent stated in §1 below**. Does not supersede `docs/design/ui-spec.md`; §2 says
> exactly which of its decisions carry, which change, and why.
>
> **User decision this file implements:** the frontend is **Next.js**, built **alongside**
> the static page, **static first**. The static page in `site/` remains the shippable
> artifact through the Wed 10 Sep freeze and the Sep 13 submission. The Next.js app is
> additive, integrated incrementally, and never a replacement before submission.
>
> Freeze is **Wed 10 Sep**. Today is **Mon 08 Sep**. Every hour figure below is for one
> implementer who has read `ui-spec.md`.

---

## 0. The one-paragraph answer

Two artifacts, one data plane, one set of tested logic. `site/index.html` stays the
document a tester is handed and the thing that survives 3 am on submission day: no
build, no dependency, opens from `file://`. A Next.js app in `web/` (App Router,
`output: 'export'`, no server) is the **instrument**: it takes the screens that benefit
from React state, first the auction view, and it is the only place the wallet-bound CTAs
will ever live. Everything that *computes* (`phase`, `canSettle`, `recommendReserve`, the
GraphQL query strings, row-shaping, formatting, the live/cache/snapshot precedence) lives
in `site/` as plain ESM with no build step, is tested in `test/js/`, and is imported by
both artifacts. `web/` renders; it never re-implements. The two artifacts deploy from one
GitHub Pages workflow in which the static copy cannot be blocked by a Next.js build
failure. If `next build` breaks, the page at `/` is exactly what it was.

---

## 1. Reconciliation with `ui-spec.md` and `run.md` §9

### 1.1 Carries over unchanged (binding on both artifacts)

| ui-spec § | What | Why it does not depend on the framework |
|---|---|---|
| §1 DL, §2 | The design language: Newsreader / IBM Plex Sans / IBM Plex Mono, the token set incl. `--amber`, the number rule, the hatch pattern, two-tier density, the motion table, no icons beyond three glyphs. | It is CSS and typography. React does not change a colour. §6 below makes the Next app consume the *same token values* and tests that they match. |
| §3 | The provenance system: source tag first child, `made` caption last child, the ten `data-src` kinds, bidder provenance chips, placement rules, the lint. | It is the F-114 defence. In React it gets *stronger*: a `<Figure>` component with required `src` and `made` props makes an untagged table a type error, not a lint finding (§7.3). The text lint still runs on `site/index.html`. |
| §4 | Adopted conventions and the Glasshouse-defined ones (phase track, sealed card, running/final/settled, deadline-on-the-button, losing bidders' rank). | Behavioural, not structural. `cta-patterns.md` refines the CTA rows with the survey evidence; the rest stands verbatim. |
| §5 | Data plane: Studio URL client-side, `_meta` on every query, RPC head only for countdowns, `localStorage` cache, checked-in snapshot, the head-block rule, the polling budget. | The Next app has **no server** (§4), so the data plane is identical by construction. The budget of 3 000 queries/day is now shared by two artifacts, which §5.4 accounts for. |
| §6 | Screen inventory S0–S7 and every "must never show". | Screens are the product. Which artifact renders each one is the only thing that changes (§3). |
| §8, §9 | The cut line for the static page and the acceptance checklist. | Unchanged for `site/`. The Next app gets its own gates (§10), which are additive. |
| Decision **W** | Wallet bidding from the page is cut from the freeze. | Still true, and now sharper: wallet CTAs are built **only in `web/`**, never in `site/index.html` (§8). The static page is a read-only instrument forever. |
| Decision **N** | No maker UI; the page prints the `cast send` line. | Unchanged. |
| The refusals | `subgraph/README.md` "What it refuses to compute" and `subgraph-design.md` §9. | Nothing in this file needs any refused number. The Next app's data layer imports the same three queries and has no others. |

### 1.2 Must change because it is now Next.js

| ui-spec § | Was | Now |
|---|---|---|
| U-6 | "Hosted on GitHub Pages from `site/`. No build step, so Pages serves the directory as-is." | Pages still serves `site/` as-is at `/`, but through an Actions workflow (Pages cannot publish an arbitrary subdirectory from a branch; only `/` or `/docs`). The workflow copies `site/` untouched and, in a job that is allowed to fail, adds the Next export under `/app/` (§9). |
| §5.4 | "`site/app.js` is `<script type="module">` and imports both." | Still true for the static page. Additionally, `site/lib/*.js` is created for the logic that both artifacts share (§7.1). `site/app.js` becomes thin: DOM rendering over `site/lib/`. |
| §6 S2–S5 | One page, anchored sections. | The static page keeps S2–S5 as read-only Tier 1/2 sections exactly as specified. The Next app renders the same screens as routes (§3), starting with S3. Rendering is duplicated on purpose; logic is not (§7). |
| §7.4–7.9 | Wallet CTAs "specified so they can be built after Wed 12:00". | They are built in `web/` only, with `viem` for ABI encoding (§8), never with hand-encoded calldata in `site/`. The un-cut trigger stays as written. |
| §3.6 | The lint parses `site/index.html` as text. | Still does. `web/` gets the typed `<Figure>` plus a second check that no `<table`, `<svg` or `.stat` is rendered outside it (§7.3). |
| `run.md` §9 stack line | "single static page, no framework, no build step" | Amend to: *"the static page is the shippable artifact and is never cut; a Next.js instrument app is built alongside it under `web/`, deploys under `/app/`, and is not on the critical path of the submission."* |
| `run.md` §9 "Nothing new is built after the freeze" | — | **Conflict, stated plainly.** With one implementer and a 12-hour UI budget already allocated to static Tier 1 and 2, the Next app cannot start before Wed 12:00 without cutting Tier 2 (§1.3). It therefore either starts after the freeze or displaces Tier 2. My recommendation is in §1.3; the user must pick. |

### 1.3 What Next.js buys, what it costs, and when it is affordable

**Buys**

1. **A real home for the wallet flow.** ui-spec §7.6–7.7 is a five-state stepper with a
   browser-held secret, per-block countdowns on a disabled button, and revert decoding. In
   hand-written DOM that is the kind of code that gets one state wrong at 2 am. React state
   plus a typed `TxButton` ladder (`cta-patterns.md` §4) is the right tool for it.
2. **Provenance as a type.** `<Figure src="base" made="…">` with required props cannot be
   forgotten. The static page relies on a text lint.
3. **Routes.** `/app/auction/?id=…` is a URL a tester can paste to a teammate. The static
   page's `#auction=` hash works but is invisible in most chat previews.
4. **Fonts self-hosted at build** via `next/font`, so the instrument does not depend on
   `fonts.googleapis.com` being reachable during the demo.
5. **The thing the user asked for.** A React codebase is what a second contributor after
   the event expects to find.

**Costs, concretely**

| Item | Hours | Notes |
|---|---|---|
| Scaffold `web/`: Next, TypeScript, `output: 'export'`, `basePath`, tokens, fonts, `<Figure>`, shared-import wiring and its tests | 1.5 | Must be done before any screen. |
| S3 auction view in React (phase track, cards, stat line, timeline) | 2.5 | Rendering only; logic imported from `site/lib/`. |
| S2 list | 1 | |
| S4 receipt | 1 | |
| S5 reserve panel | 1 | |
| Pages workflow with the isolated Next job | 0.5 | |
| **Total to parity with static Tier 1+2 instrument sections** | **7.5** | On top of the 13.75 already budgeted for the static page. |
| Wallet CTAs 7.4–7.9 (`web/` only) | 5–6 | Unchanged from ui-spec item 9. |
| Toolchain risk | — | A `next build` failure, a Turbopack root warning, a `basePath` mismatch, a lockfile drift. Each is a known 20-minute problem, and 20 minutes is what the schedule does not have on Wed. §9 ensures none of them can touch `site/`. |

**When it is affordable**

The static page's Tier 1 (8.75 h) and Tier 2 (5 h) already fill Tue and Wed morning.
Starting `web/` before the freeze means either a second implementer or cutting Tier 2
(receipt, reserve panel, lens), and Tier 2 is what testers and the video see.

**Recommendation.** Do not start `web/` before Wed 12:00. Then:

- If Tier 1 and 2 have landed and been reviewed by Wed 12:00 (the same trigger ui-spec §8
  sets for un-cutting the wallet), spend Wed afternoon on §11 steps 1–2 (scaffold + S3),
  which is 4 hours and does not touch `site/`. It ships at `/app/` only if it passes its
  own gate; otherwise the workflow simply does not publish it.
- Otherwise `web/` starts **Thu 11**, as a track explicitly excepted from the freeze
  because it cannot affect the shippable artifact: it is a separate package, a separate
  Pages job, and a separate URL. Amend `run.md` §9 to say so, so a reader does not think
  the freeze was broken by accident. It reaches `/app/` before Sat 13 21:30 IST only if
  §10's gates pass; the submission does not depend on it.

Where I am uncertain: whether a judge opening `/app/` and `/` sees two products or one. I
think one, if the static page's section nav links to `/app/` under the words *live
instrument* and the app's masthead links back under *the argument*. But it is a risk and
the mitigation is the link text, not more code.

### 1.4 Replace or alongside

**Alongside.** Decided by the user, and it is also what I would have recommended:

- The static page is on the "never cut" line of `run.md` §9 for reasons that are still
  true: it opens from `file://` for a judge with no network (ui-spec §9 acceptance 4), it
  has no dependency that can fail, and it is the video's backdrop on Fri 12.
- A Next static export cannot honestly meet acceptance 4. Client navigation and
  `/_next/static/` assets assume an HTTP origin; `assetPrefix: './'` gets close and is
  not a supported configuration. The document tier does not need React and gains nothing
  from it.
- The retirement point (§11, step 8) is therefore *after* the argument tier is ported as
  MDX **and** acceptance 4 is deliberately dropped as a requirement. Assume that never
  happens before submission, and probably not after.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| **FA-1** | **Next.js 16, pinned exact** (the docs fetched today are `v16.3.4`, updated 2026-08-25). App Router. `output: 'export'`. TypeScript. | App Router is where static export got Server Components and route handlers (v13.4 changelog on the same page). Pages Router would be a second mental model for no gain. Pin exact so a Thu install equals a Wed install. |
| **FA-2** | **No server, ever, for this app.** No ISR, no Server Actions, no route handlers that read a request, no middleware/proxy, no dynamic routes. Static export to `web/out/`. | Everything the app shows is live subgraph or RPC data fetched **in the browser**, exactly as ui-spec U-5 decided. A server would add a place to keep a Gateway key and a second thing that can be down at 3 am. The Subgraph MCP proxy (subgraph-design Q4) stays "not for the freeze". |
| **FA-3** | **Rendering per route:** the shell (masthead, nav, footer, legend text, captions) is Server Components rendered at build; every figure that shows indexed or computed data is a Client Component. | Server Components in a static export run at build and emit HTML with no JS. That is what the argument-shaped chrome wants. Anything with `_meta` needs `useEffect` and polling. |
| **FA-4** | **Subgraph queries live in the client**, in a polling store (`web/lib/store.ts`) that implements ui-spec §5.3 verbatim. Query strings are imported from `site/lib/queries.js`. | Same data plane as the static page; one source of truth for Q1/Q2/Q3. |
| **FA-5** | **State management: none beyond React.** One custom store (`useSyncExternalStore`), ~120 lines. No SWR, no TanStack Query, no Zustand, no Redux. | The schedule has visibility gating, a 4 h pause, live/cache/snapshot precedence and a two-head rule. Libraries fight bespoke schedules; a store this small is easier to read than the configuration that would tame one. |
| **FA-6** | **Styling: plain CSS.** `web/app/tokens.css` (the `:root` block, byte-for-byte the values in `site/index.html`), `web/app/globals.css` (type, tiers, `.strip/.track/.measure` patterns), CSS Modules per component. No Tailwind, no CSS-in-JS. | The design language is already CSS. A test asserts token parity (§7.4). |
| **FA-7** | **Fonts via `next/font/google`** (Newsreader, IBM Plex Sans, IBM Plex Mono), self-hosted at build. Fallback stacks as in `site/index.html`. | Removes a runtime dependency on Google Fonts for the instrument. The static page keeps its `<link>`; a document may depend on a font CDN, an instrument being demoed should not. |
| **FA-8** | **Wallet: none in the freeze (W holds). Post-freeze: `viem` only** — `createWalletClient(custom(window.ethereum))`, `encodeFunctionData` from the compiled Book ABI, `simulateContract` before every send. **No wagmi, no RainbowKit, no ConnectKit, no AppKit.** | `viem` is already a root devDependency and is what `scripts/run-auction.ts` uses, so the calldata the page sends is built by the same library the team already trusts. Connector kits bring a modal, a theme system and 40 wallets; we need one EIP-1193 provider on one chain. ui-spec 7.4's states are ~60 lines with `viem`. |
| **FA-9** | **Layout: `web/` is its own npm package with its own lockfile.** It imports `../site/lib/*.js`, `../site/phase.js`, `../site/reserve-rule.js` by relative path through a `@shared/*` alias. Nothing in the root `package.json` or `hardhat.config.ts` references `web/`. | The contracts' toolchain and the static page must not be able to break because of a React dependency. Direction of dependency is `web → site`, never the reverse. |
| **FA-10** | **Deployment: GitHub Pages, one workflow, two jobs.** `site/` → `/`; `web/out/` → `/app/`. The Next job may fail; the static job cannot be blocked by it. Optional Vercel preview for `web/` is allowed but is not on any path. | One URL family (`https://iiitmanjeet.github.io/Glasshouse/` and `…/Glasshouse/app/`) for testers and the README. §9. |
| **FA-11** | **Build-failure fallback: the static page at `/`, and the file in the repo.** The workflow publishes `site/` even when `next build` fails; `/app/` then serves a one-line static notice that links to `/`. | This is what makes the user's "static first" true in production rather than in intent. |
| **FA-12** | **Logic lives in `site/`, rendering in both.** Any function that turns subgraph JSON into a number, a label, a phase, a source tag or a recommendation is a plain ESM module under `site/` with a test under `test/js/`. `web/` may contain no such function. | The two artifacts must never disagree about a number on the same head block (subgraph-design §7.3 already demands this of the page and the advisor). §7. |

---

## 3. Route table

Base path in production is `/Glasshouse/app` (Pages serves the repo under its name).
Locally `next dev` serves at `/app` via `basePath: '/app'`; the workflow sets
`NEXT_PUBLIC_BASE_PATH=/Glasshouse/app` so both agree with `basePath`.

| Route | Screen (ui-spec §6) | Rendering | Data | Migration step (§11) |
|---|---|---|---|---|
| `/app/` | **S2 Live auctions** + compact masthead (opcode strip only, no h1) + section nav + S7 footer lines | Shell: server, at build. Table: client. | Q1 every 12 s / 120 s per §5.3 | 3 |
| `/app/auction/?id=<auctionId>` | **S3 Auction view** (three bands) + **S4 Receipt** when settled or filled | Shell: server. Bands and receipt: client, inside `<Suspense>` because `useSearchParams` requires it in a static export. Missing or unknown `id`: renders the newest live auction and says so in the source tag detail. | Q2 for `id`, polled per phase | 2 (S3), 4 (S4) |
| `/app/next/` | **S5 Next auction — reserve control** | Shell: server. Panel: client. | Q3 for the deployed maker | 5 |
| `/app/auction/?id=…#bid` | **Wallet flow** 7.4–7.9, rendered as a fourth band under S3 | Client | Q2 + RPC + `window.ethereum` | 6 (post-freeze) |
| `/app/argument/` | S0, S1, S6 as MDX | Server, at build | none | 7 (optional, post-event) |
| — | S0 masthead, S1 comparison, S6 lens, S7 limits | **Stay on the static page.** The app's masthead links to `../#argument`, `../#comparison`, `../#lens`. | none | never before step 7 |

Not routes: no `/auction/[id]` (dynamic routes need `generateStaticParams`, which would
require knowing every auction id at build, which is the "static dataset" F-80 excludes);
no `/api/*` (FA-2); no 404 page beyond Next's default with the tokens applied.

Query-string `id` rather than a path segment is the price of FA-2 and it is small: the
static page uses `#auction=<id>` and the app's `AuctionRow` links to `auction/?id=<id>`;
the static page's S2 rows link to the same app URL under `↗ open in the live instrument`.

---

## 4. Rendering strategy, in detail

| Concern | Decision |
|---|---|
| Server Components | `layout.tsx`, page shells, `Masthead`, `SectionNav`, `Footer`, `Legend` (the *Unlisted* sentence), `Made` captions whose text is constant. They run once at `next build` and ship as HTML. They **fetch nothing**: a build-time fetch of the subgraph would bake a dataset into HTML, and a judge diffing the deploy would see it. Explicitly forbidden. |
| Client Components | Everything under `web/components/auction/`, `reserve/`, `cta/`, `chain/BlockNumber`, `chain/Deadline`, `DataBanner`. Marked `'use client'`; browser APIs only inside `useEffect` (the static-export doc's rule). |
| Hydration | Client figures render a `SOURCE · … · LOADING` tag and an empty grid on first paint, then fill on the first poll. No skeleton shimmer (ui-spec §2.4). `LOADING` is not a tenth `data-src` kind; it is the `base` tag with the detail `awaiting first response` and `--amber` colour, and it must be replaced or downgraded to `cache`/`snapshot` within one poll interval. |
| `useSearchParams` | Only in `AuctionView`, wrapped in `<Suspense fallback={<FigureShell/>}>`. Without the boundary `next build` fails the static export of that route. |
| `Link` and prefetch | `prefetch={false}` everywhere. Three routes do not need a prefetch cache, and every prefetch is a request against nothing (there is no server) that still shows in the network panel during acceptance 9. |
| Images | None. `images.unoptimized: true` anyway so a stray `<Image>` cannot fail the export. |
| Metadata | `title` per route: `Glasshouse · live auctions`, `Glasshouse · auction #7`, `Glasshouse · next auction`. The tab title also carries the reveal countdown when a bid is armed (`cta-patterns.md` §5). |

---

## 5. Data layer

### 5.1 Modules

```
site/lib/queries.js       Q1, Q2, Q3 as exported template strings, plus the `_meta` fragment.
                          The ONLY place a GraphQL string may exist. Static page and app import it.
site/lib/sources.js       resolveSource({ live, cache, snapshot }) -> { data, src: 'base'|'cache'|'snapshot', head, fetchedAt }
                          The precedence rule of ui-spec §5.1, as a pure function over three optional inputs.
site/lib/heads.js         countdownHead(Hi, Hc) = max; lagBlocks(Hi, Hc); the "indexer N blocks behind" threshold (3).
site/lib/shape.js         shapeAuctionRow(a, head) -> the S2 row; shapeAuctionView(a, head) -> bands 1-3 as plain objects;
                          shapeReceipt(a) -> the S4 fields; shapeReserve(window, opts) wraps recommendReserve with the gloss text.
site/lib/format.js        fmtInt (space-thousands), shortAddr, fmtBlocks(n) -> "23 blocks · ~46 s at 2 s/block",
                          relTime, provenanceLabel (UNKNOWN -> "UNLISTED"), reasonGloss (the five reason codes).
site/lib/cast.js          castOpenLine(params) -> the S5 cast send line. The advisor's castSendLine moves here and
                          scripts/reserve-advisor.mjs imports it (test/js/reserve-advisor.test.js already pins it).
site/phase.js             unchanged.
site/reserve-rule.js      unchanged.
site/data/snapshot.js     unchanged (classic script assigning window.GLASSHOUSE_SNAPSHOT). The app imports the same
                          file through a tiny adapter that reads the global after a <Script strategy="beforeInteractive">.
```

Every module: plain ESM, no imports except each other, no DOM, no `fetch`. Each gets a
`test/js/<name>.test.js`. The static page's `site/app.js` and the app's `web/lib/` are the
only callers, and both are I/O and rendering only.

### 5.2 The app-side store (`web/lib/store.ts`)

One store per query name (`auctions`, `auction:<id>`, `reserveWindow`), each holding
`{ status, data, src, head, fetchedAt, error }`. Behaviour, all of it from ui-spec §5:

- `poll(name, query, vars, intervalMs)`: `fetch` the Studio URL, write `localStorage["glasshouse:q:<name>"]` on success, call `resolveSource` on failure, notify subscribers.
- Interval selection from the S2 result: any auction in `commit | reveal | exclusive` against `_meta` → 12 s for Q1/Q2 and 4 s for the RPC head; else 120 s for Q1 and no RPC.
- `document.hidden` → stop. Resume on `visibilitychange`.
- 4 h without a `pointerdown`/`keydown` → stop and publish `paused` so the head shows `paused · click to resume`.
- Two tabs of the app share the budget badly. Mitigation: a `BroadcastChannel('glasshouse')` in which one tab (`navigator.locks` if available, else first-writer) polls and the others read `localStorage` on `storage` events. 30 lines. Without it three testers with two tabs each hit 1 440/day idle, still under the cap; with it they hit 720. Implement it in step 3, not step 1.
- The Studio URL is `NEXT_PUBLIC_SUBGRAPH_URL` at build time **and** is read from `site/lib/queries.js`'s `SUBGRAPH_URL` export at runtime if the env is unset, so the two artifacts point at one endpoint by default.

### 5.3 The RPC head

`web/lib/rpc.ts`: `eth_blockNumber` against `https://mainnet.base.org`, 4 s while a phase
is live, else off. Shared rule via `site/lib/heads.js`. Nothing else is ever read from RPC
in the read-only app (ui-spec S3 "must never show: anything from RPC other than the
head"). The wallet band (step 6) adds `eth_call`, `eth_sendTransaction`,
`eth_getTransactionReceipt` through `viem`, and nothing else.

### 5.4 Budget with two artifacts

The 3 000/day cap (F-83) is per Studio key, i.e. shared. A live 150 s auction watched on
both artifacts costs ≈ 52 queries. Three testers idle on both costs 3 × 2 × 720 = 4 320,
over the cap. Two mitigations, both cheap: the `BroadcastChannel` above halves the app
side, and the idle interval on the app is **300 s** rather than 120 s (the app is opened
to watch an auction, not left open to read an argument). Idle then costs
3 × (720 + 288) = 3 024 — at the line, acceptable given testers do not leave both open all
day. If it is not, the next lever is publishing to the network and using a Gateway key
server-side, which is the proxy in subgraph-design Q4 and is not for the freeze.

---

## 6. Styling

- `web/app/tokens.css`: the `:root`, `@media (prefers-color-scheme: dark)` and
  `[data-theme]` blocks copied from `site/index.html` lines 9–58, plus the two `--amber`
  tokens from ui-spec §2.2. **Parity is tested** (§7.4). No theme toggle (DL).
- `web/app/globals.css`: body type at 16.5px/1.65, `.wrap`/`.spine`, `.eyebrow`, `h2`,
  `h3`, `code`, `pre`, `a`, focus rings, the reduced-motion rule, the `.strip`, `.track`,
  `.measure`, `table` rules. Copied, then trimmed to what the instrument tier uses.
- CSS Modules for `Figure`, `SourceTag`, `PhaseTrack`, `BidCard`, `StatLine`, `Receipt`,
  `ReservePanel`, `TxButton`. Class names in modules mirror the static page's
  (`.track`, `.ph`, `.blocks`) so a screenshot of either artifact is recognisable as the
  same product.
- The hatch pattern for a sealed card is one rule in `BidCard.module.css`, identical to
  ui-spec §2.2.
- Instrument tier is 14px/1.5 inside figures (ui-spec §2.3). Set on `.fig` in
  `Figure.module.css`, not on `body`.

---

## 7. Sharing, and the tests that make it real

### 7.1 Import mechanics

`web/tsconfig.json`:

```json
{ "compilerOptions": { "paths": { "@shared/*": ["../site/*"] }, "allowJs": true, "checkJs": false } }
```

`web/next.config.mjs`:

```js
import path from 'node:path';
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '/app';
export default {
  output: 'export',
  basePath: base,
  assetPrefix: base,
  trailingSlash: true,                     // emits /auction/index.html, which Pages serves
  images: { unoptimized: true },
  turbopack: { root: path.resolve(import.meta.dirname, '..') },   // lets ../site/ be imported
  outputFileTracingRoot: path.resolve(import.meta.dirname, '..'),
};
```

`turbopack.root` at the repository root is what stops Turbopack refusing files outside
`web/`. If the installed Next version names the option differently, the fallback is a
`webpack` build (`next build --webpack`) with `experimental.externalDir: true`; both are
documented, and whichever works first is pinned in `web/README.md`. This is one of the
20-minute problems from §1.3 and it is why step 1 exists as its own step.

`site/*.js` files are `.js` ESM with no types. `web/types/shared.d.ts` declares the
exported signatures (`phase`, `canSettle`, `recommendReserve`, and the `site/lib`
functions) so the app is typed at the boundary without touching the shared files.

### 7.2 The no-fork rule (test)

`test/js/no-fork.test.js`: walks `web/` (excluding `node_modules`, `.next`, `out`) and
fails if any file is named `phase.*`, `reserve-rule.*`, `queries.*`, `shape.*`,
`format.*`, `sources.*`, `heads.*`, `cast.*`, or if any `.ts/.tsx` file contains a
GraphQL operation (`/query\s+\w+\s*\(|\{\s*_meta\s*\{/`) or the substring
`commitEnd <=` / `revealEnd <=` (the phase comparison) outside an import of `@shared/`.
Crude and sufficient.

### 7.3 Provenance as a type, plus a check

```tsx
// web/components/provenance/Figure.tsx
type Src = 'test' | 'base' | 'chain' | 'cache' | 'snapshot' | 'rule' | 'sim' | 'config' | 'const';
export function Figure(props: { src: Src; detail: string; made: React.ReactNode; children: React.ReactNode }) { … }
```

Renders `<figure class="fig" data-src={src}>` with `<SourceTag/>` first and
`<figcaption class="made">` last. `made` is required and must begin with the literal
"What produced this:"; the component throws in development if it does not.

`test/js/web-provenance.test.js`: greps `web/components` and `web/app` for `<table`,
`<svg`, `className="stat"` and fails unless the file also imports `Figure` and the
occurrence is lexically inside a `<Figure` … `</Figure>` pair. Same idea as
`scripts/lint-provenance.mjs`, applied to TSX.

### 7.4 Token parity (test)

`test/js/tokens-parity.test.js`: extracts every `--name: value;` from the three token
blocks in `site/index.html` and from `web/app/tokens.css` and asserts the maps are equal,
with `--amber`/`--amber-soft` required in both. Fails the commit if one artifact's teal
drifts.

### 7.5 Vocabulary (test)

The ui-spec §9 grep (`HHI|market share|solver|concentration|USD|\$`, and `external`)
runs over `web/` too, with the same single permitted `$` in the `cast` line, which lives
in `site/lib/cast.js` and is therefore matched once.

---

## 8. Wallet

**Freeze:** none. The app is read-only, like the page. The `Connect wallet` button does
not render; `web/components/cta/WalletButton.tsx` exists only as a stub returning `null`
behind `NEXT_PUBLIC_WALLET=off` (the default).

**Post-freeze, in `web/` only:**

- Provider: `window.ethereum` (EIP-1193) through `viem`'s `custom()` transport. No
  injected-wallet discovery (EIP-6963) for now; if two wallets are installed the first
  wins and the button's `title` says which.
- Chain: Base `0x2105`. Wrong chain → `Switch to Base` per ui-spec 7.4;
  `wallet_switchEthereumChain`, then `wallet_addEthereumChain` on 4902 with
  `https://mainnet.base.org`.
- Writes: `commit`, `reveal`, `settle`, `claimBond`, `approve`. Each call is
  `simulateContract` (an `eth_call` of the exact calldata) **before** the wallet prompt;
  a revert here is decoded by selector against the Book ABI and shown without ever
  opening the wallet. Then `writeContract`, then `waitForTransactionReceipt`. The revert
  names (`CommitClosed`, `RevealClosed`, `RevealNotOpen`, `AlreadyCommitted`,
  `NoCommitment`, `AlreadyRevealed`, `BadReveal`, `BidOutOfRange(bps, reserveBps,
  maxBps)`, `AlreadySettled`, `WindowNotElapsed`, `NothingToClaim`, `NotSettled`) map to
  sentences in `cta-patterns.md` §7.
- `commitmentFor` is an `eth_call` (F-144: no keccak in the browser). Unchanged.
- The secret is written to `localStorage["glasshouse:bid:<auctionId>:<bidder>"]` **before**
  `writeContract` is called, and `Copy bid secret` is shown at the same instant. The ENS
  2017 lesson (ui-spec §4.2) is implemented as ordering, not as a warning.
- ABI source: `web/abi/GlasshouseBook.ts` is generated by `web/scripts/abi.mjs` from
  `subgraph/abis/GlasshouseBook.json`, which is already proven byte-identical to the
  deployed artifact (`subgraph/README.md`). A test asserts the four function selectors
  the app uses match the ABI.

Does decision W still hold? **Yes.** The reasons were about testers meeting a 120 s
window by appointment and a browser-held secret with a block deadline being the worst
thing to hand a stranger. Neither reason is about the framework. What changes is only
*where* the flow is built when it is built.

---

## 9. Deployment and the failure path

`.github/workflows/pages.yml`, two jobs, one artifact:

```yaml
name: pages
on: { push: { branches: [main] }, workflow_dispatch: {} }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  assemble:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Static page, copied verbatim            # never rewritten, never transformed
        run: mkdir -p dist && cp -r site/. dist/
      - name: Placeholder for /app/ in case the build fails
        run: |
          mkdir -p dist/app
          printf '<meta charset="utf-8"><title>Glasshouse</title><p style="font:16px IBM Plex Sans,sans-serif;padding:2rem">The live instrument did not build for this commit. The page is at <a href="../">/</a>.' > dist/app/index.html
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - name: Next.js export (allowed to fail)
        id: next
        continue-on-error: true
        working-directory: web
        env: { NEXT_PUBLIC_BASE_PATH: /Glasshouse/app, NEXT_PUBLIC_SUBGRAPH_URL: ${{ vars.SUBGRAPH_URL }} }
        run: npm ci && npm test --prefix .. -- test/js/ && npm run build
      - name: Place the export
        if: steps.next.outcome == 'success'
        run: rm -rf dist/app && cp -r web/out dist/app
      - run: touch dist/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: assemble
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

Properties that make FA-11 true:

1. `site/` is copied with `cp`. No minifier, no bundler, no template step, no rewrite of
   any path. What is in the repo is what is served at `/`.
2. The Next job has `continue-on-error: true` and runs **after** the copy. Its failure
   leaves the placeholder at `/app/index.html` and still deploys.
3. `web/` has its own lockfile and `npm ci`; a dependency resolution failure there
   cannot affect the root install, which the workflow never runs.
4. `test/js/` runs inside the Next step so that a shared-logic regression blocks `/app/`
   but not `/`. (It also runs in the root `npm test`, which is the developer's gate.)
5. The last-resort fallback needs no workflow at all: `site/index.html` opened from the
   repo, from `file://`, per ui-spec acceptance 4.

Local: `npm run dev --prefix web` serves the app at `http://localhost:3000/app/`; the
static page is served by `npx serve site` (or any static server) at another port, and the
app's back-links use `NEXT_PUBLIC_PAGE_URL` (default `../`) so they work in both places.

Vercel: allowed as a preview of `web/` (root directory `web`, framework preset Next.js,
`NEXT_PUBLIC_BASE_PATH=` empty). Not referenced by the README, the video, or the
submission form. If someone sets it up, it is a convenience, not a deployment.

---

## 10. Acceptance gates for the Next app

Additive to ui-spec §9, which stays the static page's gate. `/app/` is published only
when all of these pass; the workflow's placeholder handles the case where they do not.

1. `npm test` at root passes, including `no-fork`, `web-provenance`, `tokens-parity`,
   and the vocabulary grep over `web/`.
2. `next build` produces `web/out/` with exactly the routes in §3 and no `/_next/data`
   fetches at runtime (network panel, acceptance 9 of ui-spec applied to the app).
3. `/app/` with the network blocked shows the `cache` banner and tags; with site data
   cleared, the `snapshot` banner and tags. Same words as the static page.
4. Open `/` and `/app/auction/?id=<live>` side by side during a `run-auction.ts` run:
   both show the same phase, the same clearing price and the same `AS OF BLOCK` within
   one poll interval of each other, and never disagree about `running`/`final`.
5. The token-parity and provenance tests are green **and** a screenshot of S3 from each
   artifact, placed side by side, reads as one product (a human check; record it in
   `run.md`).
6. `prefers-reduced-motion` and both themes, as ui-spec §9 items 8 and 10.
7. Lighthouse accessibility ≥ 95 on `/app/` (every chip is text, every button has a
   name, focus is visible). Not a score to chase; a floor.

---

## 11. Migration order

Each step has an acceptance gate; a step is not started until the previous gate passes.
Nothing in any step edits `site/index.html` except step 0, which is the static page's
own ui-spec work and is listed only to show the dependency.

| Step | What | Hours | Gate | Earliest |
|---|---|---|---|---|
| 0 | **Static page Tier 1 and 2 per ui-spec §8.** Extract `site/lib/*.js` while doing it (queries, shape, format, sources, heads, cast) with tests. This is the static page's own work, done in a way that makes step 1 possible. | in the 13.75 already budgeted, +1 for the extraction | ui-spec §9 acceptance 1–10 | Tue 09 – Wed 12:00 |
| 1 | **Scaffold `web/`:** Next pinned, `output: 'export'`, `basePath`, tokens + fonts, `Figure`/`SourceTag`/`Made`, `@shared` imports proven by rendering `phase()` of a hard-coded auction, the four tests of §7, the Pages workflow. | 1.5 | §10 gates 1–2; the workflow deploys `/` unchanged and `/app/` shows the masthead and a tagged empty figure | Wed 12:00 if the un-cut trigger fires; else Thu 11 |
| 2 | **S3 Auction view** (`/app/auction/?id=`): store, RPC head, bands 1–3, receipt shell. The screen the wallet flow will attach to, so it goes first. | 2.5 | §10 gate 4 during a live run | after 1 |
| 3 | **S2 Live auctions** (`/app/`): table, phase chips, row → S3 link, `BroadcastChannel` sharing, 300 s idle interval. | 1 | gate 3 and 4; both artifacts' S2 agree | after 2 |
| 4 | **S4 Receipt** inside S3. | 1 | receipt fields equal the static page's for the same auction | after 2 |
| 5 | **S5 Reserve control** (`/app/next/`). | 1 | `bps`, band and reason equal the static page's and the advisor's on the same head (subgraph-design §12 test 4, now three-way) | after 3 |
| — | **Point at which `/app/` is worth linking from the static page's section nav:** after 3. Before that the app is a preview, not a product. | | | |
| 6 | **Wallet band** 7.4–7.9 in `web/` per `cta-patterns.md`. | 5–6 | `cta-patterns.md` §8 acceptance; a full commit → reveal → settle from a browser on a live auction with `bond = 0`, then once with `bond > 0` from a team wallet | post-freeze; not before Tier 1+2 and steps 1–3 |
| 7 | **Argument tier as MDX** (`/app/argument/`): S0, S1, S6 ported. Optional. | 3 | side-by-side reads identical; provenance test covers MDX | post-event |
| 8 | **Retirement of `site/index.html`.** Only if step 7 is done **and** the team decides `file://` rendering (ui-spec acceptance 4) is no longer a requirement, and the README's "open the page locally" instruction is rewritten. Until both, the static page is the front door. | — | — | assume never before submission; probably never |

What moves first and why: S3, because it is the screen React was bought for (the wallet
flow attaches to it) and because it is the screen where hand-written DOM is most likely to
be wrong. What stays static: the argument, the comparison, the lens, the limits — the
document tier — because they are already right, need no script, and are the parts a judge
opens cold. What is shared and never forked: everything in `site/lib/`, `site/phase.js`,
`site/reserve-rule.js`, `site/data/snapshot.js`, enforced by §7.2.

---

## 12. File and folder layout

```
site/                          the static page — never rewritten by any tool
  index.html                   S0–S7; imports app.js as a module (ui-spec §5.4)
  app.js                       DOM rendering over site/lib; no logic of its own
  phase.js                     unchanged
  reserve-rule.js              unchanged
  lib/
    queries.js  sources.js  heads.js  shape.js  format.js  cast.js
  data/snapshot.js             produced by scripts/reserve-advisor.mjs --snapshot

web/                           the Next.js instrument — its own package
  package.json  package-lock.json  next.config.mjs  tsconfig.json  README.md
  app/
    layout.tsx                 fonts (next/font), tokens.css, globals.css, <Masthead compact/>, <DataBanner/>, <Footer/>
    page.tsx                   S2 shell → <LiveAuctions/>
    auction/page.tsx           S3+S4 shell → <Suspense><AuctionView/></Suspense>
    next/page.tsx              S5 shell → <ReservePanel/>
    tokens.css  globals.css
  components/
    chrome/     Masthead.tsx  SectionNav.tsx  Footer.tsx  Legend.tsx  DataBanner.tsx
    provenance/ Figure.tsx  SourceTag.tsx  Made.tsx  SrcInline.tsx  (+ .module.css)
    chain/      Address.tsx  BlockNumber.tsx  TxLink.tsx  Deadline.tsx  ProvenanceChip.tsx
    auction/    LiveAuctions.tsx  AuctionRow.tsx  PhaseChip.tsx
                AuctionView.tsx  PhaseTrack.tsx  PhaseCell.tsx  BidCard.tsx  StatLine.tsx  Timeline.tsx  Receipt.tsx
    reserve/    ReservePanel.tsx  CastLine.tsx
    cta/        CopyButton.tsx  ExplorerLink.tsx  PauseResume.tsx
                TxButton.tsx  WalletButton.tsx  BondApprove.tsx  PlaceSealedBid.tsx  Reveal.tsx  Settle.tsx  ClaimBond.tsx
                SealedBidsStrip.tsx  BidSecret.tsx          (cta/ beyond the first three are step 6)
  lib/
    store.ts                   polling store (§5.2)
    rpc.ts                     eth_blockNumber (§5.3)
    snapshot.ts                adapter over window.GLASSHOUSE_SNAPSHOT
    wallet.ts                  viem clients, chain switch, revert decoding (step 6)
  abi/GlasshouseBook.ts        generated from subgraph/abis/GlasshouseBook.json (step 6)
  types/shared.d.ts            signatures for @shared/* imports
  scripts/abi.mjs

test/js/
  phase.test.js  reserve-rule.test.js  reserve-advisor.test.js      (exist)
  queries.test.js  sources.test.js  heads.test.js  shape.test.js  format.test.js  cast.test.js   (step 0)
  no-fork.test.js  web-provenance.test.js  tokens-parity.test.js  vocabulary.test.js           (step 1)

.github/workflows/pages.yml    §9
scripts/lint-provenance.mjs    unchanged; static page only
```

---

## 13. Component tree (S3, the first screen)

```
<RootLayout>                                   server
  <Masthead compact>                           server — opcode strip, link "the argument ↗" to ../#argument
  <SectionNav>                                 server — live auctions · auction · next auction · the argument ↗
  <DataBanner/>                                client — cache/snapshot banner from the store (ui-spec §3.5 rule 3)
  <AuctionPage>                                server shell
    <Suspense>
      <AuctionView>                            client — reads ?id, subscribes store('auction:'+id) and rpc head
        <Figure src={src} detail=`AS OF BLOCK ${Hi} · ${rel}` made={…}>
          <HeadLine Hi Hc lag paused/>         client — "as of block N · 8 s ago", blink-once dot, "indexer 5 behind", paused
          <PhaseTrack a head>                  client — four <PhaseCell/> from phase(a, Hi); countdown from max(Hi,Hc)
            <PhaseCell name range state>       progress bar 2px; dashed "collapses if nobody reveals"; settled ✓ on open
          <BidCards bids you>                  client — <BidCard sealed|revealed|unrevealed/> in commitIdx order
            <BidCard>                          hatch → bps cross-fade; <Address/><ProvenanceChip/>; "← sets the price"
          <StatLine a phase>                   client — clearing · running/final/settled ✓ · margin · competition · reserve/max/bond
          <Timeline events>                    client — mono list, <TxLink/> per row
          <Made>                               the "What produced this" sentence, constant text + deployment id
        </Figure>
        <Receipt a> (if settled || filled)     client — <Figure src="base"> with a const mini-tag on the pair cell
        <WalletBand a>  (step 6, NEXT_PUBLIC_WALLET=on)
          <SealedBidsStrip/> <WalletButton/> <BondApprove/> <PlaceSealedBid/> <Reveal/> <Settle/> <ClaimBond/> <BidSecret/>
      </Suspense>
  <Footer>                                     server — the two subgraph lines, links, GitHub
```

Props flow down from one `shapeAuctionView(a, head)` call in `AuctionView`; children
receive plain objects and never touch the store. That single call is what guarantees the
page and the app cannot compute a different phase for the same head.

---

## 14. Things an implementer might otherwise guess

- **Do not** add a `web/` script to the root `package.json`. The root `npm test` finds
  `test/js/*.test.js` already; the new tests need no registration.
- **Do not** put anything under `web/public/` that duplicates `site/`. The app links to
  the static page; it does not carry a copy.
- **Do not** `fetch` in a Server Component. There is no server, and a build-time fetch
  bakes data (F-80).
- `BigInt` everywhere a block number is compared (`site/phase.js` already normalises).
  Render with `fmtInt(Number(n))` only for display; never `Number()` before comparing.
- The `_meta` block is on **every** query. The store rejects a response without it.
- The word `external` does not appear in `web/`. `UNKNOWN` renders as `UNLISTED` via
  `provenanceLabel` and nowhere else.
- Sentence case for every label. Mono for every value that came from a machine.
  Newsreader never inside a figure.
- If Next's static export complains about `useSearchParams`, the fix is the `<Suspense>`
  boundary, not `dynamic = 'force-dynamic'` (which would silently need a server).
- If `turbopack.root` is not accepted by the pinned version, use `next build --webpack`
  with `experimental.externalDir: true`. Record which in `web/README.md`. Do not copy
  `site/*.js` into `web/` to make the error go away; §7.2 will fail the commit.
