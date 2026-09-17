// The MATCH-DEPENDENT static findings (decisions.md #71, plan phase 9;
// wayfinder/tickets/T07-what-the-lints-judge.md): two facts that are
// "static" in spirit — no removal, no re-read, judged once — but that
// need the browser to ask, since matching a selector against a document
// is the browser's job, never a hand-rolled one (decisions.md #71,
// "MATCHING IS THE BROWSER'S"). Both read `dd`'s match caches
// (`dd.matchedRules`, `dd.ruleMatches`, `dd.geometry.node`), which answer
// against the CANVAS's own rendered document — the simulated strategy's
// DOM, kept in step with `dd.document()` — so these two findings see
// exactly what an author (or an agent mid-draft) sees on the canvas.
// staticLint.ts stays pure JSON-only; this file is the one seam of the
// static gate that reaches into the browser, kept small on purpose.
//
// REDUNDANCY: a per-element declaration a matched, unconditional rule
// already sets with the identical verbatim value — the element's own
// declaration does nothing a rule does not already do, so the finding
// names the element's line as the one to remove.
//
// DEAD RULE: no rendered element matches the rule's selector — with
// state pseudo-classes given a second chance, state-stripped, since
// nobody hovers a lint run (statePseudo.ts). A rule whose OWN `@media`
// condition is not active on the canvas right now is left alone: the
// kernel's match cache reports `[]` for those exactly as it does for a
// truly dead selector (src/canvas/ruleMatch.ts ruleIsActive), and this
// lint has no width sweep of its own to tell the two apart — the
// necessity lint's sweep is what judges a responsive rule's declarations
// (necessity.ts).

import type {
  CoreApi,
  DaydreamApi,
  DreamDocument,
  DreamElement,
  DreamViewport,
  Finding,
} from "@daydream/plugin-api";

import { nameOf } from "./staticLint";
import { hasStatePseudo, stripStatePseudo } from "./statePseudo";

/** What the match-dependent findings need: the pure helpers and the
 * canvas's match facts. A gate hands in its `dd`; a test hands in a test
 * kernel's, over a rendered viewport (`renderViewport` from
 * `@daydream/plugin-testing`) — these two facts read `[]`/`undefined`
 * over anything not actually on the canvas. */
export type MatchHost = Pick<
  DaydreamApi,
  "core" | "matchedRules" | "ruleMatches" | "geometry"
>;

/** Every match-dependent static finding for the document (decisions.md
 * #71, plan phase 9): redundancy, dead rules, and a rule's own
 * container-query-without-container. Empty when nothing on the canvas
 * disagrees with the sheet. */
export function matchLint(dd: MatchHost, doc: DreamDocument): Finding[] {
  const findings: Finding[] = [];
  for (const vp of dd.core.viewportItems(doc) as DreamViewport[]) {
    lintRedundancy(dd, vp, findings);
    lintDeadRules(dd, vp, findings);
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

// ---------------------------------------------------------------------------
// Dead rule — no element in the viewport matches the selector.

function lintDeadRules(
  dd: MatchHost,
  vp: DreamViewport,
  findings: Finding[],
): void {
  const sheet = vp.payload.sheet ?? [];
  sheet.forEach((rule, index) => {
    // An inactive @media condition is indistinguishable, in the match
    // cache alone, from a selector that matches nothing — and the
    // necessity lint's width sweep, not this one, is what tells a
    // currently-inactive responsive rule apart from a genuinely dead one
    // (see the file header). Never call one dead on this evidence alone.
    if (hasInactiveMediaCondition(dd.core, vp, rule)) return;
    let dead = dd.ruleMatches(vp.id, index).length === 0;
    if (dead && hasStatePseudo(rule.selector)) {
      // Give the selector a second chance state-stripped: a `.card:hover`
      // that matches SOME element once hovered is not a rule that
      // matches nothing, and nobody hovers a lint run.
      const rewritten = stripStatePseudo(rule.selector);
      dead = !elementIds(vp.payload.root).some((id) => {
        const node = dd.geometry.node(id);
        if (node === undefined) return false;
        try {
          return node.matches(rewritten);
        } catch {
          return false;
        }
      });
    }
    if (!dead) return;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: vp.payload.root.id,
      rule: index,
      message: `rule ${rule.selector} (sheet[${index}]) in viewport ${vp.id} matches no element`,
    });
  });
}

function hasInactiveMediaCondition(
  core: CoreApi,
  vp: DreamViewport,
  rule: { conditions?: string[] },
): boolean {
  const conditions = rule.conditions ?? [];
  if (conditions.length === 0) return false;
  const env = core.viewportMediaEnvironment(vp);
  return conditions.some((condition) => {
    if (core.conditionKind(condition) !== "media") return false;
    const result = env === null ? "unknown" : core.evaluateMediaCondition(condition, env);
    return result === false;
  });
}

function elementIds(root: DreamElement): string[] {
  const out: string[] = [];
  const visit = (el: DreamElement): void => {
    out.push(el.id);
    el.children.forEach(visit);
  };
  visit(root);
  return out;
}
