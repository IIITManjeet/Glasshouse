# Decisions

Every judgment call on this project, in the order it was made, in plain language.

Two reasons this file exists. It is the record of who directed the work, which the event's
rules ask for. And it is what the demo video gets narrated from, so it is written to be
spoken rather than skimmed.

`run.md` §4 holds the formal version with `D-nnn` ids, options considered, and the research
each one rests on. This is the readable one.

> **Blanks marked `[ ]` are for the decider to fill in their own words.** Do not fill them
> in for them. Slightly rough first-person prose is more convincing than polished prose,
> and it is the part no one else can write.

---

## 1. Drop EigenLayer and Sui — 3 Sep

**Decided:** abandon the original premise and re-aim at 1inch.

The project started as an MEV bidding layer on EigenLayer, optionally on Sui. Research
against the live sponsor list found that EigenLayer is not a sponsor at this event, Sui is
not a sponsor, and there is no MEV or Flashbots track. The entire prize pool is sponsor
bounties, so the original idea mapped to zero addressable prize money.

**Why this and not the alternative:** the alternative was to build the genuinely novel Sui
post-Shio MEV protection layer, which is a real open gap but worth nothing at this event.
Keep the intellectual core, change the surface it is expressed through.

`[ ] In your words: what made you willing to throw away the original premise?`

## 2. Go after a verified gap, not a safe integration — 3 Sep

**Decided:** novel mechanism, infrastructure-deep, rather than a comfortable integration.

Six years of ETHGlobal results say the same thing: every project touching real
builder, relay or auction infrastructure won something, and the projects that lost were
consumer wrappers, dashboards and analytics over someone else's infrastructure.

`[ ] In your words: why take the harder path with nine days on the clock?`

## 3. The name is Glasshouse — 3 Sep

Checked against GitHub and DefiLlama for collisions. Rejected **Candle** (permanently fights
"candlestick chart" in search, and collides with a well-known Rust ML crate), **Witness**
("witness" is an overloaded term in ZK), and **Gavel** (clear but least distinctive).

## 4. Attack the taker axis, not the maker axis — 3 Sep

**Decided:** the mechanism decides *who may fill*, not *what the fee is*.

Three independent adversarial reviews of the design came back MAJOR REWORK, DESCOPE and
QUALIFIES WITH FIXES. None said kill, but all three agreed on one thing: never pitch this
as an auction-managed AMM or a fee auction. A project doing exactly that won **first place
in this same 1inch track** at ETHGlobal New York three months ago.

What survived that review is the whole idea: SwapVM allocates taker priority by identity or
by clock, and **neither allocates by bid**. Nobody has touched that axis.

`[ ] In your words: the moment you realised the fee-auction version was already taken.`

## 5. Freeze the build on Wednesday 10 Sep — 5 Sep

**Decided:** stop building three days before the deadline.

Submission is the 13th. The build ends on the 10th, and 11–13 September are for studying the
work, putting it in front of real people, and acting on what comes back.

Two things follow from that. The explanation page stops being optional, because it is what a
tester is handed — if it needs a walkthrough from the author it has failed. And the schedule
loses its slack, so the cut order is live from day one instead of held in reserve.

`[ ] In your words: why real user testing was worth three days of build time.`

## 6. Keep the planning artifacts in the repo — 5 Sep

**Decided:** `run.md` and the design documents ship with the submission.

The instinct was to clean them out before submitting. The event's own rules say the
opposite, verbatim: *"you must include all spec files, prompts, and planning artifacts in
your submission repository. Judges need to see the full picture of how you directed the AI,
not just the generated output."*

They are also the defence against the rule that matters most — a submission that *"relies
entirely on AI"* may lose prize eligibility. Evidence of direction is exactly what a sourced
decision log with its superseded conclusions left visible provides.

## 7. Simulate the exclusive window instead of guessing it — 5 Sep

**Decided:** *"we should perform some mathematic simulation around this idea to get to the
one probabilistically acceptable window."*

This turned out to be the sharpest call on the project, because the window is not what it
looks like. It is a **free option** granted to the auction winner: the right, not the
obligation, to fill at the improved price. A longer window raises bids, and simultaneously
lets the winner exercise only when the market has moved against the maker.

The Monte Carlo settled it. On a volatile pair, stretching the window from 2 seconds to 300
raises the clearing price from 79 to 124 basis points — it looks 57% better — while the
maker's net **falls** from 75.7 to 67.2. The premium does not cover the adverse selection it
creates.

**Result: `exclusiveBlocks = 15`, thirty seconds.** The simulation rules out the long end and
is indifferent across the short end, so the choice fell to what a human winner needs in order
to see they have won and sign a transaction.

`[ ] In your words: why you asked for a simulation instead of accepting a number.`

## 8. Test the whole reserve range instead of picking one — 5 Sep

**Decided:** *"we can show all these cases and cover a lot more broader scope as well and
can also test our logics and mechanisms are working fine or not."*

The sweep showed the reserve is only a floor once competition exists — with five bidders the
clearing price is identical at every reserve tested — but with thin competition it is the
**only** thing protecting the maker.

**Result: `reserveBps = 50`, and it is derived rather than chosen.** Running an auction costs
the maker price risk across the frozen order: the mid moves about 44 basis points over the
150-second lockup on a volatile pair. A reserve below that makes running the auction worse
than simply posting a limit order.

That reasoning matters because the tempting reason to pick 50 was that it flatters the demo.

## 9. Total lockup of 150 seconds — 5 Sep

**Decided:** 30 blocks to commit, 30 to reveal, 15 exclusive.

Half the 300-second lockup that a `WhitelistSequential` ladder imposes on outsiders — which
is the comparison a judge will make, and the one the whole argument rests on.

## 10. Invite real bidders, and split it into two runs — 5 Sep

**Decided:** 3–5 real people bid in the live auction.

A subgraph indexing three wallets we control is not a market, and a judge sees that
instantly. Real bidders make it a small but genuine one.

That forced a second decision. The bond escrows at **commit**, so a friend who is slow to
reveal would forfeit real money — an unacceptable way to treat someone doing you a favour.
So there are two runs: **Run A** bonded, on our own accounts, proving forfeiture works with
real value moving; **Run B** unbonded with invited bidders on longer windows, as the headline.

`[ ] In your words: who you invited and what you asked them to do.`

## 11. `[ ] Keep or cut The Graph` — pending

---

## What the video has to carry

Four minutes, human-narrated. AI voiceover is an automatic reject.

1. **The problem, from source.** Two shipped opcodes. One gates by identity and reverts on
   outsiders. One gates by clock, and its price is a pure function of `block.timestamp`, so
   every bidder in a block sees the same number and the fastest wins. Neither asks what the
   fill is worth.
2. **The measurement.** One order, three ways. Identity 10 000, clock 10 618, bid 9 756 basis
   points of base — and the bid gate is the only one where the participant who valued it most
   actually got it.
3. **It runs.** A real fill through the official Aqua on Base: 0.01 WETH in, 38.986354 USDC
   out, gated by opcode `0x2e`, priced at the second bid.
4. **The honest part.** It is slower than what it replaces. The window is still a free option
   worth a few basis points. Forfeiture needs evidence, so a no-show nobody else fills behind
   keeps its bond. Say all of it — the limits are more convincing than the claims.

**The question to be ready for:** *"isn't this just a Dutch auction?"* Dutch is equivalent to
first-price sealed bid in a frictionless model. On chain `block.timestamp` is quantised to
the block and ordering inside the block is sold to the highest priority fee, so the clock
awards the fill to the lowest-latency participant regardless of valuation. The fix is not a
better clock. It is to stop using one.
