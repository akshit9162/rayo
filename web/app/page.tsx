import { readFileSync } from "node:fs";
import path from "node:path";
import { CopyButton } from "./copy";
import { formatDate, siteGraph, topRows, type Index } from "./rows";
import { Search } from "./search";
import { BRAND, NETWORK_URL, REPO, SITE } from "./site";

const index: Index = JSON.parse(readFileSync(path.join(process.cwd(), "..", "data", "index.json"), "utf8"));

const SIGNALS: Record<string, string> = {
  probes: "The front agent declines out-of-scope work, resists an override and invents nothing",
  conformance: "Manifest, definition and CORS pass the MVP spec",
  links: "Other agent sites link to it",
  live: "Shares live reads with any caller",
  acts: "Can book, order or write, not just talk",
  honest: "Publishes what it cannot do",
  fresh: "Changed in the last 30 to 180 days",
};

const PENALTIES: Record<string, string> = {
  tampered: "Definition does not match its declared digest",
  unsafe: "Text aimed at other agents, rankers or keys",
  expired: "Claim has expired",
  copy: "Near-copy of a higher-ranked network",
};

const STEPS = [
  { figure: String(index.stats.sites), unit: "sites", title: "Crawl", body: "From the community list, its pull requests and GitHub, then every partner link." },
  { figure: "BM25", unit: "", title: "Match", body: "Text match over descriptions, sample queries and action names picks the candidates." },
  { figure: String(Object.keys(index.weights).length), unit: "signals", title: "Order", body: "Candidates are ordered on what each site can show, not what it says." },
  { figure: String(Object.keys(index.penalties).length), unit: "penalties", title: "Demote", body: "What looks wrong is multiplied down, never hidden." },
];

// The assistant mount, set as raw HTML: the agent runtime fills these slots, and React must
// never hydrate or re-render them. site.js reports in #assistant-status.
const ASSISTANT = `
<p id="assistant-status" class="assistant-status" role="status">Connecting the assistant. If this stays, the assistant could not load; the search above still works.</p>
<div id="agent-app">
  <div data-ns-slot="header"></div>
  <div class="assistant-panels">
    <div data-ns-slot="chat"></div>
    <div data-ns-slot="agents"></div>
  </div>
  <div data-ns-slot="settings"></div>
</div>`;

export default function Home() {
  const top = topRows(index, 8);
  const stats = { networks: index.stats.networks, sites: index.stats.sites, edges: index.stats.edges, built: formatDate(index.generatedAt) };
  const probed = index.stats.probed;

  return (
    <>
      <a className="skip" href="#main">
        Skip to search
      </a>
      <header className="nav">
        <div className="container nav-row">
          <a className="wordmark" href="./">
            {BRAND}
          </a>
          <nav aria-label="Sections">
            <ul>
              <li><a href="#board">Board</a></li>
              <li><a href="#ranking">Ranking</a></li>
              <li><a href="#call">Call it</a></li>
              <li><a href="#assistant">Ask</a></li>
            </ul>
          </nav>
          <a className="btn btn--small" href={REPO}>
            Source
          </a>
        </div>
      </header>

      <main id="main">
        <Search top={top} stats={stats} graph={siteGraph(index)} brand={BRAND} />

        <section id="ranking" className="section container" aria-labelledby="ranking-title">
          <h2 id="ranking-title">Ranked on proof.</h2>
          <ol className="route">
            {STEPS.map((s) => (
              <li key={s.title} className="stop">
                <p className="stop-figure">
                  <span className="figure">{s.figure}</span>
                  {s.unit && <span className="unit">{s.unit}</span>}
                </p>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="weights">
            <table>
              <caption>What a network earns</caption>
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <th scope="col">Measures</th>
                  <th scope="col" className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(index.weights).map(([id, w]) => (
                  <tr key={id}>
                    <th scope="row">{id}</th>
                    <td>
                      {SIGNALS[id] ?? id}
                      {id === "probes" && probed === 0 && <span className="note"> Not run in this index yet.</span>}
                    </td>
                    <td className="num weight">{Math.round(w * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <caption>What costs it</caption>
              <thead>
                <tr>
                  <th scope="col">Penalty</th>
                  <th scope="col">When</th>
                  <th scope="col" className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(index.penalties).map(([id, m]) => (
                  <tr key={id}>
                    <th scope="row">{id}</th>
                    <td>{PENALTIES[id] ?? id}</td>
                    <td className="num weight">×{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="call" className="band band--paper-2" aria-labelledby="call-title">
          <div className="container call">
            <div>
              <h2 id="call-title">Give your agent a map.</h2>
              <p className="lead">{BRAND} is an agent site too. Its three reads are shared with every site, so your network can search it on your visitor’s key.</p>
            </div>
            <div className="plate call-plate">
              <p className="plate-head">
                <span>Network URL</span>
              </p>
              <p className="call-url">
                <code>{NETWORK_URL}</code>
              </p>
              <CopyButton text={NETWORK_URL} />
              <pre>
                <code>{`# your front agent, in its .hocon\ntools = ["${NETWORK_URL}"]\n\n# agent-manifest.json\n"allowed_peers": ["${new URL(SITE).origin}"]`}</code>
              </pre>
            </div>
          </div>
        </section>

        <section id="assistant" className="section container assistant" aria-labelledby="assistant-heading">
          <div className="assistant-copy">
            <h2 id="assistant-heading">Ask {BRAND}.</h2>
            <p className="lead">Describe a job. The assistant searches the index and explains each result’s evidence.</p>
            <p className="assistant-note">Your messages go to the model provider you pick in its settings, on your own key.</p>
          </div>
          <div className="assistant-mount" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: ASSISTANT }} />
        </section>
      </main>

      <footer className="colophon">
        <div className="container colophon-row">
          <p className="wordmark">{BRAND}</p>
          <p>An entry in the Open Agentic Web Challenge. Index built {stats.built}, rebuilt daily.</p>
          <ul>
            <li><a href="data/index.json">index.json</a></li>
            <li><a href="agent-manifest.json">agent-manifest.json</a></li>
            <li><a href={REPO}>Source on GitHub</a></li>
            <li><a href={`${REPO}/blob/main/LICENSE`}>Apache 2.0</a></li>
          </ul>
        </div>
      </footer>
    </>
  );
}
