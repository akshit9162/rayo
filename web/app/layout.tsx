import type { Metadata } from "next";
import { Chivo_Mono } from "next/font/google";
import "./globals.css";
import { BRAND, SITE } from "./site";

// Self-hosted at build: the spec allows no third-party scripts, and the font needs no request elsewhere.
const chivo = Chivo_Mono({ subsets: ["latin"], weight: ["400", "500", "800"], variable: "--font-chivo", display: "swap" });


export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: `${BRAND}: search the open agentic web`,
  description: "Find open agentic websites for a job, ranked on evidence: spec checks, integrity, safety scans, probes and links from other sites.",
  openGraph: {
    title: `${BRAND}: search the open agentic web`,
    description: "Find the agent for the job, ranked on proof instead of pitch.",
    url: SITE,
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={chivo.variable}>
      <head>
        {/* The agent site contract: the manifest link, the assistant's styles and its boot script, all relative to this folder. */}
        <link rel="agent-manifest" href="agent-manifest.json" />
        <link rel="stylesheet" href="assistant.css" />
        <script type="module" src="site.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
