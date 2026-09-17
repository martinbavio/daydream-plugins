// The MATCH-DEPENDENT static findings (decisions.md #71, plan phase 9;
// wayfinder/tickets/T07-what-the-lints-judge.md): two facts that are
// "static" in spirit — no removal, no re-read, judged once — but that
// need the browser to ask, since matching a selector against a document is
// the browser's job, never a hand-rolled one (decisions.md #71, "MATCHING
// IS THE BROWSER'S"). staticLint.ts stays pure JSON-only; this file is the
// one seam of the static gate that reaches into the browser, kept small on
// purpose.
//
// WHY THIS FILE MOUNTS, AND NEVER READS `dd.matchedRules` /
// `dd.ruleMatches` / `dd.geometry`: a gate runs over an INCOMING document —
// ingest, replace_viewport, a draft's finalize — that is not, and may
// never have been, on the canvas (decisions.md #71). `dd.matchedRules`,
// `dd.ruleMatches` and `dd.geometry.node` all answer about the CANVAS's
// own rendered document (the simulated strategy's DOM, kept in step with
// `dd.document()`); asked about a viewport that was never rendered there,
// every one of them reports empty, which is exactly the eval bug this
// file fixes — a document with a plainly-matching `.card`/`nav`/`li` rule
// refused on landing because the gate was reading the wrong DOM entirely.
// The fix judges the document it is actually handed by MOUNTING it, the
// same way necessity.ts already must (a live-strategy iframe, `dd.mount-
// Viewport`): matching is asked of THAT DOM, through native
// `Element.matches` — the sanctioned way (decisions.md #71) — never a
// hand-rolled selector engine and never the kernel's canvas-only rewrite
// (necessity.ts's own header explains why: the mounted iframe is its own
// unnamespaced document, so the stored selector is asked of it verbatim).
//
// REDUNDANCY: a per-element declaration a matched, unconditional rule
// already sets with the identical verbatim value — the element's own
// declaration does nothing a rule does not already do, so the finding
// names the element's line as the one to remove.
//
// DEAD RULE: no element in the mounted document matches the rule's
// selector — with state pseudo-classes given a second chance,
// state-stripped, since nobody hovers a lint run (statePseudo.ts). A rule
// whose OWN `@media` condition is not active on the viewport's own frame
// is left alone: this lint has no width sweep of its own to tell a
// currently-inactive responsive rule apart from a genuinely dead one — the
// necessity lint's sweep is what judges a responsive rule's declarations
// (necessity.ts); a container query's own dead-match question is judged
// separately below, from the rule's matched elements' ancestors.
//
// CONTAINER-QUERY-WITHOUT-CONTAINER ON RULES: the same fact staticLint.ts
// asks of an element's `@container` layer (rule 1), asked of a rule's
// `@container` condition instead — the ancestors in question are every
// matched element's own (`dd.core.findPath`, over the DOCUMENT tree, which
// needs no mount), since a rule has no single element position of its own.
//
// RULE-AGAINST-RULE REDUNDANCY (the CSS author's review after the
// selectors step landed): a rule's declaration restating, for EVERY
// element the rule reaches, what the next rule beneath it in that
// element's cascade already sets — the same fact as REDUNDANCY, one level
// up. The judgment is ruleRedundancy.ts's (pure, node-proved); this file
// only hands it the ranked matches the mount answered.
//
// A selector member's trailing `::pseudo-element` has no element of its
// own for `Element.matches` to test — asking it throws or silently
// answers false — so every match this file makes strips a member's
// trailing pseudo-element first (mirroring the kernel's own
// `core/selectors.ts trailingPseudoElement`, reimplemented here since a
// plugin has no import of core's internals, decisions.md #48's plugin
// boundary) and keeps the pseudo-element name alongside for the two
// questions that need it: a pseudo-element match still answers the
// dead-rule question (a `.card::before` rule is not dead while `.card`
// exists) but is skipped outright for redundancy (a pseudo-element's box
// has no inline declarations on the element for a matched rule to
// restate) — the same skip the old canvas read applied to `match.pseudo`.

import type {
  CoreApi,
  DaydreamApi,
  DreamDocument,
  DreamElement,
  DreamViewport,
  Finding,
  MountedViewport,
  StyleRule,
} from "@daydream/plugin-api";

