// Wayfind's page: a search box over the crawled index, and the same search for the assistant.
// The page's own form, the assistant's website_* tools (site-actions.js) and other sites'
// agents (bridge/bridge-actions.js) all call SearchPage, so they share one set of rules.
import { prepare, search } from "./lib/search.mjs";

const INDEX_URL = new URL("./data/index.json", import.meta.url).href;
const MAX_LIMIT = 10;

/**
 * The crawled index and the searches over it. Holds no visitor data.
 */
export class SearchPage {
  constructor() {
    this.index = null;
    this.prepared = null;
    this.loading = null;
  }

  /** Use an index already in memory (tests, and the bridge after its own fetch). */
  useIndex(index) {
    this.index = index;
    this.prepared = prepare(index);
    return this;
  }

  /** Fetch data/index.json once. */
  async load() {
    if (this.index) return this;
    this.loading ??= fetch(INDEX_URL).then(async (r) => {
      if (!r.ok) throw new Error(`The index answered ${r.status}.`);
      return this.useIndex(await r.json());
    });
    return this.loading;
  }

  /** When the index was built and how much it holds. */
  async info() {
    await this.load();
    const { generatedAt, stats, weights, penalties } = this.index;
    return { builtAt: generatedAt, ...stats, weights, penalties, page: new URL("./", INDEX_URL).href.replace(/data\/$/, "") };
  }

  /**
   * Search networks for a job. Refuses an empty query without searching.
   * Returns compact results the model can read in one go.
   */
  async search({ query, limit = 5, mustAct, callableOnly = false }) {
    const q = String(query ?? "").trim();
    if (q.length < 2) return { ok: false, reason: "Say what job the agent site should do, in a few words." };
    await this.load();
    const hits = search(this.prepared, q, { limit: Math.min(Math.max(1, limit), MAX_LIMIT), mustAct, callableOnly });
    return {
      ok: true,
      query: q,
      builtAt: this.index.generatedAt,
      // false when no result matches every word of the job: say so instead of offering a near miss.
      fullMatch: hits.some((h) => h.why.coverage === 1),
      results: hits.map((h) => {
        const n = this.network(h.url);
        return {
          networkUrl: h.url,
          name: h.name,
          description: h.description.slice(0, 240),
          score: h.score,
          rank: h.why.rank,
          canAct: h.why.canAct,
          matched: h.why.matched,
          coverage: h.why.coverage,
          failedChecks: n.checks.filter((c) => c.pass === false).map((c) => `${c.id}: ${c.detail}`.slice(0, 200)),
          probes: n.checks.find((c) => c.id === "probes")?.detail ?? "not probed yet",
          linkedFrom: h.why.linkedFrom.length,
        };
      }),
    };
  }

  /** Every check and signal for one network URL from a search result. */
  async report({ networkUrl }) {
    await this.load();
    const n = this.network(networkUrl);
    if (!n) return { ok: false, reason: "That network is not in the index. Use a networkUrl from a search result." };
    const { url, name, brand, description, sampleQueries, cannotDo, siteActions, sharedActions, checks, signals, penalty, score, inbound, sources } = n;
    return { ok: true, networkUrl: url, name: brand || name, description, sampleQueries, cannotDo, siteActions, sharedActions, checks, signals, penalty, score, linkedFrom: inbound, foundVia: sources.slice(0, 5) };
  }

  network(url) {
    return this.index.networks.find((n) => n.url === url) ?? null;
  }
}

/**
 * The page object and its form. Kept apart from SearchPage so the bridge, which has no
 * page, can use the search alone.
 */
export class App {
  static page = new SearchPage();

  static async mount() {
    const form = document.querySelector("#search-form");
    const input = document.querySelector("#q");
    const act = document.querySelector("#must-act");
    const list = document.querySelector("#results");
    const status = document.querySelector("#search-status");
    document.querySelector("#network-url").textContent = new URL("wayfind", new URL("./", import.meta.url)).href;
    try {
      const info = await App.page.info();
      document.querySelector("#index-stats").textContent =
        `${info.networks} agent networks on ${info.sites} sites, crawled ${new Date(info.builtAt).toUTCString().slice(5, 16)}. ${info.probed} probed.`;
    } catch (error) {
      status.textContent = "The index could not load. Try again later.";
      return;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await App.page.search({ query: input.value, limit: 10, mustAct: act.checked || undefined });
      App.render(list, status, result);
    });
    const q = new URLSearchParams(location.search).get("q");
    if (q) {
      input.value = q;
      form.requestSubmit();
    }
  }

  static render(list, status, result) {
    list.replaceChildren();
    if (!result.ok) {
      status.textContent = result.reason;
      return;
    }
    status.textContent = !result.results.length
      ? `No agent site matches “${result.query}” yet.`
      : result.fullMatch
        ? `${result.results.length} results for “${result.query}”`
        : `No site matches all of “${result.query}”. These match part of it.`;
    for (const r of result.results) {
      const n = App.page.network(r.networkUrl);
      const li = document.createElement("li");
      li.className = "result";
      const h = document.createElement("h3");
      const a = document.createElement("a");
      a.href = n.site;
      a.textContent = r.name;
      h.append(a);
      const url = document.createElement("code");
      url.textContent = r.networkUrl;
      const p = document.createElement("p");
      p.textContent = r.description;
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = `score ${r.score.toFixed(2)} · rank ${r.rank.toFixed(2)}${r.canAct ? " · can act" : ""}${r.linkedFrom ? ` · linked from ${r.linkedFrom} site${r.linkedFrom > 1 ? "s" : ""}` : ""}`;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Why it ranks here";
      const ul = document.createElement("ul");
      for (const c of n.checks) {
        const item = document.createElement("li");
        item.className = c.pass === null ? "na" : c.pass ? "pass" : "fail";
        item.textContent = `${c.pass === null ? "–" : c.pass ? "✓" : "✗"} ${c.id}: ${c.detail}`;
        ul.append(item);
      }
      details.append(summary, ul);
      li.append(h, url, p, meta, details);
      list.append(li);
    }
  }
}

// The bridge frame imports this module too, and has no search form.
if (typeof window !== "undefined" && document.querySelector("#search-form")) App.mount();
