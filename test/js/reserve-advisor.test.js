import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, checkPrerequisites, castSendLine } from "../../scripts/reserve-advisor.mjs";

test("parseArgs: defaults match section 8.3 (K=8, floor=50, maxBps=500)", () => {
  const args = parseArgs([]);
  assert.equal(args.k, 8);
  assert.equal(args.floor, 50);
  assert.equal(args.maxBps, 500);
  assert.equal(args.send, false);
  assert.equal(args.snapshot, false);
});

test("parseArgs: reads flags", () => {
  const args = parseArgs(["--maker", "0xabc", "--k", "5", "--floor", "10", "--send", "--snapshot"]);
  assert.equal(args.maker, "0xabc");
  assert.equal(args.k, 5);
  assert.equal(args.floor, 10);
  assert.equal(args.send, true);
  assert.equal(args.snapshot, true);
});

test("parseArgs: rejects a flag it does not know", () => {
  assert.throws(() => parseArgs(["--nonsense"]));
});

// This is the whole of the "make it fail with a clear message" requirement: every missing
// piece must be named, not just the first one encountered.
//
// The advisor listed THREE prerequisites when it was written. One, @modelcontextprotocol
// /sdk, was simply an uninstalled dependency and was installed on 2026-09-08, so it must
// no longer be reported. Its absence is asserted rather than the case being dropped: a
// prerequisite check that still names something already satisfied sends the reader off to
// fix a non-problem. The two that remain need a human with a Studio account
// (subgraph-design.md sections 2 and 8.1).
test("checkPrerequisites: names the two that remain, and not the installed dependency", async () => {
  const missing = await checkPrerequisites({}, {});
  const joined = missing.join("\n");
  assert.match(joined, /GRAPH_API_KEY/);
  assert.match(joined, /deployment id/i);
  assert.doesNotMatch(joined, /@modelcontextprotocol\/sdk/);
});

test("checkPrerequisites: a deployment id can come from the flag instead of the env var", async () => {
  const missing = await checkPrerequisites({ GRAPH_API_KEY: "k" }, { deployment: "Qm123" });
  const joined = missing.join("\n");
  assert.doesNotMatch(joined, /GRAPH_API_KEY/);
  assert.doesNotMatch(joined, /deployment id/i);
});

test("checkPrerequisites: a deployment id can come from the env var instead of the flag", async () => {
  const missing = await checkPrerequisites({ GRAPH_API_KEY: "k", GLASSHOUSE_DEPLOYMENT_ID: "Qm123" }, {});
  const joined = missing.join("\n");
  assert.doesNotMatch(joined, /deployment id/i);
});

test("castSendLine: substitutes the recommended reserve into the DEPLOY.md open() line", () => {
  const line = castSendLine("0xBOOK", { reserveBps: 137, maxBps: 500 });
  assert.match(line, /^cast send 0xBOOK "open\(bytes32,address,address,uint40,uint40,uint40,uint24,uint24,uint128\)"/);
  // order matches DEPLOY.md section 6 step 2: orderHash router tokenIn commit reveal
  // exclusive reserve max bond
  assert.match(line, /\$ORDER_HASH \$ROUTER \$TOKEN_IN 30 30 15 137 500 \$BOND/);
  assert.match(line, /--rpc-url \$BASE_RPC_URL --private-key \$MAKER_KEY$/);
});

test("castSendLine: does not silently drop non-default windows", () => {
  const line = castSendLine("0xBOOK", { reserveBps: 60, commitBlocks: 60, revealBlocks: 60, exclusiveBlocks: 15, maxBps: 500 });
  assert.match(line, /\$TOKEN_IN 60 60 15 60 500 \$BOND/);
});
