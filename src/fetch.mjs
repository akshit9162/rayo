// HTTP fetcher for public agent artifacts. Sends no credentials, caps size and time.

const MAX_BYTES = 2_000_000;
export const CRAWLER_ORIGIN = "https://wayfind.example";
export const USER_AGENT = "WayfindCrawler/0.1 (+open agentic web search)";

/** Fetch a URL and report status, final URL, CORS header and body. Never throws. */
export async function fetchResource(url, { timeoutMs = 15_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      credentials: "omit",
      signal: ctrl.signal,
      headers: { Origin: CRAWLER_ORIGIN, "User-Agent": USER_AGENT, Accept: "application/json, text/javascript, */*" },
    });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, status: res.status, finalUrl: res.url, error: "too large" };
    const text = new TextDecoder().decode(buf);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      cors: res.headers.get("access-control-allow-origin"),
      lastModified: res.headers.get("last-modified"),
      text,
      json,
    };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, error: e.name === "AbortError" ? "timeout" : String(e.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}
