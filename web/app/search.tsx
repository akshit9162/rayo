"use client";

import { ArrowUpRight, Check, MagnifyingGlass, Minus, X } from "@phosphor-icons/react/dist/ssr";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Flip } from "./flip";
import { Globe, type GlobeGraph } from "./globe";
import { toRow, type Check as CheckT, type IndexNetwork, type Row } from "./rows";

// The page script the agent bundle ships (site/script.js). Importing it by URL gives the
// form the same SearchPage instance the assistant's website_* tools use.
type Result = { networkUrl: string };
type SearchPage = {
  search(args: { query: string; limit: number; mustAct?: boolean }): Promise<
    { ok: false; reason: string } | { ok: true; query: string; fullMatch: boolean; results: Result[] }
  >;
  network(url: string): IndexNetwork | null;
};
let pageModule: Promise<SearchPage> | null = null;
function searchPage(): Promise<SearchPage> {
  pageModule ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL("script.js", document.baseURI).href).then(
    (m: { App: { page: SearchPage } }) => m.App.page,
  );
  return pageModule;
}

// The assistant the agent bundle boots (site/site.js). Importing it by URL returns the
// instance the page's own <script type="module"> started.
type Engine = {
  mockLLM?: boolean;
  byokKey?: string;
  top?: { base: string; network?: { name: string; setLink(ref: string, url: string): void } };
};
async function assistantEngine(): Promise<Engine | null> {
  try {
    const m = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL("site.js", document.baseURI).href);
    return (m as { AssistantMount: { engine: Engine | null } }).AssistantMount.engine;
  } catch {
    return null;
  }
}

/** The network's handoff slot (site/rayo.hocon, link_slots). */
const SLOT = "chosen_agent";

/**
 * Hand the visitor's job to one agent site through Rayo's assistant: bind the slot to
 * that site's network URL, then send the job. The runtime still shows its consent card
 * before contacting the site, and any booking or order opens in the site's own window.
 */
async function handOff(row: Row, job: string): Promise<string> {
  const message = await bindAndSend(row, job);
  // Also say it beside the chat, where the page scrolls to.
  const status = document.querySelector("#assistant-status");
  if (status) status.textContent = message;
  return message;
}

async function bindAndSend(row: Row, job: string): Promise<string> {
  const engine = await assistantEngine();
  const top = engine?.top;
  if (top?.network) {
    top.network.setLink(SLOT, row.url);
    // The runtime also reads a stored link, if it rebuilds the network after a key change.
    try {
      localStorage.setItem(`nsdeploy-link-v1::${top.base}::${top.network.name}::${SLOT}`, row.url);
    } catch {}
  }
  const input = document.querySelector<HTMLInputElement>("#ns-input");
  const send = document.querySelector<HTMLButtonElement>("#ns-send");
  if (!engine || !top?.network || !input || !send) return "The assistant could not load, so the job could not be handed over. Use the site's page instead.";
  input.value = `Hand this job to ${row.name}: ${job}`;
  const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
  if (needsKey) {
    input.focus();
    return `Ready to hand your job to ${row.name}. Add your AI provider key in the assistant's settings, then press Send.`;
  }
  send.click();
  return `Handing your job to ${row.name}. Allow the call on the assistant's card.`;
}

type Board =
  | { kind: "top"; rows: Row[] }
  | { kind: "busy"; query: string; rows: Row[] }
  | { kind: "results"; query: string; partial: boolean; rows: Row[] }
  | { kind: "error"; message: string; rows: Row[] };

function boardTitle(b: Board): string {
  if (b.kind === "top") return "Top of the board";
  if (b.kind === "error") return "Search stopped";
  return `For “${b.query}”`;
}

function boardStatus(b: Board): string {
  switch (b.kind) {
    case "top":
      return "The highest scored networks in today’s index. Search to rank them for your job.";
    case "busy":
      return "Searching the index.";
    case "error":
      return b.message;
    case "results":
      if (!b.rows.length) return `No agent site matches “${b.query}” yet.`;
      return b.partial ? `No site matches every word of “${b.query}”. These match part of it.` : `${b.rows.length} networks, best evidence first.`;
  }
}

