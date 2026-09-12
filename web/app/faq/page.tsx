import Link from "next/link";
import { Mechanism } from "@/components/Mechanism";
import { LatencyLens } from "@/components/Lens";

/**
 * ONE FLAT PAGE. NO ACCORDION, NO STATE, NO CLIENT BOUNDARY.
 *
 * Every one of those is a deliberate refusal, and each has a reason that is not taste.
 *
 * An accordion is a click tax on a page whose only job is reading. Worse, a collapsed
 * `<details>` body is invisible to find-in-page in Safari and Firefox, so the one reader
 * who knows exactly which word they are looking for is the reader it fails. And worst:
 * every instrument panel on this site deep-links in here -- `/faq#check`, `/faq#house`,
 * `/faq#blocks` -- and an answer that is CLOSED when the link lands has not answered
 * anything. The anchor has to arrive on an open paragraph.
 *
 * No `"use client"`, which is what makes the above true of the SERVED HTML rather than of
 * the hydrated page. Both figures render at build time into `web/out/faq/index.html`, which
 * is what a crawler sees, what a screenshot sees, and what `scripts/lint-provenance.mjs`
 * scans -- `faq/index.html` is in its `APP_PAGES`.
 *
 * THE PROSE IS LIFTED, NOT WRITTEN. Almost every answer below is sentences moved verbatim
 * or near-verbatim out of the components and the README that already made the claim, and
 * the source is named in a comment above each one. That is not laziness: a claim rewritten
 * fresh is a claim nobody has checked, and this page is the one place a reader goes
 * expecting plain statements of fact. Where a sentence had to change to stand alone it was
 * trimmed rather than reworded.
 *
 * WHY THE TWO FIGURES ARE HERE AND NOT ON /evidence. `<Mechanism>` is a drawing of the
 * contract's rule and `<LatencyLens>` is a drawing of a unit test. Neither is a record of a
 * chain event, so neither is evidence -- they are the ARGUMENT, and the argument belongs on
 * the page that answers "why is it built this way". Both keep their own `<figure data-src>`
 * wrapper and their own "What produced this" caption, which travel with the component.
 *
 * WHY `.prose-measure` IS ON EVERY PARAGRAPH AND NOT ON THE ANSWER. It sets a 44rem max
 * width, which is right for a sentence and wrong for a figure: the mechanism SVG has a
 * 52rem min-width, so putting the measure on a wrapper would have forced the one diagram
 * that explains the whole product to live permanently inside a horizontal scrollbar. Text
 * is measured; figures get the page.
 */

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";
const ROUTER = "0x5c3baE054e8b4915a13726B397b1AeA864247DBf";
const REPO = "https://github.com/IIITManjeet/Glasshouse";

/** The index, the page order and every heading, from one list. Two hand-maintained copies
 *  of a set of anchors is how a link to `#seald` ships. */
const GROUPS = [
  {
    id: "what-this-is",
    title: "What this is",
    questions: [
      ["what", "What is Glasshouse?"],
      ["bidding-for", "What am I actually bidding for?"],
      ["round", "How does a round work?"],
      ["second-price", "Why does the winner pay the runner-up’s price, not their own?"],
      ["sealed", "Why are bids sealed?"],
    ],
  },
  {
    id: "taking-part",
    title: "Taking part",
    questions: [
      ["need", "What do I need to bid?"],
      ["reveal", "What happens if I seal a bid and never reveal it?"],
      ["secret", "What is the bid secret and where is it kept?"],
      ["house", "Who is the “house” bidder, and why is it in every round?"],
      ["keeper", "Why is there sometimes no round open?"],
      ["blocks", "Why are windows counted in blocks, not seconds?"],
      ["real", "Is this a real market?"],
      ["rehearsal", "What is “Rehearsal”?"],
    ],
  },
  {
    id: "checking-it",
    title: "Checking it",
    questions: [
      ["check", "How do I check a round myself, without trusting this site?"],
      ["replay", "What does “matches an independent replay” mean?"],
      ["subgraph", "What is the subgraph for, and what does it refuse to compute?"],
    ],
  },
  {
    id: "why-built-this-way",
    title: "Why it is built this way",
    questions: [
      ["why-not-clock", "Why not a whitelist or a Dutch auction?"],
      ["why-not-avs", "Why not an AVS or restaking?"],
      ["contracts", "Where are the contracts, and who can change them?"],
      ["more", "Where is the long version?"],
    ],
  },
] as const;

