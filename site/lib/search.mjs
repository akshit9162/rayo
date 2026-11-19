// Search over a built index. Plain ESM with no Node APIs, so the browser imports the same file.

const STOP = new Set("a an the and or of to for in on at by with from is are be can i me my we our you your it this that what which who how do does any some there".split(" "));
const ACTION = /\b(book|order|buy|reserve|schedule|pay|purchase|place|sign ?up|apply|file|rent|hire|send|submit)\b/i;
// Sample queries are the site's own pitch, so they weigh no more than agent descriptions.
const FIELDS = { description: 3, brand: 2, name: 2, sampleQueries: 1, agents: 1, actions: 1.5, tags: 1 };
// Results below this share of the best match are dropped: they matched one word in passing.
const MIN_RELEVANCE = 0.25;

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/[\s_-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// Light stemming so "booking", "books" and "booked" meet "book".
function stem(t) {
  if (t.length <= 3) return t;
  if (t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (/ing$/.test(t) && t.length >= 6) return t.slice(0, -3);
  if (/ed$/.test(t) && t.length >= 5) return t.slice(0, -2);
  if (/[^s]s$/.test(t)) return t.slice(0, -1);
  return t;
}

function fieldsOf(n) {
  return {
    description: n.description,
    brand: n.brand,
    name: n.name.replace(/_/g, " "),
    sampleQueries: n.sampleQueries.join(" "),
    agents: n.agents.map((a) => a.description).join(" "),
    actions: [...n.siteActions, ...n.sharedActions.map((a) => a.name)].join(" ").replace(/_/g, " "),
    tags: (n.tags ?? []).join(" "),
  };
}

/** Prepare BM25 statistics once per index. */
export function prepare(index) {
  const docs = index.networks.map((n) => {
    const tf = new Map();
    let len = 0;
    for (const [field, text] of Object.entries(fieldsOf(n))) {
      for (const t of tokenize(text ?? "")) {
        tf.set(t, (tf.get(t) ?? 0) + FIELDS[field]);
        len += FIELDS[field];
      }
    }
    return { n, tf, len };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  return { docs, df, avgLen, N: docs.length };
}

/**
 * Rank networks for a query. Text match chooses candidates; the evidence rank orders them.
 * Options: limit, mustAct (only sites that can take actions), callableOnly.
 */
export function search(prepared, query, { limit = 5, mustAct, callableOnly = false } = {}) {
  const terms = [...new Set(tokenize(query))];
  const wantsAction = mustAct ?? ACTION.test(query);
  const k1 = 1.2, b = 0.75;
  const scored = [];
  for (const d of prepared.docs) {
    let bm = 0;
    const matched = [];
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (prepared.N - prepared.df.get(t) + 0.5) / (prepared.df.get(t) + 0.5));
      bm += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / prepared.avgLen));
      matched.push(t);
    }
    if (bm === 0) continue;
    if (callableOnly && !d.n.checks.find((c) => c.id === "cors")?.pass) continue;
    scored.push({ d, bm, matched });
  }
  const top = Math.max(...scored.map((s) => s.bm), 1e-9);
  return scored
    .map(({ d, bm, matched }) => {
      // Matching more of the query's words counts, so one shared word cannot carry a result.
      const coverage = matched.length / Math.max(1, terms.length);
      const relevance = (bm / top) * (0.5 + 0.5 * coverage);
      const actFactor = wantsAction ? 0.6 + 0.4 * d.n.signals.acts : 1;
      return {
        url: d.n.url,
        name: d.n.brand || d.n.name,
        description: d.n.description,
        score: Math.round((0.6 * relevance + 0.4 * d.n.score) * actFactor * 1000) / 1000,
        why: {
          matched,
          relevance: Math.round(relevance * 100) / 100,
          coverage: Math.round(coverage * 100) / 100,
          rank: d.n.score,
          canAct: d.n.signals.acts > 0,
          checks: d.n.checks.map((c) => `${c.pass === null ? "–" : c.pass ? "✓" : "✗"} ${c.id}: ${c.detail}`),
          linkedFrom: d.n.inbound,
        },
      };
    })
    .filter((h) => h.why.relevance >= MIN_RELEVANCE)
    .sort((a, b2) => b2.score - a.score || a.url.localeCompare(b2.url))
    .slice(0, limit);
}