export function Search({
  top,
  stats,
  graph,
  brand,
}: {
  top: Row[];
  stats: { networks: number; sites: number; edges: number; built: string };
  graph: GlobeGraph;
  brand: string;
}) {
  const [board, setBoard] = useState<Board>({ kind: "top", rows: top });
  const [query, setQuery] = useState("");
  const [mustAct, setMustAct] = useState(false);
  const [handoff, setHandoff] = useState("");
  const [handed, setHanded] = useState(0);

  const boardRef = useRef<HTMLElement>(null);
  const still = useReducedMotion();
  // Scroll to the assistant once React has drawn the new board, so its height change
  // cannot move the assistant out of view again.
  useEffect(() => {
    if (handed) document.querySelector("#assistant")?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [handed, still]);

  /** Searches and shows the board; returns the rows, or nothing when the search stopped. */
  async function run(q: string, act: boolean, scroll: boolean): Promise<Row[] | undefined> {
    setBoard((b) => ({ kind: "busy", query: q, rows: b.rows }));
    try {
      const page = await searchPage();
      const res = await page.search({ query: q, limit: 10, mustAct: act || undefined });
      if (!res.ok) {
        setBoard((b) => ({ kind: "error", message: res.reason, rows: b.rows }));
        return;
      }
      const rows = res.results.flatMap((r) => {
        const n = page.network(r.networkUrl);
        return n ? [toRow(n)] : [];
      });
      setBoard({ kind: "results", query: res.query, partial: !res.fullMatch, rows });
      history.replaceState(null, "", `?q=${encodeURIComponent(res.query)}#board`);
      if (scroll) boardRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
      return rows;
    } catch {
      setBoard((b) => ({ kind: "error", message: "The index could not load. Try again in a minute.", rows: b.rows }));
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("q");
    if (q) {
      setQuery(q);
      void run(q, false, false);
    }
    // Runs once: a shared link opens on its search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Search" shows the board. "Hand it to the top agent" is the lucky button of the agentic
  // web: instead of opening the best match's page, its agent gets the job.
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const job = query.trim();
    const handing = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "handoff";
    setHandoff("");
    const rows = await run(job, mustAct, !handing);
    if (!handing || !rows) return;
    if (!rows.length) {
      setHandoff(`No agent site in the index does “${job}” yet.`);
      boardRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
      return;
    }
    setHandoff(await handOff(rows[0], job));
    setHanded((n) => n + 1);
  }

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <Globe graph={graph} />
        <div className="hero-center container">
          <h1 id="hero-title" className="logo">
            {brand}
          </h1>
          <form className="find" role="search" onSubmit={submit}>
            <label htmlFor="job" className="visually-hidden">
              What job should the agent do?
            </label>
            <div className="find-box">
              <MagnifyingGlass aria-hidden="true" weight="bold" />
              <input
                id="job"
                name="q"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Describe a job for an agent"
                autoComplete="off"
                required
                minLength={2}
              />
            </div>
            <div className="find-actions">
              <button type="submit" name="go" value="search" className="btn btn--soft" disabled={board.kind === "busy"}>
                Search
              </button>
              <button type="submit" name="go" value="handoff" className="btn btn--soft" disabled={board.kind === "busy"}>
                Hand it to the top agent
              </button>
            </div>
            <label className="tick">
              <input type="checkbox" checked={mustAct} onChange={(e) => setMustAct(e.target.checked)} />
              Only sites that can act: book, order, write
            </label>
          </form>
          <p className="handoff" role="status">
            {handoff}
          </p>
          <p className="hero-meta">
            Searching {stats.networks} agent networks on {stats.sites} sites, ranked on proof. Crawled {stats.built}.
          </p>
        </div>
      </section>

      <section id="board" ref={boardRef} className="band band--ink" aria-labelledby="board-title">
        <div className="container">
          <div className="board-head">
            <h2 id="board-title">{boardTitle(board)}</h2>
            <p role="status" className="board-status">
              {boardStatus(board)}
            </p>
          </div>
          <div className="board-cols" aria-hidden="true">
            <span>Network</span>
            <span>Does</span>
            <span>Score</span>
          </div>
          <ol className="board" aria-busy={board.kind === "busy"}>
            {still ? (
              board.rows.map((r) => (
                <li key={r.url} className="board-row">
                  <BoardRow row={r} />
                </li>
              ))
            ) : (
              <AnimatePresence initial={false} mode="popLayout">
                {board.rows.map((r) => (
                  <motion.li
                    key={r.url}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="board-row"
                  >
                    <BoardRow row={r} />
                  </motion.li>
                ))}
              </AnimatePresence>
            )}
          </ol>
        </div>
      </section>
    </>
  );
}

function BoardRow({ row }: { row: Row }) {
  return (
    <>
      <div className="row-name">
        <h3>
          <a href={row.site}>
            {row.name}
            <ArrowUpRight aria-hidden="true" weight="bold" />
          </a>
        </h3>
        <p className="row-host">{row.host}</p>
        <p className="row-desc">{row.description}</p>
      </div>
      <p className={row.canAct ? "does does--acts" : "does"}>{row.canAct ? "Acts" : "Talks"}</p>
      <p className="score">
        <Flip text={row.score.toFixed(2)} />
      </p>
      <details className="evidence">
        <summary>Why it ranks here</summary>
        <ul>
          {row.checks.map((c) => (
            <CheckLine key={c.id} check={c} />
          ))}
          <li className="check">
            <span className="check-mark">
              <Minus aria-hidden="true" weight="bold" />
            </span>
            <span className="check-id">links</span>
            <span>
              {row.linkedFrom ? `linked from ${row.linkedFrom} other site${row.linkedFrom > 1 ? "s" : ""}` : "no other site links here yet"}
            </span>
          </li>
        </ul>
        <p className="row-url">
          Network URL <code>{row.url}</code>
        </p>
      </details>
    </>
  );
}

function CheckLine({ check }: { check: CheckT }) {
  const state = check.pass === null ? "na" : check.pass ? "pass" : "fail";
  const Icon = check.pass === null ? Minus : check.pass ? Check : X;
  const word = check.pass === null ? "not scored" : check.pass ? "pass" : "fail";
  return (
    <li className={`check check--${state}`}>
      <span className="check-mark">
        <Icon weight="bold" aria-label={word} />
      </span>
      <span className="check-id">{check.id.replaceAll("_", " ")}</span>
      <span>{check.detail}</span>
    </li>
  );
}
