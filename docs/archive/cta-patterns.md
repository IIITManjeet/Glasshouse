# cta-patterns.md — every call to action in Glasshouse, decided

> **Status:** DECIDED (architect, D-007 role), 2026-09-08. Refines `ui-spec.md` §4.1 and
> §7 with the survey below; where the two disagree, this file wins and says why. Binding
> on `site/index.html` for the Tier 1 CTAs (§4.1–4.4, 4.12) and on `web/` for everything
> else (`frontend-architecture.md` §8: wallet-bound CTAs are built only in the Next app).
>
> Survey fetched 2026-09-08. Every claim about a product cites what was actually read.
> Products whose interface could not be fetched are listed in §1.3 and are **not** cited
> as evidence.

---

## 0. What a CTA is here, and the four rules every one of them obeys

A CTA is any control whose activation changes state: on chain, in the wallet, in this
browser, or in the clipboard. Links to another section are wayfinding, not CTAs, and are
covered in one line (§4.1).

Four rules, derived in §2 from the survey and enforced in §8:

1. **The disabled label is the reason.** A disabled button never says the verb; it says
   why it cannot act (`Enter a bid between 50 and 500`, `Reveal opens at block N`). This is
   the one convention every surveyed product shares (Uniswap `Enter an amount` /
   `Insufficient balance`; CoW `Wallet not connected`; RainbowKit `Wrong network`).
   Deviating is a usability bug.
2. **The verb is the contract's verb.** `commit` becomes *Place sealed bid* only because
   "commit" means something else to a person; `reveal`, `settle`, `claim` are used as-is.
   No first-person ("Place my bid"), no marketing verbs ("Get", "Start"). None of the
   surveyed DeFi products uses first person; the marketing literature that recommends it
   (§1.2, general) is about sign-up forms.
3. **Cost and deadline are stated where the decision is made**, in the block-first form
   `23 blocks · ~46 s at 2 s/block`, never seconds alone. CoW puts "cost gas" in the
   cancel dialog; Gnosis Auction has a cancellation deadline separate from the auction
   end; Etherscan shows *Remaining Blocks* before *Estimated Target Date*. We put the
   deadline on the button when missing it costs money (reveal) and under the button when
   it costs only the opportunity (commit).
4. **The state ladder is two-stage and always visible:** wallet → chain. `wagmi` models
   it as two hooks (`useWriteContract` status `idle | pending | error | success`, then
   `useWaitForTransactionReceipt`), and every surveyed product renders it as two labels
   (`Confirm in wallet…` then `Pending`/`Swap pending...`). We never collapse the two.

---

## 1. The survey

### 1.1 Products, what was read, what we take

