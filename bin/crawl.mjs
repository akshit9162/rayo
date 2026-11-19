#!/usr/bin/env node
// Crawl the open agentic web, then rebuild data/index.json.
// Usage: node bin/crawl.mjs [--no-github] [--max 300]

import { crawl } from "../src/crawl.mjs";
import { fetchResource } from "../src/fetch.mjs";
import { seedsFromUpstream, seedsFromGitHub } from "../src/seeds.mjs";
import { readJson, writeJson, writeIndex } from "../src/store.mjs";

const args = process.argv.slice(2);
const max = Number(args[args.indexOf("--max") + 1]) || 300;
const log = (m) => process.stderr.write(`${m}\n`);

const seeds = await seedsFromUpstream();
log(`upstream seeds: ${seeds.length}`);
if (!args.includes("--no-github")) {
  try {
    seeds.push(...(await seedsFromGitHub({ log })));
  } catch (error) {
    // Code search needs a token that may search; without it the crawl still runs from the list.
    log(`github seeds skipped: ${error.message.split("\n")[0]}`);
  }
}
log(`total seeds: ${seeds.length}`);

const result = await crawl({ seeds, fetcher: fetchResource, previous: readJson("crawl.json", null), maxSites: max });
writeJson("crawl.json", { crawledAt: new Date().toISOString(), ...result });
log(`index: ${JSON.stringify(writeIndex().stats)}`);
