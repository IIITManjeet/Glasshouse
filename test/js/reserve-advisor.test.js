import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, checkPrerequisites, castSendLine, normalizeDeploymentId } from "../../scripts/reserve-advisor.mjs";

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

// The MCP's deployment tools take the 32-byte hash; every document in this project names
// the deployment as a Qm... IPFS id. Handing the documented value straight to the MCP
// failed with "Schema not found in the response", which names neither the id nor the
// format it wanted and reads like the subgraph is unpublished. These pin the conversion.

test("normalizeDeploymentId: the documented Qm id becomes the hash the GNS event carries", () => {
  // Cross-checked against Arbitrum: the SubgraphPublished log for our subgraph
  // (tx 0x14abd788bd19dffe372270a6d4ca4ec4fd72b81f0270183340da7d625d3b597c) carries this
  // value as its subgraphDeploymentID. Derived two independent ways, same answer.
  assert.equal(
    normalizeDeploymentId("Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E"),
    "0xcd128c4faa5567a6cde0dd66f8a463ffc9a56750510c2d185f4493fe74dd4d49"
  );
});

test("normalizeDeploymentId: a 0x id is passed through untouched", () => {
  const id = "0xcd128c4faa5567a6cde0dd66f8a463ffc9a56750510c2d185f4493fe74dd4d49";
  assert.equal(normalizeDeploymentId(id), id);
});

test("normalizeDeploymentId: leaves an absent id absent rather than inventing one", () => {
  // checkPrerequisites is what reports a missing deployment id, and it must keep being the
  // thing that reports it -- throwing here would replace a named prerequisite with a stack.
  assert.equal(normalizeDeploymentId(undefined), undefined);
  assert.equal(normalizeDeploymentId(""), "");
});

test("normalizeDeploymentId: refuses input that is neither form", () => {
  assert.throws(() => normalizeDeploymentId("glasshouse"), /neither a Qm/);
});

test("normalizeDeploymentId: refuses a Qm id with a non-base58 character", () => {
  // 0, O, I and l are not in the base58 alphabet, and are the characters a hand-copied id
  // is most likely to acquire.
  assert.throws(() => normalizeDeploymentId("Qm0c9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E"), /base58/);
});