import {
  containerDeclaration,
  nameOf,
  queryNeeds,
  splitContainerPrelude,
} from "./staticLint";
import { ruleRestatements } from "./ruleRedundancy";
import { hasStatePseudo, stripStatePseudo } from "./statePseudo";

/** What the match-dependent findings need: the pure helpers and core's
 * live mount. A gate hands in its `dd`; a test hands in a test kernel's —
 * both mount the document handed to `matchLint`, never read a fact about
 * whatever (if anything) is on the canvas. */
export type MatchHost = Pick<DaydreamApi, "core" | "mountViewport">;

/** Every match-dependent static finding for the document (decisions.md
 * #71, plan phase 9): redundancy (an element's, and a rule's against the
 * rule beneath it), dead rules, and a rule's own
 * container-query-without-container. Each viewport is mounted once — the
 * ranked matches are read once for every node and answer every question
 * this file asks — and disposed before moving to the next. Empty when
 * nothing in the mounted document disagrees with the sheet. */
export async function matchLint(
  dd: MatchHost,
  doc: DreamDocument,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const vp of dd.core.viewportItems(doc) as DreamViewport[]) {
    // Every question here is about a rule, so a viewport without a sheet
    // has nothing to ask and pays for no mount (decisions.md #71).
    const sheet = vp.payload.sheet;
    if (sheet === undefined || sheet.length === 0) continue;
    const mounted = await dd.mountViewport(vp);
    try {
      const byId = mountedNodesById(mounted);
      const ranked = rankedMatches(dd.core, sheet, byId);
      lintRedundancy(vp, ranked, findings);
      lintRuleRestatements(vp, ranked, findings);
      lintDeadRules(dd.core, vp, byId, findings);
      lintContainerQueriesOnRules(dd.core, doc, vp, byId, findings);
    } finally {
      mounted.dispose();
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Selector matching against the mounted document — the one seam every
// question below shares.

/** Every `[data-dream-id]` node of the mounted page, keyed by the id the
 * document stores — one query per viewport, shared by all three
 * questions below (mirrors necessity.ts's own `baseline`/`elementsById`
 * split: the mount's nodes read once, never per rule). */
function mountedNodesById(mounted: MountedViewport): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const node of Array.from(
    mounted.document().querySelectorAll("[data-dream-id]"),
  )) {
    const id = (node as HTMLElement).dataset["dreamId"];
    if (id !== undefined) map.set(id, node);
  }
  return map;
}

/** The selector list's members, split at top-level commas — outside
 * parens, brackets and strings, the same grain `rule.selector` is already
 * stored in (the CSSOM's `", "`). A private copy, the same one
 * necessity.ts keeps beside it (see this file's header: two independent
 * lints, neither imports the other's internals). */
