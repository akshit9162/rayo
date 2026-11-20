// Where the crawl starts: the community list, sites proposed in open PRs, and manifests on GitHub.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const UPSTREAM = "cognizant-ai-labs/agentic-web";

/** Site bases from the markdown table in agentic_websites.md (site URL and agent URL columns). */
export function seedsFromList(markdown, source = "list") {
  const out = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-/.test(line) || /\|\s*URL\s*\|/i.test(line)) continue;
    for (const url of line.match(/https:\/\/[^\s|)\]]+/g) ?? []) {
      const u = new URL(url);
      // An agent URL names a network or a .network.json file: its folder is the site base.
      const base = u.pathname.endsWith("/") ? u.href : new URL(".", u).href;
      out.push({ base, source });
      if (base !== `${u.origin}/`) out.push({ base: `${u.origin}/`, source });
    }
  }
  return out;
}

async function gh(args) {
  const { stdout } = await run("gh", args, { maxBuffer: 20_000_000 });
  return stdout;
}

/** The list file on main plus versions of it in open PRs. */
export async function seedsFromUpstream() {
  const main = await gh(["api", `repos/${UPSTREAM}/contents/docs/agentic_websites.md`, "-H", "Accept: application/vnd.github.raw"]);
  const seeds = seedsFromList(main);
  const prs = JSON.parse(await gh(["pr", "list", "-R", UPSTREAM, "--state", "open", "--json", "number,headRefOid,headRepositoryOwner,headRepository", "--limit", "50"]));
  for (const pr of prs) {
    try {
      const raw = await gh(["api", `repos/${pr.headRepositoryOwner.login}/${pr.headRepository.name}/contents/docs/agentic_websites.md?ref=${pr.headRefOid}`, "-H", "Accept: application/vnd.github.raw"]);
      seeds.push(...seedsFromList(raw, `pr:#${pr.number}`));
    } catch {}
  }
  return seeds;
}

/**
 * Sites submitted to Rayo directly: one URL per line in data/seeds.txt, "#" starts a comment.
 * A missing file means no submitted sites.
 */
export function seedsFromFile(file = new URL("../data/seeds.txt", import.meta.url)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const url = line.replace(/#.*/, "").trim();
    if (!url.startsWith("https://")) continue;
    const u = new URL(url);
    out.push({ base: u.pathname.endsWith("/") ? u.href : new URL(".", u).href, source: "submitted" });
  }
  return out;
}

/** Candidate site bases for repos that contain an agent-manifest.json. */
export async function seedsFromGitHub({ maxRepos = 80, log = () => {} } = {}) {
  const hits = [];
  for (let page = 1; page <= 3; page++) {
    const res = JSON.parse(await gh(["api", "-X", "GET", "search/code", "-f", "q=front_man filename:agent-manifest.json", "-f", "per_page=100", "-f", `page=${page}`]));
    hits.push(...res.items.map((i) => ({ repo: i.repository.full_name, path: i.path })));
    if (res.items.length < 100) break;
  }
  const byRepo = new Map();
  for (const h of hits) {
    if (h.repo === UPSTREAM) continue;
    byRepo.set(h.repo, [...(byRepo.get(h.repo) ?? []), h.path]);
  }
  log(`github: ${hits.length} manifests in ${byRepo.size} repos`);
  const seeds = [];
  for (const [repo, paths] of [...byRepo].slice(0, maxRepos)) {
    const roots = new Set();
    try {
      const info = JSON.parse(await gh(["api", `repos/${repo}`, "--jq", "{homepage, has_pages}"]));
      if (info.homepage) roots.add(withSlash(info.homepage));
      if (info.has_pages) {
        const pages = JSON.parse(await gh(["api", `repos/${repo}/pages`, "--jq", "{html_url}"]));
        if (pages.html_url) roots.add(withSlash(pages.html_url));
      }
    } catch {}
    for (const root of roots) {
      if (!/^https:\/\//.test(root)) continue;
      for (const dir of candidateDirs(paths)) seeds.push({ base: new URL(dir, root).href, source: `github:${repo}` });
    }
  }
  return seeds;
}

/** "docs/site/agent-manifest.json" -> ["docs/site/", "site/", ""], since hosts publish a subfolder. */
export function candidateDirs(paths) {
  const dirs = new Set([""]);
  for (const p of paths) {
    const parts = p.split("/").slice(0, -1);
    for (let i = 0; i < parts.length; i++) dirs.add(parts.slice(i).join("/") + "/");
  }
  return [...dirs].filter((d) => !/(^|\/)(node_modules|test|tests|fixtures)\//.test(d));
}

const withSlash = (u) => (u.endsWith("/") ? u : `${u}/`);
