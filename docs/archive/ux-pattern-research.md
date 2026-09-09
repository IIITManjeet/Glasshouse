# ux-pattern-research.md — interaction patterns for a live sealed-bid auction

> **Status:** research, 2026-09-08. Answers the seven questions in the brief. This file is
> about **flows and mechanisms** — what happens across time, across tabs, across a browser
> being closed — not about button labels or visual styling. `cta-patterns.md` already
> covers labels, ladders and the per-revert sentence in exhaustive detail; where this file
> and that one overlap, this file says so and defers. Where this file's research pulls in
> a different direction than a decision already made in `cta-patterns.md`, it is called out
> explicitly in §0.2, not silently.
>
> Read `cta-patterns.md` first. It already contains: the reveal-deadline answer (its §5),
> the wallet-connect ladder (§4.5), the full revert vocabulary (§7), and the walk-away
> matrix (§6). This file does not repeat those tables. It asks a narrower question of each:
> *is there a mechanism the survey missed, and does the chosen mechanism hold up against
> what other products actually do when the stakes are "you lose money for doing nothing"?*

---

## 0.1 What was searched, and how to read the citations

Every claim below cites what was actually read. Three tiers, marked inline:

- **Primary** — official docs, help centers, source code, or an org's own blog
  (`support.arbitrum.io`, `nngroup.com`, `github.com/nounsDAO/…`, `ebay.com/help`).
- **Secondary, corroborated** — a content-marketing blog whose claim matches what a
  primary source elsewhere confirms (used only to fill in copy examples primary sources
  didn't quote).
- **Unreachable / unverified** — searched, not found in a form worth citing as evidence.
  Listed in §8.2. Not used to justify a decision.

## 0.2 Where this file disagrees with, or adds to, `cta-patterns.md`

Three places, stated up front so they aren't buried:

1. **The Notification API.** `cta-patterns.md` §5 says flatly "no browser Notifications
   API." The research in §1 below supports the *reasoning* (a permission prompt on load,
   to a stranger, is worse than the risk it mitigates) but not the *conclusion* as stated.
   Etherscan's own "Notify me when this block is produced" — already cited in
   `cta-patterns.md` §1.1 as the precedent for the tab-title countdown — **is** a
   click-triggered Notification API call, not a tab-title trick. The distinction that
   matters is *automatic* vs. *opt-in-by-click*, not *notification* vs. *no notification*.
   I recommend narrowing the rule to "no notification prompt the user did not click for,"
   and adding a one-click `🔔 Notify me when reveal opens` next to `Copy bid secret`. See
   §1, mechanism 3.
2. **Deadline extension.** The brief asks about this mechanism by name; `cta-patterns.md`
   doesn't mention it at all. I looked (Nouns, eBay) and recommend **against** it for the
   reveal window, but for a reason worth recording rather than assuming: extension-on-
   activity (what Nouns and eBay do) protects a *different* failure mode than ours. See
   §1, mechanism 8.
3. **Forgiveness.** Also asked for by name, also absent from `cta-patterns.md`. The
   closest real product (domain-registrar redemption grace periods) turns out to be
   informative mainly for *why it can't transfer here* — it's a business-rule change a
   registrar can grant from its own database; a bond forfeiture in Glasshouse is enforced
   by immutable contract logic the frontend has no authority over. Worth one paragraph so
   nobody re-proposes a UI-only "grace period" later. See §1, mechanism 9.

Nothing else here contradicts `cta-patterns.md`; most of what follows corroborates
decisions already made there, from different products than its survey used.

---

## 1. The reveal problem: every mechanism found, and the recommendation

The brief's hard problem restated: a deadline measured in blocks, and a secret the
browser must hold between two transactions, on a page with **no accounts and no
backend** — so nothing can be sent to the user, only shown to them, and only while some
tab of theirs is open.

### 1.1 The mechanisms, one by one

**1. Tab-title countdown.** Overwrite `document.title` with the remaining time/blocks —
`(6 blocks) Reveal opens · Glasshouse`. Primary source: a working implementation pattern
(`useTitle` hook keyed off a countdown value) documented at
[dev.to: Browser Tab UX in React](https://dev.to/childrentime/browser-tab-ux-in-react-pull-users-back-with-titles-favicons-and-notifications-m94).
Precedent for the *idea* (not the exact mechanism) is Etherscan's block-countdown page,
already cited in `cta-patterns.md` §1.1. **Works** — every browser renders the tab title
whether or not the tab is focused, and it costs nothing. **No-backend-safe** — pure
client-side `setInterval` writing a string. **The gap, stated precisely against the
brief's own two examples:** it does nothing if the user *closed the tab* (no JS runs,
nothing to overwrite) and does nothing reliable if *the laptop slept* (timers do not
fire while suspended; the title is stale until the OS wakes and the page's own poll
catches up, which for a 60–120 s window may be the whole window). It only defends
against the third failure mode named in the brief — forgetting while the tab stays open
in the background. This is real value, but it is not "the answer"; it is one layer.
Already adopted in `cta-patterns.md` §5. **Endorsed, unchanged.**

