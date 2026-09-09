#!/usr/bin/env node
// Reads a maker's recent settled auctions through the Subgraph MCP and prints a reserve
// recommendation, using the exact same recommendReserve() the page runs
// (site/reserve-rule.js). docs/design/subgraph-design.md sections 7.3 and 8.3.
//
// Three things this needs, none of which exist yet:
//   1. The subgraph published to The Graph Network, not only deployed to Studio - the
//      Subgraph MCP only sees subgraphs "available on The Graph Network" (section 2).
//   2. A Gateway API key restricted to that subgraph (Studio > API Keys, section 8.1
//      step 3), in GRAPH_API_KEY.
//   3. @modelcontextprotocol/sdk installed (it is not a dependency yet; section 8.3
//      lists it as one to add).
//
// Run this with any of the three missing and it says exactly which, and stops - it does
// not fall back to a cached number or a guess. The rule itself has no network dependency
// and is exercised directly by `node --test test/js/`.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { recommendReserve } from "../web/lib/reserve-rule.ts";

const MCP_URL = "https://subgraphs.mcp.thegraph.com/sse";
const CHAIN_PARAMS = new URL("../ignition/parameters/chain-8453.json", import.meta.url);
const DEPLOYED_ADDRESSES = new URL("../ignition/deployments/chain-8453/deployed_addresses.json", import.meta.url);

export function parseArgs(argv) {
  const args = { k: 8, floor: 50, maxBps: 500, send: false, snapshot: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--maker") args.maker = argv[++i];
    else if (a === "--deployment") args.deployment = argv[++i];
    else if (a === "--k") args.k = Number(argv[++i]);
    else if (a === "--floor") args.floor = Number(argv[++i]);
    else if (a === "--max-bps") args.maxBps = Number(argv[++i]);
    else if (a === "--send") args.send = true;
    else if (a === "--snapshot") args.snapshot = true;
    else throw new Error(`reserve-advisor: unrecognised argument "${a}"`);
  }
  return args;
}

// The Q3 window query, verbatim from subgraph-design.md section 7.2. $head comes from a
// _meta query run immediately before this one, against the same MCP connection, so the
// two agree on the block the answer is as of (section 6.1's rule applies to this script
// exactly as it does to the page).
const RESERVE_WINDOW_QUERY = `
  query ReserveWindow($maker: Bytes!, $head: BigInt!, $k: Int!) {
    auctions(
      where: { maker: $maker, revealEnd_lt: $head }
      orderBy: revealEnd, orderDirection: desc, first: $k
    ) {
      id reserveBps maxBps revealedCount unrevealedCount bestBps secondBps clearingBps
      winnerMarginBps reserveBound competition thin parameterSet
      teamRevealed invitedRevealed unknownRevealed
      bestBidder { id provenance }
    }
  }
`;

// One message per missing piece, so fixing this is one pass instead of hitting each wall
// in turn. Order matches how expensive each check is: local env first, then a require
// that only fails if node_modules is missing it, network last.
export async function checkPrerequisites(env, args) {
  const missing = [];

  if (!env.GRAPH_API_KEY) {
    missing.push(
      "GRAPH_API_KEY is not set. Create a Gateway API key in Studio, restricted to the " +
        "glasshouse-base subgraph (subgraph-design.md section 8.1 step 3), and export it."
    );
  }

  if (!args.deployment && !env.GLASSHOUSE_DEPLOYMENT_ID) {
    missing.push(
      "No deployment id. Pass --deployment <Qm...> or set GLASSHOUSE_DEPLOYMENT_ID. It " +
        "only exists after `graph deploy` AND publishing to The Graph Network from Studio " +
        "(subgraph-design.md section 8.1 steps 1-2) - a Studio-only deploy is invisible to " +
        "the Subgraph MCP (section 2)."
    );
  }

  try {
    await import("@modelcontextprotocol/sdk/client/index.js");
  } catch {
    missing.push("@modelcontextprotocol/sdk is not installed. Run: npm install @modelcontextprotocol/sdk viem");
  }

  return missing;
}

// The cast send line from DEPLOY.md section 6 step 2, with the recommended reserve
// substituted in. Everything else about the auction (order, router, token, bond) is the
// maker's to fill in - this line only answers "what reserve", not "what order" - so
// those stay as the same placeholders DEPLOY.md uses.
export function castSendLine(bookAddress, { reserveBps, maxBps = 500, commitBlocks = 30, revealBlocks = 30, exclusiveBlocks = 15 }) {
  return (
    `cast send ${bookAddress} "open(bytes32,address,address,uint40,uint40,uint40,uint24,uint24,uint128)" ` +
    `$ORDER_HASH $ROUTER $TOKEN_IN ${commitBlocks} ${revealBlocks} ${exclusiveBlocks} ${reserveBps} ${maxBps} $BOND ` +
    `--rpc-url $BASE_RPC_URL --private-key $MAKER_KEY`
  );
}

