// Reading auctions straight from the Book, over plain eth_call.
//
// WHY THE PAGE TALKS TO THE CHAIN AT ALL. Not because the subgraph cannot answer -- it was
// published to The Graph Network on 2026-09-11 and is served by an allocated indexer. The
// keeper opens rounds continuously and this card counts down in blocks, and an indexer is a
// block or two behind the head. A board that cannot see the round happening right now is not
// a board.
//
// This is possible without an indexer only because the round hashes are DETERMINISTIC and
// precomputed (site/data/rounds.js, generated from config/rounds.json, itself built by
// upstream's MakerTraitsLib). There is nothing to discover: the page already knows every
// order hash the keeper will ever open, so it can ask the Book about each one.
//
// That reasoning did not change when the subgraph was published. Polling an indexer every
// 12 s costs 7,200 queries a day per open tab against a 3,000/day cap; the chain has no
// such limit, and for a live phase it is fresher anyway. The subgraph's job is history and
// the things it derives, not the ticking card.
//
// EVERY SELECTOR AND TOPIC HERE WAS TAKEN FROM THE COMPILED ABI, never guessed. A guessed
// event signature is what previously made a completed fill look like a failed one.

const SEL_AUCTIONS = "0xee5bcb62"; // auctions(address,bytes32)
const TOPIC_COMMITTED = "0x15bac7ec2595728439a169878c5d66df17234ecc558f7ff84ca42bd372ff182c";
const TOPIC_REVEALED = "0xe91f377a8690b8f3432ec7784cc702c2bc3d063fb2ac87290dd5ce249198ed32";

// The keeper's commit window, needed only to bound the log scan for bid cards. If it is
// wrong the scan is merely wider or narrower, never incorrect.
const COMMIT_WINDOW = 60;

const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const asInt = (w) => Number(BigInt("0x" + w));
const asAddr = (w) => "0x" + w.slice(24);
const isZero = (w) => /^0+$/.test(w);

/**
 * BACKING OFF WAS NOT ENOUGH, BECAUSE THE LIMIT IS NOT TRANSIENT.
 *
 * mainnet.base.org rate limits per IP (-32016), and this page reads it from the visitor's
 * own browser. Waiting 400ms and asking the same endpoint again is the right move for a
 * burst and useless against a budget that is already spent: the deployed board spent a
 * whole afternoon serving "eth_call: over rate limit" and falling back to the snapshot,
 * which is the correct behaviour and still means a visitor sees history instead of the
 * chain.
 *
 * So it changes endpoint rather than only waiting. These are all public Base RPCs needing
 * no key -- which matters, because `output: "export"` bakes every URL into the client
 * bundle and a key here would be a published key.
 *
 * THE WORKING ONE IS REMEMBERED for the rest of the session, so a page that has already
 * found a live endpoint does not re-walk the list on every poll. It resets to the head of
 * the list on a fresh load, so a temporarily degraded endpoint is not avoided forever.
 *
 * AN EXPLICIT ?rpc= IS NEVER ROTATED AWAY FROM. That parameter points the board at a fork
 * or at a private node on purpose, and silently answering from Base mainnet instead would
 * be the single most dishonest thing this file could do -- the page would show real
 * mainnet data under a chip saying it came from somewhere else.
 */
const DEFAULT_RPC = "https://mainnet.base.org";

// TESTED AGAINST BOTH METHODS THIS APP ACTUALLY USES, which eliminated most candidates.
// A Base endpoint that answers eth_call is easy to find; one that also answers eth_getLogs
// over a ~140-block window is not, and a pool member that served only the first would be
// worse than no pool at all -- rounds would load with their bids silently missing.
//
//   base-rpc.publicnode.com   eth_call ok, getLogs needs a paid token
//   1rpc.io/base              eth_call ok, getLogs capped at 50 blocks
//   base.llamarpc.com         TLS failure (525)
//   base.drpc.org             getLogs refused on the free plan
//   base.meowrpc.com          does not implement eth_getLogs
//
// Two survivors. Worth re-testing before a demo rather than trusted indefinitely: these
// are free endpoints and their terms move.
const POOL = [DEFAULT_RPC, "https://base.gateway.tenderly.co"];

let preferred = 0;

const isLimit = (msg) => /rate limit|-32016|429|too many|capacity|limit exceeded/i.test(msg);

