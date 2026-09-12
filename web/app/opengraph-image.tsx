import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The link card.
 *
 * The product is handed around as a URL -- to testers on Thursday, to judges after that,
 * and in whatever chat window someone pastes it into. Without this it previews as a blank
 * rectangle with a globe, which is the first impression a fair number of people will get
 * before they ever open it.
 *
 * Generated at BUILD time, not on request: Next statically optimises an ImageResponse that
 * touches no request-time API, which is what makes this compatible with
 * `output: "export"` (next.config.mjs). There is still no server.
 *
 * It says the mechanism rather than a slogan -- bid 400, pay 250 -- because the claim is
 * more interesting than any adjective available to describe it. No custom font is fetched:
 * a build-time font download is one more thing that can fail on submission day, and the
 * default face is legible at this size.
 */

// Required by `output: "export"`. An ImageResponse is a route handler under the hood, and
// a static export refuses to build one that has not declared it renders once at build
// time rather than per request. Saying it explicitly is also the honest declaration: this
// card never varies, so there is nothing to regenerate.
export const dynamic = "force-static";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Glasshouse — taker priority by sealed bid. The winner bids 400 basis points and pays 250, the runner-up's price.";

// The palette, from web/app/globals.css. Hard-coded because ImageResponse renders outside
// the document and cannot read a CSS custom property -- which means it does not follow the
// site when the site changes, and it did not: the card kept painting the light green-tinted
// palette for hours after c46eeca made the product dark and neutral. A link preview that
// looks like a different product than the one behind the link is worse than no preview.
//
// THE DARK VALUES, because the card is the product's face and the product is dark.
const GROUND = "#0A0C10";
const RAISED = "#12161C";
const INK = "#E8ECF1";
const INK_SOFT = "#A3ADB8";
const INK_FAINT = "#7F8896";
const RULE = "#262D37";
const GLASS = "#3ECFB2";
const AMBER = "#E6B345";

/**
 * The background, inlined.
 *
 * Read from disk at build time and embedded as a data URI rather than referenced by URL:
 * this renders during `next build` with no server running and no origin to resolve a path
 * against, so a relative src would simply produce a card with no background and no error.
 *
 * It is 12 KB of JPEG. The source is `public/art/social-card.jpg`, cropped from the
 * generated original to remove the generator's watermark -- see art-prompts/README.md.
 */
const BG = `data:image/jpeg;base64,${readFileSync(
  join(process.cwd(), "public", "art", "social-card.jpg"),
).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: GROUND,
          color: INK,
          padding: "64px 72px",
          fontFamily: "monospace",
          position: "relative",
        }}
      >
        {/* Behind everything. The image is dark and empty across its left half by
            construction, which is where the type sits; it carries its interest to the
            right, where nothing is written. It is atmosphere and it says nothing -- the
            card's claim is made entirely in text, and removing this changes no fact on
            it. */}
        <img
          src={BG}
          width={1200}
          height={630}
          style={{ position: "absolute", top: 0, left: 0, width: "1200px", height: "630px" }}
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: INK_FAINT,
              display: "flex",
            }}
          >
            Glasshouse · 1inch SwapVM · opcode 0x2e
          </div>
          <div
            style={{
              marginTop: 30,
              fontSize: 52,
              lineHeight: 1.18,
              fontFamily: "serif",
              maxWidth: 980,
              display: "flex",
            }}
          >
            Who fills your order should be decided by what it is worth, not by who is fastest.
          </div>
        </div>

        {/* The mechanism, in the three numbers that carry it. */}
        <div style={{ display: "flex", alignItems: "stretch", gap: 20 }}>
          <Cell label="highest bid" value="400 bps" tone={GLASS} note="wins the right to fill" />
          <Cell label="pays" value="250 bps" tone={AMBER} note="the runner-up's bid" />
          <Cell label="to the maker" value="150 bps" tone={INK} note="the difference" />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 21,
            color: INK_SOFT,
            borderTop: `2px solid ${RULE}`,
            paddingTop: 22,
          }}
        >
          <div style={{ display: "flex" }}>A sealed-bid, second-price auction, settled on chain</div>
          <div style={{ display: "flex", color: GLASS }}>Live on Base</div>
        </div>
      </div>
    ),
    size,
  );
}

function Cell({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone: string;
  note: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: RAISED,
        border: `2px solid ${RULE}`,
        padding: "24px 26px",
      }}
    >
      <div
        style={{
          fontSize: 19,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: INK_FAINT,
          display: "flex",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 12, fontSize: 54, color: tone, display: "flex" }}>{value}</div>
      <div style={{ marginTop: 8, fontSize: 20, color: INK_SOFT, display: "flex" }}>{note}</div>
    </div>
  );
}
