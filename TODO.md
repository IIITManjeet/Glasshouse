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

- [ ] **Demonstration bidders render as strangers.** `TEAM_ADDRESSES`
      (`subgraph/src/provenance.ts:19`) lists only the maker. The ephemeral bidders
      `scripts/run-live-fill.ts` generates and funds — winner and rival — are not in it, so
      they resolve to `UNKNOWN` on the contested round that carries this project's headline
      claim, with no chip distinguishing them from a real stranger. Nothing is hidden — the
      funding transactions are on chain — but the asymmetry is real. Not fixable without a
      subgraph republish and reindex, since `provenance.ts` is mapping code; until then the
      disclosure is spoken rather than rendered. After the deadline: add both addresses to
      `TEAM_ADDRESSES`, republish, and they carry a `TEAM` chip like the maker does.

- [ ] **Spacing-scale leftovers.** From the spacing review, none are defects: collapse
      vertical rhythm to `2/3/4/6/8/12/16` (sixteen distinct steps are currently in use, and
      section→section spacing is a different value on every route); move `/rounds`'s one
      primary button out of `.card-foot`, where it sits inside a 13px caption strip; move
      the wallet bar on `/` into the bid-panel column so "who am I" sits above "place a bid"
      instead of reading as masthead furniture.

- [ ] **`.nowrap-token` is a dead primitive.** Declared in `web/app/globals.css` with zero
      call sites anywhere in `web/`. Either remove it or use it for whatever it was reserved
      for.

- [ ] **The keeper can stall if more than one process runs against the same state file.**
      `scripts/keeper.ts` reads `.keeper-state.json` (or `.keeper-state.dryrun.json` under
      `DRY_RUN`) once at start and writes it back after each step, with no lock. Two keeper
      processes started against the same network race that read/write: both can act on the
      same `nextRound`, the second hits Aqua's duplicate-strategy revert on a round the
      first already shipped, and whichever process writes last silently overwrites the
      other's progress in the cursor. Only one keeper process should ever be pointed at a
      given network at a time; nothing currently enforces that.

- [ ] **`NEXT_PUBLIC_RPC_URL` is unset on the deployed site.** Every visitor reads
      `mainnet.base.org` from their own IP and can be rate limited. Setting it removes that
      risk but also disables `web/lib/chain.ts`'s fallback pool, since a caller-chosen
      endpoint is honoured exactly rather than substituted. See `DEPLOY.md`.

- [ ] **`DECISIONS.md` still has blank `[ ] In your words` lines.** Deliberately left for
      the developer's own voice — see the note at the top of that file. Not something a
      documentation pass fills in.
