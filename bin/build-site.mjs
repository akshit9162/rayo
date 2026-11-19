#!/usr/bin/env node
// Copy the search module and the built index into site/, so the site folder is the whole
// published bundle. Run after bin/crawl.mjs or bin/probe.mjs.
import { copyFileSync, mkdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
mkdirSync(new URL("site/lib/", root), { recursive: true });
mkdirSync(new URL("site/data/", root), { recursive: true });
copyFileSync(new URL("src/search.mjs", root), new URL("site/lib/search.mjs", root));
copyFileSync(new URL("data/index.json", root), new URL("site/data/index.json", root));
console.error("site/lib/search.mjs and site/data/index.json updated");
