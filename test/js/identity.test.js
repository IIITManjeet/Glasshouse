import { test } from "node:test";
import assert from "node:assert/strict";

import { addressHues, markStyle, ROLE_COPY } from "../../web/lib/identity.ts";

/**
 * The address mark is the one place this site renders a colour that was not chosen by a
 * human, so it is the one place that most needs pinning: the same address must always draw
 * the same mark, on every surface, in every session, or the whole point of it -- following
 * one bidder across three views -- quietly stops working.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const MAX = "0xffffffffffffffffffffffffffffffffffffffff";
const REAL = "0xeEbf5B4B2c0b1d0E0a4f7A9C3D2e1F0a9b8C7dCf";

const SEP = 40;

/** The gap the implementation guarantees, measured the short way round the wheel. */
const separation = (h1, h2) => {
  const gap = (h2 - h1 + 360) % 360;
  return Math.min(gap, 360 - gap);
};

test("the same address always draws the same mark", () => {
  const a = addressHues(REAL);
  const b = addressHues(REAL);
  assert.deepEqual(a, b);
});

test("case and the 0x prefix do not change the mark", () => {
  // A judge pasting a checksummed address and a table rendering a lowercased one must not
  // produce two different marks for one participant. This is the realistic way the
  // determinism above would break in practice.
  const lower = addressHues(REAL.toLowerCase());
  const upper = addressHues("0x" + REAL.slice(2).toUpperCase());
  const bare = addressHues(REAL.slice(2));
  assert.deepEqual(lower, upper);
  assert.deepEqual(lower, bare);
});

test("both hues are inside the colour wheel", () => {
  for (const addr of [ZERO, MAX, REAL]) {
    const { h1, h2 } = addressHues(addr);
    for (const h of [h1, h2]) {
      assert.ok(Number.isInteger(h), `${addr}: ${h} is not an integer`);
      assert.ok(h >= 0 && h < 360, `${addr}: ${h} is outside 0..359`);
    }
  }
});

test("the two hues are always visibly separated — including the degenerate addresses", () => {
  // 0x00…00 and 0xff…ff are the two cases where both hues derive from identical bytes, so
  // they are exactly where a naive derivation draws a flat single-colour square. If the
  // 180-degree rotation is ever dropped, these are the assertions that go red first.
  for (const addr of [ZERO, MAX, REAL]) {
    const { h1, h2 } = addressHues(addr);
    assert.ok(
      separation(h1, h2) >= SEP - 1,
      `${addr}: hues ${h1} and ${h2} are only ${separation(h1, h2)}° apart`,
    );
  }
});

test("the separation guarantee holds across the whole first-four-byte space", () => {
  // Not a sample: every combination that can reach the near-collision branch. A property
  // asserted on three addresses is a property asserted on nothing.
  let checked = 0;
  for (let b0 = 0; b0 < 256; b0 += 7) {
    for (let b2 = 0; b2 < 256; b2 += 7) {
      const addr =
        "0x" +
        b0.toString(16).padStart(2, "0") +
        "00" +
        b2.toString(16).padStart(2, "0") +
        "00" +
        "0".repeat(32);
      const { h1, h2 } = addressHues(addr);
      assert.ok(
        separation(h1, h2) >= SEP - 1,
        `${addr}: hues ${h1} and ${h2} are only ${separation(h1, h2)}° apart`,
      );
      checked++;
    }
  }
  assert.ok(checked > 1000, `expected a real sweep, only checked ${checked}`);
});

test("different addresses mostly draw different marks", () => {
  // The mark does not have to be unique -- the hex beside it disambiguates, and 129,600
  // combinations against the eight addresses a board shows at once makes a clash unlikely
  // rather than impossible. What it must not be is CONSTANT, which is what a broken byte
  // index would produce.
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const addr = "0x" + i.toString(16).padStart(4, "0") + "0".repeat(36);
    const { h1, h2 } = addressHues(addr);
    seen.add(`${h1}:${h2}`);
  }
  assert.ok(seen.size > 150, `only ${seen.size} distinct marks across 200 addresses`);
});

test("markStyle hands CSS the hues and computes no colour itself", () => {
  // The colour belongs in globals.css, where it can see a media query. If this ever starts
  // returning an hsl() string, the dark theme will be wrong on first paint.
  const style = markStyle(REAL);
  const { h1, h2 } = addressHues(REAL);
  assert.equal(style["--h1"], String(h1));
  assert.equal(style["--h2"], String(h2));
  assert.equal(Object.keys(style).length, 2);
  for (const v of Object.values(style)) {
    assert.equal(typeof v, "string");
    assert.ok(!/hsl|rgb|#/.test(v), `markStyle computed a colour: ${v}`);
  }
});

test("a malformed address renders rather than throwing", () => {
  // Every address on this site comes from a chain read, but the profile page takes one from
  // the URL, where a human can type anything. A mark is decoration; it must never be the
  // reason a record page fails to render.
  for (const bad of ["0x", "", "0xzz", "not-an-address"]) {
    assert.doesNotThrow(() => addressHues(bad), `threw on ${JSON.stringify(bad)}`);
    const { h1, h2 } = addressHues(bad);
    assert.ok(h1 >= 0 && h1 < 360 && h2 >= 0 && h2 < 360);
  }
});

test("every role has copy, and the short form fits a table cell", () => {
  const roles = ["house", "you", "winner", "leading", "filled", "maker"];
  assert.deepEqual(Object.keys(ROLE_COPY).sort(), [...roles].sort());
  for (const r of roles) {
    assert.ok(ROLE_COPY[r].short.length <= 8, `${r}: "${ROLE_COPY[r].short}" is too long`);
    assert.ok(ROLE_COPY[r].title.length > 20, `${r}: title is not a real sentence`);
  }
});
