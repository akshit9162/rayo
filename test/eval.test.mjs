import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, judge } from "../src/eval.mjs";
import { prepare } from "../src/search.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

test("every judged site still exists in the index, so the eval cannot go stale silently", () => {
  const urls = read("../data/index.json").networks.map((n) => n.url);
  for (const { q, relevant } of read("../data/eval/queries.json").queries)
    for (const key of Object.keys(relevant)) assert.ok(urls.some((u) => u.includes(key)), `${q}: no network matches ${key}`);
});

test("nDCG, MRR and recall on a tiny index", () => {
  const net = (url, description) => ({ url, name: url, brand: url, description, sampleQueries: [], agents: [], siteActions: [],
    sharedActions: [], tags: [], cannotDo: [], checks: [], signals: { acts: 0 }, score: 0.5, inbound: 0 });
  const p = prepare({ networks: [net("a", "bake bread"), net("b", "bread delivery and cakes"), net("c", "pizza")] });
  const perfect = judge(p, { q: "bread", relevant: { a: 2, b: 2 } });
  assert.equal(perfect.ndcg, 1);
  assert.equal(perfect.recall, 1);
  assert.equal(judge(p, { q: "flowers", relevant: {} }).ok, 1);
  const r = evaluate(p, [{ q: "cakes", relevant: { b: 2 } }, { q: "pizza", relevant: {} }]);
  assert.equal(r.mrr, 1);
  assert.equal(r.noAnswer, 0);   // pizza is found, but this judge said no site should be
});

test("puffery never counts as a match", async () => {
  const { prepare, search, tokenize } = await import("../src/search.mjs");
  assert.deepEqual(tokenize("The best, world-class bakery"), ["bakery"]);
  const net = (url, description) => ({ url, name: url, brand: url, description, sampleQueries: [], agents: [], siteActions: [],
    sharedActions: [], tags: [], cannotDo: [], checks: [], signals: { acts: 0 }, score: 0.5, inbound: 0 });
  const p = prepare({ networks: [net("puffed", "The best bakery in town, world-class bread"), net("plain", "Bakery: bread and cakes")] });
  const hits = search(p, "best bakery bread cakes");
  assert.equal(hits[0].url, "plain");
});

test("the claude -p client passes the site's instructions as the system prompt and returns judge JSON", async () => {
  const { claudeCliClient } = await import("../src/claude-cli.mjs");
  const calls = [];
  const client = claudeCliClient({ bin: async (args) => { calls.push(args); return { result: "x", structured_output: { pass: true, reason: "ok" }, stop_reason: "end_turn" }; } });
  const r = await client.beta.messages.create({ model: "m", system: "SITE", messages: [{ role: "user", content: "hi" }], betas: ["b"],
    output_config: { format: { type: "json_schema", schema: { type: "object" } } } });
  assert.equal(JSON.parse(r.content[0].text).pass, true);
  const a = calls[0];
  assert.equal(a[a.indexOf("--system-prompt") + 1], "SITE");
  assert.equal(a[a.indexOf("--tools") + 1], "");
  assert.ok(a.includes("--json-schema"));
});