| Product | Source actually fetched | What it does | What Glasshouse takes | What it gets wrong (for us) |
|---|---|---|---|---|
| **Uniswap** interface | `raw.githubusercontent.com/Uniswap/interface/main/packages/uniswap/src/i18n/locales/source/en-US.json` | Button states are locale strings: `Enter an amount`, `Insufficient balance`, `Review`, `Approve {{symbol}}`, `Approve Permit2`, `Sign message`, `Confirm swap in wallet`, `Proceed in your wallet`, `Swap pending...`, `Swap failed`, `Swap expired`, `Try again`, `Connect a wallet`; the expiry warning `This request has expired due to inactivity. Please try submitting again`. | The disabled-label-is-the-reason rule; `Try again` as the universal recovery verb; the idea that a request can *expire* and must say so. | Uniswap has no deadline that costs the user money, so nothing about countdowns. `Proceed in your wallet` is vaguer than `Confirm in wallet…`; we keep the latter (ui-spec §4.1, also RainbowKit's `Confirm connection in the extension`). |
| **CoW Swap** | `raw.githubusercontent.com/cowprotocol/cowswap/develop/apps/cowswap-frontend/src/locales/en-US.po`; `docs.cow.fi/cow-protocol/tutorials/cow-explorer/order` | `Sign (gas-free!) in your wallet...` names the cost at the moment of signing; `Are you sure you want to cancel order {id}?` with `On-chain cancellations require a regular on-chain transaction and cost gas.`; `Click the checkbox` as a disabled label; `Order expires in`; explorer statuses `Open`, `Filled`, `Expired`, `Cancelled`, `Partially-filled`, `Pre-signing`; explorer field order (Order ID, From, To, Transaction hash, Status, Submission time, Expiration time, …). | Cost stated in the pending label (`Sealing · escrows 5 USDC` when bond > 0); the status vocabulary shape (one word, past participle) for the sealed-bids strip; explorer field order on the receipt (already in ui-spec §4.1). | `Approve and Swap` bundles two transactions into one label; we never do — a bond approval and a commit are two signatures and the user must see both (Aave's stepper, below). |
| **Aave** | `raw.githubusercontent.com/aave/interface/main/src/locales/en/messages.po` | `I acknowledge the risks involved.` as a checkbox that gates the button; `Supply {symbol}`; `Signing`, `Pending...`, `In progress`, `Transaction cancelled`, `All done`; `Wrong Network`, `Switch Network`. | The acknowledgement checkbox, used **once**, only when the bond is non-zero (§4.7). `Transaction cancelled` as the 4001 label. | `In progress` and `Pending...` both exist for the chain stage; a product should pick one. `All done` is too cheerful for an instrument; our success label states the fact (`Sealed · #2`). |
| **ENS v3** (commit → wait → register) | `raw.githubusercontent.com/ensdomains/ens-app-v3/main/public/locales/en/register.json`; `support.ens.domains/en/articles/7882582-registering-a-eth-name` | Three explicit steps (`Complete a transaction to begin the timer`, `Wait 60 seconds for the timer to complete`, `Complete a second transaction to secure your name`), buttons `Start timer` / `Wait` / `Complete registration` (`Begin` / `Complete Registration` in the support screenshots); the reason for the wait in words (`This wait prevents others from front running your transaction…`); `You have {{duration}} remaining to complete it.`; `Your registration has expired. You will need to start the process again.`; `Reset transaction and go back`. Support page: the app "tracks a hash stored in your browser"; "don't clear your browser cache or switch browsers before you complete the registration"; the commit "expires after 24 hours". | **The closest living precedent for a two-transaction flow with browser-held state and a deadline.** We take: the numbered stepper with the wait as a step; the reason for the wait in plain words on the step; the remaining-time sentence; the expiry sentence that says what to do next; the recognition that state lives in the browser and must be exportable. | The state is *only* in the browser, with no export and no in-progress indicator on other pages ("stuck on 'Almost there'"). ENS's deadline is 24 h; ours is ~60–120 s, so their "come back later" model does not transfer — ours must keep the user on the page. |
| **ENS 2017 registrar** | `veox-ens.readthedocs.io/en/latest/userguide.html` | Sealed bid with a secret and a masked deposit; 3-day bid, 2-day reveal; `"If you don't reveal your bid by the time the auction ends, your deposit is forfeit - so make sure you store your salt in a safe place, and come back before the auction ends in order to reveal your bid."` | The exact failure mode we are designing against, in the designers' own words. Store the salt **for** the user, before the commit is sent; tell them the forfeiture consequence on the button, not in a guide. | Everything about it was a guide, not an interface. |
| **Blur** | `theblock.co/post/193237/blur-nft-traders-refund` (via search summary; the article itself returned 403 to the fetcher); `docs.blur.foundation` reachable only as an index page | Dec 2022: a bid typed as `.70` was parsed as `70` ETH and accepted against a far lower floor; 70 ETH lost; Blur refunded 50% for bids accepted "over 25% of the non-flagged floor". Apr 2023: bids that should have lapsed were still acceptable; Blur compensated 2× the difference. Blur's model otherwise: deposit ETH to a bidding pool once, then gasless signed bids with an expiry; bids sit in a visible depth ladder and can be hit instantly. | Two hard lessons. **(a) The number in the button must be the number the contract will see**, so our input is integer bps with `inputmode="numeric"`, non-integers rejected at the keystroke, and the button label repeats the value (`Place sealed bid · 250 bps`). **(b) A deadline enforced by the contract must be mirrored by the UI against the pessimistic head**, so `Reveal` is never shown enabled past `revealEnd` against `max(H_i, H_c)`. | The bidding UX is optimised for speed (one click, gasless); ours is deliberately two-transaction and slow. Blur's depth ladder is the opposite of sealed. |
| **OpenSea** | `support.opensea.io/en/articles/8866977-how-do-i-make-an-offer-on-nfts` | `Make offer` → amount + duration (default 30 days, max 6 months) → one-time WETH approval with a gas fee → `Review item offer` → wallet signatures → offer visible in the profile's *Offers* tab; cancellation free by default. | The review step names the thing being offered on; the one-time approval is explained as one-time. Our `Approve bond` says `for the Book` and is shown only when needed. | Offer expiry is user-chosen days; ours is contract-fixed blocks. "Make offer" is a marketplace verb; ours is an auction. |
| **Gnosis Auction** (ido-contracts) | `github.com/gnosis/ido-contracts` README; blockcast.cc mechanism guide | Bidders place sell orders with a limit price; orders are cancellable only until `orderCancellationEndDate`, which is **before** `auctionEndDate`; after the end, price is calculated and "everyone can claim their part" — matched bidders withdraw tokens, unmatched recover funds. The app shows a running "Current Price" that becomes "Clearing Price" then "Closing Price". | **Two deadlines, distinct, both shown** — the structural precedent for our commit/reveal boundaries. The three price words map exactly to our `running` → `final` → `settled ✓` (already adopted, ui-spec §4.1). A post-auction *claim* step that is the user's to perform (our `Claim bond`). | Gnosis's post-close step recovers funds; ours (reveal) is what *prevents* losing them. No product surveyed has a post-commit step whose omission costs the user's deposit within minutes. |
| **Etherscan** | `etherscan.io/block/countdown/30000000` | `Countdown For Block`, `Remaining Blocks`, `Current Block`, then Days/Hours/Mins/Secs, `Estimated Target Date` with add-to-calendar, and `Notify me when this block is produced`. The word "estimated" on every time figure. | Blocks first, time second and labelled estimated (ui-spec §4.1). The *notify me* affordance is the precedent for the tab-title countdown in §5. | Nothing; it is the reference. |
| **Flashbots Protect status API** | `docs.flashbots.net/flashbots-protect/additional-documentation/status-api` | Statuses `PENDING`, `INCLUDED`, `FAILED` ("submitted for 25 blocks and failed to be included"), `CANCELLED`, `UNKNOWN`; fields `maxBlockNumber`, `seenInMempool`, `simError`, `revertReason`, `isRevert`. | A pending transaction with a **block deadline** (`maxBlockNumber`) and a distinct `FAILED` meaning "not included in time" — exactly the shape of a reveal sent with three blocks left. Our pending-chain state therefore shows the deadline too (`Revealing · 0x… · 2 blocks left`). `simError` before send is the pattern behind our pre-flight `eth_call`. | An API, not a UI. |
| **RainbowKit** | `raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/locales/en_US.json` | `Connect Wallet`, `Wrong network`, `Switch Networks`, `Opening %{wallet}...`, `Connecting`, `Confirm connection in the extension`, `Accept connection request in the wallet`, `Waiting for signature...`, `Error signing message, please retry!`, `%{wallet} is not installed`. | The connect ladder's wording; `is not installed` → our `No wallet found`. | Exclamation marks in error copy. |
| **wagmi** | `wagmi.sh/react/api/hooks/useWriteContract` | `status: 'idle' | 'pending' | 'error' | 'success'` for the wallet/broadcast stage; `useWaitForTransactionReceipt` for inclusion. | The two-stage model as the ecosystem's own vocabulary (rule 4). Our `TxButton` has exactly these two stages plus the pre-flight simulation. | — |
| **NN/g, confirmation dialogs** | `nngroup.com/articles/confirmation-dialog/` | "Use a confirmation dialog before committing to actions with serious consequences — such as destroying users' work or costing large amounts of money"; "Do not use confirmation dialogs for routine actions"; buttons should "summarize what will happen for each possible response" (`Delete file` / `Keep file`, not Yes/No); "if you warn people too much, they stop paying attention". | One acknowledgement, only when bond > 0; no confirmation on settle, claim, copy; button labels that say what will happen. | — |
| **NN/g, progress indicators** | `nngroup.com/articles/progress-indicators/` | Feedback for anything over ~1 s; looped animation for 2–10 s; percent-done for longer; text that says what is happening ("Updating address 3 of 50"). | Wallet stage (2–10 s): the ellipsis. Chain stage: the block countdown *is* a determinate indicator, and the phase-cell progress bar is percent-done by blocks. | — |
| **NN/g, error messages** | `nngroup.com/articles/error-message-guidelines/` | Near the source; plain language; "concisely and precisely describe the issue"; offer the fix; never blame; preserve the user's input. | Every revert maps to one sentence with a next step (§7); the bid input is never cleared on error. | — |
| **NN/g, button states** | `nngroup.com/articles/button-states-communicate-interaction/` | Enabled, disabled, hover, focus, pressed must be distinct; disabled needs `aria-disabled`; loading keeps the enabled look plus an indicator. | Our disabled state is *not* desaturated to invisibility: it is `--ink-faint` text on `--raised` with a 1px `--rule` border, because the label carries the reason and must stay legible. Loading adds the 1px indeterminate bar (ui-spec §2.4). | The article does not say disabled buttons need a reason; the surveyed products do it anyway, and so do we. |

### 1.2 General CTA literature, and how much of it applies

Marketing sources (crazyegg, klientboost, uxpin, kissmetrics — search summaries only)
recommend first-person, benefit-led, verb-first labels ("Get my free audit"). **Verb-first
applies. First-person and benefit-led do not.** An instrument that sends a transaction is
not a landing page: the user needs to know *what the contract will do*, and a benefit
frame ("Win this fill") on a button that escrows a bond is the kind of copy the Blur
incident punishes. Every DeFi product surveyed uses the bare imperative; we do too.

### 1.3 Not reachable today; not cited

Blur's own docs beyond the index (`docs.blur.foundation`, bidding pages), Safe's help
centre (`help.safe.global/…/transaction-queue`, 404), Zora's Auction House docs (DNS
failure), Morpho's user guides (404), Pendle's app (rendered an error screen), Lido's
widget (help page only, no strings), Curve, Ethena, 1inch Fusion's app (help articles were
read yesterday for `ui-spec.md` §10 and are not re-cited here), and any live MEV auction
UI (search found mechanism explainers, not interfaces). Where a pattern from one of these
is mentioned below it is marked *(unverified today)* and carries no weight in a decision.