const TITLES = new Map<string, string>(
  GROUPS.flatMap((g) => g.questions.map(([id, q]) => [id, q] as [string, string])),
);

const linkClass = "text-glass underline underline-offset-2";

/**
 * A question, with its heading text taken from the index rather than retyped.
 *
 * `scroll-mt-8` is the whole reason this is a component rather than a bare `<h3>`: an
 * anchor that lands with its own heading tucked against the top of the viewport reads as
 * having landed on the previous answer, which is the failure mode a deep link exists to
 * avoid.
 */
function Q({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mt-9 scroll-mt-8">
      <h3 className="text-[1.0625rem] font-semibold text-ink">{TITLES.get(id)}</h3>
      <div className="mt-2 text-ink-soft">{children}</div>
    </div>
  );
}

/** A measured paragraph. Everything a person reads goes through this; nothing a machine
 *  drew does. */
function P({ children }: { children: React.ReactNode }) {
  return <p className="prose-measure mt-3 first:mt-0">{children}</p>;
}

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-[62rem] py-8">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Questions, answered in full
      </h1>
      <p className="prose-measure mt-3 text-ink-soft">
        Every answer is open. Nothing here is behind a click, because the panels on the rest
        of the site link into this page and an answer you have to expand has not been given.
      </p>

      {/* The index is a list of anchors and nothing cleverer. It is also the only place the
          shape of the page is visible at a glance, which is exactly what a reader who
          arrived from a deep link needs in order to know what else is here. */}
      <nav
        aria-label="Questions on this page"
        className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 border-y border-rule py-5 sm:grid-cols-2"
      >
        {GROUPS.map((g) => (
          <div key={g.id}>
            <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {g.title}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {g.questions.map(([anchor, question]) => (
                <li key={anchor}>
                  <a
                    href={`#${anchor}`}
                    className="text-[0.8125rem] text-ink-soft underline-offset-2 hover:text-glass hover:underline"
                  >
                    {question}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ============================================================== 1 =============== */}
      <section id="what-this-is" className="mt-12 scroll-mt-8">
        <h2 className="border-b border-rule pb-2 font-display text-xl font-semibold text-ink">
          What this is
        </h2>

        {/* Lifted: app/page.tsx headline and standfirst, plus README.md "What Glasshouse
            adds". The opcode and the slot it occupies are the README's own words. */}
        <Q id="what">
          <P>
            SwapVM ships two ways to allocate the right to fill an order. One asks who you
            are. The other asks what time it is. Glasshouse asks what you will pay — a
            sealed-bid, second-price auction, settled on chain.
          </P>
          <P>
            It is one custom instruction: <code className="font-mono">Opcode._2e</code>, the
            free slot immediately after{" "}
            <code className="font-mono">WhitelistSequential</code> in SwapVM&rsquo;s{" "}
            <em>Conditions &amp; access guards</em> bank, gating the fill on a sealed-bid,
            second-price auction with a committed close. The winning bid is a price
            improvement in basis points applied to{" "}
            <code className="font-mono">balanceIn</code>, so ordinary SwapVM settlement
            delivers the surplus to the maker. No transfer, no custody, no fee router.
          </P>
        </Q>

        {/* Lifted verbatim: components/HowToBid.tsx:34-38. */}
        <Q id="bidding-for">
          <P>
            Bidding is for the right to <em>fill</em> an order — to be the one who trades
            against it. You bid in basis points of improvement you are willing to give the
            maker, and the winner pays the runner-up&rsquo;s bid, not their own.
          </P>
        </Q>

        {/* The figure first, then the steps. `Mechanism` draws all three phases at once,
            which is the one thing no live board can do: a board shows whichever phase
            happens to be running when you arrive. */}
        <Q id="round">
          <P>
            Three phases, disjoint in block space: commit, reveal, settle. The picture is the
            whole round at once; the steps under it are the same round from the
            bidder&rsquo;s side.
          </P>
          <div className="mt-5">
            <Mechanism />
          </div>
          {/* Lifted verbatim: components/HowToBid.tsx:46-57, the four steps. */}
          <ol className="mt-6 space-y-4">
            {[
              [
                "Connect a wallet on Base",
                "A browser wallet — MetaMask, Rabby — on Base mainnet. You need a little ETH for gas. Reading the board needs no wallet at all; only bidding does.",
              ],
              [
                "Seal a bid while the commit window is open",
                "You send a hash of your number and a secret, never the number. Nobody — not other bidders, not the maker, not us — can read it. Your position in the queue is fixed the moment you commit, so bidding early cannot be punished and cannot be gamed.",
              ],
              [
                "Open it while the reveal window is open",
                "You send the number and the secret, and the contract checks they match the hash you committed. A bid that is never opened cannot win. This is the step people forget, and the one your record on this site remembers.",
              ],
              [
                "If you win, fill inside your exclusive window",
                "The highest revealed bid wins and pays the second-highest — or the reserve, if there was no second. For a short window only you may fill at that improved price. After it, anyone may fill at the base price instead.",
              ],
            ].map(([title, body], i) => (
              <li key={title} className="prose-measure flex gap-3">
                <span aria-hidden className="tnum mt-0.5 shrink-0 text-glass">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium text-ink">{title}</div>
                  <p className="mt-0.5">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="prose-measure mt-4 text-ink-faint">
            The windows this Book is opened with are 30 blocks to commit, 30 to open and 15
            exclusive — about a minute each at Base&rsquo;s block time.
          </p>
        </Q>

        {/* Lifted: components/Settlement.tsx:372-383 caption, components/Receipt.tsx:237,
            components/Mechanism.tsx:192-193. All three already said it; none of them said it
            anywhere a reader could find on purpose. */}
        <Q id="second-price">
          <P>
            Because paying the runner-up rather than your own bid is what makes bidding your
            true value safe: what you bid decides <em>whether</em> you win, not what you pay
            for it. On the settlement chart the price line is drawn from the runner-up
            because that is where the number comes from — the winner&rsquo;s own bid decided
            only that they won.
          </P>
          <P>
            The price is <code className="font-mono">clearingBps</code> —{" "}
            <code className="font-mono">max(reserveBps, secondBps)</code> from
            GlasshouseBook.sol:229, not a figure computed by this site. The gap between what
            the winner bid and what the winner paid is printed on every receipt as{" "}
            <em>what the winner kept</em>, and it is the reason bidding true is safe.
          </P>
        </Q>

        {/* Lifted: README.md:96-97. */}
        <Q id="sealed">
          <P>
            Sealed rather than open, for{" "}
            <strong className="font-medium text-ink">shill resistance</strong>: an open
            second-price auction lets the maker insert a bid just under the top. A commitment
            is a hash of the bid, a salt and the order, so until the reveal window opens there
            is nothing for anyone — the maker included — to read and bid against.
          </P>
        </Q>
      </section>

      {/* ============================================================== 2 =============== */}
      <section id="taking-part" className="mt-16 scroll-mt-8">
        <h2 className="border-b border-rule pb-2 font-display text-xl font-semibold text-ink">
          Taking part
        </h2>

        {/* Lifted: components/HowToBid.tsx:43-44, plus the reading-needs-no-wallet rule
            that app/layout.tsx states in a comment and the site never stated to a reader. */}
        <Q id="need">
          <P>
            A browser wallet — MetaMask, Rabby — on Base mainnet, and a little ETH for gas.
            That is all.
          </P>
          <P>
            Reading this site needs no wallet at all; only bidding does. That is deliberate,
            and it is one of the better decisions in the product: a page arguing that you do
            not have to trust it should not ask you to sign something before it will show you
            why.
          </P>
        </Q>

        {/* Lifted: components/BidPanel.tsx:845-851 (the "missed" state) and :866-869 (the
            warning shown to anyone holding a sealed bid). */}
        <Q id="reveal">
          <P>
            The bid is void. Nothing is taken from your wallet beyond gas — the bid simply
            does not count, and the round clears without it, which is exactly the cost of
            silence the bond exists to price.
          </P>
          <P>
            This page cannot reveal for you. If nothing signs the reveal between the block
            after the commit window closes and the block the reveal window ends on, the bid is
            void. It is the step people forget, and the one your{" "}
            <Link href="/account" className={linkClass}>
              record on this site
            </Link>{" "}
            remembers: bids sealed against bids opened is a reliability record, and the
            contract cannot tell someone who left a bid sealed from someone who simply went
            away.
          </P>
        </Q>

        {/* Lifted: components/BidPanel.tsx:316-318 and :504-506. */}
        <Q id="secret">
          <P>
            Your bid is a hash of the number and a salt. The pair of them — the bps and the
            salt — is the bid secret, and it is stored in this browser only. Copy it if you
            might reveal from another one: a sealed bid can only be opened with its secret, by
            anyone, including us.
          </P>
          <P>
            If you lost the browser but kept the numbers, the bid panel takes them back by
            hand. Nothing is validated there — the contract checks the pair at reveal, and a
            wrong one is rejected without costing the bid.
          </P>
        </Q>

        {/* README.md:99-107, IN FULL and not trimmed. This is the single most important
            disclosure on the site: the maker bids in its own auctions. Shortening it would be
            the one edit on this page that changes a claim. */}
        <Q id="house">
          <P>
            <strong className="font-medium text-ink">
              The demo maker bids in its own auctions, and it is labelled on the board.
            </strong>{" "}
            The keeper that keeps a live round on the page also places one bid per round, from
            the maker&rsquo;s own address, so that a lone visitor sees a second price rather
            than the reserve — a second-price auction with one bidder clears at the reserve and
            demonstrates nothing.
          </P>
          <P>
            It commits at index 0, before any visitor can have acted; it cannot read a sealed
            rival; it never reveals early; and its bond is 0. So it behaves as a randomised
            hidden reserve drawn from 60&ndash;200 bps, well under{" "}
            <code className="font-mono">maxBps</code>, and any real bidder can outbid it. It is
            marked <span className="chip">house · the maker</span> on its own bid card rather
            than explained away. A production maker would set{" "}
            <code className="font-mono">reserveBps</code> and not bid at all.
          </P>
        </Q>

        {/* Lifted: components/BidPanel.tsx:920-922. The hedge in that sentence is itself a
            recorded correction -- the panel used to promise a round unconditionally. */}
        <Q id="keeper">
          <P>
            A keeper opens the rounds. While it is running a new one arrives every couple of
            minutes and takes bids for its whole commit window — but nothing here can tell you
            whether it is running now, so this is what usually happens rather than a promise.
          </P>
          <P>
            The keeper is a script, not a hosted service. When there is no round open the board
            says so, and{" "}
            <Link href="/rounds" className={linkClass}>
              the rounds table
            </Link>{" "}
            says which phase the most recent one reached.
          </P>
        </Q>

        {/* Lifted: components/Auction.tsx:59-63, the Countdown header comment. */}
        <Q id="blocks">
          <P>
            Because the contract has no clock. It compares{" "}
            <code className="font-mono">block.number</code> against boundaries written when the
            round opened, so blocks are the enforced number.
          </P>
          <P>
            Seconds are this page multiplying blocks by an assumed 2 s, and they are wrong
            whenever Base is not producing at exactly that rate. Printing the estimate in the
            same weight as the enforced number would be the page quietly promoting its own
            guess — so blocks lead and seconds follow, everywhere.
          </P>
        </Q>

        <Q id="real">
          <P>
            No. Live rounds run with bond 0 and dust-sized orders, and the maker bids in its
            own auctions so that a lone visitor sees a second price at all. This is a working
            mechanism, not a market.
          </P>
          <P>
            What is real is the code path: the contracts are on Base mainnet, the auctions are
            real transactions, the clearing price is computed on chain, and every figure on
            this site can be re-derived from the Book&rsquo;s own logs by someone who does not
            trust it. The figures on{" "}
            <Link href="/evidence" className={linkClass}>
              the evidence page
            </Link>{" "}
            are counts, never shares, for the same reason.
          </P>
        </Q>

        {/* Lifted: components/DemoMode.tsx:26-37. */}
        <Q id="rehearsal">
          <P>
            A replay, and every number in it is simulated. Nothing in rehearsal was read from
            Base or from any chain. A round on Base takes 75 blocks, about two and a half
            minutes, and the keeper only opens one while it is running — so the rehearsal
            replays the full lifecycle at <span className="tnum">1 block / 0.4 s</span> against
            the same components, using the contract&rsquo;s own arithmetic over assigned bids.
          </P>
          <P>
            It is produced by <code className="font-mono">web/lib/simulate.js</code>. The block
            numbers it shows count from a chosen origin and are not Base blocks, and bidding is
            disabled: a commitment signed against a synthetic order hash could never be
            revealed. Whenever it is on, a banner says so on every page.
          </P>
        </Q>
      </section>

      {/* ============================================================== 3 =============== */}
      <section id="checking-it" className="mt-16 scroll-mt-8">
        <h2 className="border-b border-rule pb-2 font-display text-xl font-semibold text-ink">
          Checking it
        </h2>

        {/* Lifted: components/Receipt.tsx:313-316, and the two commands castCommands()
            builds at :43-49. The block range is per-round there; the shape is the same. */}
        <Q id="check">
          <P>
            Every figure on a receipt comes out of two calls. They need{" "}
            <code className="font-mono">foundry</code> and nothing else — no key, no account,
            no permission from us. Take the round&rsquo;s maker and order hash off its row in{" "}
            <Link href="/rounds" className={linkClass}>
              the rounds table
            </Link>
            , and the block range off the round&rsquo;s own page.
          </P>
          <pre className="mt-4 overflow-x-auto rounded-control bg-sunk p-3 font-mono text-[0.72rem] leading-relaxed text-ink-soft">
            {`# the auction struct, exactly as the contract stores it
cast call ${BOOK} "auctions(address,bytes32)" <maker> <orderHash> --rpc-url https://mainnet.base.org

# every commit and reveal on this round, in the order they landed
cast logs --address ${BOOK} --from-block <opened> --to-block <exclusiveEnd> --rpc-url https://mainnet.base.org`}
          </pre>
          <P>
            Every receipt on this site carries a <em>Check this yourself</em> panel with those
            two commands already filled in for that round, and a button to copy them.
          </P>
        </Q>

        {/* Lifted: components/Verification.tsx:6-27 header comment, and README.md:288-292 on
            what the replay compares and what it refuses to report as a disagreement. */}
        <Q id="replay">
          <P>
            <code className="font-mono">scripts/verify-run.mjs</code> reads the Book&rsquo;s
            logs, re-derives every auction outcome from the raw reveals{" "}
            <em>without importing any of the three implementations of the clearing rule</em>,
            and reports whether they agree. The settlement replay re-derives the
            contract&rsquo;s own top-2 rule from the reveals and compares it against what{" "}
            <code className="font-mono">settle()</code> emitted — a check, never an echo.
          </P>
          <P>
            What the evidence page shows is a snapshot of a run, not a live check, and
            everything about how it is presented keeps saying so: it prints the block it was
            taken at, the RPC it asked, and when. The failures are shown first and in full,
            because the verifier&rsquo;s entire worth is that it reports what it could not
            confirm — a panel that showed only the passes would be advertising a tool while
            defeating it. The direct-chain reader cannot run the replay at all and reports{" "}
            <code className="font-mono">null</code> rather than{" "}
            <code className="font-mono">false</code>: <em>not checked</em> and{" "}
            <em>checked and disagreed</em> are very different claims.
          </P>
        </Q>

        {/* Lifted: components/Timeline.tsx:18-35 and components/Record.tsx:14-31 header
            comments, plus README.md:294-295. The README sentence there names a metric whose
            acronym the provenance lint forbids on an app page, so it is spelled out rather
            than quoted. */}
        <Q id="subgraph">
          <P>
            Two questions the chain reader cannot answer. One is order: everything else shows a
            round&rsquo;s <em>current</em> state, and the timeline shows the sequence that
            produced it — which reveal took the lead from whom, and what the clearing price was
            immediately after each one. That ordering is the argument, not decoration: you can
            watch the number move to each new runner-up as the reveals land, and watch it not
            move when the winner&rsquo;s own bid comes in. The other is history: whether an
            address has ever left a bid sealed needs every round the Book has ever had, not the
            recent window the board holds.
          </P>
          <P>
            It re-derives nothing. The reveal event stores{" "}
            <code className="font-mono">bestBpsAfter</code>,{" "}
            <code className="font-mono">secondBpsAfter</code> and{" "}
            <code className="font-mono">clearingBpsAfter</code> — the state after that reveal
            was applied — specifically so a reader can replay a round without re-implementing
            the clearing rule.
          </P>
          <P>
            What it refuses: not a win rate, not a share, not a rank, not a profit figure.
            Rounds won is a count and is shown as a count, and where a denominator exists it is
            printed beside the numerator rather than divided into it. Conformance to the
            generic indexing schema is not claimed either — it wants non-null dollar
            value-locked and revenue fields that an auction book does not have and that we
            would have to fabricate.
          </P>
        </Q>
      </section>

      {/* ============================================================== 4 =============== */}
      <section id="why-built-this-way" className="mt-16 scroll-mt-8">
        <h2 className="border-b border-rule pb-2 font-display text-xl font-semibold text-ink">
          Why it is built this way
        </h2>

        <Q id="why-not-clock">
          <P>
            Because neither of them allocates by what the fill is actually worth. The figure
            below is the same three bidders under both rules — only the rule for choosing among
            them differs, and the axis each rule ignores is drawn rather than deleted.
          </P>
          <div className="mt-5">
            <LatencyLens />
          </div>
          {/* Lifted: README.md "The problem", the two paragraphs -- identity and clock. */}
          <div className="mt-6">
            <P>
              <strong className="font-medium text-ink">
                By identity — <code className="font-mono">WhitelistSequential</code> (
                <code className="font-mono">0x2d</code>).
              </strong>{" "}
              A hardcoded ladder of privileged takers, each with an exclusive window. An
              unlisted taker does not merely lose priority: it reverts until the entire
              cumulative ladder has elapsed. It is a cartel ladder written into the order.
            </P>
            <P>
              <strong className="font-medium text-ink">
                By clock — <code className="font-mono">DutchAuctionBalanceIn</code> /{" "}
                <code className="font-mono">Out</code> (<code className="font-mono">0x94</code>{" "}
                / <code className="font-mono">0x95</code>).
              </strong>{" "}
              The price is a pure function of{" "}
              <code className="font-mono">block.timestamp</code>. Every transaction in a block
              shares one timestamp, so every bidder in that block faces an identical price and
              valuation cannot break the tie. Allocation is decided by intra-block ordering —
              by priority fee and builder placement — and the surplus above the posted price is
              competed away into priority fees paid to the builder, not returned to the maker.
              The descending clock does not price the order; it runs a latency auction whose
              proceeds leak out of the protocol.
            </P>
            <P>
              A maker who does not want an auction leaves{" "}
              <code className="font-mono">0x2e</code> out of the program, and nothing here
              applies to them — that is the point of it being an opcode rather than a protocol
              rule.{" "}
              <Link href="/evidence" className={linkClass}>
                The evidence page
              </Link>{" "}
              carries the measured difference: the same order, the same three participants,
              under all three gates, from one Foundry test.
            </P>
          </div>
        </Q>

        {/* Lifted: README.md:303-317. */}
        <Q id="why-not-avs">
          <P>
            Because there is nothing here to secure. An off-chain auction committed by a signed
            operator quorum is an <em>unverifiable assertion</em>, and assertions need economic
            backing plus a challenge window — that design is correct for problems forced by
            latency. Loss-versus-rebalancing is per-block, and a commit-reveal auction cannot
            resolve inside one block, so those auctions <em>must</em> run off chain.
          </P>
          <P>
            Taker priority on a resting order is not per-block. Glasshouse can afford 150
            seconds, and for that price the winner is computed{" "}
            <strong className="font-medium text-ink">on chain</strong> from revealed bids:{" "}
            <code className="font-mono">outcome()</code> is a view function over state written
            permissionlessly by <code className="font-mono">commit</code> and{" "}
            <code className="font-mono">reveal</code>, with no owner, no admin and no upgrade
            path. Nobody makes a claim, so there is no claim to challenge. Adding an AVS would
            mean introducing a trusted party in order to then buy machinery to constrain it.
          </P>
          <P>
            The general rule: verify on chain when you can afford the latency; secure
            economically off chain when you cannot. Where defection <em>is</em> possible we
            already use capital at risk — <code className="font-mono">claimForfeit</code>,{" "}
            <code className="font-mono">claimUnrevealed</code>,{" "}
            <code className="font-mono">claimBond</code>.
          </P>
        </Q>

        {/* Lifted: README.md:137-143, plus the maker-side-bond asymmetry at :296-302, which
            is the unflattering half and is the reason this answer is not just two addresses. */}
        <Q id="contracts">
          <P>
            <code className="font-mono">GlasshouseBook</code> at{" "}
            <a
              href={`https://basescan.org/address/${BOOK}`}
              title={BOOK}
              target="_blank"
              rel="noopener"
              className={`${linkClass} tnum`}
            >
              0xc4ea…Fbfe
            </a>{" "}
            and <code className="font-mono">GlasshouseRouter</code> at{" "}
            <a
              href={`https://basescan.org/address/${ROUTER}`}
              title={ROUTER}
              target="_blank"
              rel="noopener"
              className={`${linkClass} tnum`}
            >
              0x5c3b…7DBf
            </a>
            , both on Base mainnet (8453). The footer carries them on every page, with the
            1inch Aqua the router points at.
          </P>
          <P>
            <code className="font-mono">GlasshouseBook</code> has{" "}
            <strong className="font-medium text-ink">
              no owner, no upgrade path, no admin
            </strong>
            . Auction parameters are immutable after{" "}
            <code className="font-mono">open()</code>. The answer to{" "}
            <em>
              who can change what <code className="font-mono">outcome()</code> returns?
            </em>{" "}
            is <em>nobody</em>, which is what makes the quote/swap consistency argument
            airtight.
          </P>
          <P>
            They are unaudited, and the known asymmetry is ours: bidders post bonds and the
            maker posts nothing, so a maker can open an auction against an order they never
            ship. The contract already refuses to mark a winner forfeited without positive
            evidence that someone else filled, precisely because it cannot distinguish a
            no-show from a misconfigured hook. A maker-side bond is the fix, and it means a new
            deployment — because the Book has no upgrade path by design.
          </P>
        </Q>

        <Q id="more">
          <P>
            The written argument is at{" "}
            <a href="/argument.html" className={linkClass}>
              /argument.html
            </a>{" "}
            — the same case at essay length, with the source paths inline. Every decision and
            the reason for it is in{" "}
            <a
              href={`${REPO}/blob/main/DECISIONS.md`}
              target="_blank"
              rel="noopener"
              className={linkClass}
            >
              DECISIONS.md<span aria-hidden> ↗</span>
            </a>
            , the design in{" "}
            <a
              href={`${REPO}/blob/main/docs/design/HLD.md`}
              target="_blank"
              rel="noopener"
              className={linkClass}
            >
              docs/design/HLD.md<span aria-hidden> ↗</span>
            </a>
            , and everything else in{" "}
            <a href={REPO} target="_blank" rel="noopener" className={linkClass}>
              the repository<span aria-hidden> ↗</span>
            </a>
            .
          </P>
        </Q>
      </section>
    </main>
  );
}