**2. Favicon countdown.** The same idea one level down: swap the 16×16 favicon to encode
state (a filled ring, a color) so status is visible even when many tabs are open and the
title is truncated to a few characters. Primary source:
[Favitimer](https://www.favitimer.com/) and its author's write-up,
[What I learned building Favitimer](https://www.timetler.com/2015/11/21/favitimer/),
which is exactly "a countdown timer in your browser favicon." **Works**, same
no-backend profile as #1, same gap. **Not currently in `cta-patterns.md` — recommended
as a cheap addition**, not a replacement: three pre-rendered favicon states (`sealed`,
`urgent` at ≤10 blocks, `closed`) swapped alongside the title text costs under an hour
and helps exactly the tester who has Glasshouse as tab #14.

**3. Browser Notifications API, opt-in only.** Fires an OS-level notification even if
the browser is in the background (not the foreground app), as long as the tab is still
open and the permission was granted. Primary source, and the reason the distinction in
§0.2 matters: the same dev.to article states the rule plainly — *"Never call
`Notification.requestPermission()` on page load"* — and that permission must be
requested "only from explicit user interaction (button clicks)." Etherscan's own
`Notify me when this block is produced` is this pattern, click-triggered, on a page
strangers land on with no account either. **Works, with a precise limit worth stating
honestly:** background tabs are throttled but do still run timers (usually at least
once a minute), so a *backgrounded* tab can still notify; a *closed* tab cannot — no JS,
no permission, nothing fires. **No-backend-safe** — no server, no push subscription,
just `Notification.requestPermission()` and `new Notification(...)` from a page script.
**Recommendation:** add `🔔 Notify me when reveal opens`, a plain button beside `Copy bid
secret` (`cta-patterns.md` §4.13), never invoked automatically, never re-asked once
denied. This closes part of the gap #1 and #2 leave open (switched apps, not closed
tab) without the "prompt on arrival" problem `cta-patterns.md` is right to avoid.

**4. Email.** Requires an account or at least an email capture, and a backend to send
from. **Does not apply** — confirmed unavailable, not merely undesirable, for a page
with no accounts. None of the products surveyed for `cta-patterns.md` (ENS v3, Blur,
Gnosis) use it for the analogous step either, which is corroborating, not just
convenient.

**5. A persistent banner/strip on every route.** The single highest-leverage mechanism,
because unlike #1–#3 it doesn't need the tab to stay open or focused — it only needs
the browser to be reopened *at all*, on any route, reading from `localStorage`.
Precedent: Safe's transaction queue and CoW's "your orders" list (both already cited in
`cta-patterns.md` §2.3/§4.5); corroborated by a second product,
[Argent's multisig queue docs](https://support.argent.xyz/hc/en-us/articles/19485184697245-Transaction-queue-and-rejecting-transactions-on-your-Multisig),
which describes the same shape — a pending item stays visible across the app "until
other parties sign," not just on the screen where it was created. Already adopted as
`SealedBidsStrip` in `cta-patterns.md` §5.2. **Endorsed, unchanged** — this is the
mechanism to lean on hardest, because it is the only one immune to the tab-closed
failure mode (once reopened).

**6. Storing the secret somewhere recoverable.** Write the salt to `localStorage`
*before* sending the commit tx, and offer it as a copyable/exportable value. This is
literally the lesson of the closest real precedent to Glasshouse's exact problem: the
[ENS 2017 registrar's own instructions](https://veox-ens.readthedocs.io/en/latest/userguide.html)
(already the centerpiece of `cta-patterns.md`'s §5) told bidders to "store your salt in
a safe place" — advice given because the interface did not do it for them, and
documented forfeitures followed. Already adopted as `Copy bid secret` / `Enter secret`
(`cta-patterns.md` §4.13). **Endorsed, unchanged** — this is the mechanism that turns a
closed tab from data loss into inconvenience, and it's the only one of the nine that
solves the "closed the tab" case rather than merely warning about it.

**7. Auto-execution / a relayer that reveals for you.** A keeper holding bidders' salts
and submitting `reveal()` on their behalf close to the deadline. Rejected already in
`cta-patterns.md` §5 as needing infrastructure the project doesn't have. Worth
strengthening the reasoning, not just repeating it: this isn't only a missing-backend
problem, it's a **trust regression in a product whose whole premise is not trusting an
intermediary** — a relayer holding a bidder's bps+salt can front-run the reveal it was
trusted to make, and a relayer holding a signing key to submit on the bidder's behalf is
custodial. The "removed the auctioneer" pitch (`DESIGN.md`, referenced by
`cta-patterns.md` §1.1's Gnosis row) is undercut by reintroducing an auctioneer-shaped
relayer at the one step that decides who wins. **No-backend alternative:** none needed —
this mechanism should stay rejected on trust grounds even if a backend existed.

**8. Deadline extension** (the brief names this explicitly). The real pattern, verified
in source: Nouns DAO's `NounsAuctionHouse.sol`
([github.com/nounsDAO/nouns-monorepo](https://github.com/nounsDAO/nouns-monorepo/blob/master/packages/nouns-contracts/contracts/NounsAuctionHouse.sol))
has a `timeBuffer` — when a bid lands within `timeBuffer` of the auction's end, the
contract itself pushes `endTime` out to `block.timestamp + timeBuffer`. eBay bidders and
sellers report the same shape happening on eBay in forum threads (**secondary,
unverified** — a community-forum claim about a 2026 test, not eBay's own docs; treated
as unconfirmed, see §8.2). **Why it doesn't transfer to our reveal deadline, precisely:**
both real examples extend the deadline *because a bidder just acted* (a bid arrived) —
the extension protects other bidders' chance to respond to new information. Our failure
mode is the opposite shape: a bidder who does **not** act. Extending `revealEnd` because
nobody revealed does not give the missing bidder new information to react to; it only
delays the exclusive-fill window for the bidder who *did* reveal correctly, to buy time
for one who may never come back regardless. It would also require the contract to
recompute a stored `revealEnd`, which is a state-machine change, not a UI one.
**Recommendation: do not build this.** Recorded here so the idea, once it's raised (it
will be — "why not just give them a few more blocks?"), has a specific, considered
answer rather than a re-litigated one.

**9. Forgiveness mechanisms.** The real analogue is domain-name redemption: after a
domain lapses, ICANN policy requires registrars to run it through an "auto-renew grace
period" (≈45 days) and then a "redemption grace period" (≈30 days) before deletion,
recoverable for a restoration fee —
[ICANN, "About Redeeming a Domain Name in Redemption Grace Period"](https://www.icann.org/resources/pages/grace-2013-05-03-en),
corroborated by
[Namecheap's own KB article](https://www.namecheap.com/support/knowledgebase/article.aspx/242/2207/what-is-the-domain-redemption-grace-period/).
**Why this doesn't transfer, and the point worth recording:** a registrar can grant a
grace period because the registrar's own database decides what "expired" means and can
choose to honor a late renewal, for a fee it sets. Glasshouse's `revealEnd` is enforced
by `GlasshouseBook.sol` on chain; the frontend has no more authority to grant a reveal
past that block than a browser tab has authority to un-expire an eBay auction. A
UI-only "grace period" is not a real option — either the contract admits late reveals
(a mechanism-design change that weakens the incentive the bond exists to create, since
"reveal late if you feel like it, forfeit only if you never show up at all" is a softer
promise than the one the bond currently makes) or there is no grace period. **Not a UI
decision; flag to whoever owns the contract, do not attempt to fake it in the frontend.**

### 1.2 The recommendation, restated against the research

`cta-patterns.md` §5's five-part answer (page-stays-a-step, persistent strip, secret
stored before the risk, never-disable-while-revealable, reconcile-on-return) is, after
this survey, **still the right shape** — mechanisms #5 and #6 above are the only two
that survive a closed tab, and they are exactly the two the existing design leans on
hardest. The two changes this file recommends are additive, not structural:

1. Add the favicon swap (#2) alongside the tab-title countdown — near-zero cost, same
   no-backend profile, helps the many-open-tabs case the title alone can't.
2. Soften "no Notifications API" to "no *automatic* Notifications API," and add one
   click-triggered `🔔 Notify me` button (#3) that degrades to nothing if denied or
   unsupported. This is the one mechanism in the whole list that can reach a user who
   has switched away from the tab but not closed it — a real, common, distinct failure
   mode from either "never came back" or "closed it entirely."

Both are additions to `cta-patterns.md` §5, not replacements of anything in it.

---

## 2. Losing money by inaction: honest copy, and the honest way to say "we can't guarantee a reminder"

**Real copy found, honest end of the spectrum:**

- ENS 2017's own instructions (already `cta-patterns.md`'s centerpiece):
  *"If you don't reveal your bid by the time the auction ends, your deposit is forfeit —
  so make sure you store your salt in a safe place, and come back before the auction
  ends in order to reveal your bid."* — [veox-ens.readthedocs.io](https://veox-ens.readthedocs.io/en/latest/userguide.html).
  States the consequence first, in plain words, then the two things the user must do.
  No hedge, no exclamation mark.
- Aave's checkbox, already adopted in `cta-patterns.md` §4.7: *"I understand: if I do not
  reveal before block N the bond is forfeitable."* — source in `cta-patterns.md` §1.1.
  Notice the shape: consequence, then condition, in that order, first person
  acknowledgement rather than second-person warning — it reads as the user affirming a
  fact rather than the product scolding them.
- OTP countdown copy, a graduated-urgency pattern rather than a single warning: *"Code
  expires in 9:42"* ticking down, color shifting to amber under the last minute — a
  documented implementation pattern at
  [OTP-UX gist](https://gist.github.com/ccloudorarestro-hue/a1ee28552462f5a58c8fec017202b07a),
  corroborated by general guidance at
  [mojoauth.com, OTP Expiration & Retry Policies](https://mojoauth.com/ciam-qna/best-practices-otp-expiration-retry-policies) —
  the number itself, ticking, is the honest device; color is a reinforcement, not a
  substitute for the number.

**What over-promising looks like, and why to avoid it:** ICANN requires registrars to
send three separate expiry reminders — about a month before, a week before, and within
five days after —
([icann.org, renewal/expiration FAQs](https://www.icann.org/resources/pages/domain-name-renewal-expiration-faqs-2018-12-07-en)) —
and domains still lapse into redemption at scale regardless. This is useful precisely
because it's a case where a product *with* email, accounts, and three scheduled
reminders still can't guarantee attention. Glasshouse has none of those channels. Saying
anything that implies it will remind the user (a checkbox reading "I'll be reminded," a
button that promises a notification without checking permission state) would be a
promise the page cannot keep. The honest framing is to state the mechanism's actual
limits, not its intent:

> *This page counts down for you, but only while this tab stays open. There is no
> account, no email, and no notification unless you turn one on below. If you might
> close this tab before reveal, copy your bid secret first — you can reveal from any
> browser with it.*

This differs from `cta-patterns.md`'s current checkbox line only by making the *absence*
of a backend explicit rather than implied — the ENS-2017 line names the consequence and
the remedy; this adds the one sentence ENS 2017 didn't have to say, because a hackathon
static page's honesty budget includes admitting what it cannot do. Recommend adding it
as the sentence directly under the checkbox in `cta-patterns.md` §4.7, not replacing the
checkbox itself.

**What alarmism looks like, to avoid it too:** none of the sources above use capitals,
exclamation marks, or countdown-red before it's actually urgent — the OTP pattern only
turns amber in the last 60 seconds, not from the start, and `cta-patterns.md` §4.8
already follows this shape (`--brick` only at ≤10 blocks, plain text before that). This
is corroboration, not a change.

---

## 3. Onboarding a first-time bidder

**The established, citable principle: teach at the point of need, not before it.**
Nielsen Norman Group's research on onboarding is unambiguous and directly on point —
*"push revelations"* (tutorials, walkthroughs, coach-mark tours shown up front) *"tend to
interrupt the user in the process of trying to accomplish a goal... they don't tend to
be memorable, and they also don't result in better task performance"* —
[nngroup.com, Onboarding Tutorials vs. Contextual Help](https://www.nngroup.com/articles/onboarding-tutorials/).
The same organization's separate study of coach marks specifically found users skipping
them and, more tellingly, that people who *read* tutorials before using a product rated
ease-of-use *lower* (4.92) than people who skipped straight to using it (5.49) —
[nngroup.com, Mobile Tutorials: Wasted Effort or Efficiency Boost?](https://www.nngroup.com/articles/mobile-tutorials/)
(cited via the coach-marks survey). NN/g's prescription is **"pull revelations"** — help
triggered by a signal that the user is about to need it, shown beside the control it
explains, dismissible and re-findable, using progressive disclosure so nothing is
explained before it's relevant.

**What "minimum understanding" means for Glasshouse, stated as five facts, ranked by
what happens if the user doesn't know it:**

1. **A commit forfeits the bond if not followed by a reveal** (only if `bond > 0`) — the
   one fact where not knowing costs money. Highest priority; belongs on the control that
   creates the risk, not before it (Aave's checkbox is exactly this: shown once, at the
   moment of the costly click, not in a tutorial three screens earlier).
2. **There are two required transactions, with a countdown starting after the first** —
   costs nothing to misunderstand except surprise; belongs on the stepper as a whole
   before either button is live, which is what the ENS v3 numbered-step model already
   does (`cta-patterns.md` §1.1/§3).
3. **The bid is hidden, not just "pending"** — costs nothing to misunderstand, but is
   the thing a first-time user's intuition gets wrong (a "pending" spinner reads as "the
   system is doing something," not "nobody, including a re-loaded page, can see your
   number"). Belongs on the sealed card itself, which `cta-patterns.md` §4.2 already
   states in the card's own label (`sealed`, hatched, not `pending`).
4. **The number is bps within a stated range** — a UI-domain fact, already handled by
   the always-visible range line (`cta-patterns.md` §4.7).
5. **The secret is saved in this browser and should be exported if the user might
   switch devices** — costs money only combined with fact 1; already the `Copy bid
   secret` affordance.

**How the best products teach these in-flow rather than up front, concretely:** Wise's
onboarding — cited in a secondary source,
[themasterly.com, Fintech Onboarding UX: Stripe, Wise & Revolut Lessons](https://www.themasterly.com/blog/fintech-onboarding-ux),
which specifically credits Wise's *unauthenticated fee calculator* as the pattern of
"showing core value before asking for anything" — is the closest fintech analogue to
what Glasshouse's static argument page (`ui-spec.md` S0/S1/S6) already does structurally:
the comparison table and the latency lens **are** the fee calculator — they show, with a
concrete worked number, why sealed-bid beats the alternative, before any wallet is
connected or any bid is placed. That is already "show value before asking," just for a
mechanism instead of a fee. **This is a genuine strength already in place and worth
naming as such**, not a gap.

For the five facts above, the existing design already follows the "pull revelation"
principle for four of five (2 through 5, all shown at the control, not before it). Fact
1, the one where not knowing costs money, is currently a checkbox users can, per NN/g's
own confirmation-dialog research already cited in `cta-patterns.md` §1.1, tick without
reading. **Recommendation, additive to `cta-patterns.md` §4.7:** keep the checkbox
(NN/g's guidance is to use one sparingly, for exactly this kind of action, which
`cta-patterns.md` already does correctly) but do not rely on it alone — the sealed
card's own label, after commit succeeds, should restate the deadline
(`Sealed · #2 · reveal opens at block N`, already planned) so the fact reappears at the
next point of need rather than only at the moment it was ticked past.

**What Glasshouse should not build:** a modal walkthrough, a "step 1 of 4" product tour,
or a "welcome, here's how sealed-bid auctions work" interstitial before the argument
page even loads — NN/g's research above is a direct citation against exactly this shape,
and it would also contradict `ui-spec.md`'s own decision (§1, decision N/DL) that the
argument page *is* the explainer, read at the reader's pace, not gated behind a click.

---

## 4. Empty and waiting states: the gap between auctions

The product-specific brief: a keeper opens a fresh auction every few minutes; a visitor
may land in the gap between auctions with nothing live to show.

**The two research threads that matter here, both primary:**

**Virtual queues.** NN/g's dedicated study of waiting-room UX (Disney, ticket sales,
retail drops) gives four transferable rules, quoted directly from the fetched article —
[nngroup.com, Virtual Queue Best Practices](https://www.nngroup.com/articles/virtual-queue-best-practices/):

- *Automatic transition, no manual refresh:* Disney's own copy, quoted in the article —
  *"When the sale begins, your screen will automatically refresh and you will be moved
  into the Queue."* Translated to Glasshouse: the moment the keeper opens the next
  auction, the page (already polling per `ui-spec.md` §5.3) should move the visitor into
  S3 without a click, the way S2's row-click already does for an existing auction.
- *State the actual stakes of leaving, not a generic warning:* the article contrasts a
  retailer that told users they *could* close the tab without losing their place against
  ones that didn't say either way — ambiguity is worse than either honest answer.
  Translated: our empty state should say plainly that leaving the tab costs nothing (no
  auction to lose a place in) rather than being silent, which reads as "maybe you'll
  miss something."
- *Let people prepare in advance:* Disney lets visitors "confirm in advance the people
  in their party" before the queue even opens. Translated: the gap between auctions is
  exactly the moment to have the wallet already connected, the `bond`/range visible from
  the *last* auction's parameters (config doesn't change between auctions per
  `config/auction.json`), so the very first commit of the newly-opened auction has zero
  additional setup friction.
- *Contextual, non-distracting content, not decoration:* the article's own caveat —
  filler content must not "obscure progress indicators or confuse the primary
  experience." Translated: the empty state's content should be the *last settled
  auction's receipt* (S4) and the *timeline* (already-built, real data), not a spinner
  or an illustration — this is real information a visitor can use while waiting, not
  padding.

**The labor illusion.** The empirical finding, from the original study
([pubsonline.informs.org, "The Labor Illusion: How Operational Transparency Increases
Perceived Value"](https://pubsonline.informs.org/doi/10.1287/mnsc.1110.1376), Buell &
Norton) and its practical write-up
([uxtigers.com, Progress Indicators Ease the Wait](https://www.uxtigers.com/post/progress-indicators)):
people who are *shown* work happening — even work that makes them wait *longer* —
report higher satisfaction than people given a faster, opaque result. The canonical
production example, also cited in the same research thread: Domino's Pizza Tracker
(2008), and every ride-hailing app's live driver-on-a-map since. **Translated for
Glasshouse's specific gap-between-auctions case:** the emptiness is not actually empty —
there is a keeper, on a schedule, and a chain producing blocks the whole time. The empty
state should show that machinery running, not hide it: a chain-head ticker that keeps
moving (`site/phase.js`'s existing "as of block N" device, already specified in
`ui-spec.md` §5.2) and, if knowable, an estimate of when the next auction is likely
("keeper interval ≈ N minutes; last opened at block M") turns dead air into visible
process — the same move Domino's tracker makes, applied to a keeper instead of a kitchen.

**Recommendation, concrete, additive to `ui-spec.md` §6 (S2/S3):**

> No live auction? Show the *last settled auction's* full S3/S4 (a real receipt, not a
> placeholder), with a strip above it: `no auction is open right now — the next one
> opens automatically, this page will switch to it` and the still-ticking `as of block
> N` head. Do not build a spinner, an illustration, or a "check back soon" dead end —
> those violate the labor-illusion finding (nothing to see = lower perceived value) and
> the NN/g filler-content rule (decoration that isn't information is worse than nothing).

This is a genuine gap in `ui-spec.md`, which currently only specifies "S2/S3 show the
newest live auction" without an explicit no-live-auction state.

---

## 5. Wallet connection

**Established convention, not an open question — the research corroborates what
`cta-patterns.md` §4.5 and `ui-spec.md` §7.4 already specify.** Three sources agree on
the shape:

- **When to prompt:** never automatically, only on click, and never before the user has
  a reason. Corroborated generally by
  [evilmartians.com, "Decentralized app design: first aid for common dApp UI pains"](https://evilmartians.com/chronicles/decentralized-app-design-first-aid-common-dapp-ui-pains)
  and [khalilahmed.dev, Wallet UX Best Practices for Modern Web3 Apps](https://www.khalilahmed.dev/articles/wallet-ux-best-practices-web3-apps) —
  both content-marketing sources (secondary), but they agree with each other and with
  the primary RainbowKit/Uniswap/CoW locale strings already cited in
  `cta-patterns.md` §1.1, none of which auto-connect. `ui-spec.md`'s decision to keep
  `Connect wallet` out of the masthead entirely — the argument tier works with no wallet
  at all — is the strongest form of this rule and is already correct.
- **Wrong chain:** don't block the whole app with a hard wall; show a targeted, specific
  message and a one-click fix. General guidance (secondary sources, same two above)
  converges with the primary [MetaMask engineering post, "No Longer Reloading Pages on
  Network Change"](https://medium.com/metamask/no-longer-reloading-pages-on-network-change-fbf041942b44),
  which documents the platform-level shift away from forcing a reload on network
  change — the implication for an app built on top is that a network mismatch should be
  handled as in-place state, not a page-breaking error. `cta-patterns.md` §4.5's
  `Switch to Base` (`--brick` outline, `wallet_switchEthereumChain`, falling back to
  `wallet_addEthereumChain` on 4902) is exactly this shape. **Endorsed, unchanged.**
- **Avoiding the wall before the user knows why:** this is `ui-spec.md`'s own decision
  (density tiers, §2.3) rather than a gap — the instrument tier (S2 onward) is where
  `Connect wallet` lives, and everything before it (the argument, the comparison, the
  lens) requires nothing. This is a stronger version of the general "don't gate content
  behind a wallet prompt" advice than most surveyed sources bother to state, because most
  of them are trading interfaces where nothing exists without a wallet; Glasshouse's
  argument-first structure has no analogue in the survey and doesn't need one — the
  no-backend, no-account requirement of the whole project already forces the right
  answer here.

**No disagreement, no addition.** This question is close to fully settled by
`cta-patterns.md` and `ui-spec.md` already; the research found nothing that argues for a
different shape, only more products doing the same thing.

---

## 6. Error and revert handling

**Also close to fully settled** by `cta-patterns.md` §7's per-selector table, which
already implements the general principle this research turned up from multiple secondary
sources — near the source, plain language, name the fix, never blame, preserve input —
[NN/g's error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/)
(primary, already cited in `cta-patterns.md` §1.1) generalized by two blockchain-specific
secondary sources:
[arounda.agency, "How to Design Blockchain UX When Users Can't Afford Mistakes"](https://arounda.agency/blog/how-to-design-a-better-ux-for-blockchain)
and [procreator.design, "Designing for Blockchain: 8 Best UX Practices"](https://procreator.design/blog/designing-for-blockchain-best-ux-practices/),
both of which converge on the same shape `cta-patterns.md` §7 already builds: a decoded
revert reason shown as one sentence, the raw message available but not front-and-center,
and a concrete next step rather than a dead end. One useful confirmation from the
blockchain-specific sources worth stating explicitly, since it validates a structural
choice rather than a copy choice: both recommend running the transaction through
simulation *before* the wallet opens so a doomed transaction never reaches the "confirm
in wallet" step at all — this is exactly `cta-patterns.md` §4.7's pre-flight
`simulateContract` step (item 4 of the commit sequence), sourced there from Flashbots'
`simError` field and wagmi's simulate-then-write pattern. Two independent lines of
research converging on the same mechanism is a good sign it's not idiosyncratic to this
project.

**Nothing to add.** The 17-custom-error problem is already solved at the right altitude
(one row per selector, `cta-patterns.md` §7); this research didn't find a better general
pattern, only agreement that the chosen one is the right shape.

---

## 7. Trust: a stranger's money, an unaudited contract

**Where the research came up short, stated honestly per the brief's own rule:** a
specific search for real "not yet audited" or "use at your own risk" banner copy from
production DeFi products did not surface a citable primary source — searches returned
audit-checklist advice (how *evaluators* should judge a protocol) rather than how
protocols *word their own disclaimers*. This is listed in §8.2 rather than guessed at.

**What the research does support, from sources already partly in `cta-patterns.md`'s
own survey plus general UX-writing sources:**

- **A single, explicit acknowledgment, not a wall of legal text.** Aave's checkbox
  (`cta-patterns.md` §1.1) — *"I acknowledge the risks involved"* — is real production
  copy for exactly this kind of moment, and NN/g's confirmation-dialog research
  (`cta-patterns.md` §1.1) explains why it's shaped as one checkbox and not a modal: *"if
  you warn people too much, they stop paying attention."* The same logic that argues for
  one Aave-style checkbox on the risky action (already adopted, `cta-patterns.md` §4.7)
  argues against a separate "this is unaudited" interstitial before the page loads — it
  would be a second warning competing with the first, and NN/g's own finding is that
  stacking warnings degrades attention to all of them.
- **Honesty as the trust mechanism, not reassurance.** General UX-writing guidance
  converges on this even from secondary sources — e.g.
  [mindsea.com, "The Dos and Don'ts of UX Writing"](https://mindsea.com/blog/ux-writing/) —
  the through-line being that copy which shows empathy and states real limits earns more
  trust than copy that reassures without evidence. This matches the entire premise of
  `ui-spec.md`'s provenance system (§3) — every figure tagged with what produced it,
  including `TEST` for numbers that were never observed on a network — which is already
  the strongest trust mechanism in this project's design and is *itself* the honest
  answer to "this is a hackathon project": the page doesn't merely say "trust us," it
  shows its work, sourced, on every number. That's a stronger and more specific move than
  any disclaimer banner a generic DeFi product puts up.
- **The concrete recommendation this file adds:** one line, near the risk checkbox
  (`cta-patterns.md` §4.7), stating the actual, checkable fact rather than a vague
  disclaimer:

  > *This contract has not been audited. It has been tested (`test/`, linked) and run on
  > Base mainnet by the team (see the receipts on this page). Bid only what you can
  > afford to lose.*

  This follows the provenance system's own rule (`ui-spec.md` §3.2 — name what produced
  the confidence that exists, not a blanket "trust us") rather than importing a generic
  DeFi disclaimer template, because a generic template would be less honest than what
  the project can actually say: it has tests, it has real (if small) mainnet receipts,
  and it does not have an audit. Say exactly that, in that order.

**No architectural disagreement with anything already decided** — this section mostly
confirms that `ui-spec.md`'s provenance system is doing double duty as a trust
mechanism, which is worth naming explicitly since it wasn't framed that way when it was
designed for a different reason (§2 of `ui-spec.md`, the "measurement of the world"
defect).

---

## 8. Sources

### 8.1 Fetched or search-confirmed today (2026-09-08)

- Arbitrum bridge claim step — [support.arbitrum.io, "Why wait 7 days to claim funds..."](https://support.arbitrum.io/hc/en-gb/articles/19478133076123-Why-wait-7-days-to-claim-funds-when-bridge-to-Ethereum); [docs.arbitrum.io/arbitrum-bridge/troubleshooting](https://docs.arbitrum.io/arbitrum-bridge/troubleshooting) (fetched directly — confirms the claim step and the wait, but the page carries no specific reminder/notification copy; noted as a gap, not filled with a guess)
- NN/g, Virtual Queue Best Practices — [nngroup.com/articles/virtual-queue-best-practices/](https://www.nngroup.com/articles/virtual-queue-best-practices/) (fetched directly)
- NN/g, Onboarding Tutorials vs. Contextual Help — [nngroup.com/articles/onboarding-tutorials/](https://www.nngroup.com/articles/onboarding-tutorials/) (fetched directly)
- NN/g, Mobile Tutorials: Wasted Effort or Efficiency Boost? — [nngroup.com/articles/mobile-tutorials/](https://www.nngroup.com/articles/mobile-tutorials/)
- NN/g, Instructional Overlays and Coach Marks for Mobile Apps — [nngroup.com/articles/mobile-instructional-overlay/](https://www.nngroup.com/articles/mobile-instructional-overlay/)
- Browser tab UX (title/favicon/Notifications patterns and the permission-on-click rule) — [dev.to, "Browser Tab UX in React"](https://dev.to/childrentime/browser-tab-ux-in-react-pull-users-back-with-titles-favicons-and-notifications-m94) (fetched directly)
- Favitimer — [favitimer.com](https://www.favitimer.com/); [timetler.com/2015/11/21/favitimer](https://www.timetler.com/2015/11/21/favitimer/)
- Ticketmaster queue — [blog.ticketmaster.com/how-ticketmaster-queue-works](https://blog.ticketmaster.com/how-ticketmaster-queue-works/)
- The labor illusion — [pubsonline.informs.org/doi/10.1287/mnsc.1110.1376](https://pubsonline.informs.org/doi/10.1287/mnsc.1110.1376) (Buell & Norton, original study); [uxtigers.com/post/progress-indicators](https://www.uxtigers.com/post/progress-indicators)
- eBay bid sniping — [ebay.com/help/buying/bidding/bid-sniping](https://www.ebay.com/help/buying/bidding/bid-sniping?id=4224) (primary, official); the "auto-extends 1–2 min" claim is community-forum sourced only, see §8.2
- Nouns DAO `timeBuffer` auction extension — [github.com/nounsDAO/nouns-monorepo, NounsAuctionHouse.sol](https://github.com/nounsDAO/nouns-monorepo/blob/master/packages/nouns-contracts/contracts/NounsAuctionHouse.sol)
- ICANN, domain redemption grace period — [icann.org/resources/pages/grace-2013-05-03-en](https://www.icann.org/resources/pages/grace-2013-05-03-en); [icann.org, renewal/expiration FAQs](https://www.icann.org/resources/pages/domain-name-renewal-expiration-faqs-2018-12-07-en); corroborated by [namecheap.com KB](https://www.namecheap.com/support/knowledgebase/article.aspx/242/2207/what-is-the-domain-redemption-grace-period/)
- OTP countdown pattern — [gist.github.com, OTP-UX](https://gist.github.com/ccloudorarestro-hue/a1ee28552462f5a58c8fec017202b07a); [mojoauth.com, OTP Expiration & Retry Policies](https://mojoauth.com/ciam-qna/best-practices-otp-expiration-retry-policies)
- Fintech onboarding / Wise fee calculator — [themasterly.com, "Fintech Onboarding UX: Stripe, Wise & Revolut Lessons"](https://www.themasterly.com/blog/fintech-onboarding-ux) (secondary)
- Argent multisig transaction queue — [support.argent.xyz/hc/en-us/articles/19485184697245](https://support.argent.xyz/hc/en-us/articles/19485184697245-Transaction-queue-and-rejecting-transactions-on-your-Multisig)
- MetaMask, network-change handling — [medium.com/metamask, "No Longer Reloading Pages on Network Change"](https://medium.com/metamask/no-longer-reloading-pages-on-network-change-fbf041942b44)
- Web3 wallet UX (secondary, corroborating) — [evilmartians.com, "Decentralized app design"](https://evilmartians.com/chronicles/decentralized-app-design-first-aid-common-dapp-ui-pains); [khalilahmed.dev, "Wallet UX Best Practices for Modern Web3 Apps"](https://www.khalilahmed.dev/articles/wallet-ux-best-practices-web3-apps)
- Blockchain error UX (secondary, corroborating) — [arounda.agency](https://arounda.agency/blog/how-to-design-a-better-ux-for-blockchain); [procreator.design](https://procreator.design/blog/designing-for-blockchain-best-ux-practices/)
- UX writing / honest disclaimer tone (secondary) — [mindsea.com, "The Dos and Don'ts of UX Writing"](https://mindsea.com/blog/ux-writing/)
- Uber Eats delivery tracker redesign (secondary, corroborating for §4's "show the work" point, not otherwise used) — [restaurantdive.com, "Uber Eats boosts delivery tracker transparency"](https://www.restaurantdive.com/news/uber-eats-boosts-delivery-tracker-transparency-with-colorful-animations/552513/)
- Empty-state design (secondary, general principles only, no single quote load-bearing) — [toptal.com/designers/ux/empty-state-ux-design](https://www.toptal.com/designers/ux/empty-state-ux-design); [pencilandpaper.io/articles/empty-states](https://www.pencilandpaper.io/articles/empty-states)

Reused without re-fetching (already primary-sourced in `cta-patterns.md`, cited here by
reference rather than re-quoted): ENS 2017 registrar instructions, ENS v3 register flow,
Aave's checkbox and locale, RainbowKit/Uniswap/CoW connect-wallet strings, NN/g's
confirmation-dialog and error-message articles, Flashbots' `simError`, Etherscan's
block-countdown page, Gnosis Auction's claim step, Safe/CoW's persistent order lists.

### 8.2 Searched, not reachable or not verifiable; not used as evidence

- **Real production "unaudited" or "use at your own risk" banner copy** — searched
  specifically; results were audit-evaluation advice for third parties judging a
  protocol, not first-party disclaimer wording. No claim in §7 is sourced to a specific
  banner; §7's recommendation is derived from the confirmation-dialog and UX-writing
  principles instead, and says so.
- **eBay's reported 1–2 minute auto-extension on last-second bids** — found only in
  eBay community-forum posts (user reports, not eBay's own bid-sniping help page, which
  says nothing about auto-extension). Treated as unconfirmed in §1, mechanism 8; the
  Nouns `timeBuffer` citation (verified in source) carries the weight of that point
  instead.
- **Across Protocol's claim-step UX specifically** — across.to's own pages describe the
  no-claim-needed relayer model in marketing terms; no interface screenshot or specific
  claim-step copy was reachable. Not cited as evidence anywhere above.
- **Lido / Rocket Pool "you have unclaimed rewards" reminder UI** — a Rocket Pool
  interface string ("You currently have x.xxxx unclaimed RPL...") turned up in a search
  summary without a fetchable primary page to confirm placement or trigger condition.
  Not cited as load-bearing evidence.
- **Foundation.app auction UX, Christie's/Sotheby's online bidding UX** — named in the
  brief; searches did not surface fetchable, quotable interface detail for either.
  Not cited.
- **Nouns.wtf's own FAQ/onboarding copy** — fetched; the page returned no substantive
  content (a bare header). The `timeBuffer` mechanism above is sourced to the contract
  instead, not to any first-time-bidder explainer, because none was found.

Internal: `docs/design/cta-patterns.md` (read in full; referenced throughout rather than
duplicated); `docs/design/ui-spec.md` (read in full; §3 provenance system, §5 data
plane, §6 screen inventory, §7 CTAs).
