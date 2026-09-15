# TODO

Working checklist. Kept in the repo rather than in someone's head, because things were
being dropped between sessions.

Convention: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked, with what on.
Findings referenced as F-n live in `DESIGN.md`.

The full session-by-session history — the frontend restructure, the keeper's mainnet runs,
the bonded round, the second-price claim, every fixed defect — moved to
[`docs/archive/TODO-history-2026-09.md`](./docs/archive/TODO-history-2026-09.md) once it
was done. This file keeps only what is still open.

---

## Status at submission (2026-09-13)

The instrument is reachable at the URL in `DEPLOY.md`. A round can be opened, bid in,
revealed and settled from the browser by anyone, not only from a terminal
(`GlasshouseBook.open()` has no access control). `scripts/verify-run.mjs` reported
**8 passed / 0 failed / 0 not applicable** the last time it was run and re-emitted — every
check it knows how to make has something real to make it against; see `/evidence` for the
current snapshot rather than a number repeated here, since the keeper keeps adding rounds
and a count typed into this file goes stale the next time it runs.

Deliberately still 0.x: contracts are unaudited, the subgraph's index is thin, orders are
dust-sized, and the bond on ordinary rounds is 0. Full detail in `CHANGELOG.md`'s
[0.9.0] entry.

## Open

- [x] **Demonstration bidders render as strangers.** `TEAM_ADDRESSES`
      (`subgraph/src/provenance.ts`) listed only the maker. The ephemeral bidders
      `scripts/run-live-fill.ts` generated and funded — winner and rival — resolved to
      `UNKNOWN` on the contested round that carries this project's headline claim. Their
      keys never touched the repo (ephemeral, swept, gitignored), so the two addresses were
      recovered from `site/data/snapshot.js` — built straight from `GlasshouseBook`'s own
      on-chain logs — and matched by amountIn/amountOut/bps against `run-live-fill.ts`'s own
      constants. Both are now in `TEAM_ADDRESSES`, with a comment citing the evidence; a
      subgraph republish and reindex (not done here — v2 handles that) is what makes the
      `TEAM` chip actually render.

- [x] **Spacing-scale leftovers.** From the spacing review, none were defects. Checked all
      three: `/rounds`'s primary button was already out of `.card-foot` (see `OpenNow.tsx`'s
      own comment); every `mt-`/`mb-`/`gap-y-`/`space-y-` value in `web/app` and
      `web/components` was already on the `2/3/4/6/8/12/16` scale, apart from icon-baseline
      nudges (`mt-0.5`, `mt-1.5`) that are optical alignment, not vertical rhythm, and were
      left alone; the wallet bar on `/` now sits in the bid-panel column, above `<BidPanel>`,
      instead of under the `h1` on every state of the page.

- [x] **`.nowrap-token` is a dead primitive.** Declared in `web/app/globals.css` with zero
      call sites anywhere in `web/`. Removed; `th`, `.tnum` and `.chip` still carry the
      exemption it sat alongside.

- [x] **The keeper can stall if more than one process runs against the same state file.**
      `scripts/keeper.ts` reads `.keeper-state.json` (or `.keeper-state.dryrun.json` under
      `DRY_RUN`) once at start and writes it back after each step. `scripts/lib/state-lock.ts`
      now takes an exclusive lock (`<state file>.lock`, PID inside) before the state file is
      ever read: a second keeper against the same file refuses to start, naming the lock file
      and the PID holding it; a lock left by a dead process is detected via
      `process.kill(pid, 0)` and safely stolen; the state file itself is now written
      atomically (temp file + rename). Tested in `test/js/state-lock.test.js`.

- [ ] **`NEXT_PUBLIC_RPC_URL` is unset on the deployed site.** Every visitor reads
      `mainnet.base.org` from their own IP and can be rate limited. Setting it removes that
      risk but also disables `web/lib/chain.ts`'s fallback pool, since a caller-chosen
      endpoint is honoured exactly rather than substituted. See `DEPLOY.md`.

- [ ] **`DECISIONS.md` still has blank `[ ] In your words` lines.** Deliberately left for
      the developer's own voice — see the note at the top of that file. Not something a
      documentation pass fills in.
