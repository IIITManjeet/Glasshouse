"use client";

/**
 * The same order, three ways. ui-spec.md section S1.
 *
 * These figures already existed, in the static essay. They are repeated here because the
 * product is the front door and the essay is a link away, and a visitor who never clicks
 * the link should still meet the one comparison the whole project rests on. The numbers
 * are copied from `site/index.html` verbatim, including the caption, because two copies of
 * a number that disagree is worse than one copy nobody reads.
 *
 * The `Who won` column is the addition ui-spec.md asks for: the table then says in words
 * what the lens beside it says in a picture -- both existing gates hand the fill to the
 * participant who values it least, and it is not close.
 *
 * EVERY FIGURE HERE IS FROM A UNIT TEST. Assigned valuations, mock tokens, a warped clock.
 * The chip says so, the caption says so at length, and it says so before it says anything
 * flattering -- an adversarial review found the earlier page printing these three numbers
 * with nothing to indicate they were not a measurement of the world.
 */

type Row = {
  gate: string;
  opcode: string;
  valuesBps: number;
  givesUp: string;
  against: string;
  who: string;
  /** Bar width as a share of the widest row, for the same visual the essay draws. */
  width: number;
  win?: boolean;
  worse?: boolean;
};

const ROWS: Row[] = [
  {
    gate: "By identity",
    opcode: "0x2d",
    valuesBps: 100,
    givesUp: "10 000",
    against: "Level with no auction at all",
    who: "Cyd · valued 100 · the incumbent on the ladder",
    width: 62,
  },
  {
    gate: "By clock",
    opcode: "0x94",
    valuesBps: 100,
    givesUp: "10 618",
    against: "6.2% worse for the maker",
    who: "Cyd · valued 100 · first in the block",
    width: 66,
    worse: true,
  },
  {
    gate: "By bid",
    opcode: "0x2e",
    valuesBps: 400,
    givesUp: "9 756",
    against: "2.4% better, and the right bidder won",
    who: "Ada · valued 400 · slowest of the three",
    width: 57,
    win: true,
  },
];

export function Comparison() {
  return (
    <figure data-src="test" className="border border-rule bg-raised rounded-card shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          The same order, three ways
        </span>
        <span className="chip">
          Source · Foundry test · test/Comparison.t.sol
        </span>
      </figcaption>

      <p className="px-4 pt-4 text-[0.86rem] leading-relaxed text-ink-soft">
        One order. Three participants with the same valuations each time, identical balances and swap curve in
        all three programs, so the only variable is how the right to fill is decided. The participant who
        values the fill least is also the fastest, and is the incumbent on the ladder — because that is the
        situation the mechanism is supposed to handle.
      </p>

      <div className="overflow-x-auto px-4 py-4">
        <table className="w-full min-w-[42rem] border-collapse text-[0.84rem]">
          <thead>
            <tr className="border-b border-rule text-left font-mono text-[0.64rem] uppercase tracking-[0.12em] text-ink-faint">
              <th className="py-2 pr-4 font-normal">Gate</th>
              <th className="py-2 pr-4 text-right font-normal">Winner values</th>
              <th className="py-2 pr-4 text-right font-normal">Maker gives up</th>
              <th className="py-2 pr-4 font-normal">Against base</th>
              <th className="py-2 font-normal">Who won</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr
                key={r.opcode}
                className={`border-b border-rule align-top ${r.win ? "bg-glass-soft" : ""}`}
              >
                <td className="py-2.5 pr-4">
                  {r.gate}{" "}
                  <code className="ml-1 border border-rule px-1 py-0.5 font-mono text-[0.7rem] text-ink-faint">
                    {r.opcode}
                  </code>
                </td>
                <td className="tnum py-2.5 pr-4 text-right">{r.valuesBps} bps</td>
                <td className={`tnum py-2.5 pr-4 text-right ${r.win ? "text-glass" : r.worse ? "text-brick" : ""}`}>
                  {r.givesUp}
                </td>
                <td className="py-2.5 pr-4">
                  <span className={r.win ? "text-glass" : r.worse ? "text-brick" : "text-ink-soft"}>
                    {r.against}
                  </span>
                  {/* The bar is the essay's, redrawn: it is a comparison of three numbers
                      whose differences are small enough that a column of digits alone
                      hides them. It is not a scale from zero and does not pretend to be. */}
                  <span className="mt-1.5 block h-1 bg-sunk">
                    <span
                      className={`block h-full ${r.win ? "bg-glass" : r.worse ? "bg-brick" : "bg-ink-faint"}`}
                      style={{ width: `${r.width}%` }}
                    />
                  </span>
                </td>
                <td className="py-2.5 text-[0.8rem] text-ink-soft">{r.who}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 pb-3 text-[0.8rem] text-ink-faint">
        Basis points of the base price; lower is better for the maker. Both existing gates hand the fill to
        the participant who values it least. The clock additionally concedes to the taker every second it runs.
      </p>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
        <code className="font-mono">test_Comparison_AllThreeGatesOnTheSameOrder</code> in{" "}
        <code className="font-mono">test/Comparison.t.sol</code>, run with{" "}
        <code className="font-mono">npx hardhat test solidity</code>. Two mock tokens (
        <code className="font-mono">TokenMock</code> &ldquo;Token I&rdquo;/&ldquo;Token J&rdquo;), static balances
        1000 / 2000, swap 1. Three test addresses with <strong>assigned</strong> valuations — Ada 400 bps,
        Bram 250, Cyd 100 — where Cyd is also assigned the first position in the block and the first rung on
        the ladder. The clock row is read once, 60 s after start, with decay 0.999 per second over a 600 s
        window (the slowest factor in upstream&rsquo;s own tests, i.e. the one kindest to the clock). Auction
        parameters in the test are 5 / 5 / 10 blocks, reserve 10, max 500, not the deployed 30 / 30 / 15.
        Nothing here was observed on a network.
      </p>
    </figure>
  );
}
