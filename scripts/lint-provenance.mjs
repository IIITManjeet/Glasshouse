#!/usr/bin/env node
// Every figure on the page must say what produced it.
//
// DESIGN.md section 2 is the rule: "every number on screen is labelled with what produced
// it". An adversarial review found the shipped page breaking its own rule -- the
// comparison table carried three hard numbers and no indication that they come from a
// Foundry unit test with mock tokens, assigned valuations, a 60-second warp and a chosen
// decay factor. Read cold, it looked like a measurement of the world.
//
// A habit does not survive a deadline, so this makes it a property. It fails the build if
// any <table>, <svg> or .stat is not inside a <figure data-src="..."> that also carries a
// "What produced this" caption.
//
//   node scripts/lint-provenance.mjs
//
// IT NOW CHECKS TWO PAGES. The written argument is still site/index.html, hand-written and
// build-free. The product is the Next app, whose figures -- the comparison, the latency
// lens, the reserve advisor, the receipt -- are TSX and reach the reader as the exported
// HTML in web/out/. Checking only the essay would have left the rule enforced on the page
// that carries the fewest numbers. The app's pages are checked only if they have been
// built; a missing web/out/ is reported, not failed, because the contracts test suite runs
// this and must not require a front-end build.
//
// Deliberately a text scan with no dependencies and no DOM: the essay is one static file
// with no build step, and a linter that needed a toolchain would be the first thing to
// break on submission day.

import { readFileSync, existsSync } from "node:fs";

const PAGE = new URL("../site/index.html", import.meta.url);
const html = readFileSync(PAGE, "utf8");

// The kinds ui-spec.md section 3.5 rule 1 names. A single large number (.stat) counts:
// it is the most quotable thing on a page and the easiest to screenshot without context.
const NEEDS_SOURCE = [
  { re: /<table[\s>]/g, what: "<table>" },
  // An <svg> is presumed to be a chart, because on this site it almost always is. The one
  // exception is a graphic that carries NO information: the hero's atmosphere
  // (components/Atmosphere.tsx) is a drifting field of envelope glyphs with not a number
  // in it. `aria-hidden="true"` is the right test for that and not a loophole -- it is the
  // author asserting, in the markup, that a screen reader loses nothing by skipping this.
  // Anything that conveys something to a sighted reader cannot honestly carry it.
  { re: /<svg[\s>]/g, what: "<svg>", exemptIf: /aria-hidden="true"/ },
  { re: /class="[^"]*\bstat\b[^"]*"/g, what: 'class="stat"' },
];

const failures = [];

/**
 * The structural rule, over one document.
 *
 * Parameterised over how a caption and a source chip are RECOGNISED, because the two
 * documents mark them differently and neither marking is wrong: the essay uses hand-
 * written `class="made"` / `class="src"`, and the app's components are Tailwind, where a
 * semantic class name would exist only to be grepped by this file. What both must have is
 * the same: a <figure> with a data-src, a chip, and the words "What produced this".
 */
