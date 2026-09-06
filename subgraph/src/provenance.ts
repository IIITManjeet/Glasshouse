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

// TEAM: wallets we control. Currently the Base deployer / maker, from
// ignition/parameters/chain-8453.json ("owner"), which is the account that deployed the
// Book and opens the demo auctions.
const TEAM_ADDRESSES: string[] = ["0xeebf737f92c8f0d9070f35a7d9baf416923becdf"];

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
