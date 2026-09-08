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
// Deliberately a text scan with no dependencies and no DOM: the page is one static file
// with no build step, and a linter that needed a toolchain would be the first thing to
// break on submission day.

import { readFileSync } from "node:fs";

const PAGE = new URL("../site/index.html", import.meta.url);
const html = readFileSync(PAGE, "utf8");

// The kinds ui-spec.md section 3.5 rule 1 names. A single large number (.stat) counts:
// it is the most quotable thing on a page and the easiest to screenshot without context.
const NEEDS_SOURCE = [
  { re: /<table[\s>]/g, what: "<table>" },
  { re: /<svg[\s>]/g, what: "<svg>" },
  { re: /class="[^"]*\bstat\b[^"]*"/g, what: 'class="stat"' },
];

const failures = [];
const lineOf = (index) => html.slice(0, index).split("\n").length;

/** The figure enclosing `index`, or null. Figures do not nest on this page, so tracking
 *  the last unclosed open is enough and avoids pulling in a parser. */
function enclosingFigure(index) {
  let depth = 0;
  let openAt = -1;
  const tag = /<figure\b|<\/figure>/g;
  let m;
  while ((m = tag.exec(html)) !== null) {
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
  const close = html.indexOf("</figure>", index);
  return close === -1 ? null : { openAt, close };
}

for (const { re, what } of NEEDS_SOURCE) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    const line = lineOf(m.index);
    const fig = enclosingFigure(m.index);
    if (!fig) {
      failures.push(`${what} at line ${line} is not inside a <figure>`);
      continue;
    }
    const openTag = html.slice(fig.openAt, html.indexOf(">", fig.openAt) + 1);
    if (!/\bdata-src="[a-z]+"/.test(openTag)) {
      failures.push(`${what} at line ${line} is in a <figure> with no data-src`);
    }
    const body = html.slice(fig.openAt, fig.close);
    if (!/class="made"/.test(body)) {
      failures.push(`${what} at line ${line} is in a <figure> with no "What produced this" caption`);
    }
    if (!/class="src"/.test(body)) {
      failures.push(`${what} at line ${line} is in a <figure> with no source chip`);
    }
  }
}

// Every caption must actually say the words. A <figcaption> that describes the figure
// instead of its provenance passes the structural check and fails the reader.
for (const m of html.matchAll(/class="made"[^>]*>([\s\S]*?)<\/figcaption>/g)) {
  if (!/What produced this:/.test(m[1])) {
    failures.push(`a .made caption at line ${lineOf(m.index)} does not begin "What produced this:"`);
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
for (const [re, name] of FORBIDDEN) {
  const m = re.exec(html);
  if (m) failures.push(`${name} appears at line ${lineOf(m.index)}: the page must not present a toy market as a market`);
}

const figures = (html.match(/<figure\b/g) ?? []).length;
if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} provenance problem(s) in site/index.html\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nSee docs/design/ui-spec.md section 3.\n");
  process.exit(1);
}

console.log(`PASS: ${figures} figures, each with a source chip and a "What produced this" caption.`);
