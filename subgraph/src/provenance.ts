import { Address } from "@graphprotocol/graph-ts";

import { Provenance } from "./constants";

// Wallet provenance, as a constant list (docs/design/subgraph-design.md section 3, Q1).
//
// The point of this file is the F-114 defence made structural: the page cannot forget
// to label one of our own wallets, because the label travels with the data.
//
// UNKNOWN means "not on our list". It does NOT mean "external", and no consumer may
// present it as such. The page says "N reveals from wallets not on our list".
//
// Addresses are lower-case hex. Comparison is on the raw 20 bytes, so checksum casing
// in a source document does not matter.

// TEAM: wallets we control.
//
// - The Base deployer / maker, from ignition/parameters/chain-8453.json ("owner"), which
//   is the account that deployed the Book and opens the demo auctions.
// - The two ephemeral bidders scripts/run-live-fill.ts generated and funded for the
//   headline second-price fill on order 0x58296d32e575d28f4213301b4a113ab8f92ab46afc48dcb8147ea7667e3efdf9
//   (run-live-fill.ts's own comment records this as "shipped, opened, settled and FILLED
//   on Base mainnet on 2026-09-12"). Their keys lived only in that process's memory and
//   the gitignored .ephemeral-bidders.json, swept afterward, so the addresses are not
//   typed anywhere in source -- they are read back from site/data/snapshot.js, which
//   scripts/make-snapshot.mjs built directly from GlasshouseBook's own on-chain logs
//   (eth_getLogs against Base, no subgraph in the loop). That entry's amountIn
//   (10000000000000), amountOut (24096) and bids (400/250 bps) match
//   run-live-fill.ts's SWAP_AMOUNT/EXPECTED_AMOUNT_OUT/BIDS exactly, which is what
//   identifies it as this run rather than a coincidence of two addresses:
//     - 0x1d59a25a36dcc04b5081f8b9c8be96accd1332a8 -- "winner": bestBidder, filledBy and
//       settledWinner on that entry, committed first (commitIdx 0) at 400 bps.
//     - 0x3b699d49cd21426ff2ce2f7acbfcc700cab028fa -- "rival": committed second
//       (commitIdx 1) at 250 bps, the bid the auction cleared at.
//   (site/data/snapshot.js:302-343)
const TEAM_ADDRESSES: string[] = [
  "0xeebf737f92c8f0d9070f35a7d9baf416923becdf",
  "0x1d59a25a36dcc04b5081f8b9c8be96accd1332a8",
  "0x3b699d49cd21426ff2ce2f7acbfcc700cab028fa",
];

// INVITED: bidders we asked to take part who agreed to be named here. Design Q1's
// recommendation is to default to leaving an invited bidder UNKNOWN unless they have
// been asked, so this list is empty until someone says yes.
const INVITED_ADDRESSES: string[] = [];

function isListed(list: string[], address: Address): boolean {
  for (let i = 0; i < list.length; i++) {
    if (Address.fromString(list[i]).equals(address)) {
      return true;
    }
  }
  return false;
}

export function provenanceOf(address: Address): string {
  if (isListed(TEAM_ADDRESSES, address)) {
    return Provenance.TEAM;
  }
  if (isListed(INVITED_ADDRESSES, address)) {
    return Provenance.INVITED;
  }
  return Provenance.UNKNOWN;
}
