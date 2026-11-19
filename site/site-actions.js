// Registers Wayfind's operations with the agent runtime. agent-manifest.json loads this
// module through "actions.module". Only the names in "actions.agentTools" become model
// tools, called website_<name>. Every action only reads the public index.
import { App } from "./script.js";

/**
 * The page's searches as actions the assistant can call. They wrap SearchPage, so the
 * assistant, the page's form and other sites' agents share one set of rules.
 */
export class SiteActions {
  static registerActions(actions) {
    for (const definition of SiteActions.definitions(App.page)) actions.register(definition);
  }

  /**
   * The three reads. The bridge registers the same definitions, so the network's
   * instructions fit both.
   *
   * :param page: A SearchPage.
   * :return: The action definitions.
   */
  static definitions(page) {
    return [
      {
        name: "search_agentic_web",
        description: "Search the crawled index of open agentic websites for a job, such as \"order pizza\" or \"check a contract\". Returns up to 10 networks, best first, each with its networkUrl (what another agent site calls), score, whether it can act (book, order) or only talk, the checks it failed and its probe results. Changes nothing. Call it before naming any site.",
        effect: "read",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 2, maxLength: 200, description: "The job in a few plain words, without the visitor's personal details." },
            limit: { type: "integer", minimum: 1, maximum: 10, description: "How many results. Default 5." },
            mustAct: { type: "boolean", description: "true for only sites that can take actions such as bookings or orders. Leave it out to let the query decide." },
            callableOnly: { type: "boolean", description: "true for only networks another site can load (CORS open)." },
          },
        },
        execute: (args) => page.search(args),
      },
      {
        name: "get_network_report",
        description: "Read every check and signal for one network: conformance, integrity, safety, probes, links from other sites, shared actions and what it cannot do. Changes nothing. Call it with a networkUrl from website_search_agentic_web when the visitor asks why a site ranks where it does or whether it is safe to link to.",
        effect: "read",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["networkUrl"],
          properties: {
            networkUrl: { type: "string", minLength: 8, maxLength: 400, description: "A networkUrl exactly as website_search_agentic_web returned it." },
          },
        },
        execute: (args) => page.report(args),
      },
      {
        name: "get_index_info",
        description: "Read when the index was built, how many sites, networks and links it holds, how many were probed, and the ranking weights and penalties. Changes nothing. Call it when the visitor asks how Wayfind works, how fresh it is, or how ranking is decided.",
        effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => page.info(),
      },
    ];
  }
}

export const registerActions = SiteActions.registerActions;