function scanStructure(source, { label, captionRe, chipRe, chipName }) {
  const found = [];
  const lineOf = (index) => source.slice(0, index).split("\n").length;

  /** The figure enclosing `index`, or null. Figures do not nest in either document, so
   *  tracking the last unclosed open is enough and avoids pulling in a parser. */
  function enclosingFigure(index) {
    let depth = 0;
    let openAt = -1;
    const tag = /<figure\b|<\/figure>/g;
    let m;
    while ((m = tag.exec(source)) !== null) {
      if (m.index >= index) break;
      if (m[0] === "</figure>") {
        depth = Math.max(0, depth - 1);
        if (depth === 0) openAt = -1;
      } else {
        if (depth === 0) openAt = m.index;
        depth++;
      }
    }
    if (depth === 0 || openAt === -1) return null;
    const close = source.indexOf("</figure>", index);
    return close === -1 ? null : { openAt, close };
  }

  for (const { re, what, exemptIf } of NEEDS_SOURCE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      // The element's own opening tag, for the exemption test. Read from the match to the
      // first '>' so an attribute on a PARENT can never grant the exemption by accident.
      if (exemptIf) {
        const close = source.indexOf(">", m.index);
        if (close !== -1 && exemptIf.test(source.slice(m.index, close + 1))) continue;
      }
      const where = `${label} line ${lineOf(m.index)}`;
      const fig = enclosingFigure(m.index);
      if (!fig) {
        found.push(`${what} at ${where} is not inside a <figure>`);
        continue;
      }
      const openTag = source.slice(fig.openAt, source.indexOf(">", fig.openAt) + 1);
      if (!/\bdata-src="[a-z]+"/.test(openTag)) {
        found.push(`${what} at ${where} is in a <figure> with no data-src`);
      }
      const body = source.slice(fig.openAt, fig.close);
      if (!captionRe.test(body)) {
        found.push(`${what} at ${where} is in a <figure> with no "What produced this" caption`);
      }
      if (chipRe && !chipRe.test(body)) {
        found.push(`${what} at ${where} is in a <figure> with no ${chipName}`);
      }
    }
  }
  return found;
}

failures.push(
  ...scanStructure(html, {
    label: "site/index.html",
    captionRe: /class="made"/,
    chipRe: /class="src"/,
    chipName: "source chip",
  }),
);

// Every caption must actually say the words. A <figcaption> that describes the figure
// instead of its provenance passes the structural check and fails the reader.
for (const m of html.matchAll(/class="made"[^>]*>([\s\S]*?)<\/figcaption>/g)) {
  const line = html.slice(0, m.index).split("\n").length;
  if (!/What produced this:/.test(m[1])) {
    failures.push(`a .made caption at site/index.html line ${line} does not begin "What produced this:"`);
  }
}

// The rule the project wrote for itself, checked rather than trusted: no claim that the
// data describes a market. DESIGN.md section 2, and subgraph/README.md's refusals list.
const FORBIDDEN = [
  [/\bHHI\b/i, "HHI"],
  [/market share/i, '"market share"'],
  [/solver concentration/i, '"solver concentration"'],
  [/\bTVL\b/, "TVL"],
];
function scanForbidden(source, label) {
  const found = [];
  for (const [re, name] of FORBIDDEN) {
    const m = re.exec(source);
    if (m) {
      const line = source.slice(0, m.index).split("\n").length;
      found.push(`${name} appears at ${label} line ${line}: the page must not present a toy market as a market`);
    }
  }
  return found;
}
failures.push(...scanForbidden(html, "site/index.html"));

// ---------------------------------------------------------------------------------
// The exported app.
//
// Prerendered HTML, so what is checked is what a visitor is served before any script
// runs -- which is also what a crawler and a screenshot see. Figures that only appear
// after a fetch (the receipt) are not in here, and this does not pretend to cover them;
// the shape test covers their data and the components carry their captions inline.
const APP_PAGES = [
  "index.html",
  "board/index.html",
  "evidence/index.html",
  "rounds/index.html",
  "account/index.html",
];
const appRoot = new URL("../web/out/", import.meta.url);
let appChecked = 0;
let appFigures = 0;

for (const page of APP_PAGES) {
  const file = new URL(page, appRoot);
  if (!existsSync(file)) continue;
  const source = readFileSync(file, "utf8");
  appChecked++;
  appFigures += (source.match(/<figure\b/g) ?? []).length;
  failures.push(
    ...scanStructure(source, {
      label: `web/out/${page}`,
      // The app has no class="made": the caption is a paragraph that begins with the
      // words, which is the thing that actually matters to a reader.
      captionRe: /What produced this/,
      chipRe: null,
    }),
  );
  failures.push(...scanForbidden(source, `web/out/${page}`));
}

