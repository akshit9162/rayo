#!/usr/bin/env node
// Score the current ranking on the judged queries. Usage: node bin/eval.mjs [--all]
// --all prints every query; otherwise only the ones that miss.

import { readFileSync } from "node:fs";
import { evaluate } from "../src/eval.mjs";
import { prepare } from "../src/search.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const r = evaluate(prepare(read("../data/index.json")), read("../data/eval/queries.json").queries);
const pct = (x) => `${(x * 100).toFixed(1)}`;
console.log(`nDCG@5 ${pct(r.ndcg)}  MRR ${pct(r.mrr)}  Recall@5 ${pct(r.recall)}  no-answer ${pct(r.noAnswer)}  (${r.queries} queries)`);
for (const row of r.rows) {
  const bad = row.empty ? !row.ok : row.ndcg < 0.999;
  if (!bad && !process.argv.includes("--all")) continue;
  const tag = row.empty ? (row.ok ? "ok  " : "MISS") : row.ndcg.toFixed(2);
  console.log(`${tag}  ${row.q}\n      ${row.hits.map((h) => h.name).join(" | ") || "(nothing)"}`);
}
