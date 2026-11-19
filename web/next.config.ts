import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  // /rayo/ on GitHub Pages; empty locally.
  basePath: process.env.PAGES_BASE_PATH ?? "",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: import.meta.dirname },
};

export default config;