function printRecommendation(rec, { maker, head }) {
  console.log(`\nreserve-advisor: maker ${maker}, as of block ${head}\n`);
  console.log(`  window            ${rec.n} settled auction(s)`);
  console.log(`  empty / weak / strong   ${rec.empty} / ${rec.weak} / ${rec.strong}`);
  console.log(`  unrevealed commitments  ${rec.unrevealed}`);
  console.log(
    `  reveals by provenance   team ${rec.provenance.team}, invited ${rec.provenance.invited}, ` +
      `unknown ${rec.provenance.unknown}`
  );
  console.log(`  lowest winning bid seen ${rec.minBest === null ? "n/a" : `${rec.minBest} bps`}`);
  console.log(`\n  recommended reserve: ${rec.bps} bps   (band ${rec.band[0]}-${rec.band[1]}, reason ${rec.reason})\n`);
  console.log("  This is a heuristic that splits a known-safe floor from a known-unsafe");
  console.log("  ceiling. It is not an optimal-reserve computation.\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.maker) {
    const params = JSON.parse(await readFile(CHAIN_PARAMS, "utf8"));
    args.maker = params.$global.owner;
  }

  const missing = await checkPrerequisites(process.env, args);
  if (missing.length > 0) {
    console.error("reserve-advisor: cannot reach the Subgraph MCP yet.\n");
    for (const m of missing) console.error(`  - ${m}`);
    console.error(
      "\nThe reserve rule has no network dependency and is covered without any of the " +
        "above by `node --test test/js/`.\n"
    );
    process.exit(1);
  }

  const deploymentId = args.deployment ?? process.env.GLASSHOUSE_DEPLOYMENT_ID;

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");

  const client = new Client({ name: "glasshouse-reserve-advisor", version: "0.1.0" }, { capabilities: {} });
  const transport = new SSEClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.GRAPH_API_KEY}` } },
  });
  await client.connect(transport);

  try {
    // Proves the tool is pointed at the right deployment, and doubles as the schema
    // self-check section 8.3 asks for: this must contain ReserveControl.
    const schemaResult = await client.callTool({
      name: "get_schema_by_deployment_id",
      arguments: { deployment_id: deploymentId },
    });
    const schemaText = JSON.stringify(schemaResult);
    if (!schemaText.includes("ReserveControl")) {
      throw new Error(
        "the schema at this deployment id has no ReserveControl entity - wrong deployment id, " +
          "or the subgraph does not match subgraph-design.md section 3."
      );
    }

    const metaResult = await client.callTool({
      name: "execute_query_by_deployment_id",
      arguments: { deployment_id: deploymentId, query: "{ _meta { block { number } } }" },
    });
    const head = JSON.parse(metaResult.content?.[0]?.text ?? "{}")?.data?._meta?.block?.number;
    if (head === undefined) throw new Error("no _meta.block.number in the MCP response");

    const windowResult = await client.callTool({
      name: "execute_query_by_deployment_id",
      arguments: {
        deployment_id: deploymentId,
        query: RESERVE_WINDOW_QUERY,
        variables: { maker: args.maker.toLowerCase(), head: String(head), k: args.k },
      },
    });
    const window = JSON.parse(windowResult.content?.[0]?.text ?? "{}")?.data?.auctions ?? [];

    const rec = recommendReserve(window, { floorBps: args.floor, maxBps: args.maxBps, K: args.k });
    printRecommendation(rec, { maker: args.maker, head });

    const addresses = JSON.parse(await readFile(DEPLOYED_ADDRESSES, "utf8"));
    console.log(`  ${castSendLine(addresses["Glasshouse#GlasshouseBook"], { reserveBps: rec.bps, maxBps: args.maxBps })}\n`);

    if (args.send) {
      throw new Error(
        "--send is not implemented yet: it needs MAKER_PRIVATE_KEY, ORDER_HASH and " +
          "BASE_RPC_URL wired to a viem walletClient submitting open() (section 8.3). " +
          "Copy the cast send line above and run it by hand for now."
      );
    }

    if (args.snapshot) {
      throw new Error("--snapshot is not implemented yet: it needs Q1 and Q2 run for every auction (section 8.3).");
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
}
