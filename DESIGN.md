# Wayfind: a search engine for the open agentic web

Working name. Written 2026-11-20 and follows `../SEARCH_AND_PLAN.md` §1.

## What changed since the plan (18 → 20 Nov)

- **#41 fixed upstream** (PR #47 merged 19 Nov). The SharePoint links and typos are gone, so `upstream_spec_docfix.patch` is obsolete.
- **Partner reads (#45) and partner writes (#46) merged.** A site's `bridge/bridge-actions.js` can share an action with caller origins (`"*"` allowed for public reads). This is how other sites will call our search: they load our network, and its `search` read runs on our origin and returns live results. No MCP server or backend is needed.
- **The intent inbox is mostly obsolete.** #46 gives partner writes in a partner window, and the visitor confirms there. Drop it from the Toll-Free plan.
- **The listed sites are a small fraction.** `agentic_websites.md` lists 5 sites (2 more are in open PRs #48 and #49). GitHub code search for `front_man filename:agent-manifest.json` returns about 110 manifests in about 40 repos, so there is something real to crawl.
- **Agent Atlas** (the nearest entry) is still a directory plus a conformance checker over the list, with `filter_directory`. It has no crawler and no outcome ranking.

## The pipeline

```
seeds ──► crawl ──► index.json ──► rank ──► search (browser, shared read)
```

1. **Seeds.** The table in `agentic_websites.md`; sites in open PRs that edit it; GitHub code search for manifests, mapped repo → live URL (repo homepage, GitHub Pages URL plus manifest directory).
2. **Crawl (agent links).** For each site base: fetch `agent-manifest.json`, each network definition, `links.json`, `bridge/agent-manifest.json` and `bridge/bridge-actions.js` (read as text, never executed). Follow every external URL: network `tools` entries, `link_labels`, `links.json` bindings, `allowed_peers`. HTTPS only (loopback skipped). Bounded by max sites and timeouts.
3. **Index.** One record per network: description, sample queries, agent descriptions, the site action names, shared bridge actions with their effect and callers, and the "cannot do" text from grounding rules. Edges: site → peer.
4. **Rank on proof, not pitch.**
   - `conformance`: manifest parses, has name, front_man and hocon; definition parses; front agent exists; CORS `*` or set; HTTPS.
   - `callable`: shares a bridge read with `"*"`, or has `peer_policy` that lets peers call it.
   - `acts`: shares or registers write actions (it can do the job, not just talk about it).
   - `links`: PageRank over peer edges (an `allowed_peers` or tool link is a vouch).
   - `fulfillment` (v1, needs a model): a fixed intent suite per category, scored on grounded answers and honest declines.
   - Text match (BM25) picks the candidates. Rank orders them.
5. **Serve.** The site is itself an agent site built with `agentify-website`. Its `search_agentic_web` read is shared with `"*"`. It returns network URLs plus the evidence trail behind each rank.

The crawler runs on a daily GitHub Actions cron and commits `data/index.json`. The site is static (GitHub Pages).

## Scope for v0 (this week)

Crawler, index, rank without fulfillment, BM25 search module shared by Node and the browser, CLI `node bin/search.mjs "book a boat trip"`. Tests on fixtures from upstream examples. Then the agent site.
