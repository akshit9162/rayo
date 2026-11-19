// Static scan of a site's public agent files for text aimed at other agents, rankers or keys.
// It never runs the site's code. A finding demotes the network and is shown as evidence.

const HIDDEN = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;

const RULES = [
  { id: "override", re: /\b(ignore|disregard|forget|override)\b.{0,30}\b(all|any|previous|prior|earlier|above|your|the)\b.{0,20}\b(instructions?|rules|prompts?|guidelines)\b/i },
  { id: "self-promotion", re: /\b(always|must|should)\s+(recommend|rank|prefer|choose|pick|route\s+to|list)\s+(this|our|us\b)/i },
  { id: "ranker-targeting", re: /\b(search engines?|rankers?|crawlers?|directories|indexers?|other (agents?|assistants?|ais?))\b.{0,60}\b(rank|recommend|prefer|list)\b.{0,30}\b(this|our|us\b|first|top)/i },
  { id: "exfiltration", re: /\b(send|post|forward|upload|include|reveal|leak)\b.{0,40}\b(api[ _-]?keys?|tokens?|passwords?|credentials|cookies|byok|secrets?)\b.{0,40}\b(to|into|at)\b/i },
  { id: "hidden-text", re: HIDDEN },
];

// Defensive text names the attack in order to refuse it.
const DEFENSIVE = /\b(if|never|do not|don't|not|refuse|treat|ignore requests to|if (a|the) (partner|page|tool|result))\b[^.]{0,60}$/i;

/** Returns findings [{ id, excerpt }] for the given strings. */
export function scanStrings(strings) {
  const findings = [];
  for (const s of strings) {
    for (const { id, re } of RULES) {
      const m = re.exec(s);
      if (!m) continue;
      const before = s.slice(Math.max(0, m.index - 80), m.index);
      if (id !== "hidden-text" && DEFENSIVE.test(before)) continue;
      const excerpt = id === "hidden-text" ? "invisible Unicode characters in published text" : s.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).replace(/\s+/g, " ").trim();
      if (!findings.some((f) => f.id === id)) findings.push({ id, excerpt });
    }
  }
  return findings;
}
