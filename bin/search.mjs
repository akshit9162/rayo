#!/usr/bin/env node
// Query data/index.json. Usage: node bin/search.mjs "book a boat trip" [--json]

import { readFileSync } from "node:fs";
import { prepare, search } from "../src/search.mjs";

const args = process.argv.slice(2);
const query = args.filter((a) => !a.startsWith("--")).join(" ");
const index = JSON.parse(readFileSync(new URL("../data/index.json", import.meta.url), "utf8"));
const hits = search(prepare(index), query, { limit: 5 });
if (args.includes("--json")) console.log(JSON.stringify(hits, null, 2));
else
  for (const h of hits) {
    console.log(`${h.score.toFixed(3)}  ${h.name}\n       ${h.url}\n       ${h.description.slice(0, 110)}`);
    console.log(`       rank ${h.why.rank}, relevance ${h.why.relevance}, matched [${h.why.matched}]${h.why.canAct ? ", can act" : ""}\n`);
  }
