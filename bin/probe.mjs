#!/usr/bin/env node
// Probe networks from data/crawl.json whose definitions changed, then rebuild data/index.json.
// Needs ANTHROPIC_API_KEY, or --via-claude to use your Claude Code login. Usage: node bin/probe.mjs [--limit N] [--via-claude]

import { probeAll } from "../src/probe.mjs";
import { readJson, writeJson, writeIndex } from "../src/store.mjs";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const log = (m) => process.stderr.write(`${m}\n`);

// --via-claude runs probes through `claude -p` on your own Claude Code login instead of the API.
const viaCli = args.includes("--via-claude");
if (!viaCli && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  log("No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN (and no --via-claude): skipping probes, rebuilding the index from saved results.");
  log(`index: ${JSON.stringify(writeIndex().stats)}`);
  process.exit(0);
}

const crawl = readJson("crawl.json");
const networks = crawl.sites.flatMap((s) => s.networks);
const client = viaCli ? (await import("../src/claude-cli.mjs")).claudeCliClient() : undefined;
await probeAll(networks, readJson("probes.json", {}), { ...(client && { client, concurrency: 2 }), limit, log, save: (c) => writeJson("probes.json", c) });
log(`index: ${JSON.stringify(writeIndex().stats)}`);
