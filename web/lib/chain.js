// Reading auctions straight from the Book, over plain eth_call.
//
// WHY THE PAGE TALKS TO THE CHAIN AT ALL. The subgraph is the intended source, but it is
// deployed to Studio and not published to The Graph Network, so today there is nothing to
// query -- while the keeper opens rounds continuously. A board that cannot see the round
// happening right now is not a board.
//
// This is possible without an indexer only because the round hashes are DETERMINISTIC and
// precomputed (site/data/rounds.js, generated from config/rounds.json, itself built by
// upstream's MakerTraitsLib). There is nothing to discover: the page already knows every
// order hash the keeper will ever open, so it can ask the Book about each one.
//
// It also stays the right source once the subgraph IS published. Polling an indexer every
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

/** Base's public endpoint rate limits (-32016). Reads are idempotent, so back off. */
async function call(rpc, method, params, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await once(rpc, method, params);
    } catch (e) {
      const msg = String(e.message ?? e);
      if (attempt >= tries || !/rate limit|-32016|429|too many/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }
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
 */
async function newestOpenedRound(rpc, book, manifest, at) {
  const rounds = manifest.rounds;
  const cursor = Math.min(readCursor(), rounds.length - 1);

  // Fast path: the remembered round is still the newest, or one or two have passed.
  if (cursor > 0 && (await isOpened(rpc, book, manifest.maker, rounds[cursor].orderHash, at))) {
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
      a.bids = [];
      a.revealedCount = 0;
    }
    out.push(a);
  }
  return out.length === 0 ? null : { source: "chain", head, auctions: out };
}
