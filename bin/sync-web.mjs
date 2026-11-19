#!/usr/bin/env node
// Copy the agent bundle in site/ into web/public/, so the Next.js export serves every
// agent file unchanged beside its own page. site/ stays the source: its tests and the
// network check read it. The page itself (index.html, styles.css) comes from web/app.
import { cpSync, rmSync } from "node:fs";

const root = new URL("../", import.meta.url);
const SKIP = new Set(["index.html", "styles.css", "tests"]);
const dest = new URL("web/public/", root);
rmSync(dest, { recursive: true, force: true });
cpSync(new URL("site/", root), dest, {
  recursive: true,
  filter: (src) => !SKIP.has(src.slice(new URL("site/", root).pathname.length).split("/")[0]),
});
console.error("web/public/ now mirrors site/ without its page");
