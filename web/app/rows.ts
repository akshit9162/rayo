// One shape for a board row, whether it came from the build-time index or a live search.

export type Check = { id: string; pass: boolean | null; detail: string };

export type IndexNetwork = {
  url: string;
  name: string;
  brand?: string;
  site: string;
  description: string;
  score: number;
  inbound: string[];
  signals: Record<string, number | null>;
  checks: Check[];
};

export type Index = {
  generatedAt: string;
  stats: { sites: number; networks: number; edges: number; misses: number; probed: number };
  weights: Record<string, number>;
  penalties: Record<string, number>;
  networks: IndexNetwork[];
};

export type Row = {
  url: string;
  name: string;
  site: string;
  host: string;
  description: string;
  score: number;
  canAct: boolean;
  live: boolean;
  linkedFrom: number;
  checks: Check[];
};

export function toRow(n: IndexNetwork): Row {
  return {
    url: n.url,
    name: n.brand || n.name,
    site: n.site,
    host: new URL(n.site).host,
    description: n.description,
    score: n.score,
    canAct: (n.signals.acts ?? 0) > 0,
    live: (n.signals.live ?? 0) > 0,
    linkedFrom: n.inbound.length,
    checks: n.checks,
  };
}

/** The best-scored networks, one per URL: the board before anyone searches. */
export function topRows(index: Index, count: number): Row[] {
  const seen = new Set<string>();
  return [...index.networks]
    .sort((a, b) => b.score - a.score)
    .filter((n) => !seen.has(n.url) && seen.add(n.url))
    .slice(0, count)
    .map(toRow);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The crawl as a graph of sites: what the hero globe draws. */
export function siteGraph(index: Index): { nodes: { score: number; linked: boolean }[]; edges: [number, number][] } {
  const best = new Map<string, number>();
  for (const n of index.networks) best.set(n.site, Math.max(best.get(n.site) ?? 0, n.score));
  const sites = [...best.keys()].sort();
  const at = new Map(sites.map((s, i) => [s, i]));
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const n of index.networks) {
    for (const from of n.inbound) {
      const a = at.get(from);
      const b = at.get(n.site);
      if (a === undefined || b === undefined || a === b || seen.has(`${a}-${b}`)) continue;
      seen.add(`${a}-${b}`);
      edges.push([a, b]);
    }
  }
  const linked = new Set(edges.flat());
  return { nodes: sites.map((s, i) => ({ score: best.get(s)!, linked: linked.has(i) })), edges };
}
