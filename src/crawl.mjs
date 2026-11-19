// Crawl the agentic web by following agent links between site manifests.
//
// The crawl runs in breadth-first levels. Each level's sites are fetched in parallel, then
// merged in sorted order, so the same web gives the same index whatever order fetches end in.

import { createHash } from "node:crypto";
import {
  splitNetworkUrl, normalizeBase, isCrawlable, parseManifest, parseNetwork, parseLinks,
  parseBridgeActions, relativeImports, frontInstructions, allStrings,
} from "./parse.mjs";
import { scanStrings } from "./safety.mjs";

const sha256 = (text) => createHash("sha256").update(text ?? "", "utf8").digest("hex");

/** Retry when the host did not answer or failed on its side: up to `attempts` tries with backoff. */
export function withRetry(fetcher, { attempts = 3, backoffMs = 1000 } = {}) {
  return async (url) => {
    let r;
    for (let i = 0; i < attempts; i++) {
      if (i) await new Promise((res) => setTimeout(res, backoffMs * i));
      r = await fetcher(url);
      if (!(r.status === 0 || r.status >= 500)) return r;
    }
    return r;
  };
}

/**
 * A network whose definition could not be fetched this time keeps its last good record,
 * marked stale, so one slow host does not drop it or the sites it links to.
 */
function carryOver(site, previous) {
  for (const [i, n] of site.networks.entries()) {
    if (n.digest) continue;
    const old = previous.get(n.url);
    if (!old?.digest) continue;
    site.networks[i] = { ...old, stale: true, problems: [...n.problems.map((p) => `${p}; using the record from ${old.fetchedAt ?? "the last crawl"}`)] };
  }
}

/**
 * seeds: [{ base, source }]. fetcher(url) -> { ok, status, finalUrl, cors, json, text, error }.
 * Returns { sites, edges, misses }. A site is counted only when its manifest parses.
 */
export async function crawl({ seeds, fetcher, previous = null, maxSites = 300, concurrency = 6, maxLevels = 6, retry = {}, log = () => {} }) {
  const get = withRetry(fetcher, retry);
  const prevNetworks = new Map((previous?.sites ?? []).flatMap((s) => s.networks.map((n) => [n.url, n])));
  const prevEdges = previous?.edges ?? [];
  const seen = new Map(); // base -> sources
  const sites = [];
  const misses = [];
  const edges = [];

  const add = (next, base, source) => {
    if (!isCrawlable(base)) return;
    const key = normalizeBase(base);
    if (seen.has(key)) return seen.get(key).add(source);
    if (!next.has(key)) next.set(key, new Set());
    next.get(key).add(source);
  };

  let level = new Map();
  seeds.forEach((s) => add(level, s.base, s.source));

  for (let depth = 0; depth < maxLevels && level.size && sites.length < maxSites; depth++) {
    const bases = [...level.keys()].sort();
    for (const b of bases) seen.set(b, level.get(b));
    const results = await mapLimit(bases, concurrency, (b) => visit(b, get));
    const next = new Map();
    for (const [i, base] of bases.entries()) {
      const sources = [...seen.get(base)].sort();
      const r = results[i];
      if (r.miss) {
        misses.push({ base, sources, ...r.miss });
        continue;
      }
      // Hosts with rewrites serve one manifest under several paths; the first base in sorted order wins.
      const digests = (s) => s.networks.map((n) => `${n.name}:${n.digest}`).sort().join(",");
      const twin = sites.find((s) => s.base === r.site.base || (s.origin === r.site.origin
        && (s.manifestDigest === r.site.manifestDigest || (r.site.networks.length && digests(s) === digests(r.site)))));
      if (twin) {
        twin.sources = [...new Set([...twin.sources, ...sources])].sort();
        continue;
      }
      if (sites.length >= maxSites) break;
      carryOver(r.site, prevNetworks);
      for (const n of r.site.networks.filter((x) => x.stale)) {
        r.edges.push(...prevEdges.filter((e) => e.kind === "tool" && e.from === n.url));
      }
      sites.push({ ...r.site, sources });
      log(`site ${r.site.base} (${sources[0]})`);
      for (const e of r.edges) {
        edges.push(e);
        add(next, e.kind === "tool" ? splitNetworkUrl(e.to).base : e.to, `${e.kind === "tool" ? "link" : "peer"}:${e.from}`);
      }
    }
    level = next;
  }

  edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  return {
    sites: sites.map(({ origin, manifestDigest, ...s }) => s),
    edges,
    misses,
  };
}

