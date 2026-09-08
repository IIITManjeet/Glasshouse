// The instrument: live auctions on Base, rendered from indexed data.
//
// PRECEDENCE (ui-spec section 5.1). Live subgraph, then localStorage cache, then the
// checked-in snapshot. Each is LABELLED with its own source tag; the page never shows a
// number without saying where it came from, which is DESIGN.md section 2 and the one rule
// this project treats as non-negotiable.
//
// TWO HEADS (ui-spec section 5.2). The indexed head H_i comes from the data source; the
// chain head H_c from an RPC. Phase is computed against H_i, because that is the block
// the data describes and a phase computed against anything else is a guess. Countdowns
// use max(H_i, H_c), because time only moves forward and a countdown must be pessimistic.
//
// No framework, no build step. This file and the two it imports are plain ESM, which is
// why the same phase() and recommendReserve() run here, in the advisor, and under
// `node --test`. One implementation, three consumers, no forks.

import { phase, canSettle } from "./phase.js";

// Set this once the subgraph is published; until then the page runs on the snapshot and
// says so. Empty is a supported state, not a broken one.
const SUBGRAPH_URL = "";

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";
const RPC = "https://mainnet.base.org";
const BLOCK_SECONDS = 2;

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const num = (n) => Number(n).toLocaleString("en-US");

// ---------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------

const CACHE_KEY = "glasshouse:q:auctions";

function readCache() {
  // Wrapped because a browser set to block site data throws on the accessor itself,
  // rather than returning null. A thrown accessor means "no cache", not a broken page.
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode, quota, blocked storage: the page works without it */
  }
}

const Q1 = `{
  _meta { block { number timestamp } }
  auctions(orderBy: openedAtBlock, orderDirection: desc, first: 50) {
    id maker { id provenance } orderHash
    openedAtBlock commitEnd revealEnd exclusiveEnd
    reserveBps maxBps bond
    committedCount revealedCount
    bestBidder { id provenance } bestBps secondBps clearingBps
    filled filledBy settled winnerForfeited
    bids(orderBy: commitIdx) { commitIdx bidder { id provenance } bps committedAtBlock revealedAtBlock }
  }
}`;

async function fromSubgraph() {
  if (!SUBGRAPH_URL) return null;
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: Q1 }),
  });
  if (!res.ok) throw new Error(`subgraph ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(body.errors[0]?.message ?? "subgraph error");
  return {
    source: "base",
    head: Number(body.data._meta.block.number),
    auctions: body.data.auctions,
  };
}

function fromSnapshot() {
  const s = window.GLASSHOUSE_SNAPSHOT;
  if (!s) return null;
  return { source: "snapshot", head: s.head, auctions: s.auctions, producedAt: s.producedAt };
}

/** Live, then cache, then snapshot. Never silently: the caller renders the tag. */
async function load() {
  try {
    const live = await fromSubgraph();
    if (live) {
      writeCache({ at: Date.now(), head: live.head, auctions: live.auctions });
      return live;
    }
  } catch (e) {
    console.warn("[glasshouse] subgraph unavailable:", e.message);
  }
  const cached = readCache();
  if (cached) return { source: "cache", head: cached.head, auctions: cached.auctions, at: cached.at };
  return fromSnapshot();
}

async function chainHead() {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    const body = await res.json();
    return body.result ? Number(BigInt(body.result)) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------

const PHASE_LABEL = { commit: "commit", reveal: "reveal", exclusive: "exclusive", open: "open" };

function sourceChip(state) {
  const bits = ["Source"];
  if (state.source === "base") bits.push("Base mainnet · indexed", `as of block ${num(state.head)}`);
  else if (state.source === "cache") bits.push("Cached", `as of block ${num(state.head)}`);
  else bits.push("Snapshot in repo", `as of block ${num(state.head)}`);
  return bits.join(" · ");
}

/** The phase track: four cells, the active one carrying the countdown. */
function renderTrack(a, hi, hc) {
  const now = Math.max(hi, hc ?? 0);
  const p = phase(
    { commitEnd: a.commitEnd, revealEnd: a.revealEnd, exclusiveEnd: a.exclusiveEnd, bestBidder: a.bestBidder ?? null },
    hi,
  );
  const track = el("div", "track");
  const cells = [
    { key: "commit", head: "commit", range: `${num(a.openedAtBlock)}–${num(a.commitEnd)}`, note: "sealed bids arrive" },
    { key: "reveal", head: "reveal", range: `${num(a.commitEnd + 1)}–${num(a.revealEnd)}`, note: "bids open, top two settle" },
    { key: "exclusive", head: "exclusive", range: `${num(a.revealEnd + 1)}–${num(a.exclusiveEnd)}`, note: "winner fills at the improved price" },
    { key: "open", head: "open", range: `from ${num(a.exclusiveEnd + 1)}`, note: "anyone fills, at base price" },
  ];
  for (const c of cells) {
    const cell = el("div", c.key === p ? "cell is-active" : "cell");
    cell.appendChild(el("span", "ph", c.head));
    cell.appendChild(el("span", "blocks", c.range));
    if (c.key === p) {
      const end = c.key === "commit" ? a.commitEnd : c.key === "reveal" ? a.revealEnd : a.exclusiveEnd;
      const left = Math.max(0, end - now + 1);
      cell.appendChild(el("span", "count", `${left} block${left === 1 ? "" : "s"} · ~${left * BLOCK_SECONDS}s at 2s/block`));
    } else {
      cell.appendChild(el("span", "note", c.note));
    }
    // The contract collapses the exclusive window to nothing when nobody revealed, so
    // the diagram has to say that rather than draw a window that will never exist.
    if (c.key === "exclusive" && !a.bestBidder) {
      cell.classList.add("is-void");
      cell.appendChild(el("span", "note", "collapses if nobody reveals"));
    }
    track.appendChild(cell);
  }
  return { track, p };
}

/** One card per bid, hatched until revealed. "Sealed" is a state, not "pending". */
function renderBids(a) {
  const wrap = el("div", "bids");
  if (!a.bids || a.bids.length === 0) {
    wrap.appendChild(el("p", "muted", "No bids committed yet."));
    return wrap;
  }
  const best = a.bestBidder && (a.bestBidder.id ?? a.bestBidder);
  for (const b of a.bids) {
    const bidder = b.bidder?.id ?? b.bidder;
    const card = el("div", b.bps === null || b.bps === undefined ? "bid is-sealed" : "bid");
    card.appendChild(el("span", "idx", `#${b.commitIdx}`));
    if (b.bps === null || b.bps === undefined) {
      card.appendChild(el("span", "seal", "▨▨▨▨▨▨"));
      card.appendChild(el("span", "who", short(bidder)));
      card.appendChild(el("span", "note", `sealed · block ${num(b.committedAtBlock)}`));
    } else {
      card.appendChild(el("span", "bps", `${b.bps} bps`));
      card.appendChild(el("span", "who", short(bidder)));
      const role = best && bidder && best.toLowerCase() === bidder.toLowerCase()
        ? "leading"
        : b.bps === a.secondBps ? "sets the price" : "outbid";
      card.appendChild(el("span", "note", role));
    }
    wrap.appendChild(card);
  }
  return wrap;
}

