// Turn a crawl into a ranked index. Rank comes from evidence, never from a site's own text.

import { splitNetworkUrl, normalizeBase } from "./parse.mjs";
import { tokenize } from "./search.mjs";

// Probes weigh most: they measure behaviour. A network with no probe result is scored on
// the other signals, renormalised, and says so in its checks.
export const WEIGHTS = { probes: 0.3, conformance: 0.25, links: 0.15, live: 0.1, acts: 0.1, honest: 0.05, fresh: 0.05 };
// Failing one of these multiplies the score: they mean the network may not be what it says.
export const PENALTIES = { tampered: 0.2, expired: 0.5, unsafe: 0.3, copy: 0.5 };

export function buildIndex({ sites, edges, misses }, { now = new Date(), probes = {} } = {}) {
  const known = sites.map((s) => s.base);
  const graph = siteGraph(edges, known);
  const pr = pagerank(known, graph);
  const maxPr = Math.max(...Object.values(pr), 1e-9);
  const inbound = new Map();
  for (const [from, tos] of graph) for (const to of tos) inbound.set(to, [...(inbound.get(to) ?? []), from].sort());

  const rows = [];
  for (const site of sites) {
    const writes = site.bridge.actions.filter((a) => a.effect !== "read");
    const sharedReads = site.bridge.actions.filter((a) => a.effect === "read");
    for (const n of site.networks) {
      const probe = n.digest ? probes[n.digest] : null;
      const integrity = integrityOf(site.trust, n, now);
      const findings = [...site.findings, ...n.findings];
      const checks = [
        check("manifest", site.problems.length === 0, site.problems.join("; ") || "manifest has networks, front_man, hocon and llm_router"),
        check("definition", n.problems.length === 0 && n.agents.length > 0, n.problems.join("; ") || `${n.agents.length} agents, front agent defined`),
        check("cors", Boolean(site.manifestCors && n.definitionCors), `manifest ${site.manifestCors ?? "none"}, definition ${n.definitionCors ?? "none"}`),
        check("integrity", integrity.pass, integrity.detail),
        check("safety", findings.length === 0, findings.length ? findings.map((f) => `${f.id}: "${f.excerpt}"`).join("; ") : "no text aimed at other agents, rankers or keys"),
        check("probes", probe ? probe.passed === probe.total : null,
          probe ? `${probe.passed}/${probe.total} on ${probe.model}: ${probe.results.map((r) => `${r.id} ${r.pass ? "pass" : "fail"}`).join(", ")}` : "not probed yet"),
        check("live_for_callers", site.bridge.publicCallers && sharedReads.length > 0,
          sharedReads.length ? `shares ${sharedReads.map((a) => a.name).join(", ")}${site.bridge.publicCallers ? " with any site" : " with named sites only"}` : "shares no live reads"),
        check("acts", writes.length > 0 || site.agentTools.length > 0,
          writes.length ? `partners can ${writes.map((a) => `${a.name} (${a.effect})`).join(", ")}` : site.agentTools.length ? `site actions: ${site.agentTools.join(", ")}` : "talks only"),
        check("honest", n.cannotDo.length > 0, n.cannotDo[0] ?? "publishes no can't-do list"),
      ];
      const pass = Object.fromEntries(checks.map((c) => [c.id, c.pass ? 1 : 0]));
      const signals = {
        probes: probe ? probe.passed / probe.total : null,
        conformance: (pass.manifest + pass.definition + pass.cors) / 3,
        links: pr[site.base] / maxPr,
        live: pass.live_for_callers,
        acts: writes.length > 0 ? 1 : site.agentTools.length > 0 ? 0.5 : 0,
        honest: pass.honest,
        fresh: freshness(n.lastModified ?? site.lastModified, now),
      };
      let penalty = 1;
      if (integrity.state === "tampered") penalty *= PENALTIES.tampered;
      if (integrity.state === "expired") penalty *= PENALTIES.expired;
      if (findings.length) penalty *= PENALTIES.unsafe;
      rows.push({ site, n, checks, signals, penalty, tokens: new Set(tokenize(`${n.description} ${n.instructions}`)) });
    }
  }

  // A copy is a network on another origin whose text nearly matches one that ranks higher.
  const base = (r) => weighted(r.signals) * r.penalty;
  const order = [...rows].sort((a, b) => base(b) - base(a) || a.n.url.localeCompare(b.n.url));
  for (const [i, r] of order.entries()) {
    const origin = (row) => new URL(row.site.base).origin;
    const original = order.slice(0, i).find((o) => origin(o) !== origin(r) && jaccard(o.tokens, r.tokens) >= 0.9);
    r.checks.push(check("original", !original, original ? `nearly the same text as ${original.n.url}` : "no near-copy of a higher-ranked network"));
    if (original) r.penalty *= PENALTIES.copy;
  }

  const networks = rows.map(({ site, n, checks, signals, penalty }) => ({
    url: n.url,
    name: n.name,
    site: site.base,
    brand: site.brand,
    description: n.description,
    sampleQueries: n.sampleQueries,
    tags: n.tags,
    agents: n.agents,
    cannotDo: n.cannotDo,
    siteActions: site.agentTools,
    sharedActions: site.bridge.actions,
    digest: n.digest,
    checks,
    signals,
    penalty: round(penalty),
    score: round(weighted(signals) * penalty),
    inbound: inbound.get(site.base) ?? [],
    sources: site.sources,
  }));
  networks.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  return {
    generatedAt: now.toISOString(),
    weights: WEIGHTS,
    penalties: PENALTIES,
    stats: { sites: sites.length, networks: networks.length, edges: edges.length, misses: misses.length, probed: networks.filter((n) => n.signals.probes !== null).length },
    networks,
    misses,
  };
}

