import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  splitNetworkUrl, normalizeBase, isCrawlable, parseManifest, parseNetwork, parseLinks,
  parseBridgeActions, relativeImports,
} from "../src/parse.mjs";

const fx = (p) => readFileSync(new URL(`./fixtures/pizza/${p}`, import.meta.url), "utf8");
const BASE = "https://pizza.example/site/";

test("network URL splits into site base and name", () => {
  assert.deepEqual(splitNetworkUrl("https://peer.example/agents/transit?x=1"), {
    base: "https://peer.example/agents/", name: "transit",
  });
  assert.equal(normalizeBase("https://a.example/x"), "https://a.example/x/");
});

test("only public HTTPS URLs are crawlable", () => {
  assert.equal(isCrawlable("https://a.example/n"), true);
  assert.equal(isCrawlable("http://a.example/n"), false);
  assert.equal(isCrawlable("https://localhost/n"), false);
  assert.equal(isCrawlable("not a url"), false);
});

test("manifest: networks resolve against the base", () => {
  const m = parseManifest(JSON.parse(fx("agent-manifest.json")), BASE);
  assert.equal(m.networks.length, 1);
  const [n] = m.networks;
  assert.equal(n.name, "little_oven_pizza");
  assert.equal(n.url, "https://pizza.example/site/little_oven_pizza");
  assert.equal(n.hoconUrl, "https://pizza.example/site/little_oven_pizza.network.json");
  assert.equal(n.frontMan, "little_oven_assistant");
  assert.ok(n.sampleQueries.length > 3);
  assert.equal(m.peerMode, "closed");
  assert.equal(m.actions.bridge, "https://pizza.example/site/bridge/action-bridge.html");
  assert.ok(m.actions.agentTools.includes("place_order"));
  assert.deepEqual(m.problems, []);
});

test("manifest: missing fields are reported, not thrown", () => {
  const m = parseManifest({ networks: [{ name: "x" }] }, BASE);
  assert.ok(m.problems.some((p) => p.includes("front_man")));
  assert.ok(m.problems.some((p) => p.includes("llm_router")));
  assert.deepEqual(parseManifest(null, BASE).networks, []);
});

test("network: agents, peer links and cannot-do text", () => {
  const n = parseNetwork(JSON.parse(fx("little_oven_pizza.network.json")), "little_oven_assistant");
  assert.deepEqual(n.problems, []);
  assert.ok(n.agents.some((a) => a.name === "little_oven_assistant" && a.description));
  assert.ok(n.externalRefs.includes("http://localhost:8081/marrow_point_harbor_tours"));
  assert.ok(n.cannotDo.some((s) => /cannot take payment/.test(s)));
});

test("network: undefined front agent and duplicates are problems", () => {
  const n = parseNetwork({ tools: [{ name: "a", tools: ["b", "https://p.example/n", { url: "https://m.example/mcp" }] }, { name: "a" }] }, "z");
  assert.ok(n.problems.some((p) => p.includes("duplicate agent a")));
  assert.ok(n.problems.some((p) => p.includes("front agent z")));
  assert.deepEqual(n.symbolicRefs, ["b"]);
  assert.deepEqual(n.mcp, ["https://m.example/mcp"]);
});

test("links.json bindings", () => {
  const json = { version: 1, networks: { a: { transit: "https://peer.example/agents/transit" }, b: {} } };
  assert.deepEqual(parseLinks(json, "a"), ["https://peer.example/agents/transit"]);
  assert.deepEqual(parseLinks(json), ["https://peer.example/agents/transit"]);
});

test("bridge actions are read from source text, including imported modules", () => {
  const bridge = fx("bridge/bridge-actions.js");
  const imports = relativeImports(bridge, "https://pizza.example/site/bridge/bridge-actions.js");
  assert.ok(imports.includes("https://pizza.example/site/bridge/order-window.js"));
  const b = parseBridgeActions([bridge, fx("bridge/order-window.js")]);
  assert.deepEqual(b.actions.map((a) => [a.name, a.effect]).sort(), [
    ["get_restaurant_state", "read"], ["place_order", "irreversible"],
  ]);
  assert.equal(b.publicCallers, false);
  assert.equal(parseBridgeActions(['callerOrigins: ["*"], name: "s", effect: "read"']).publicCallers, true);
});
