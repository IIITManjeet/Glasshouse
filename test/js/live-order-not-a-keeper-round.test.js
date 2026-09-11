import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE LIVE FILL MUST NOT EAT A ROUND THE KEEPER IS GOING TO OPEN.
 *
 * `scripts/run-live-fill.ts` and `config/rounds.json` draw their orders from ONE generator:
 * `_orderForRound` in test/fork/LiveFillPreflight.t.sol is the same function
 * GenerateRounds.t.sol uses to write the manifest. So the live order and the keeper's 300
 * rounds are not merely similar in shape -- they are points in the same space, and picking
 * the wrong counter produces the keeper's round byte for byte.
 *
 * That nearly happened on 2026-09-12. The first live fill spent its order, which correctly
 * turned the preflight red; the obvious fix was to bump the round counter from "none" to 1;
 * and `_orderForRound(1)` is exactly manifest round 1 -- with the keeper's cursor sitting at
 * nextRound 1. The live fill would have consumed the round the keeper was about to open, and
 * the keeper would then have reverted with custom error 0x879f237b, which names the router
 * and the order hash and reads like almost anything except "someone else shipped this".
 *
 * A collision is silent in both files. Nothing about reading either one tells you the other
 * exists. So it is asserted here, cheaply, against the real bytes of both.
 *
 * This is a textual guard over a TypeScript constant, which is the weaker kind -- the same
 * caveat verify-run's TRANSLITERATION check carries. It is worth having anyway: the failure
 * it prevents costs real money and breaks the keeper, and the alternative on offer was a
 * comment.
 */

const RUNNER = "scripts/run-live-fill.ts";
const MANIFEST = "config/rounds.json";

/** The one constant the live run opens against. Read, not duplicated. */
function liveOrderHash() {
  const src = readFileSync(RUNNER, "utf8");
  const m = src.match(/const EXPECTED_ORDER_HASH\s*=\s*\n?\s*"(0x[0-9a-fA-F]{64})"/);
  assert.ok(
    m,
    `could not find EXPECTED_ORDER_HASH in ${RUNNER}. If it was renamed, this guard stopped ` +
      `guarding -- fix the pattern rather than deleting the test.`,
  );
  return m[1].toLowerCase();
}

test("the live fill's order is not one of the keeper's rounds", () => {
  const live = liveOrderHash();
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

  assert.ok(manifest.rounds.length > 0, "the manifest must have rounds to collide with");

  const clash = manifest.rounds.find((r) => r.orderHash.toLowerCase() === live);
  assert.equal(
    clash,
    undefined,
    clash &&
      `the live order ${live} IS keeper round ${clash.round}. Running the live fill would ` +
        `consume it, and the keeper's next ship would revert with 0x879f237b. Bump ` +
        `LIVE_ROUND in test/fork/LiveFillPreflight.t.sol above ${manifest.rounds.length}, ` +
        `re-run the preflight, and paste the new constants into ${RUNNER}.`,
  );
});

test("the live order is not the one already spent on mainnet", () => {
  // 0x58296d32 was shipped, opened, settled and filled on Base on 2026-09-12. Aqua.ship and
  // Book.open are each one-time for a hash, so pointing the runner back at it would fail --
  // after funding two ephemeral bidders, which is the expensive way to find out.
  const SPENT = "0x58296d32e575d28f4213301b4a113ab8f92ab46afc48dcb8147ea7667e3efdf9";
  assert.notEqual(
    liveOrderHash(),
    SPENT,
    "the runner points at the order already consumed on mainnet; bump LIVE_ROUND and re-run the preflight",
  );
});