/** Fetch everything one site publishes. Pure with respect to crawl state. */
async function visit(base, get) {
  const res = await get(new URL("agent-manifest.json", base).href);
  if (!res.ok || !res.json) return { miss: { status: res.status, error: res.error ?? (res.ok ? "not JSON" : `HTTP ${res.status}`) } };
  const realBase = normalizeBase(new URL(".", res.finalUrl).href);
  const manifest = parseManifest(res.json, realBase);
  const site = {
    base: realBase,
    origin: new URL(realBase).origin,
    manifestDigest: sha256(res.text),
    brand: manifest.brand,
    manifestCors: res.cors ?? null,
    lastModified: res.lastModified ?? null,
    peerMode: manifest.peerMode,
    allowedPeers: manifest.allowedPeers,
    agentTools: manifest.actions.agentTools,
    trust: manifest.trust,
    problems: [...manifest.problems],
    findings: scanStrings(allStrings(res.json)),
    networks: [],
    bridge: { actions: [], publicCallers: false },
  };
  const edges = [];
  const linksRes = await get(new URL("links.json", realBase).href);
  const links = linksRes.ok && linksRes.json ? linksRes.json : null;

  for (const n of manifest.networks) {
    const rec = { ...n, agents: [], cannotDo: [], mcp: [], definitionCors: null, digest: null, instructions: "", findings: [], problems: [] };
    if (n.hoconUrl) {
      const def = await get(n.hoconUrl);
      if (def.ok && def.json) {
        const parsed = parseNetwork(def.json, n.frontMan);
        Object.assign(rec, {
          agents: parsed.agents,
          cannotDo: parsed.cannotDo,
          mcp: parsed.mcp,
          description: rec.description || parsed.description,
          sampleQueries: rec.sampleQueries.length ? rec.sampleQueries : parsed.sampleQueries,
          definitionCors: def.cors ?? null,
          lastModified: def.lastModified ?? null,
          fetchedAt: new Date().toISOString().slice(0, 10),
          digest: sha256(def.text),
          instructions: frontInstructions(def.json, n.frontMan).slice(0, 24_000),
          findings: scanStrings(allStrings(def.json)),
        });
        rec.problems.push(...parsed.problems);
        const refs = [...new Set([...parsed.externalRefs, ...(links ? parseLinks(links, n.name) : [])])].sort();
        for (const ref of refs) if (isCrawlable(ref)) edges.push({ from: rec.url, to: ref, kind: "tool" });
      } else {
        rec.problems.push(`network definition unavailable (${def.error ?? `HTTP ${def.status}`})`);
      }
    }
    site.networks.push(rec);
  }
  for (const origin of manifest.allowedPeers) {
    if (isCrawlable(origin)) edges.push({ from: realBase, to: normalizeBase(origin), kind: "peer" });
  }
  if (manifest.actions.bridge) site.bridge = await readBridge(manifest.actions.bridge, get);
  return { site, edges };
}

/** Read the bridge's shared actions from its module source (never executed). */
async function readBridge(bridgePageUrl, get) {
  const bm = await get(new URL("agent-manifest.json", bridgePageUrl).href);
  const modRef = bm.ok && bm.json?.actions?.module;
  if (!modRef) return { actions: [], publicCallers: false };
  const mod = await get(new URL(modRef, bm.finalUrl).href);
  if (!mod.ok || !mod.text) return { actions: [], publicCallers: false };
  const sources = [mod.text];
  for (const imp of relativeImports(mod.text, mod.finalUrl).slice(0, 6)) {
    const r = await get(imp);
    if (r.ok && r.text) sources.push(r.text);
  }
  return parseBridgeActions(sources);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}
