// The MATCH-DEPENDENT static findings (decisions.md #71, plan phase 9;
// wayfinder/tickets/T07-what-the-lints-judge.md): facts that are "static"
// in spirit — no removal, no re-read, judged once — but that need the
// browser to ask, since matching a selector against a document is the
// browser's job, never a hand-rolled one (decisions.md #71, "MATCHING IS
// THE BROWSER'S"). They read `dd`'s match caches (`dd.matchedRules`,
// `dd.ruleMatches`), which answer against the CANVAS's own rendered
// document — the simulated strategy's DOM, kept in step with
// `dd.document()` — so these findings see exactly what an author (or an
// agent mid-draft) sees on the canvas. staticLint.ts stays pure
// JSON-only; this file is the one seam of the static gate that reaches
// into the browser, kept small on purpose.
//
// REDUNDANCY: a per-element declaration a matched, unconditional rule
// already sets with the identical verbatim value — the element's own
// declaration does nothing a rule does not already do, so the finding
// names the element's line as the one to remove.

import type {
  DaydreamApi,
  DreamDocument,
  DreamElement,
  DreamViewport,
  Finding,
} from "@daydream/plugin-api";

import { nameOf } from "./staticLint";

/** What the match-dependent findings need: the pure helpers and the
 * canvas's match facts. A gate hands in its `dd`; a test hands in a test
 * kernel's, over a rendered viewport (`renderViewport` from
 * `@daydream/plugin-testing`) — this fact reads `[]` over anything not
 * actually on the canvas. */
export type MatchHost = Pick<DaydreamApi, "core" | "matchedRules">;

/** Every match-dependent static finding for the document (decisions.md
 * #71, plan phase 9): redundancy so far. Empty when nothing on the
 * canvas disagrees with the sheet. */
export function matchLint(dd: MatchHost, doc: DreamDocument): Finding[] {
  const findings: Finding[] = [];
  for (const vp of dd.core.viewportItems(doc) as DreamViewport[]) {
    lintRedundancy(dd, vp, findings);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Redundancy — an element's declaration a matched rule already makes.

function lintRedundancy(
  dd: MatchHost,
  vp: DreamViewport,
  findings: Finding[],
): void {
  const sheet = vp.payload.sheet ?? [];
  const visit = (el: DreamElement): void => {
    for (const [property, value] of Object.entries(el.styles)) {
      // Winner first (dd.matchedRules's own cascade order): the first
      // matching rule that restates the declaration is the one worth
      // naming — a rule further down the cascade the element already
      // beats is not why the element's own line is redundant.
      for (const match of dd.matchedRules(el.id)) {
        // A pseudo-element match (`.a::before`) styles a box the element
        // itself has no inline declarations for; it is never what an
        // element's own base map restates.
        if (match.pseudo !== undefined) continue;
        const rule = sheet[match.index];
        if (rule === undefined) continue;
        // A conditional rule may not apply everywhere the element does
        // (decisions.md #71): only an unconditional one is guaranteed
        // redundant with a base declaration.
        if (rule.conditions !== undefined && rule.conditions.length > 0) {
          continue;
        }
        if (rule.styles[property] !== value) continue;
        findings.push({
          tier: "static",
          severity: "blocking",
          elementId: el.id,
          property,
          rule: match.index,
          message: `${property}: ${value} on ${nameOf(el)} restates rule ${rule.selector} (sheet[${match.index}]); remove the element's`,
        });
        break;
      }
    }
    el.children.forEach(visit);
  };
  visit(vp.payload.root);
}