/** Weighted mean over the signals that exist. */
export function weighted(signals) {
  let sum = 0, total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (signals[k] === null || signals[k] === undefined) continue;
    sum += w * signals[k];
    total += w;
  }
  return total ? sum / total : 0;
}

/** Compare a publisher's declared digest and expiry with what the site serves now. */
export function integrityOf(trust, n, now) {
  const declared = trust?.digests?.[n.name];
  if (!declared) return { state: "none", pass: null, detail: "no declared digest" };
  if (n.digest && declared !== n.digest) return { state: "tampered", pass: false, detail: `declared sha256 ${declared.slice(0, 12)}… but the served definition is ${n.digest.slice(0, 12)}…` };
  if (trust.expiresAt && new Date(trust.expiresAt) < now) return { state: "expired", pass: false, detail: `digest matches but the claim expired ${trust.expiresAt.slice(0, 10)}` };
  return { state: "ok", pass: true, detail: `served definition matches the declared sha256 (${trust.profile || "trust"}; signature not checked)` };
}

/** 1 when changed in the last 30 days, falling to 0 at 180. Unknown dates count as 0.5. */
export function freshness(lastModified, now) {
  const t = Date.parse(lastModified ?? "");
  if (Number.isNaN(t)) return 0.5;
  const days = (now - t) / 86_400_000;
  return round(Math.max(0, Math.min(1, 1 - (days - 30) / 150)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Site-to-site edges between known sites, self-links dropped. */
function siteGraph(edges, known) {
  const siteOf = (url) => known.filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0] ?? null;
  const g = new Map();
  for (const e of edges) {
    const from = siteOf(e.kind === "tool" ? splitNetworkUrl(e.from).base : normalizeBase(e.from));
    const to = siteOf(e.kind === "tool" ? splitNetworkUrl(e.to).base : normalizeBase(e.to));
    if (!to || !from || to === from) continue;
    if (!g.has(from)) g.set(from, new Set());
    g.get(from).add(to);
  }
  return g;
}

export function pagerank(nodes, graph, { d = 0.85, iters = 40 } = {}) {
  const N = nodes.length || 1;
  let pr = Object.fromEntries(nodes.map((n) => [n, 1 / N]));
  for (let i = 0; i < iters; i++) {
    const next = Object.fromEntries(nodes.map((n) => [n, (1 - d) / N]));
    let dangling = 0;
    for (const n of nodes) {
      const outs = graph.get(n);
      if (!outs?.size) dangling += pr[n];
      else for (const t of outs) next[t] += (d * pr[n]) / outs.size;
    }
    for (const n of nodes) next[n] += (d * dangling) / N;
    pr = next;
  }
  return pr;
}

const check = (id, pass, detail) => ({ id, pass, detail });
const round = (x) => Math.round(x * 1000) / 1000;
