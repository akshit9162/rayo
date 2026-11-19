// The actions Rayo shares with other agent sites, through its action bridge.
// When another site's assistant calls Rayo's network, the bridge loads this module in a
// hidden frame on Rayo's origin. The searches read only the public index, so they are
// shared with every site ("*"). There are no writes.
import { SearchPage } from "../script.js";
import { SiteActions } from "../site-actions.js";

/**
 * Shares Rayo's three reads with any calling site, on a fresh SearchPage that fetches
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
