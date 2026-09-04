**Version 0.4.0 - 2026-09-05 - simulation-backed parameter selection.**

# Sizing the exclusive window

`exclusiveBlocks` was a guess. This is the analysis that replaced it.
Reproduce with `node scripts/simulate-window.mjs` (seeded, no dependencies).

## Why it is not just execution time

During the window the winner holds a **right, not an obligation**, to fill at the improved
price. That is a free American call on the maker's order, struck at `P·(1+c)`, expiring in
W blocks. Two consequences pull against each other:

- A longer window makes the option worth more, so bidders bid more and the clearing price
  rises.
- A longer window also lets the winner be selective. They exercise when the market has
  moved their way, which is when it has moved **against the maker**.

The question is whether the extra revenue covers the adverse selection. It is a real
question, because the same free-option dynamic is what makes market makers wary of RFQ
and Dutch systems generally.

## Model

- Mid price is a driftless random walk in log space, one step per block, 2 s blocks (Base).
- Bidder `i` has a private edge `eᵢ` in bps, drawn from an exponential with mean 150 bps.
  Searcher edges are right-skewed: a few large, many small.
- Break-even bid is `eᵢ + O(W)`, where `O(W) = σ·√(2W/π)` is the expected running maximum
  of the walk - what the right to wait is worth.
- Second-price sealed bid; `clearing = max(reserve, second highest)`.
- Maker's net improvement over not running an auction is `clearing − ΔM` at the fill
  block: they captured `clearing`, but sold into a mid that had moved by `ΔM`.

Two exercise rules are reported, because how patient real searchers are is not something
we know:

| Rule | Behaviour | What it bounds |
|---|---|---|
| **EAGER** | Fills at the first block where it pays | Lower bound on adverse selection. Also internally generous: bidders pay for a waiting right they then decline to use. |
| **PATIENT** | Fills at the profit-maximising block, with perfect foresight | Upper bound. No searcher is clairvoyant, but this is the rule the bid model assumes, so it is the internally consistent one. |

The truth sits between them.

## Result

200,000 trials per cell. All figures in basis points.

**ETH/USDC-like, 60% annual volatility, 3 bidders**

| W (blocks) | secs | option | clearing | EAGER net | PATIENT net |
|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 1.21 | 126.41 | 125.71 | **125.11** |
| 5 | 10 | 2.70 | 127.84 | 126.77 | **124.83** |
| 15 | 30 | 4.67 | 129.36 | 127.72 | **123.92** |
| 30 | 60 | 6.60 | 131.63 | 129.46 | **123.80** |
| 150 | 300 | 14.77 | 139.72 | 134.83 | **121.51** |

**Volatile pair, 200% annual volatility, 2 bidders** - the case that decides it

| W (blocks) | secs | option | clearing | EAGER net | PATIENT net |
|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 4.02 | 79.15 | 77.69 | **75.74** |
| 5 | 10 | 8.99 | 84.31 | 81.75 | **75.51** |
| 15 | 30 | 15.56 | 90.53 | 86.25 | **74.05** |
| 30 | 60 | 22.01 | 96.80 | 90.77 | **72.79** |
| 150 | 300 | 49.22 | 124.21 | 107.53 | **67.22** |

## What it says

**A long window inflates the headline and costs the maker.** Going from a 2-second window
to a 300-second one on the volatile pair raises the clearing price from 79 to 124 bps - it
looks 57% better - while the maker's net *falls* from 75.7 to 67.2 bps, about 11% worse.
The option premium does not cover the adverse selection it creates.

Under the eager rule the maker net rises with W instead. That rule is the generous one,
and the reason it is generous is instructive: bidders there pay for a waiting right they
never use. Taking the two bounds together, the revenue case for a long window is somewhere
between small and negative, and it is never large.

**Meanwhile lockup is a certain cost.** Every block of window is a block in which the
order is unavailable to the market, and the whole argument against `WhitelistSequential`
is that locking outsiders out is the problem. A 300-second window is the ladder's own
lockup, which is the sharpest objection anyone could raise.

**Between 10 s and 30 s the difference is noise.** At normal volatility the maker net moves
under 1 bp between W=5 and W=15; at 200% volatility it is about 1.5 bps out of 75, so
roughly 2%. Nothing in the economics distinguishes them.

## Decision

**`exclusiveBlocks = 15` (30 seconds on Base).**

The simulation rules out the long end firmly and is indifferent across the short end, so
the choice is settled by what a human winner needs in order to see they have won and sign
a transaction. Ten seconds does not accommodate that; thirty does. If Glasshouse were
running against bots only, W=5 would be equally defensible and slightly better on the
consistent rule.

The remaining cost is stated rather than hidden: at 30 seconds the free option is worth
about 4.7 bps at normal volatility and 15.6 bps on a volatile pair, and roughly 2% of the
maker's net improvement is being spent on it.

## What this analysis does not cover

- Real searchers are neither perfectly eager nor clairvoyant; the true cost is inside the
  bracket but its position is not established here.
- Bidders are assumed to bid their break-even, which is the dominant strategy under a
  second-price rule but assumes they price the option correctly.
- Edges are independent draws. Correlated edges, which is what a bidder ring looks like,
  are not modelled.
- The walk is driftless. A pair with genuine drift over the window would shift the
  adverse selection in one direction.
