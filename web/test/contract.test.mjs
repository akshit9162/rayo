// The exported page must stay a conformant agent site: the same contract site/index.html
// meets, now produced by Next.js. Run after `npm run build`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const out = new URL("../out/", import.meta.url);
const html = readFileSync(new URL("index.html", out), "utf8");
const network = JSON.parse(readFileSync(new URL("agent-manifest.json", out), "utf8")).networks[0].name;

test("the page links its agent manifest and boots the assistant", () => {
  assert.match(html, /<link rel="agent-manifest" href="agent-manifest.json"\/?>/);
  assert.match(html, /<script type="module" src="site.js">/);
  assert.match(html, /<link rel="stylesheet" href="assistant.css"\/?>/);
});

test("the assistant mount has its four slots and a status line", () => {
  assert.match(html, /<div id="agent-app">/);
  for (const slot of ["header", "chat", "agents", "settings"]) assert.match(html, new RegExp(`data-ns-slot="${slot}"`));
  assert.match(html, /id="assistant-status"/);
});

test("every agent file is published beside the page", () => {
  for (const f of ["agent-manifest.json", `${network}.network.json`, `${network}.hocon`, "links.json", "agent-mcp.json", ".well-known/nsdeploy.json", ".well-known/nsdeploy-agent.json", "bridge/action-bridge.html", "bridge/bridge-actions.js", "runtime/index.js", "runtime/sandbox-worker.js", "script.js", "site.js", "site-actions.js", "lib/search.mjs", "data/index.json"]) {
    assert.ok(existsSync(new URL(f, out)), `${f} is missing from out/`);
  }
});

test("the board is in the HTML, so it reads without scripting", () => {
  assert.match(html, /Top of the board/);
  assert.ok((html.match(/class="board-row"/g) ?? []).length >= 5);
});
