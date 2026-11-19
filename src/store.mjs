// Files the pipeline reads and writes under data/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { buildIndex } from "./rank.mjs";

const DATA = new URL("../data/", import.meta.url);
const path = (name) => new URL(name, DATA);

export function readJson(name, fallback) {
  return existsSync(path(name)) ? JSON.parse(readFileSync(path(name), "utf8")) : fallback;
}

export function writeJson(name, value) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(path(name), `${JSON.stringify(value, null, 1)}\n`);
}

/** Rebuild data/index.json from data/crawl.json and data/probes.json. */
export function writeIndex() {
  const index = buildIndex(readJson("crawl.json"), { probes: readJson("probes.json", {}) });
  writeJson("index.json", index);
  return index;
}
