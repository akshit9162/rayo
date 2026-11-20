// Pure parsers for the public files of an agent site. No network access here.

const EFFECTS = new Set(["read", "write", "irreversible"]);

/** The site base for a peer-network URL: everything up to the last path segment. */
export function splitNetworkUrl(url) {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  const parts = u.pathname.split("/");
  const name = parts.pop();
  u.pathname = parts.join("/") + "/";
  return { base: u.href, name };
}

/** Normalise a site base so the same site always gets the same key. */
export function normalizeBase(base) {
  const u = new URL(base);
  u.hash = "";
  u.search = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.href;
}

export function isCrawlable(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Parse agent-manifest.json fetched from `base`. */
export function parseManifest(json, base) {
  const problems = [];
  if (!json || typeof json !== "object") return { networks: [], problems: ["manifest is not a JSON object"] };
  const networks = [];
  for (const n of Array.isArray(json.networks) ? json.networks : []) {
    if (!n?.name) problems.push("a network has no name");
    if (!n?.front_man) problems.push(`network ${n?.name ?? "?"} has no front_man`);
    if (!n?.hocon) problems.push(`network ${n?.name ?? "?"} has no hocon`);
    if (!n?.name) continue;
    let hoconUrl = null;
    try {
      hoconUrl = n.hocon ? new URL(n.hocon, base).href : null;
    } catch {
      problems.push(`network ${n.name} has an invalid hocon URL`);
    }
    networks.push({
      name: n.name,
      url: new URL(n.name, base).href,
      frontMan: n.front_man ?? null,
      hoconUrl,
      description: str(n.description),
      sampleQueries: strings(n.sample_queries),
      tags: strings(n.tags),
    });
  }
  if (networks.length === 0) problems.push("manifest lists no networks");
  if (!json.llm_router) problems.push("manifest has no llm_router");
  const policy = json.peer_policy ?? {};
  return {
    brand: str(json.brand) || str(json.brand?.name),
    trust: parseTrust(json.trust),
    networks,
    allowedPeers: strings(json.allowed_peers),
    peerMode: typeof policy === "object" ? policy.mode ?? null : null,
    actions: {
      module: json.actions?.module ? safeUrl(json.actions.module, base) : null,
      bridge: json.actions?.bridge ? safeUrl(json.actions.bridge, base) : null,
      agentTools: strings(json.actions?.agentTools),
    },
    problems,
  };
}

/**
 * Digests a publisher declares for its own networks, as in the oatb trust profile:
 * trust.claims.networks[].sha256 and trust.expires_at. The signature itself is not checked.
 */
export function parseTrust(trust) {
  if (!trust || typeof trust !== "object") return null;
  const digests = {};
  for (const n of Array.isArray(trust.claims?.networks) ? trust.claims.networks : []) {
    if (n?.name && typeof n.sha256 === "string") digests[n.name] = n.sha256.toLowerCase();
  }
  return { profile: str(trust.profile), expiresAt: str(trust.expires_at) || null, digests };
}

/** The front agent's instructions with {placeholders} filled from commondefs.replacement_strings. */
export function frontInstructions(json, frontMan) {
  const agent = (Array.isArray(json?.tools) ? json.tools : []).find((t) => t?.name === frontMan);
  const text = str(agent?.instructions);
  const repl = json?.commondefs?.replacement_strings ?? {};
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (typeof repl[k] === "string" ? repl[k] : m));
}

/** Every string in a JSON value, for scanning. */
export function allStrings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (out.push(k), allStrings(x, out)));
  return out;
}

/** Parse a resolved network definition. `frontMan` comes from the manifest. */
export function parseNetwork(json, frontMan) {
  const problems = [];
  const tools = Array.isArray(json?.tools) ? json.tools : [];
  if (tools.length === 0) problems.push("network has no tools (agents)");
  const names = new Set();
  const agents = [];
  const externalRefs = new Set();
  const symbolicRefs = new Set();
  const mcp = new Set();
  for (const t of tools) {
    if (!t?.name) {
      problems.push("an agent has no name");
      continue;
    }
    if (names.has(t.name)) problems.push(`duplicate agent ${t.name}`);
    names.add(t.name);
    agents.push({ name: t.name, description: str(t.function?.description) });
  }
  for (const t of tools) {
    for (const ref of Array.isArray(t?.tools) ? t.tools : []) {
      if (typeof ref === "string") {
        if (/^https?:\/\//.test(ref)) externalRefs.add(ref);
        else if (!names.has(ref) && !ref.startsWith("/")) symbolicRefs.add(ref);
      } else if (ref && typeof ref.url === "string") {
        mcp.add(ref.url);
      }
    }
  }
  for (const url of Object.keys(json?.link_labels ?? {})) externalRefs.add(url);
  if (frontMan && !names.has(frontMan)) problems.push(`front agent ${frontMan} is not defined`);
  return {
    description: str(json?.metadata?.description),
    sampleQueries: strings(json?.metadata?.sample_queries),
    agents,
    externalRefs: [...externalRefs],
    symbolicRefs: [...symbolicRefs],
    mcp: [...mcp],
    cannotDo: cannotDoSentences(json),
    problems,
  };
}

/** Peer URLs bound in links.json for one network (or all networks when name is omitted). */
export function parseLinks(json, networkName) {
  const nets = json?.networks ?? {};
  const maps = networkName ? [nets[networkName] ?? {}] : Object.values(nets);
  return maps.flatMap((m) => Object.values(m ?? {}).filter((v) => typeof v === "string"));
}

/**
 * Read shared bridge actions out of JavaScript source as text. The code is never run.
 * `sources` is the bridge module plus any modules it imports.
 */
export function parseBridgeActions(sources) {
  const text = sources.join("\n");
  const actions = [];
  const re = /name:\s*["'`]([A-Za-z0-9_]+)["'`][\s\S]{0,1200}?effect:\s*["'`]([a-z]+)["'`]/g;
  for (const m of text.matchAll(re)) {
    if (!EFFECTS.has(m[2])) continue;
    if (actions.some((a) => a.name === m[1])) continue;
    actions.push({ name: m[1], effect: m[2] });
  }
  const publicCallers = /callerOrigins:\s*\[\s*["']\*["']/.test(text) || /CALLERS\s*=\s*\[\s*["']\*["']/.test(text);
  return { actions, publicCallers };
}

/** Relative module imports in a JS source, resolved against its URL. */
export function relativeImports(source, url) {
  const out = [];
  for (const m of source.matchAll(/import\s[^"'`]*?["'`](\.{1,2}\/[^"'`]+)["'`]/g)) out.push(new URL(m[1], url).href);
  return out;
}

function cannotDoSentences(json) {
  const out = new Set();
  const visit = (v) => {
    if (typeof v === "string") {
      for (const s of v.split(/(?<=\.)\s+|\n/)) {
        if (/\b(cannot|can't|can not|does not|doesn't)\b/i.test(s) && s.length < 800) out.add(s.trim());
      }
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(json?.commondefs);
  return [...out].slice(0, 5);
}

function safeUrl(ref, base) {
  try {
    return new URL(ref, base).href;
  } catch {
    return null;
  }
}
const str = (v) => (typeof v === "string" ? v : "");
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