async function call(rpc, method, params, tries = 4) {
  // A caller-chosen endpoint is honoured exactly: retry it, never substitute it.
  if (rpc !== DEFAULT_RPC) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(rpc, method, params);
      } catch (e) {
        const msg = String(e.message ?? e);
        if (attempt >= tries || !isLimit(msg)) throw e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
      }
    }
  }

  let lastError = null;
  for (let hop = 0; hop < POOL.length; hop++) {
    const idx = (preferred + hop) % POOL.length;
    const url = POOL[idx];
    try {
      const out = await once(url, method, params);
      preferred = idx; // stick with whatever answered
      return out;
    } catch (e) {
      lastError = e;
      const msg = String(e.message ?? e);
      // A rate limit or a dead host means try the next one. Anything else is the CHAIN
      // answering with a real error -- a reverted eth_call, a bad parameter -- and asking
      // a different node the same malformed question would only waste time and return the
      // same answer.
      if (!isLimit(msg) && !/fetch|network|failed|timeout|abort/i.test(msg)) throw e;
      // One short backoff before moving on, in case it was a burst rather than a budget.
      if (hop === 0) await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw lastError ?? new Error(`${method}: every Base endpoint failed`);
}

async function once(rpc, method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

export async function chainHead(rpc) {
  const r = await call(rpc, "eth_blockNumber", []);
  return r ? Number(BigInt(r)) : null;
}

/**
 * The Auction struct is sixteen fields and every one is a static type, so the return
 * decodes as sixteen flat 32-byte words with no offsets to chase.
 *
 * Field order is the ABI's, checked against subgraph/abis/GlasshouseBook.json:
 *   0 router          4 exclusiveBlocks   8 best            12 commitCount
 *   1 tokenIn         5 reserveBps        9 bestBps         13 filledBy
 *   2 commitEnd       6 maxBps           10 bestCommitIdx   14 settled
 *   3 revealEnd       7 bond             11 secondBps       15 winnerForfeited
 *
 * Note it carries exclusiveBLOCKS, not an end block, so the end is derived here.
 */
export function decodeAuction(data) {
  if (!data || data === "0x") return null;
  const commitEnd = asInt(word(data, 2));
  if (commitEnd === 0) return null; // this round was never opened
  const revealEnd = asInt(word(data, 3));
  const best = word(data, 8);
  const filled = word(data, 13);
  return {
    commitEnd,
    revealEnd,
    exclusiveEnd: revealEnd + asInt(word(data, 4)),
    reserveBps: asInt(word(data, 5)),
    maxBps: asInt(word(data, 6)),
    // Word 7. Needed because the UI must not claim a bond is forfeitable on a round whose
    // bond is zero -- which is every round the keeper opens (scripts/keeper.ts:58). A
    // string, not a number: it is a uint128 and can exceed Number.MAX_SAFE_INTEGER.
    bond: BigInt("0x" + word(data, 7)).toString(),
    bestBidder: isZero(best) ? null : asAddr(best),
    bestBps: asInt(word(data, 9)),
    secondBps: asInt(word(data, 11)),
    committedCount: asInt(word(data, 12)),
    filledBy: isZero(filled) ? null : asAddr(filled),
    filled: !isZero(filled),
    settled: asInt(word(data, 14)) === 1,
    winnerForfeited: asInt(word(data, 15)) === 1,
  };
}

/**
 * Bid cards need the bidders, and only the logs carry those -- `bids()` takes an address,
 * so it can confirm a bid but cannot enumerate them.
 *
 * Scanned over one round's block range, which is ~135 blocks, well inside the 10,000-block
 * cap Base's public endpoint enforces. Ordering is by first sighting, which reproduces
 * commitIdx because the contract assigns it in commit order.
 */
export async function bidsFor(rpc, book, orderHash, fromBlock, toBlock) {
  const logs = await call(rpc, "eth_getLogs", [{
    address: book,
    fromBlock: "0x" + Math.max(0, fromBlock).toString(16),
    toBlock: "0x" + toBlock.toString(16),
    topics: [null, null, orderHash],
  }]);
  const byBidder = new Map();
  for (const l of logs) {
    if (!l.topics[3]) continue;
    const bidder = "0x" + l.topics[3].slice(26);
    if (l.topics[0] === TOPIC_COMMITTED) {
      if (!byBidder.has(bidder)) {
        byBidder.set(bidder, {
          bidder,
          commitIdx: byBidder.size,
          committedAtBlock: Number(BigInt(l.blockNumber)),
          bps: null,
          // KEPT, HAVING BEEN THROWN AWAY. Every log already carries the transaction that
          // emitted it, and discarding it meant the page could say "a bid was committed at
          // block N" while offering no way to go and look at it. On a page whose whole
          // claim is that you do not have to trust it, an unlinked assertion is the weakest
          // thing on screen. This one field is what turns the bid cards and the receipt
          // from a report into something checkable on Basescan.
          commitTx: l.transactionHash ?? null,
          revealTx: null,
        });
      }
    } else if (l.topics[0] === TOPIC_REVEALED) {
      const b = byBidder.get(bidder);
      if (b) {
        b.bps = asInt(word(l.data, 0));
        b.revealTx = l.transactionHash ?? null;
      }
    }
  }
  return [...byBidder.values()];
}

/** Has this round been opened? One eth_call, pinned to a block. */
async function isOpened(rpc, book, maker, orderHash, at) {
  const data = await call(rpc, "eth_call", [
    { to: book, data: SEL_AUCTIONS + pad(maker) + pad(orderHash) },
    at,
  ]);
  return decodeAuction(data);
}

const CURSOR_KEY = "glasshouse:lastRound";
const readCursor = () => { try { return Number(localStorage.getItem(CURSOR_KEY)) || 0; } catch { return 0; } };
const writeCursor = (n) => { try { localStorage.setItem(CURSOR_KEY, String(n)); } catch { /* blocked storage */ } };

/**
 * Find the newest round the keeper has opened, without asking about all 300.
 *
 * The first attempt walked backwards one round at a time and was rate limited before it
 * finished -- fifteen sequential eth_calls on every poll against an endpoint that caps
 * bursts. Rounds are opened strictly in order, so "is round i open" is monotonic and a
 * binary search settles it in about nine calls instead.
 *
 * Better still, the answer is remembered: after the first load the page starts from the
 * round it last saw and usually needs one or two calls to confirm nothing has moved.
 *
 * THE GUARD IS `>= 0`, NOT `> 0`, AND THAT IS THE WHOLE POINT OF THE MEMO.
 *
 * Round 0 is a real round, and for a chain with exactly one auction on it the remembered
 * cursor IS 0. Under `> 0` the fast path never engaged there, so every poll paid the full
 * ten-call binary search over all 300 rounds -- and `writeCursor(0)` stored a value that
 * read back as 0 and failed the same guard on the next tick, so the memo could never warm
 * up. The page was rate limited by the endpoint within minutes of the first keeper round
 * landing on mainnet, having been cheap for as long as the chain was empty (round 0 not
 * open meant an early return after ONE call). That is the worst shape for a bug: dormant
 * until the moment the thing it guards starts working.
 *
 * `readCursor` cannot distinguish "nothing stored" from "stored 0" -- `Number("0") || 0`
 * is 0 either way -- and it does not need to. Both mean "start at round 0", and asking
 * whether round 0 is open costs one call, which is what the empty chain used to cost.
 */
async function newestOpenedRound(rpc, book, manifest, at) {
  const rounds = manifest.rounds;
  const cursor = Math.min(readCursor(), rounds.length - 1);

  // Fast path: the remembered round is still the newest, or one or two have passed.
  if (cursor >= 0 && (await isOpened(rpc, book, manifest.maker, rounds[cursor].orderHash, at))) {
    let i = cursor;
    while (i + 1 < rounds.length && (await isOpened(rpc, book, manifest.maker, rounds[i + 1].orderHash, at))) i++;
    writeCursor(i);
    return i;
  }

  // Otherwise binary search the boundary between opened and not.
  let lo = 0;
  let hi = rounds.length - 1;
  if (!(await isOpened(rpc, book, manifest.maker, rounds[0].orderHash, at))) return -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await isOpened(rpc, book, manifest.maker, rounds[mid].orderHash, at)) lo = mid;
    else hi = mid - 1;
  }
  writeCursor(lo);
  return lo;
}

