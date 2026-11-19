#!/usr/bin/env node
// Probe networks from data/crawl.json whose definitions changed, then rebuild data/index.json.
// Needs ANTHROPIC_API_KEY. Usage: node bin/probe.mjs [--limit N]

import { probeAll } from "../src/probe.mjs";
import { readJson, writeJson, writeIndex } from "../src/store.mjs";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const log = (m) => process.stderr.write(`${m}\n`);

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  log("No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN: skipping probes, rebuilding the index from saved results.");
  log(`index: ${JSON.stringify(writeIndex().stats)}`);
  process.exit(0);
}

const crawl = readJson("crawl.json");
const networks = crawl.sites.flatMap((s) => s.networks);
await probeAll(networks, readJson("probes.json", {}), { limit, log, save: (c) => writeJson("probes.json", c) });
log(`index: ${JSON.stringify(writeIndex().stats)}`);
