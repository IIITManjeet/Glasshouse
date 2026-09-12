/**
 * AN ADDRESS BECOMES RECOGNISABLE WITHOUT BECOMING A PERSON.
 *
 * The ask was "personification of accounts". `components/Identity.tsx` had already refused
 * the obvious reading of that, and refused it for the right reason, which is quoted here
 * because this file is the exception to it and the exception has to carry the argument:
 *
 *   "Not an identicon. A generated picture is a face this address never chose, and on a
 *    page about provenance an invented identity is the wrong kind of decoration."
 *
 * That stands. A generated word-name ("Brave Falcon") is a name nobody chose and reads as a
 * person, so it stays refused. A blockie is a face by another route, so it stays refused.
 *
 * WHAT THIS DOES INSTEAD, and why it is not the same thing. A pair of hues derived from the
 * address invents no fact about anybody: it is a RENDERING of the address, the way
 * `0xeEbf…cDf` is a rendering of it. Nothing is claimed, nothing is stored, and there is
 * nothing a reader could mistake for information -- which is exactly the test the refusal
 * above sets. What it buys is the thing the raw hex could not do: six rows of addresses
 * become six recognisable participants, so a reader can follow one bidder from the rounds
 * table to the bid ladder to the settlement chart without re-reading forty hex characters.
 *
 * The handle is the mark plus the short hex plus the role. The hex is the handle; it is
 * visibly derived because it IS the address. The full 42 characters stay on the profile
 * header with a copy control and in the `title` of every link.
 *
 * PURE, so it can be tested and so two surfaces cannot disagree about one address.
 * `test/js/identity.test.js` pins the determinism and the split guarantee.
 */

export type AddressHues = { h1: number; h2: number };

/** How close two hues may be before they stop reading as two colours. Degrees. */
const MIN_SEPARATION = 40;

/**
 * Two hues from the first four bytes of the address.
 *
 * WHY THE SEPARATION GUARANTEE EXISTS. Without it, roughly a fifth of all addresses draw a
 * gradient between two neighbouring hues, which renders as a flat single-colour square --
 * not wrong, but it throws away half the distinguishing power for no reason and looks like
 * a rendering bug next to marks that clearly have two halves. Rotating the second hue by
 * 180° when the gap is too small is deterministic, costs nothing, and keeps every mark
 * legibly two-toned. The wrap-around case (`> 320`) matters as much as the near case: 350°
 * of separation is 10° the short way round.
 */
export function addressHues(addr: string): AddressHues {
  const hex = String(addr).toLowerCase().replace(/^0x/, "");
  const byte = (i: number) => {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return Number.isNaN(v) ? 0 : v;
  };

  const h1 = (byte(0) * 256 + byte(1)) % 360;
  let h2 = (byte(2) * 256 + byte(3)) % 360;

  const gap = (h2 - h1 + 360) % 360;
  if (gap < MIN_SEPARATION || gap > 360 - MIN_SEPARATION) {
    h2 = (h2 + 180) % 360;
  }

  return { h1, h2 };
}

/**
 * The two hues as CSS custom properties, which is the only form a component ever needs.
 *
 * The colour itself is computed in `globals.css` (`.addr-mark`), not here, so the light and
 * dark values live beside every other themed value rather than in a TypeScript file that
 * cannot see a media query. A component that wanted to compute the hsl() string itself
 * would have to know the theme, and knowing the theme in JS is how a page flashes the wrong
 * colour on first paint.
 */
export function markStyle(addr: string): React.CSSProperties {
  const { h1, h2 } = addressHues(addr);
  return { ["--h1" as string]: String(h1), ["--h2" as string]: String(h2) };
}

/**
 * The roles an address can hold in a round. Every one is read from the chain or from the
 * connected wallet -- none is inferred, and none is a label anybody chose for themselves.
 *
 *   house   the maker bidding in its own round. The most important disclosure on the site.
 *   you     the connected wallet.
 *   winner  settled, and this address held the best revealed bid.
 *   leading the same position before settlement, when it can still change.
 *   filled  this address actually filled the order.
 *   maker   opened the round (profile header only).
 */
export type AddressRole = "house" | "you" | "winner" | "leading" | "filled" | "maker";

/** What each role says, and the longer form for a `title`. Copy lives here so one wording
 *  serves the table, the ladder and the profile rather than three that drift apart. */
export const ROLE_COPY: Record<AddressRole, { short: string; title: string }> = {
  house: {
    short: "house",
    title: "The maker, bidding in its own round. Disclosed on every card rather than hidden.",
  },
  you: { short: "you", title: "The wallet connected to this browser." },
  winner: { short: "winner", title: "Held the highest revealed bid when the round settled." },
  leading: {
    short: "leading",
    title: "Holds the highest revealed bid so far. The round has not settled, so this can change.",
  },
  filled: { short: "filled", title: "Filled the order on chain, in the exclusive window." },
  maker: {
    short: "maker",
    title: "Opened this round. The maker sets the reserve and ships the order to Aqua.",
  },
};