// ---------------------------------------------------------------------------------
// Contrast, computed rather than eyeballed.
//
// A visual-design review found --ink-faint at 3.15:1 on the light ground -- below WCAG
// AA for normal text, and the colour of every provenance caption, source chip and note.
// The layer that exists to make the page honest was the hardest thing on it to read.
// Both themes pass now; this keeps them passing, because a palette drifts one hex at a
// time and nobody notices until somebody cannot read it.
//
// Both palettes are checked. They are separate files -- site/index.html's :root and the
// app's @theme -- and a token corrected in one and not the other is exactly the drift
// this is here to catch.
//
// Small text only: these tokens are used at 0.66-0.9rem, nowhere near the 18.66px that
// would let the 3:1 large-text threshold apply.
const srgb = (h) => h.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255);
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (h) => {
  const [r, g, b] = srgb(h).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

/** Tokens from one block, so light and dark are judged separately. The app names them
 *  `--color-ground` because Tailwind's @theme requires the prefix; strip it so one set
 *  of rules covers both files. */
function tokensIn(source) {
  const out = {};
  for (const t of source.matchAll(/--(?:color-)?([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[t[1]] = t[2];
  return out;
}

const AA = 4.5;

/**
 * Every palette on the site, named.
 *
 * A palette that is not in this list is a palette nobody is checking, which is how
 * --ink-faint shipped at 3.15:1 in the first place. THE TAPE is the reason this became a
 * list rather than two regexes: /board and /evidence got their own register -- dark-first,
 * with the light variant in a media query, the inverse of every other block here -- and it
 * went in entirely unchecked. A brand-new palette is exactly where contrast regresses,
 * because nobody has looked at it yet.
 */
const PALETTES = [];

{
  const l = /:root \{[\s\S]*?\n  \}/.exec(html);
  const d = /prefers-color-scheme: dark[\s\S]*?\n    \}/.exec(html);
  if (l) PALETTES.push(["site/index.html light", l[0]]);
  if (d) PALETTES.push(["site/index.html dark", d[0]]);
}

const globalsCss = new URL("../web/app/globals.css", import.meta.url);
if (existsSync(globalsCss)) {
  const css = readFileSync(globalsCss, "utf8");
  const theme = /@theme \{[\s\S]*?\n\}/.exec(css);
  const dark = /@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}/.exec(css);
  const tapeDark = /\.tape \{[\s\S]*?\n\}/.exec(css);
  const tapeLight = /@media \(prefers-color-scheme: light\) \{\s*\.tape \{[\s\S]*?\n  \}/.exec(css);
  if (theme) PALETTES.push(["globals.css light", theme[0]]);
  if (dark) PALETTES.push(["globals.css dark", dark[0]]);
  if (tapeDark) PALETTES.push([".tape dark (board, evidence)", tapeDark[0]]);
  if (tapeLight) PALETTES.push([".tape light (board, evidence)", tapeLight[0]]);
}

for (const [theme, block] of PALETTES) {
  {
    const t = tokensIn(block);
    if (!t.ground) continue;
    // `label` is the token The Tape added for column heads and panel ids. It is text, so it
    // is measured like any other text colour rather than trusted because it looks bright.
    for (const fg of ["ink", "ink-soft", "ink-faint", "glass", "amber", "brick", "label"]) {
      for (const bg of ["ground", "raised"]) {
        if (!t[fg] || !t[bg]) continue;
        const r = contrast(t[fg], t[bg]);
        if (r < AA) {
          failures.push(
            `${theme}: --${fg} (${t[fg]}) on --${bg} (${t[bg]}) is ${r.toFixed(2)}:1, below ` +
            `WCAG AA ${AA}:1 for the small text these tokens are used at`,
          );
        }
      }
    }
  }
}

const figures = (html.match(/<figure\b/g) ?? []).length;
if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} provenance problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nSee docs/design/ui-spec.md section 3.\n");
  process.exit(1);
}

console.log(
  `PASS: ${figures} figures in site/index.html and ${appFigures} in ${appChecked} exported app page(s), ` +
    `each with a source tag and a "What produced this" caption.`,
);
if (appChecked === 0) {
  console.log("      web/out/ is not built, so the app's own figures were not checked (npm --prefix web run build).");
}
