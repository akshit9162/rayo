import { test } from "node:test";
import assert from "node:assert/strict";
import { crawl } from "../src/crawl.mjs";
import { buildIndex, pagerank } from "../src/rank.mjs";
import { prepare, search, tokenize } from "../src/search.mjs";

// A tiny fake web: a pizza site and a tour site that link to each other, a guesthouse that
// the tour site links to, and a spam site whose description repeats the query words.
function site({ name, front, desc, refs = [], cors = "*", bridge = null, peers = [], cannot = "" }) {
  return {
    manifest: {
      brand: name, llm_router: { base_url: "https://r.example" }, allowed_peers: peers,
      networks: [{ name, front_man: front, hocon: `./${name}.network.json`, description: desc }],
      ...(bridge ? { actions: { bridge: "./bridge/action-bridge.html", agentTools: ["x"] } } : {}),
    },
    network: {
      metadata: { description: desc },
      commondefs: { replacement_strings: { rules: cannot } },
      tools: [{ name: front, function: { description: desc }, tools: refs }],
    },
    cors, bridge,
  };
}

const WEB = {
  "https://pizza.example/": site({ name: "pizza", front: "p", desc: "Order pizza for pickup in Marrow Point", refs: ["https://tours.example/boats"],
    bridge: `callerOrigins: ["*"], name: "get_menu", effect: "read"\n name: "place_order", effect: "irreversible"`, cannot: "This site cannot take payment." }),
  "https://tours.example/": site({ name: "boats", front: "t", desc: "Boat trips and harbor tours in Marrow Point", refs: ["https://pizza.example/pizza", "https://guest.example/rooms"] }),
  "https://guest.example/": site({ name: "rooms", front: "g", desc: "Rooms at a guesthouse near the harbor", refs: ["https://tours.example/boats"] }),
  "https://spam.example/": site({ name: "spam", front: "s", desc: "Best boat trip boat trip boat tours book boat trip now", cors: null }),
};

function fakeFetcher(url) {
  const u = new URL(url);
  const base = `${u.origin}/`;
  const s = WEB[base];
  const ok = (json, text) => ({ ok: true, status: 200, finalUrl: url, cors: s.cors, json, text: text ?? JSON.stringify(json) });
  if (!s) return { ok: false, status: 404, finalUrl: url };
  if (u.pathname === "/agent-manifest.json") return ok(s.manifest);
  if (u.pathname.endsWith(".network.json")) return ok(s.network);
  if (u.pathname === "/bridge/agent-manifest.json" && s.bridge) return ok({ actions: { module: "./bridge-actions.js" } });
  if (u.pathname === "/bridge/bridge-actions.js" && s.bridge) return { ...ok(null, s.bridge), json: null };
  return { ok: false, status: 404, finalUrl: url };
}

async function run() {
  const result = await crawl({
    seeds: [{ base: "https://pizza.example/", source: "list" }, { base: "https://spam.example/", source: "list" }, { base: "http://localhost/", source: "list" }],
    fetcher: async (u) => fakeFetcher(u),
  });
  return { result, index: buildIndex(result, { now: new Date("2026-11-20T00:00:00Z") }) };
}

test("crawl follows agent links to sites nobody seeded", async () => {
  const { result } = await run();
  assert.deepEqual(result.sites.map((s) => s.base).sort(), [
    "https://guest.example/", "https://pizza.example/", "https://spam.example/", "https://tours.example/",
  ]);
  assert.ok(result.sites.find((s) => s.base === "https://guest.example/").sources[0].startsWith("link:"));
});

test("one manifest served under several paths is one site", async () => {
  const manifest = WEB["https://guest.example/"].manifest;
  const result = await crawl({
    seeds: [{ base: "https://twin.example/", source: "a" }, { base: "https://twin.example/agents/", source: "b" }],
    fetcher: async (url) => ({ ok: url.endsWith("agent-manifest.json"), status: 200, finalUrl: url, json: manifest, text: JSON.stringify(manifest) }),
    concurrency: 1,
  });
  assert.equal(result.sites.length, 1);
  assert.deepEqual(result.sites[0].sources, ["a", "b"]);
});

test("bridge source gives shared reads, writes and public callers", async () => {
  const { index } = await run();
  const pizza = index.networks.find((n) => n.name === "pizza");
  assert.equal(pizza.signals.acts, 1);
  assert.equal(pizza.signals.live, 1);
  assert.equal(pizza.signals.honest, 1);
});

test("evidence beats keyword stuffing", async () => {
  const { index } = await run();
  const hits = search(prepare(index), "boat trip in Marrow Point");
  assert.equal(hits[0].url, "https://tours.example/boats");
  assert.ok(hits.findIndex((h) => h.url.includes("spam")) > 0);
  assert.ok(hits[0].why.checks.some((c) => c.startsWith("✓ cors")));
  assert.deepEqual(hits[0].why.linkedFrom.sort(), ["https://guest.example/", "https://pizza.example/"]);
});

test("action queries prefer sites that can act", async () => {
  const { index } = await run();
  const [top] = search(prepare(index), "order food in Marrow Point");
  assert.equal(top.url, "https://pizza.example/pizza");
  assert.equal(top.why.canAct, true);
});

test("pagerank sums to one and favours linked nodes", () => {
  const g = new Map([["a", new Set(["c"])], ["b", new Set(["c"])]]);
  const pr = pagerank(["a", "b", "c"], g);
  assert.ok(Math.abs(pr.a + pr.b + pr.c - 1) < 1e-9);
  assert.ok(pr.c > pr.a);
});

test("tokenize stems and drops stop words", () => {
  assert.deepEqual(tokenize("Booking the boats!"), ["book", "boat"]);
  assert.deepEqual(tokenize("slides slide classes stories booked"), ["slide", "slide", "class", "story", "book"]);
});

test("a sample query the site turns down does not make it a match", () => {
  const net = (url, brand, description, sampleQueries, cannotDo) => ({
    url, brand, name: brand, description, sampleQueries, cannotDo, agents: [], siteActions: [], sharedActions: [],
    tags: [], checks: [], signals: { acts: 0 }, score: 0.5, inbound: [],
  });
  const index = { networks: [
    net("https://shot.example/shop", "shots", "Collagen shots delivered in Hyderabad", ["Can you also send flowers with my order?"],
      ["For something this shop does not sell, such as flowers, ask the search engine."]),
    net("https://bakery.example/cakes", "cakes", "Cakes and pastries in Hyderabad", ["Do you have eggless cakes?"], []),
  ] };
  const prepared = prepare(index);
  assert.deepEqual(search(prepared, "flowers"), []);
  assert.equal(search(prepared, "collagen shots")[0].url, "https://shot.example/shop");
});
