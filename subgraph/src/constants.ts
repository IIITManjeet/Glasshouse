import { BigInt } from "@graphprotocol/graph-ts";

// Protocol record constants (docs/design/subgraph-design.md section 3).
export const PROTOCOL_NAME = "Glasshouse";
export const PROTOCOL_SLUG = "glasshouse";
export const SCHEMA_VERSION = "0.5.0";
export const SUBGRAPH_VERSION = "0.5.0"; // keep in step with subgraph/package.json "version"
export const METHODOLOGY_VERSION = "0.5.0"; // bump when section 6 or 7 of the design changes

// GlasshouseBook deploy block on Base mainnet, from
// ignition/deployments/chain-8453/journal.jsonl. Also the manifest startBlock.
export const START_BLOCK = BigInt.fromI32(50965408);

export const SECONDS_PER_DAY = 86400;

export const BIGINT_ZERO = BigInt.zero();

// ---- enum values, as the strings the store expects -----------------------------
// graph codegen does not emit AssemblyScript enums for GraphQL enums, so the values
// are string constants. Keep these identical to schema.graphql.

export namespace Network {
  export const BASE = "BASE";
}

export namespace ProtocolType {
  export const GENERIC = "GENERIC";
}

export namespace ParameterSet {
  export const ADVOCATED = "ADVOCATED";
  export const HUMAN_DEMO = "HUMAN_DEMO";
  export const OTHER = "OTHER";
}

export namespace CompetitionClass {
  export const NONE = "NONE";
  export const SOLE = "SOLE";
  export const CONTESTED = "CONTESTED";
}

export namespace FillPhase {
  export const BIDDING = "BIDDING";
  export const EXCLUSIVE = "EXCLUSIVE";
  export const OPEN = "OPEN";
}

export namespace BondStatus {
  export const HELD = "HELD";
  export const RETURNED = "RETURNED";
  export const FORFEITED_TO_MAKER = "FORFEITED_TO_MAKER";
  export const UNREVEALED_FORFEITED = "UNREVEALED_FORFEITED";
}

export namespace Provenance {
  export const TEAM = "TEAM";
  export const INVITED = "INVITED";
  export const UNKNOWN = "UNKNOWN";
}

export namespace EventKind {
  export const AUCTION_OPENED = "AUCTION_OPENED";
  export const BID_COMMITTED = "BID_COMMITTED";
  export const BID_REVEALED = "BID_REVEALED";
  export const AUCTION_FILLED = "AUCTION_FILLED";
  export const AUCTION_SETTLED = "AUCTION_SETTLED";
  export const BOND_CLAIMED = "BOND_CLAIMED";
  export const FORFEIT_CLAIMED = "FORFEIT_CLAIMED";
  export const UNREVEALED_FORFEITED = "UNREVEALED_FORFEITED";
}

// ---- parameter sets -------------------------------------------------------------
// Mirrors config/auction.json. "advocated" is the set Glasshouse argues for (150 s
// total lockup); "humanDemo" only widens the bidding windows so a person has time for
// two wallet signatures. Anything else is labelled OTHER, which is a label and not a
// judgment. If config/auction.json changes, change these and bump METHODOLOGY_VERSION.

export const ADVOCATED_COMMIT_BLOCKS = BigInt.fromI32(30);
export const ADVOCATED_REVEAL_BLOCKS = BigInt.fromI32(30);
export const ADVOCATED_EXCLUSIVE_BLOCKS = BigInt.fromI32(15);
export const ADVOCATED_RESERVE_BPS: i32 = 50;
export const ADVOCATED_MAX_BPS: i32 = 500;

export const HUMAN_DEMO_COMMIT_BLOCKS = BigInt.fromI32(60);
export const HUMAN_DEMO_REVEAL_BLOCKS = BigInt.fromI32(60);
export const HUMAN_DEMO_EXCLUSIVE_BLOCKS = BigInt.fromI32(15);
export const HUMAN_DEMO_RESERVE_BPS: i32 = 50;
export const HUMAN_DEMO_MAX_BPS: i32 = 500;
