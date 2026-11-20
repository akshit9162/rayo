// Offline evaluation against hand-judged queries (data/eval/queries.json), Cranfield style:
// a ranking change counts as better only if these numbers go up. Plain ESM, no Node APIs.

import { search } from "./search.mjs";

const gradeOf = (url, relevant) => {
  let g = 0;
  for (const [key, grade] of Object.entries(relevant)) if (url.includes(key)) g = Math.max(g, grade);
  return g;
};

const dcg = (grades) => grades.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);

/** Score one query. A query with no relevant sites is right only when nothing comes back. */
export function judge(prepared, { q, relevant }, k = 5) {
  const hits = search(prepared, q, { limit: k });
  const grades = hits.map((h) => gradeOf(h.url, relevant));
  const want = Object.values(relevant).sort((a, b) => b - a);
  if (!want.length) return { q, hits, empty: true, ok: hits.length === 0 ? 1 : 0 };
  const ideal = dcg(want.slice(0, k));
  const first = grades.findIndex((g) => g > 0);
  const found = new Set(hits.filter((h) => gradeOf(h.url, relevant) > 0).map((h) => Object.keys(relevant).find((key) => h.url.includes(key))));
  return {
    q, hits, grades,
    ndcg: ideal ? dcg(grades) / ideal : 0,
    rr: first < 0 ? 0 : 1 / (first + 1),
    recall: found.size / Object.keys(relevant).length,
  };
}

export function evaluate(prepared, queries, k = 5) {
  const rows = queries.map((x) => judge(prepared, x, k));
  const ranked = rows.filter((r) => !r.empty), empty = rows.filter((r) => r.empty);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    rows,
    ndcg: mean(ranked.map((r) => r.ndcg)),
    mrr: mean(ranked.map((r) => r.rr)),
    recall: mean(ranked.map((r) => r.recall)),
    noAnswer: mean(empty.map((r) => r.ok)),
    queries: rows.length,
  };
}
