// The actions Wayfind shares with other agent sites, through its action bridge.
// When another site's assistant calls Wayfind's network, the bridge loads this module in a
// hidden frame on Wayfind's origin. The searches read only the public index, so they are
// shared with every site ("*"). There are no writes.
import { SearchPage } from "../script.js";
import { SiteActions } from "../site-actions.js";

/**
 * Shares Wayfind's three reads with any calling site, on a fresh SearchPage that fetches
 * data/index.json, as a fresh page would.
 */
class BridgeActions {
  /** Every site may call these reads: they show only the public index. */
  static CALLERS = ["*"];

  static registerActions(actions) {
    const page = new SearchPage();
    for (const definition of SiteActions.definitions(page)) {
      actions.register({ ...definition, availability: "bridge", callerOrigins: BridgeActions.CALLERS });
    }
  }
}

export const registerActions = BridgeActions.registerActions;