/**
 * The most recently opened rounds, newest first, all pinned to one head block so the
 * board describes a single instant rather than a smear across several.
 */
export async function fromChain({ rpc, book, manifest, limit = 3 }) {
  if (!manifest || !manifest.rounds || manifest.rounds.length === 0) return null;
  const head = await chainHead(rpc);
  if (head === null) return null;
  const at = "0x" + head.toString(16);

  const newest = await newestOpenedRound(rpc, book, manifest, at);
  if (newest < 0) return null; // the keeper has not opened anything yet

  const out = [];
  for (let i = newest; i >= 0 && out.length < limit; i--) {
    const r = manifest.rounds[i];
    const a = await isOpened(rpc, book, manifest.maker, r.orderHash, at);
    if (!a) continue;
    a.orderHash = r.orderHash;
    // The maker is NOT in the Auction struct -- it is half of the mapping key, so the
    // struct never repeats it. Without it BidPanel would call placeBid({maker: undefined})
    // and build a commitment against the wrong auction key: a bid that can never be
    // revealed. It comes from the manifest, which is where the hash came from.
    a.maker = manifest.maker;
    a.round = r.round;
    a.openedAtBlock = a.commitEnd - COMMIT_WINDOW;
    a.clearingBps = a.bestBidder ? Math.max(a.secondBps, a.reserveBps) : null;
    // The chain cannot answer this: it is the subgraph's independent replay. Null, not
    // false -- "not checked" and "checked and disagreed" are very different claims.
    a.settlementMatchesDerivation = null;
    try {
      a.bids = await bidsFor(rpc, book, r.orderHash, a.openedAtBlock, Math.min(head, a.exclusiveEnd + 5));
      a.revealedCount = a.bids.filter((b) => b.bps !== null).length;
    } catch {
      // NULL, NOT ZERO. `revealedCount = 0` says "nobody opened a bid on this round",
      // which is a claim about bidders; what actually happened is that the log scan
      // failed, which is a claim about us. The rounds table already distinguishes the two
      // -- it prints "not read, N committed" and excludes the row from bid-based filters
      // when this is null -- and it was never reached, because the catch asserted the
      // flattering version instead.
      //
      // It matters more now that reads can move between endpoints: a log scan is the
      // likeliest call to fail, and the wrong answer here would accuse every bidder on
      // the round of not showing up.
      a.bids = [];
      a.revealedCount = null;
    }
    out.push(a);
  }
  return out.length === 0 ? null : { source: "chain", head, auctions: out };
}