function splitTopLevelCommas(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

/** A trimmed selector member's trailing pseudo-element, split off — or
 * null when it has none. See this file's header for why every match goes
 * through this first. */
function trailingPseudoElement(
  member: string,
): { base: string; pseudo: string } | null {
  const trimmed = member.trim();
  const match = /::([a-z-]+)\s*$/i.exec(trimmed);
  if (match === null) return null;
  return {
    base: trimmed.slice(0, match.index),
    pseudo: (match[1] as string).toLowerCase(),
  };
}

/** `rule.selector`, every member's trailing pseudo-element stripped and
 * rejoined as one selector list `Element.matches`/`querySelectorAll`
 * accepts whole — what "does this rule match anything" (the dead-rule and
 * container-query questions) asks against the mount. Redundancy asks a
 * finer-grained version of the same thing, per member, since it also
 * needs to know WHICH member matched and at what specificity
 * (`matchedRulesFor` below). */
function selectorForMatching(selector: string): string {
  return splitTopLevelCommas(selector)
    .map((member) => trailingPseudoElement(member)?.base ?? member.trim())
    .join(", ");
}

function matchesAny(nodes: Iterable<Element>, selector: string): boolean {
  for (const node of nodes) {
    try {
      if (node.matches(selector)) return true;
    } catch {
      // A selector the validator should have refused; never a match.
    }
  }
  return false;
}

function matchingIds(
  byId: ReadonlyMap<string, Element>,
  selector: string,
): string[] {
  const out: string[] = [];
  for (const [id, node] of byId) {
    let ok: boolean;
    try {
      ok = node.matches(selector);
    } catch {
      ok = false;
    }
    if (ok) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redundancy — an element's declaration a matched rule already makes.

/** One rule matching a node, ranked the way the browser's own cascade
 * would: `specificity` is the MATCHING member's own (a selector list's
 * effective specificity is whichever member matched, never the list's
 * maximum), `pseudo` present exactly when that member ended in one. */
interface RuleMatch {
  index: number;
  pseudo?: string;
  specificity: [number, number, number];
}

/** Every rule of `sheet` matching `node`, winner-first: by specificity
 * descending, then by stored index descending (a later rule wins ties) —
 * the same ordering `dd.matchedRules` used to give redundancy on the
 * canvas, rebuilt here against the mount's own DOM (see this file's
 * header for why the canvas read is wrong for a gate). A selector list is
 * tried member by member, every member tried (not just the first that
 * matches), the same reasoning `core/canvas/ruleMatch.ts`'s
 * `selectorMatch` documents: a rule may match through more than one
 * member and the more specific one is what ranks it. Unlike the canvas
 * read, a state pseudo-class is never made optional here — the mount is a
 * real, unhovered page, so a `.card:hover` rule genuinely does not match
 * `.card` right now, exactly as a browser loading the page cold would
 * say; there is no "glass" (decisions.md #52) shielding a mounted
 * document from its own literal state. */
function matchedRulesFor(
  core: CoreApi,
  sheet: readonly StyleRule[],
  node: Element,
): RuleMatch[] {
  const out: RuleMatch[] = [];
  sheet.forEach((rule, index) => {
    let best: { specificity: [number, number, number]; pseudo?: string } | null =
      null;
    let plain = false;
    for (const member of splitTopLevelCommas(rule.selector)) {
      const trimmed = member.trim();
      const trailing = trailingPseudoElement(trimmed);
      const base = trailing?.base ?? trimmed;
      let ok: boolean;
      try {
        ok = node.matches(base);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      if (trailing === null) plain = true;
      const rank = core.specificity(trimmed);
      if (best === null || isMoreSpecific(rank, best.specificity)) {
        best =
          trailing === null
            ? { specificity: rank }
            : { specificity: rank, pseudo: trailing.pseudo };
      }
    }
    if (best !== null) {
      // A rule reaching the element through a plain member AND a
      // pseudo-element one (`.card, .card::before`) reaches the real box:
      // the pseudo mark is kept only when every matching member ended in
      // one, so neither redundancy question skips a rule that does style
      // the element itself (review of this file).
      out.push({
        index,
        specificity: best.specificity,
        ...(best.pseudo === undefined || plain ? {} : { pseudo: best.pseudo }),
      });
    }
  });
  out.sort((a, b) => {
    const bySpecificity = compareSpecificityDescending(a.specificity, b.specificity);
    return bySpecificity !== 0 ? bySpecificity : b.index - a.index;
  });
  return out;
}

function isMoreSpecific(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return false;
}

/** Descending: the greater triple first. */
function compareSpecificityDescending(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (b[i] as number) - (a[i] as number);
  }
  return 0;
}

/** Every mounted node's ranked matches, keyed by element id — read once
 * per viewport and shared by both redundancy questions. */
function rankedMatches(
  core: CoreApi,
  sheet: readonly StyleRule[],
  byId: ReadonlyMap<string, Element>,
): Map<string, RuleMatch[]> {
  const out = new Map<string, RuleMatch[]>();
  for (const [id, node] of byId) out.set(id, matchedRulesFor(core, sheet, node));
  return out;
}

function lintRedundancy(
  vp: DreamViewport,
  ranked: ReadonlyMap<string, readonly RuleMatch[]>,
  findings: Finding[],
): void {
  const sheet = vp.payload.sheet ?? [];
  const visit = (el: DreamElement): void => {
    const matches = ranked.get(el.id);
    if (matches !== undefined) {
      for (const [property, value] of Object.entries(el.styles)) {
        // Winner first: the first matching rule that restates the
        // declaration is the one worth naming — a rule further down the
        // cascade the element already beats is not why the element's own
        // line is redundant.
        for (const match of matches) {
          // A pseudo-element match (`.a::before`) styles a box the
          // element itself has no inline declarations for; it is never
          // what an element's own base map restates.
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
    }
    el.children.forEach(visit);
  };
  visit(vp.payload.root);
}

// ---------------------------------------------------------------------------
// Rule-against-rule redundancy — a rule's declaration the rule beneath it
// already makes, everywhere the rule reaches (ruleRedundancy.ts).

function lintRuleRestatements(
  vp: DreamViewport,
  ranked: ReadonlyMap<string, readonly RuleMatch[]>,
  findings: Finding[],
): void {
  const sheet = vp.payload.sheet ?? [];
  for (const hit of ruleRestatements(sheet, ranked, hasStatePseudo)) {
    const rule = sheet[hit.rule];
    if (rule === undefined) continue;
    const named = hit.restates
      .map((index) => `${sheet[index]?.selector ?? "?"} (sheet[${index}])`)
      .join(" and ");
    findings.push({
      tier: "static",
      severity: "blocking",
      rule: hit.rule,
      property: hit.property,
      message: `${hit.property}: ${hit.value} in rule ${rule.selector} (sheet[${hit.rule}]) of viewport ${vp.id} restates ${hit.restates.length === 1 ? "rule" : "rules"} ${named} for every element it reaches; remove it from ${rule.selector}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Dead rule — no element in the mounted document matches the selector.

function lintDeadRules(
  core: CoreApi,
  vp: DreamViewport,
  byId: ReadonlyMap<string, Element>,
  findings: Finding[],
): void {
  const sheet = vp.payload.sheet ?? [];
  // Materialized, never the live iterator: a rule's second, state-stripped
  // look (below) re-walks every node, and `Map.values()`'s iterator is
  // spent after one walk.
  const nodes = Array.from(byId.values());
  sheet.forEach((rule, index) => {
    // An inactive @media condition is indistinguishable, from the mount
    // alone, from a selector that matches nothing — and the necessity
    // lint's width sweep, not this one, is what tells a currently-inactive
    // responsive rule apart from a genuinely dead one (see the file
    // header). Never call one dead on this evidence alone.
    if (hasInactiveMediaCondition(core, vp, rule)) return;
    let dead = !matchesAny(nodes, selectorForMatching(rule.selector));
    if (dead && hasStatePseudo(rule.selector)) {
      // Give the selector a second chance state-stripped: a `.card:hover`
      // that matches SOME element once hovered is not a rule that
      // matches nothing, and nobody hovers a lint run.
      dead = !matchesAny(
        nodes,
        selectorForMatching(stripStatePseudo(rule.selector)),
      );
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

// ---------------------------------------------------------------------------
// Container-query-without-container, asked of a rule's matched elements.

function lintContainerQueriesOnRules(
  core: CoreApi,
  doc: DreamDocument,
  vp: DreamViewport,
  byId: ReadonlyMap<string, Element>,
  findings: Finding[],
): void {
  const sheet = vp.payload.sheet ?? [];
  sheet.forEach((rule, index) => {
    for (const condition of rule.conditions ?? []) {
      if (core.conditionKind(condition) !== "container") continue;
      const prelude = condition.trim();
      const { name, condition: inner } = splitContainerPrelude(prelude);
      const needs = queryNeeds(inner);
      if (!needs.size && !needs.scrollState) continue; // style()-only
      const matched = matchingIds(byId, selectorForMatching(rule.selector));
      // A rule matching no element is the dead-rule finding's to report;
      // there is no matched element here to read ancestors from, and a
      // second finding on the same rule would only repeat it.
      if (matched.length === 0) continue;
      const satisfied = matched.some((elementId) => {
        const path = core.findPath(doc, elementId);
        if (path === undefined) return false;
        const ancestors = path.slice(0, -1);
        return ancestors.some((ancestor) => {
          const decl = containerDeclaration(core, ancestor as DreamElement);
          const typed =
            (!needs.size || decl.size) &&
            (!needs.scrollState || decl.scrollState);
          if (!typed) return false;
          return name === null || decl.names.has(name);
        });
      });
      if (satisfied) continue;
      findings.push({
        tier: "static",
        severity: "blocking",
        rule: index,
        message: `container query \`${prelude}\` in rule ${rule.selector} (sheet[${index}]) of viewport ${vp.id} can never match: no matched element has a satisfying ancestor`,
      });
    }
  });
}