---

## 2. Learnings

### 2.1 What the surveyed products get right

1. **The disabled label carries the reason** (Uniswap, CoW, RainbowKit, Aave). This is
   so universal that a grey button reading `Place sealed bid` while disabled would be read
   as broken.
2. **Two-stage ladders with distinct words per stage** (Uniswap `Confirm swap in wallet`
   → `Swap pending...`; Aave `Signing` → `Pending...`; wagmi's two hooks). Users have
   learned that "in wallet" means look at the extension and "pending" means wait.
3. **Cost at the point of decision** (CoW's cancel dialog; OpenSea's one-time approval
   explanation; Aave's checkbox). The user is told what a click costs on the surface they
   click.
4. **Steps as a visible list with the wait as a step** (ENS v3). A timer is not an error;
   it is step 2 of 3.
5. **Blocks before time, time labelled estimated** (Etherscan).
6. **Deadlines on pending things** (Flashbots `maxBlockNumber`; CoW `Order expires in`).
7. **Past-participle statuses** (CoW `Filled`, `Expired`, `Cancelled`; Flashbots
   `INCLUDED`, `FAILED`). One word, no verb tense ambiguity.
8. **Expiry that says what to do next** (ENS `You will need to start the process again`;
   Uniswap `Please try submitting again`).

### 2.2 What they get wrong, or what does not transfer

1. **Browser-only state with no export** (ENS v3: "don't clear your browser cache or
   switch browsers"; "stuck on 'Almost there'"). Correct diagnosis, no remedy. We remedy
   it: the secret is stored before the send, shown as `Copy bid secret`, and typeable
   back in through `Enter secret`.
2. **Deadlines the UI does not mirror** (Blur, Apr 2023: lapsed bids still acceptable).
   The contract's boundary must be the UI's boundary, computed against the pessimistic
   head, every poll.
3. **Number parsing that is not what the contract sees** (Blur, Dec 2022, `.70` → `70`).
   Our input domain is a small integer range, which removes the class of bug; the label
   restates the value anyway.
4. **Two words for one stage** (Aave `In progress` / `Pending...`).
5. **Bundled verbs** (CoW `Approve and Swap`). Two signatures, two steps, always.
6. **Cheerful success copy** (`All done`, exclamation marks). An instrument reports the
   fact: `Sealed · #2 · reveal opens at block N`.
7. **Nobody has a post-commit step whose omission costs the deposit within minutes.**
   ENS 2017 had it with a 48 h window and documented forfeitures. Gnosis has a claim step
   that only delays money. So the reveal deadline pattern in §5 is ours to define, and
   the components we assemble it from are each borrowed from a product that solved a
   neighbouring problem.

### 2.3 Conventions so established that deviating is a usability bug

| Convention | Who | Our form |
|---|---|---|
| `Connect wallet` as the label; address + chain when connected; `Wrong network` / `Switch …` in a warning colour | RainbowKit, Uniswap, CoW, Aave | `Connect wallet` → `0x91ab…04ce · Base` → `Switch to Base` (`--brick` outline) |
| `Confirm in wallet…` while the extension is open | RainbowKit `Confirm connection in the extension`, Uniswap `Confirm swap in wallet`, Aave `Signing` | `Confirm in wallet…` |
| A pending state that links to the explorer | Uniswap, Aave, CoW explorer | `Sealing · 0x3f9a… ↗` |
| `Try again` on failure, input preserved | Uniswap | `Failed — Try again` + `<details>` with the raw message |
| Approve as a separate, explained, one-time step | OpenSea, Aave, Uniswap `Approve {{symbol}}` | `Approve 5 USDC for the Book` |
| Explorer field order on a receipt | CoW explorer, Etherscan | Hash, Status, Block, Timestamp, From, To, then domain fields |
| Copy-address glyph with a transient `Copied` | every explorer and wallet | glyph → check + `Copied` 1.5 s |
| A checkbox before a costly action, not a modal | Aave | `I understand …` once, bond > 0 only |
| Disabled buttons are still legible and explain themselves | all of the above | `--ink-faint` text, 1px rule, label = reason |

---

## 3. Placement, in one picture

```
S2 live auctions (instrument tier, both artifacts)
  [ header right ]  Connect wallet   (web/ only, step 6)          ← never in the masthead
  rows              ↗ Basescan · ↗ open in the live instrument (static page only)

S3 auction view (both artifacts)
  band 0 (web/)     ▌ Your sealed bids  — the strip, only when this browser holds a secret (§5)
  band 1            phase track — no CTA; the countdown lives here
  band 2            bid cards — copy glyph on each address
  band 3            timeline — ↗ per row
  band 4 (web/)     the wallet band, as a vertical numbered stepper:
                      1  Approve bond            (hidden when bond == 0)
                      2  Place sealed bid        + bps input + range + bond line + [checkbox]
                         Copy bid secret         appears the instant step 2 is armed
                      3  Reveal                  the deadline is on this button
                      4  Settle auction          permissionless; anyone
                      5  Claim bond              (hidden when bond == 0)
                    Replay reveals               below the stepper, settled auctions only

S4 receipt          copy glyphs, ↗; no CTA
S5 next auction     [ Copy ] on the cast line; no other CTA
head line           paused · click to resume  (after 4 h idle)
```

The stepper is Aave's and ENS's shape: steps stay visible, completed steps show a check
and the block they completed at, the active step holds the live button, future steps are
`--ink-faint` with their opening block.

---

## 4. The catalogue

Format per CTA: **label** · why this wording · the ladder · placement · walk-away. States
are named with the vocabulary of `frontend-architecture.md` §8's `TxButton`:
`idle`, `disabled(reason)`, `simulating`, `wallet`, `chain`, `success`, `error(kind)`.
"Head" means `max(H_i, H_c)` per ui-spec §5.2 unless stated.

### 4.1 Section nav — Tier 1, both artifacts

Links, not CTAs. `argument · comparison · live auctions · receipt · next auction ·
limits` on the static page; the app's nav adds `the argument ↗` back to the page and the
page's nav adds `live instrument ↗` once `frontend-architecture.md` §11 step 3 is
reached. `:focus-visible` outline only.

### 4.2 Copy — Tier 1, both artifacts

**Label:** the copy glyph, `aria-label="Copy address"` / `"Copy transaction hash"` /
`"Copy cast line"` / `"Copy bid secret"` — the object named, because a screen reader
hears six of these on one screen.

**Why:** a glyph, not the word, because the value it copies is already the text beside
it and a second word doubles the mono density. Every explorer does this.

| State | Shows | Condition |
|---|---|---|
| idle | glyph | |
| success | check glyph + mono `Copied` for 1.5 s | `navigator.clipboard.writeText` resolved |
| error | `Select and copy`; the value becomes a focused, selected `<input readonly>` | clipboard rejected (insecure context, permissions) |

**Placement:** immediately after the value, before `↗`. **Walk-away:** none; stateless.

### 4.3 Basescan link — Tier 1, both artifacts

**Label:** `↗`, `aria-label="View on Basescan"`, `target="_blank" rel="noopener"`.
Idle only. Leads to `https://basescan.org/address/…` or `/tx/…`. After the value.

### 4.4 `open in the live instrument ↗` — Tier 1, static page only

**Label:** `open in the live instrument ↗` on each S2 row and once under the S3 head
line. **Why:** it says what is on the other side (an instrument, not "the app"), which
is what a tester who was handed the document needs to decide whether to click. Appears
only after `frontend-architecture.md` §11 step 3; until then the string is absent, not
disabled. Leads to `app/auction/?id=<id>`.

### 4.5 `Connect wallet` — Tier 3, `web/` only

**Label:** `Connect wallet`. **Why:** RainbowKit `Connect Wallet`, CoW `Connect Wallet`,
Uniswap `Connect a wallet`; sentence case is the design language's. Not `Sign in`,
because no message is signed and nothing is authenticated.

| State | Label | Behaviour |
|---|---|---|
| no provider | `No wallet found` (disabled) | `title`: *Bidding needs a browser wallet on Base. Everything else here works without one.* (RainbowKit `%{wallet} is not installed`, generalised) |
| idle | `Connect wallet` | `eth_requestAccounts` |
| wallet | `Confirm in wallet…` (disabled, ellipsis) | |
| connected, Base | `0x91ab…04ce · Base` | click → menu: `Copy address`, `Disconnect` (forgets locally; EIP-1193 has no disconnect; the menu says *This forgets the account here; your wallet stays connected on its side*) |
| connected, other chain | `Switch to Base` (`--brick` outline) | `wallet_switchEthereumChain 0x2105`; on 4902 `wallet_addEthereumChain` with `https://mainnet.base.org` |
| error 4001 | idle; inline mono `Connection cancelled` 3 s | Aave's `Transaction cancelled` shape |
| error -32002 | `Open your wallet — a request is already waiting` (disabled) | MetaMask's "request already pending"; the fix is in the label |

**Placement:** top-right of S2's figure header, and repeated as the disabled reason on
every wallet-bound button (`Connect wallet to bid`). Never in the masthead (ui-spec §4.1).
**Walk-away:** on return, the app calls `eth_accounts` (no prompt); if the wallet still
authorises the origin the button shows connected, otherwise idle. Nothing else is stored.

### 4.6 `Approve bond` — Tier 3, `web/` only; hidden when `bond == 0`

**Label:** `Approve 5 USDC for the Book`. **Why:** Uniswap `Approve {{symbol}}` plus
the spender, because "for the Book" is the fact a sceptic checks in the wallet prompt
(the `spender` field), and matching the two words removes a moment of doubt. OpenSea
explains the approval as one-time; we say it under the button: *One-time per token. The
Book can pull at most the bond.* Amount is exact (`approve(BOOK, bond)`), never
unlimited — an instrument about not trusting intermediaries does not ask for infinite
allowance.

Ladder: as §4.7 with `Approving · 0x… ↗` for the chain stage and success
`Approved ✓ block N ↗`, which checks step 1 and arms step 2. Already-sufficient
allowance on load → step 1 renders as `Approved ✓ (existing allowance)` and is skipped.

**Walk-away:** allowance is on chain; on return the step reads from `allowance()` and is
correct without local state.

### 4.7 `Place sealed bid` — Tier 3, `web/` only. The commit.

**Label (idle):** `Place sealed bid · 250 bps`.

**Why this wording.** Candidates: *Commit* (the contract's verb — but "commit" reads as
git or as a promise; ENS v3 hides it behind `Start timer` for the same reason), *Bid*
(Blur/Zora — implies the number is public), *Submit bid* (OpenSea-ish, and "submit" is
the verb every CTA guide tells you to avoid because it names the effort, not the act),
*Seal bid* (accurate, but "seal" is not a verb people click). **`Place sealed bid`** uses
the marketplace verb everyone knows (Gnosis "Place order", OpenSea offers, Blur bids) and
the one adjective that says what is different: nobody will see this number, and there is
a second step. The bps value is in the label (Blur lesson: the button restates the number
the contract sees). The deadline is **under** the button, not in it, because missing the
commit window costs nothing but the chance to bid; the label should stay stable width
for the 60–120 s it is visible.

**The input.** `<input inputmode="numeric" pattern="[0-9]*">` labelled `bid, bps`,
integer only, keystrokes outside `0–9` dropped, paste sanitised. Under it, mono:
`between 50 (reserve) and 500 (max)`. Under that, one of:
`bond 0 — nothing is escrowed` or
`bond 5 USDC — escrowed now, returned after settle if you reveal`.
When bond > 0, Aave's checkbox, verbatim:
`I understand: if I do not reveal before block 51 204 120 the bond is forfeitable.`
(NN/g: one confirmation, for the one action that costs money; none for bond = 0.)

**Sequence on click** (ui-spec 7.6, with the pre-flight added):

1. `salt = crypto.getRandomValues(32 bytes)`.
2. `eth_call commitmentFor(bidder, bps, salt)` — the contract is the hash (F-144).
3. **Write** `localStorage["glasshouse:bid:<auctionId>:<bidder>"] = { bps, salt, commitEnd, revealEnd, exclusiveEnd, bond, at, txHash: null }`. Show `Copy bid secret` (§4.13) **now**, before any wallet prompt.
4. `simulateContract(commit)` — an `eth_call` of the exact calldata. A revert here is decoded and shown as `error(revert)` without opening the wallet (Flashbots `simError`; wagmi's simulate-then-write).
5. `writeContract(commit)`; store `txHash` in the same record.
6. `waitForTransactionReceipt`.

**Ladder**

| State | Label / text | Condition |
|---|---|---|
| disabled | `Connect wallet to bid` | no account |
| disabled | `Switch to Base to bid` | wrong chain |
| disabled | `Approve the bond first (step 1)` | bond > 0 and allowance < bond |
| disabled | `Commit opens with the auction` | should not occur (commit opens at `open()`); kept so a stale snapshot cannot show an enabled button |
| disabled | `Commit closed at block 51 204 090` | head > `commitEnd` |
| disabled | `Closing — 2 blocks is too few to sign` | `commitEnd − H_c ≤ 2` |
| disabled | `Already sealed from this wallet · #1` | a `Bid` row exists for this address, or a local secret exists with a `txHash` |
| disabled | `Enter a bid between 50 and 500` | input empty or out of range |
| disabled | `Tick the acknowledgement to continue` | bond > 0, checkbox unticked (CoW `Click the checkbox`) |
| idle | `Place sealed bid · 250 bps` — under it: `commit closes at block 51 204 090 · 14 blocks · ~28 s at 2 s/block` | |
| simulating | `Checking…` (≤ 1 s; no indicator if faster, per NN/g) | |
| wallet | `Confirm in wallet…` — under it the same countdown, still running | |
| chain | `Sealing · 0x3f9a… ↗` — under it: `escrows 5 USDC` when bond > 0 | receipt not yet mined |
| success | `Sealed · #2 · reveal opens at block 51 204 091` — the sealed card appears in band 2 tagged `you`; step 3 arms; the strip (§5) appears | receipt status 1 |
| error 4001 | idle; inline `Cancelled in wallet` 3 s; secret record kept | user rejected |
| error revert `CommitClosed` | `Commit closed at block N while you were signing` (`--brick`); secret record marked `dead` | decoded by selector |
| error revert `AlreadyCommitted` | `Already sealed from this wallet · #1`; if no local secret: `…and this browser has no secret for it — Enter secret if you have it` | |
| error insufficient gas funds | `Not enough ETH on Base for gas` with the estimated cost in mono | wallet/RPC error string match |
| error other | `Failed — Try again` + `<details>` raw message; input preserved | |

**Placement:** step 2 of the stepper in band 4 of S3. **Walk-away:** the record from
step 3 exists regardless of outcome; on return, §5's strip reconciles it against the
subgraph (`Bid` row present → sealed; absent and head ≤ commitEnd → `not sent — place
again`; absent and head > commitEnd → record deleted after 24 h, shown once as `expired
unsent`).

### 4.8 `Reveal` — Tier 3, `web/` only. The one with the block deadline.

**Label (idle):** `Reveal 250 bps · 23 blocks left`.

**Why this wording.** The verb is the contract's and the vocabulary of every sealed-bid
mechanism (ENS 2017 "reveal your bid", Gnosis/ENS docs). Candidates rejected: *Unseal*
(cute, unknown), *Open bid* (ambiguous with the `open` phase), *Confirm bid* (implies a
new decision; there is none — the bid is already made), *Submit reveal* (effort verb).
The bps is in the label because the user did not type it in this session — it came from
storage — and the label is the last thing read before the wallet opens. **The deadline
is on the button** because missing it costs the bond: the countdown must be where the
eye is, not in a helper line (rule 3). `left` rather than `remaining` for width.

**Asymmetry that decides the disabled rule.** For commit we disable at ≤ 2 blocks because
a late commit loses only gas and the chance to bid. For reveal we **never disable while
`head ≤ revealEnd`**, not even at 1 block: a reveal that lands late reverts and costs gas
(cents on Base); a reveal not attempted costs the bond. The button stays live to the last
block and says so.

**Ladder**

| State | Label / text | Condition |
|---|---|---|
| disabled | `Reveal opens at block 51 204 091 · 6 blocks · ~12 s at 2 s/block` | `phase == commit` |
| disabled | `No sealed bid in this browser for 0x91ab…04ce` + the `Enter secret` disclosure (§4.13) | reveal phase, no local record, no typed secret |
| idle | `Reveal 250 bps · 23 blocks left` — under it: `closes at block 51 204 120 · ~46 s at 2 s/block` | `phase == reveal`, `revealEnd − head > 10` |
| idle, urgent | same label; button border `--brick`; under it `Reveal closes at block 51 204 120 — sign now`; tab title `(9 blocks) Reveal · Glasshouse` | `≤ 10` blocks left |
| idle, last call | `Reveal 250 bps · 1 block left · may not land` (`--brick` fill, `--ground` text) | `≤ 1` block left. Still enabled. |
| simulating | `Checking…` | |
| wallet | `Confirm in wallet… · 9 blocks left` — countdown keeps running on the disabled button | |
| chain | `Revealing · 0x… ↗ · 4 blocks left` — the deadline stays on the pending state (Flashbots `maxBlockNumber`) | |
| success, leading | `Revealed · you lead at 250 bps` | our `BidRevealedEvent.tookLead` and `Bid.leading` |
| success, sets price | `Revealed · runner-up at 250 bps · your bid sets the price` | `secondBps == ours` after the reveal |
| success, other | `Revealed · 3rd of 3` | rank from `revealOrder`/bps |
| disabled | `Revealed ✓ at block N ↗` | `Bid.revealed` |
| disabled | `Reveal closed at block 51 204 120 · your bond is claimable by the maker` (`--brick`); with bond 0: `Reveal closed at block N · no bond was escrowed` | `phase ∉ {commit, reveal}` and not revealed |
| error 4001 | idle again with the live countdown; inline `Cancelled in wallet — N blocks left` (the countdown is repeated in the error because the user just lost seconds) | |
| error revert `RevealClosed` | as the closed state, plus `Sent at block N, closed at block M` so the user sees by how much | |
| error revert `RevealNotOpen` | `Reveal opens at block N` (can only happen if the head was stale; the poll corrects it) | |
| error revert `BadReveal` | `The secret does not match the sealed bid. Check bps and salt.` — input kept | |
| error revert `BidOutOfRange(bps, r, m)` | `Reveal rejected: the bid must be between r and m` (only reachable with a typed secret) | |
| error revert `NoCommitment` | `No sealed bid from 0x91ab…04ce on this auction. Are you on the right wallet?` | |
| error revert `AlreadyRevealed` | `Revealed ✓` (re-read from the subgraph on next poll) | |
| error other | `Failed — Try again · N blocks left` + `<details>` | |

**Placement:** step 3 of the stepper, and mirrored in the strip (§5) on every route.
**Walk-away:** §5. In short — the strip on every page, the tab title, and the label on
return that says either what to do (`Reveal now · 9 blocks left`) or what happened
(`Reveal closed at block N`).

### 4.9 `Settle auction` — Tier 3, `web/` only

**Label:** `Settle auction`. **Why:** the contract's verb and CoW's noun for the same
event; *Finalize* (ENS 2017) and *End auction* (Zora, unverified today) are the same act
under names our subgraph does not use. Enabled iff `canSettle(a, head)` from
`site/phase.js` — **never derived from the phase** (they differ by 15 blocks for a
winnerless auction). Under the button: *Permissionless. Anyone may call it; it records
the result and releases bonds.*

| State | Label | Condition |
|---|---|---|
| disabled | `Settles after block 51 204 135 · 9 blocks · ~18 s at 2 s/block` | `head ≤ exclusiveEnd` |
| disabled | `Settled ✓ block N ↗` | `settled` |
| idle | `Settle auction` | `canSettle` |
| wallet / chain | `Confirm in wallet…` / `Settling · 0x… ↗` | |
| success | `Settled ✓ block N ↗` — the `open` cell gets the check; the receipt (S4) appears; step 5 arms if bond > 0 | |
| error revert `AlreadySettled` | `Settled ✓` (someone else did; next poll shows by whom) | |
| error revert `WindowNotElapsed` | as the first disabled state (stale head) | |

**Walk-away:** on chain; no local state.

### 4.10 `Claim bond` — Tier 3, `web/` only; hidden when `bond == 0`

**Label:** `Claim bond · 5 USDC`. **Why:** Gnosis's post-auction verb; the amount is in
the label because it is the only reason to click. Enabled iff `settled && bid.revealed &&
bondStatus == HELD` for this account.

| State | Label | Condition |
|---|---|---|
| disabled | `Bond is returned after settle` | not settled |
| disabled | `Bond forfeited — unrevealed` (`--brick`) | `bondStatus == UNREVEALED_FORFEITED`, or unrevealed and settled |
| disabled | `Bond forfeited — won and did not fill` (`--brick`) | `FORFEITED_TO_MAKER` |
| disabled | `Bond returned ✓ block N ↗` | `RETURNED` |
| idle | `Claim bond · 5 USDC` | |
| wallet / chain / success | `Confirm in wallet…` / `Claiming · 0x… ↗` / `Bond returned ✓ block N ↗` | |
| error revert `NotSettled` / `NothingToClaim` | the matching disabled label | |

### 4.11 `Replay reveals` — Tier 3, `web/` only

**Label:** `Replay reveals` → `Replaying…` → `Replay reveals`. Settled auctions only.
Re-seals every card and unseals in `revealOrder` at 600 ms, driving the stat line from
each `BidRevealedEvent.*After` (the subgraph carries them so the page does not
re-implement the rule). Hidden under `prefers-reduced-motion`. Below the stepper. No
scrubber. Stateless.

### 4.12 `paused · click to resume` — Tier 1, both artifacts

On the head line after 4 h without interaction. Click restarts polling; the head blinks
once on the first new block. The label is the state and the instruction in four words.

### 4.13 `Copy bid secret` / `Enter secret` — Tier 3, `web/` only. The recovery pair.

**`Copy bid secret`.** Appears beside step 2 the instant the local record is written
(§4.7 step 3), before the wallet opens, and stays for the life of the record. Copies
`{ "auction": "0x…", "bidder": "0x…", "bps": 250, "salt": "0x…", "revealEnd": 51204120 }`.
Under it, one sentence: *Stored in this browser. Copy it if you might reveal from
another one — a sealed bid can only be revealed with its secret.* This is ENS 2017's
"store your salt in a safe place" turned from a warning into a button, and ENS v3's
"don't switch browsers" turned into an export.

**`Enter secret`.** A `<details>` under a disabled `Reveal` when no local record exists:
two mono fields, `bps` and `salt`, plus `Use this secret`, which writes a local record
(marked `typed`) and arms `Reveal` with the typed bps in the label. Validation is the
contract's: a wrong pair fails at `simulateContract` with `BadReveal` and the fields are
kept.

---

## 5. The reveal deadline: the best answer, and who does something like it

**The problem.** A bidder who commits and does not reveal within `revealBlocks` (30
blocks ≈ 60 s advocated, 60 ≈ 120 s human-demo) loses the bond. No swap UI has a step
the user must come back for; NFT auctions and Gnosis have post-close steps that only
delay money; ENS v3 has a second transaction with a 24-hour window and browser-held
state; ENS 2017 had our exact problem and documented forfeitures.

**The answer, in five parts, each borrowed.**

1. **Keep the user on the page; make leaving visible.** Between `Sealed` and `Reveal
   opens` there are 0–60 s. The stepper's step 3 is already showing `Reveal opens at
   block N · 6 blocks · ~12 s`, so the wait is a step, not a gap (ENS v3's `Wait 60
   seconds for the timer to complete`). The tab title carries the countdown from the
   moment the bid is sealed: `(6 blocks) Reveal opens · Glasshouse` → `(23 blocks)
   Reveal · Glasshouse` (Etherscan's *notify me when this block is produced*, done the
   only way a static site can without permissions).

2. **A strip on every route.** `SealedBidsStrip` renders under the masthead on `/app/`,
   `/app/auction/`, `/app/next/` whenever this browser holds a live record for the
   connected (or last-connected) account. One line per bid, mono:
   `▌ auction #7 · sealed 250 bps · reveal opens in 6 blocks` /
   `▌ auction #7 · Reveal now · 9 blocks left` (`--brick` when ≤ 10; the whole line is
   the button) /
   `▌ auction #7 · revealed ✓` /
   `▌ auction #7 · reveal closed at block N · unrevealed` (`--brick`; stays 24 h, then
   collapses to the timeline entry). Safe's queue and CoW's "your orders" list are the
   precedent for a persistent list of things that need you; ENS v3's lack of one is the
   counter-example.

3. **The secret exists before the risk does.** Written at §4.7 step 3, exported by
   `Copy bid secret`, re-enterable by `Enter secret`. The ENS 2017 forfeiture story is
   about people who had the salt in a file they could not find; we keep it where the
   button is.

4. **Never disable the reveal while it can still succeed; always say what missing it
   costs.** §4.8's asymmetry. The urgent state's second line is a sentence, not a
   colour: `Reveal closes at block 51 204 120 — sign now`. The closed state says who gets
   the bond: `your bond is claimable by the maker`.

5. **Reconcile against the chain on return, not against memory.** On every load the
   strip cross-checks each record with the subgraph's `Bid` row (`revealed`,
   `bondStatus`) and the head. The label is derived from that, so a bid revealed from
   another browser shows `revealed ✓` here too, and a stale record cannot show `Reveal
   now` after `revealEnd` (the Blur lapsed-bid lesson).

**What we do not do.** No browser Notifications API (a permission prompt on a page a
stranger was handed is worse than the risk); no email; no "reveal for me" relayer (that
is an auctioneer, which is the thing the project removes); no auto-reveal in a service
worker (a background transaction from a user's wallet without a click is not
something any surveyed product does, and for good reason).

**Uncertainty.** Whether ten blocks is the right urgency threshold. ENS's 60 s timer
and our 60 s reveal window are the same length, and ENS shows no urgency colour at all;
but ENS's second step costs nothing to miss. I would rather over-warn on a step that
forfeits money and I recommend 10 blocks (≈ 20 s), reviewed after the first tester who
misses one.

---

## 6. The walk-away matrix

What a user sees on return, by where they left. "Return" means reloading, reopening the
tab, or opening another route of the app in the same browser. Different browser: the
strip is empty and `Enter secret` is the path.

| Left during | Local record | On return, the strip / stepper shows |
|---|---|---|
| typing a bid, nothing sent | none | nothing; input is not preserved across loads (it is a number they can retype) |
| after `Copy bid secret` appeared, before signing | `{txHash: null}` | `▌ auction #7 · 250 bps not sent · commit closes in 12 blocks — Place sealed bid` if head ≤ commitEnd; else `expired unsent` once, then deleted |
| wallet open, commit unsigned | as above | as above; the wallet's own prompt may still be open — the label does not assume it was cancelled |
| commit pending on chain | `{txHash}` | `▌ auction #7 · sealing · 0x… ↗` until the `Bid` row appears, then `sealed · reveal opens in N blocks` |
| commit mined, before reveal opens | sealed | `▌ auction #7 · sealed 250 bps · reveal opens in 6 blocks` + tab title countdown |
| reveal open, not yet revealed | sealed | `▌ auction #7 · Reveal now · 23 blocks left` (whole line is the button) |
| reveal pending on chain | sealed, `revealTx` | `▌ auction #7 · revealing · 0x… ↗ · 4 blocks left` |
| revealed | — | `▌ auction #7 · revealed ✓ · leading` / `· runner-up · sets the price` / `· 3rd of 3` |
| reveal closed, unrevealed | sealed | `▌ auction #7 · reveal closed at block N · bond claimable by the maker` (`--brick`), or `· no bond was escrowed`; stays 24 h |
| settled, bond held, revealed | — | `▌ auction #7 · settled · Claim bond · 5 USDC` |
| any, record older than 24 h past `exclusiveEnd` | deleted | nothing; the auction's own timeline is the record |

Approval, settle and claim have no local state; their buttons read from chain on load.

---

## 7. Error vocabulary

Reverts are decoded from `data` by 4-byte selector against the Book ABI; the pre-flight
`simulateContract` catches almost all of them before the wallet opens. The sentence is
the whole message; the raw error goes in a `<details>` under it (NN/g: precise, plain,
constructive, and keep the input).

| Source | Sentence | Next step in the same line |
|---|---|---|
| `CommitClosed()` | `Commit closed at block N while you were signing` | — (the auction has moved on; the strip shows the next one) |
| `RevealClosed()` | `Reveal closed at block M · sent at block N` | `your bond is claimable by the maker` / `no bond was escrowed` |
| `RevealNotOpen()` | `Reveal opens at block N` | countdown |
| `AlreadyCommitted()` | `Already sealed from this wallet · #k` | `Enter secret if this browser does not have it` |
| `NoCommitment()` | `No sealed bid from 0x… on this auction` | `Are you on the right wallet?` |
| `AlreadyRevealed()` | `Revealed ✓` | — |
| `BadReveal()` | `The secret does not match the sealed bid` | `Check bps and salt` |
| `BidOutOfRange(bps, r, m)` | `The bid must be between r and m` | fields kept |
| `AlreadySettled()` | `Settled ✓` | — |
| `WindowNotElapsed()` | `Settles after block N` | countdown |
| `NotSettled()` | `Bond is returned after settle` | — |
| `NothingToClaim()` | `Nothing to claim for 0x…` | the bond's actual status from the subgraph |
| `NotOpened()` / `AlreadyOpened()` / `BadWindow()` / `NotRouter()` | should be unreachable from the page; shown as `Failed — Try again` with the raw name in `<details>` and logged | — |
| wallet 4001 | `Cancelled in wallet` (+ `· N blocks left` on reveal) | — |
| wallet 4902 | handled: `wallet_addEthereumChain` | — |
| wallet -32002 | `Open your wallet — a request is already waiting` | — |
| insufficient funds | `Not enough ETH on Base for gas` | est. cost in mono |
| RPC/network | `Base RPC did not answer` | `Try again`; the head line shows `chain head unavailable · using indexed head` |
| receipt `status: 0` after send (simulation passed, state moved) | the decoded revert if available, else `Failed on chain — Try again ↗` | — |

Never shown: a hex selector alone, "execution reverted" alone, a stack trace outside
`<details>`, or the word "error" as the whole message.

---

## 8. Acceptance for CTAs

Additive to `ui-spec.md` §9 and `frontend-architecture.md` §10.

1. Every disabled button's visible text states a reason; a test walks `TxButton`'s state
   table and asserts no `disabled` state has the idle label.
2. Every wallet-bound button has exactly two pending labels, one containing `in wallet`
   and one containing a tx hash link; no third pending word exists in `web/`.
3. The local bid record is written **before** `writeContract` is called: a unit test
   stubs the wallet client to throw and asserts the record exists.
4. `Reveal` is enabled at `head == revealEnd` and disabled at `head == revealEnd + 1`
   against `max(H_i, H_c)`; `Place sealed bid` is disabled at `commitEnd − H_c ≤ 2`.
5. `Settle auction` enablement equals `canSettle(a, head)` and never equals
   `phase(a, head) == 'open'` (a fixture with `bestBidder == null` in the 15-block gap).
6. The bps input rejects `.`, `,`, `-`, `e` and whitespace at the keystroke; the label
   shows the parsed integer.
7. Every revert selector in the Book ABI has a row in §7; a test enumerates the ABI's
   `error` entries and asserts coverage.
8. The strip appears on all three routes when a record exists, and the tab title carries
   the countdown from `Sealed` until `revealed` or `closed`.
9. `grep -c "external\|Submit\|Get \|my bid\|!" web/components/cta` returns 0.
10. A full commit → reveal → settle → claim from a browser on a live `humanDemo` auction
    with `bond > 0` from a team wallet, with one deliberate walk-away (close the tab after
    `Sealed`, reopen, reveal from the strip) — recorded in `run.md` with block numbers.
