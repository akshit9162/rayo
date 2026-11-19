// The product's name and network come from the agent bundle's manifest, so the page
// follows a rename of site/ without edits here. Read at build time only.
import { readFileSync } from "node:fs";
import path from "node:path";

type Manifest = { brand: string; networks: { name: string }[] };
const manifest: Manifest = JSON.parse(readFileSync(path.join(process.cwd(), "..", "site", "agent-manifest.json"), "utf8"));

export const BRAND = manifest.brand;
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://akshit9162.github.io/rayo/";
export const NETWORK_URL = new URL(manifest.networks[0].name, SITE).href;
export const REPO = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/akshit9162/rayo";