function renderStats(a, p) {
  const wrap = el("div", "stats");
  const clearing = a.clearingBps ?? null;
  const state = a.settled ? "settled" : p === "open" || p === "exclusive" ? "final" : "running";
  const add = (k, v) => {
    const s = el("div", "stat");
    s.appendChild(el("span", "k", k));
    s.appendChild(el("span", "v", v));
    wrap.appendChild(s);
  };
  add("clearing", clearing === null ? "—" : `${clearing} bps · ${state}`);
  add("reveals", `${a.revealedCount} of ${a.committedCount}`);
  add("winner", a.bestBidder ? short(a.bestBidder.id ?? a.bestBidder) : "no reveals");
  add("reserve · max", `${a.reserveBps} · ${a.maxBps} bps`);
  if (a.filled) add("filled by", short(a.filledBy));
  return wrap;
}

function renderAuction(a, state, hc) {
  const hi = state.head;
  const root = el("figure", "fig auction");
  root.dataset.src = state.source;
  root.appendChild(el("div", "src", sourceChip(state)));

  const head = el("div", "auction-head");
  head.appendChild(el("h3", null, `Auction · ${short(a.orderHash)}`));
  const { track, p } = renderTrack(a, hi, hc);
  head.appendChild(el("span", `chip chip-${p}`, PHASE_LABEL[p]));
  if (a.settled) head.appendChild(el("span", "chip chip-settled", "settled"));
  root.appendChild(head);
  root.appendChild(track);
  root.appendChild(renderBids(a));
  root.appendChild(renderStats(a, p));

  const cap = el("figcaption", "made");
  cap.innerHTML =
    "<strong>What produced this:</strong> the <code>GlasshouseBook</code> contract at " +
    `<code>${short(BOOK)}</code> on Base mainnet, read at block ${num(hi)}. The phase is computed here by ` +
    "<code>site/phase.js</code> against that same block — the contract stores no phase, it compares " +
    "<code>block.number</code> to stored boundaries, so any reader must do the same. " +
    (state.source === "snapshot"
      ? "This is the checked-in snapshot, not live data."
      : state.source === "cache"
        ? "This is the last response that succeeded, held in your browser."
        : "This is live indexed data.");
  root.appendChild(cap);
  return root;
}

// ---------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------

function banner(state) {
  const b = $("#data-banner");
  if (!b) return;
  if (state.source === "base") {
    b.hidden = true;
    return;
  }
  b.hidden = false;
  b.textContent =
    state.source === "cache"
      ? `Showing cached data as of block ${num(state.head)} — the subgraph did not answer.`
      : `Showing the snapshot committed to this repository, as of block ${num(state.head)}.` +
        " The subgraph is deployed but not yet published to The Graph Network.";
}

async function tick() {
  const mount = $("#live-auctions");
  if (!mount) return;

  const state = await load();
  if (!state) {
    mount.replaceChildren(el("p", "muted", "No data source available."));
    return;
  }
  banner(state);
  const hc = await chainHead();

  const list = state.auctions ?? [];
  if (list.length === 0) {
    const empty = el("figure", "fig");
    empty.dataset.src = state.source;
    empty.appendChild(el("div", "src", sourceChip(state)));
    empty.appendChild(el("p", "muted", "No auctions have been opened on this Book yet."));
    const cap = el("figcaption", "made");
    cap.innerHTML = "<strong>What produced this:</strong> a scan of the Book's logs on Base found no auctions.";
    empty.appendChild(cap);
    mount.replaceChildren(empty);
    return;
  }

  mount.replaceChildren(...list.slice(0, 5).map((a) => renderAuction(a, state, hc)));
}

function start() {
  // ui-spec section 5.4: module scripts do not run from file://, so the instrument
  // sections ship with a static notice which this removes. The argument tier above needs
  // no script and renders either way.
  for (const n of document.querySelectorAll(".needs-http")) n.remove();

  tick();
  // Budgeted per ui-spec 5.3: nothing while the tab is hidden.
  setInterval(() => {
    if (!document.hidden) tick();
  }, 12_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
