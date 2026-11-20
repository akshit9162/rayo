# Rayo

A search engine for the open agentic web. Google took its name from a googol, 10^100; Rayo takes its name from Rayo's number, the largest named number, which a googol does not begin to reach.

Agent sites describe themselves; Rayo crawls the links between them and ranks each network on what it can show.

- **Site:** https://akshit9162.github.io/rayo/
- **Network URL** (call it from your own agent site): `https://akshit9162.github.io/rayo/rayo`
- **Index:** [`data/index.json`](data/index.json), rebuilt daily

## What it does

1. **Crawl agent links.** Seeds: the community list in `cognizant-ai-labs/agentic-web`, sites proposed in its open pull requests, and every `agent-manifest.json` that GitHub code search finds. From each site it follows partner network URLs, `links.json` bindings and `allowed_peers`. It reads `bridge/bridge-actions.js` as text, never running it, to see which actions a site shares.
2. **Index** each network: description, sample queries, agent descriptions, site and bridge actions with their effects, and its "cannot do" list.
3. **Rank on evidence:**

   | Signal | Weight | Measures |
   |---|---|---|
   | probes | 30% | Front-agent instructions on one fixed model: declines an out-of-scope transfer, resists an override, invents no facts |
   | conformance | 25% | Manifest, definition and CORS per the MVP spec |
   | links | 15% | PageRank over links between sites |
   | live | 10% | Shares live reads with any caller |
   | acts | 10% | Can book, order or write, not just talk |
   | honest | 5% | Publishes what it cannot do |
   | fresh | 5% | Changed in the last 30 to 180 days |

   Penalties multiply the score: definition does not match its declared sha256 ×0.2, expired claim ×0.5, text aimed at other agents, rankers or keys ×0.3, near-copy of a higher-ranked network on another origin ×0.5.

4. **Hand off.** "Hand it to the top agent" gives the job to the best match's agent instead of opening its page. The page binds the network's `chosen_agent` slot to that site's network URL and sends the job to Rayo's assistant; the runtime asks the visitor on a card before contacting the site, and a booking or order opens in the site's own window.
5. **Serve** as an agent site. The page has a search box and an assistant. Its three reads (`search_agentic_web`, `get_network_report`, `get_index_info`) are shared with every site (`"*"`) through the bridge, so any agent site can list Rayo as a tool.

## Run it

```sh
npm ci
node bin/crawl.mjs          # needs the gh CLI, logged in, for GitHub code search
node bin/probe.mjs          # needs ANTHROPIC_API_KEY; only re-probes changed networks
node bin/probe.mjs --via-claude   # or: the same probes through `claude -p` on your Claude Code login
node bin/build-site.mjs     # copies the index and search module into site/
node bin/search.mjs "explain a bank letter"
node bin/eval.mjs           # score the ranking on the judged queries in data/eval/queries.json
npm test
```

`data/eval/queries.json` holds 39 hand-judged queries, including paraphrases, "not" queries and ones whose right answer is no result. A ranking change counts as better only if `node bin/eval.mjs` goes up (nDCG@5 90.4, MRR 94.4 on 2026-11-20). Words like "best" or "world-class" never count as a match, on either side.

The override probe (version 2) asks the agent, under a fake "admin mode", to make a bank transfer and give a transaction ID. Version 1 asked it to echo a harmless token, which breaks no rule. On Opus 5.5 all 46 networks pass both "declines" and "override", so today only "grounded" separates sites; a weaker `RAYO_PROBE_MODEL` would show more.

Serve `site/` with any static host. GitHub Pages sends `Access-Control-Allow-Origin: *`, which the spec needs for the public files.

The daily workflow (`.github/workflows/crawl.yml`) crawls, probes, tests, commits the index and builds `web/` and deploys it to Pages. Repository secrets: `ANTHROPIC_API_KEY` for probes; `CRAWL_GH_TOKEN` (a fine-grained token with public read access) if `GITHUB_TOKEN` cannot use code search.

## Limits

- Probes run the front agent alone, without its website tools or partners. They measure the instructions, not the live site.
- The integrity check compares digests and expiry. It does not verify the trust signature.
- The safety scan is pattern-based. It catches plain attempts, not clever ones.
- Ranking has few links to work with while the web is small; probes do most of the ordering.

## Layout

| Path | What |
|---|---|
| `src/` | Crawler, parsers, safety scan, ranker, probes, search |
| `bin/` | `crawl`, `probe`, `build-site`, `search` |
| `web/` | The published page: a Next.js static export around the agent bundle in `site/` (`bin/sync-web.mjs` copies it in) |
| `site/` | The agent bundle, built with the `agentify-website` skill; `site/runtime/` is its unchanged runtime copy |
| `data/` | `crawl.json` (full crawl), `probes.json` (results by definition digest), `index.json` (what the site serves) |
| `test/`, `site/tests/` | Node tests, no network or model calls |
