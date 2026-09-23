// The MATCH-DEPENDENT static findings (decision #71, plan phase 9;
// wayfinder/tickets/T07-what-the-lints-judge.md): facts that are "static"
// in spirit — no removal, no re-read, judged once — but that need the
// browser to ask, since matching a selector against a page is the
// browser's job, never a hand-rolled one (decision #71, "MATCHING IS THE
// BROWSER'S"). staticLint.ts reads the texts alone; this file is the one
// seam of the static gate that mounts the page, kept small on purpose.
//
// WHY THIS FILE MOUNTS, AND NEVER READS `dd.pageRuleMatches` /
// `dd.pageStack` / `dd.geometry`: a gate runs over an INCOMING document —
// ingest, replace_viewport, a draft's finalize — that is not, and may
// never have been, on the canvas. Those reads answer about the CANVAS's
// own mounted pages; asked about a page that was never rendered there,
// every one of them reports empty (the eval bug of 2026-09-17: a
// plainly-matching `.card` rule refused on landing because the gate read
// the wrong DOM). So the page it is handed is MOUNTED (`dd.mountViewport`,
// the live face: the page's own text in an iframe) and every match is
// asked of that document through native `Element.matches`.
//
// The rules are the page's css as written (pageCss.ts `pageRules`, the
// same list and the same `rule` indices the static and necessity lints
// use), a nested rule's selector resolved against its parents the way the
// browser desugars nesting, and a rule inside an `@scope` matched from its
// scope's roots, within its limits (ruleMatch.ts) — never by
// `Element.matches` alone, which reads its `:scope` as the element asked.
// An element's own declarations are its `style` attribute, and it is
// named by its unique selector in the page's stored markup (pageDom.ts
// storedNames), not in the mounted copy.
//
// REDUNDANCY: an element's own declaration a matched, unconditional rule
// already sets with the identical value — the element's line does nothing
// a rule does not already do, so the finding names it as the one to
// remove. Sharing a value is not enough: the cascade decides what the
// element gets without its line (an `!important` elsewhere, a layer, a
// later rule), so the claim is MEASURED — the line cut from the copy, the
// element's computed style read, the line put back, as the necessity lint
// removes a declaration — and holds only when nothing changed. What the
// frame cannot show is refused outright: a rule reaching the element that
// touches the property under an `@media`, `@container`, `@supports` or
// `@starting-style`, or a state pseudo-class, could win without the line
// at another width or in another state.
//
// DEAD RULE: no element of the mounted page matches the rule's selector —
// with state pseudo-classes given a second chance, state-stripped, since
// nobody hovers a lint run (statePseudo.ts). A rule under an `@media` or
// `@supports` that does not hold in the mounted window is left alone: this
// lint has no width sweep to tell a responsive rule apart from a dead one
// — the necessity lint's sweep judges a responsive rule's declarations
// (necessity.ts). Whether a condition holds is the one answer both gates
// read (pageMount.ts conditionsHold): the window's own `matchMedia`, so a
// preference or a height query is judged the same way by both.
//
// A CONTAINER QUERY WITH NO CONTAINER: a rule under `@container` whose
// every matched element lacks an ancestor that is a container for what the
// query asks (containers.ts). Each ancestor's container declarations are
// gathered from its own style and every rule matching it under any
// condition — generous, because a static lint must never flag a query the
// browser could match at some width.
//
// RULE-AGAINST-RULE REDUNDANCY (the CSS author's review after the
// selectors step landed): a rule's declaration restating, for EVERY
// element the rule reaches, what the next rule beneath it in that
// element's cascade already sets. The judgment is ruleRedundancy.ts's
// (pure, node-proved); this file hands it the ranked matches — a state
// rule among them, matched state-stripped, so a `:hover` rule between the
// two stops the walk — and measures each restatement the same way: the
// rule's line cut from the copy's css, every element it reaches read.
//
// A selector member's trailing `::pseudo-element` has no element for
// `Element.matches` to test, so every match strips it first
// (pageCss.ts `trailingPseudoElement`) and keeps its name for the two
// questions that need it: a pseudo-element match still answers the
// dead-rule question (a `.card::before` rule is not dead while `.card`
// exists) but is skipped for redundancy (a pseudo-element's box has no
// `style` attribute for a rule to restate).

import type {
  CoreApi,
  DreamDocument,
  DreamPage,
  Finding,
} from "@daydream/plugin-api";

import {
  emptyContainerDeclaration,
  mergeContainerDeclaration,
  queryNeeds,
  satisfies,
  splitContainerPrelude,
  type ContainerDeclaration,
} from "./containers";
import {
  atKeyword,
  declarationMap,
  pageRules,
  ruleName,
  scanDeclarations,
  selectorForMatching,
  splitTopLevelCommas,
  trailingPseudoElement,
  type CssDeclaration,
  type PageRule,
} from "./pageCss";
import {
  lintElements,
  mountedStyle,
  parsePage,
  storedNames,
} from "./pageDom";
import {
  conditionsHold,
  readWithout,
  withMount,
  type MountHost,
  type TextRange,
} from "./pageMount";
import { ruleMatcher, type RuleMatcher } from "./ruleMatch";
import {
  relatedProperties,
  ruleRestatements,
  type RedundancyRule,
} from "./ruleRedundancy";
import { hasStatePseudo, stripStatePseudo } from "./statePseudo";

/** What the match-dependent findings need: the pure helpers and core's
 * live mount. A gate hands in its `dd`; a test hands in a test kernel's —
 * both mount the page handed to `matchLint`, never read a fact about
 * whatever (if anything) is on the canvas. */
export type MatchHost = MountHost;

/** One page mounted, read once: its elements in tree order, each one's
 * own declarations and unique selector, and the rules. */
interface MountedPage {
  page: DreamPage;
  doc: Document;
  /** The page's `<style>` in the copy, which a measurement cuts from and
   * restores (`unchangedWithout`), or null when there is none. */
  style: HTMLStyleElement | null;
  rules: PageRule[];
  nodes: Element[];
  own: Map<Element, CssDeclaration[]>;
  nameOf(node: Element): string;
  /** Matching in the copy, a rule's `@scope` included (ruleMatch.ts). */
  match: RuleMatcher;
}

/** Every match-dependent static finding for the document: redundancy (an
 * element's, and a rule's against the rule beneath it), dead rules, and a
 * rule's container query with no container. Each page is mounted once —
 * the ranked matches are read once for every node and answer every
 * question here — and disposed before the next. Empty when nothing in the
 * mounted page disagrees with the css. */
export async function matchLint(
  dd: MatchHost,
  doc: DreamDocument,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const page of dd.core.viewportItems(doc) as DreamPage[]) {
    // Every question here is about a rule, so a page without one has
    // nothing to ask and pays for no mount.
    const stored = parsePage(page.payload);
    const authored = pageRules(stored.css);
    if (authored.length === 0) continue;
    await withMount(dd, page, undefined, async (mounted) => {
      const mdoc = mounted.document();
      const nodes = lintElements(mdoc);
      // The copy's own css, so a rule's values and an element's `style`
      // are compared as the copy holds both (pageDom.ts mountedStyle);
      // its rules are the stored text's, index for index.
      const style = mountedStyle(mdoc);
      const copied = style?.textContent;
      const read: MountedPage = {
        page,
        doc: mdoc,
        style,
        rules: copied == null ? authored : pageRules(copied),
        nodes,
        own: new Map(
          nodes.map((node) => [
            node,
            scanDeclarations(node.getAttribute("style") ?? ""),
          ]),
        ),
        nameOf: storedNames(stored.doc, mdoc),
        match: ruleMatcher(mdoc),
      };
      const ranked = rankedMatches(dd.core, read);
      lintRedundancy(read, ranked, findings);
      lintRuleRestatements(read, ranked, findings);
      lintDeadRules(read, findings);
      lintContainerQueries(read, findings);
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Matching against the mounted page — the one seam every question shares.

/** Whether some node matches `selector`, a variant of `rule`'s, read
 * under the rule's `@scope`s. A selector the browser refuses matches
 * nothing, as in its cascade. */
function matchesAny(
  read: MountedPage,
  rule: PageRule,
  selector: string,
): boolean {
  return read.nodes.some((node) => read.match(node, selector, rule.scopes));
}

/** One rule matching a node, ranked the way the browser's cascade would:
 * `specificity` is the MATCHING member's own (a selector list's effective
 * specificity is whichever member matched), `pseudo` present exactly when
 * every matching member ended in one. */
interface RuleMatch {
  index: number;
  pseudo?: string;
  specificity: [number, number, number];
}

/** Every rule matching `node`, winner-first: specificity descending, then
 * source order descending (a later rule wins ties). Each member of a
 * selector list is tried, since a rule may match through more than one
 * and the more specific one ranks it. A member with a state pseudo-class
 * matches as though the state were in effect (state-stripped): nobody
 * hovers the mount, but the redundancy questions must see the rule that
 * would win once somebody does — and never take it for a certain one
 * (`varies`). Every condition is ignored the same way. */
function matchedRulesFor(
  core: CoreApi,
  read: MountedPage,
  node: Element,
): RuleMatch[] {
  const out: RuleMatch[] = [];
  for (const rule of read.rules) {
    let best: { specificity: [number, number, number]; pseudo?: string } | null =
      null;
    let plain = false;
    for (const member of splitTopLevelCommas(rule.selector)) {
      const trimmed = member.trim();
      const trailing = trailingPseudoElement(trimmed);
      const base = trailing?.base ?? trimmed;
      const matched =
        read.match(node, base, rule.scopes) ||
        (hasStatePseudo(base) &&
          read.match(node, stripStatePseudo(base), rule.scopes));
      if (!matched) continue;
      if (trailing === null) plain = true;
      const rank = core.specificity(trimmed);
      if (best === null || isMoreSpecific(rank, best.specificity)) {
        best =
          trailing === null
            ? { specificity: rank }
            : { specificity: rank, pseudo: trailing.pseudo };
      }
    }
    if (best === null) continue;
    // A rule reaching the element through a plain member AND a
    // pseudo-element one (`.card, .card::before`) reaches the real box.
    out.push({
      index: rule.index,
      specificity: best.specificity,
      ...(best.pseudo === undefined || plain ? {} : { pseudo: best.pseudo }),
    });
  }
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

function compareSpecificityDescending(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (b[i] as number) - (a[i] as number);
  }
  return 0;
}

/** Every mounted node's ranked matches, read once per page and shared by
 * both redundancy questions. */
function rankedMatches(core: CoreApi, read: MountedPage): Map<Element, RuleMatch[]> {
  const out = new Map<Element, RuleMatch[]>();
  for (const node of read.nodes) out.set(node, matchedRulesFor(core, read, node));
  return out;
}

// ---------------------------------------------------------------------------
// Redundancy — an element's own declaration a matched rule already makes.

function lintRedundancy(
  read: MountedPage,
  ranked: ReadonlyMap<Element, readonly RuleMatch[]>,
  findings: Finding[],
): void {
  const maps = read.rules.map((rule) => declarationMap(rule.declarations));
  for (const node of read.nodes) {
    const own = read.own.get(node) ?? [];
    // A pseudo-element match styles a box the element's own style never
    // reaches.
    const matched = (ranked.get(node) ?? []).filter(
      (match) => match.pseudo === undefined,
    );
    if (own.length === 0 || matched.length === 0) continue;
    for (const [property, value] of Object.entries(declarationMap(own))) {
      // A rule that could win without the line at another width or in
      // another state: the frame cannot say the line is redundant there.
      const contested = matched.some((match) => {
        const rule = read.rules[match.index];
        return (
          rule !== undefined &&
          varies(rule) &&
          Object.keys(maps[rule.index] ?? {}).some((name) =>
            relatedProperties(property, name),
          )
        );
      });
      if (contested) continue;
      // Winner first: the first matching rule that restates the
      // declaration is the one worth naming.
      for (const match of matched) {
        const rule = read.rules[match.index];
        // A conditional or state rule may not apply everywhere the
        // element does: only an unconditional one can restate it.
        if (rule === undefined || rule.conditions.length > 0) continue;
        if (hasStatePseudo(rule.selector)) continue;
        if (maps[rule.index]?.[property] !== value) continue;
        // The cascade without the line may still pick another rule.
        const lines = allOf(own, property).map((d) => d.range);
        if (!unchangedWithout(read, [], new Map([[node, lines]]), [node])) {
          break;
        }
        const selector = read.nameOf(node);
        findings.push({
          tier: "static",
          severity: "blocking",
          elementId: selector,
          property,
          rule: rule.index,
          message: `${property}: ${value} on \`${selector}\` restates rule ${ruleName(rule)}; remove it from the element's style`,
        });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule-against-rule redundancy (ruleRedundancy.ts).

function lintRuleRestatements(
  read: MountedPage,
  ranked: ReadonlyMap<Element, readonly RuleMatch[]>,
  findings: Finding[],
): void {
  const sheet: RedundancyRule[] = read.rules.map((rule) => ({
    selector: rule.selector,
    conditions: rule.conditions,
    styles: declarationMap(rule.declarations),
  }));
  for (const hit of ruleRestatements(sheet, ranked, hasStatePseudo)) {
    const rule = read.rules[hit.rule];
    if (rule === undefined) continue;
    // Measured: the rule's line cut from the copy, every element it
    // reaches read against the page with it.
    const reached = read.nodes.filter((node) =>
      (ranked.get(node) ?? []).some((match) => match.index === hit.rule),
    );
    const lines = allOf(rule.declarations, hit.property).map((d) => d.range);
    if (!unchangedWithout(read, lines, new Map(), reached)) continue;
    const beneath = hit.restates
      .map((index) => read.rules[index])
      .filter((r): r is PageRule => r !== undefined)
      .map(ruleName)
      .join(" and ");
    findings.push({
      tier: "static",
      severity: "blocking",
      rule: hit.rule,
      property: hit.property,
      message: `${hit.property}: ${hit.value} in rule ${ruleName(rule)} of viewport ${read.page.id} restates ${hit.restates.length === 1 ? "rule" : "rules"} ${beneath} for every element it reaches; remove it from ${ruleName(rule)}`,
    });
  }
}

/** Whether a rule may apply at one width or in one state and not at
 * another: under an at-rule that gates it (`@layer` and `@scope` do not
 * — they hold at every width), or with a state pseudo-class. */
function varies(rule: PageRule): boolean {
  return (
    hasStatePseudo(rule.selector) ||
    rule.conditions.some((condition) => {
      const keyword = atKeyword(condition);
      return keyword !== "layer" && keyword !== "scope";
    })
  );
}

function allOf(
  list: readonly CssDeclaration[],
  property: string,
): CssDeclaration[] {
  return list.filter((d) => d.property === property);
}

/**
 * Remove, read, restore — the necessity lint's measurement, through the
 * same helper (pageMount.ts readWithout), asked of the elements a
 * redundancy is about: whether every one of `nodes` computes exactly what
 * it did with the `css` and `inline` ranges cut. The computed style
 * decides an element's box and everything that inherits from it, so an
 * element computing the same is a page unchanged by the cut. With no
 * `<style>` to cut from, a css range reads as a change.
 */
function unchangedWithout(
  read: MountedPage,
  css: readonly TextRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
  nodes: readonly Element[],
): boolean {
  if (css.length > 0 && read.style === null) return false;
  const before = nodes.map(computedOf);
  return readWithout(read.style, css, inline, () =>
    nodes.every((node, i) => computedOf(node) === before[i]),
  );
}

/** Every computed value of the element, custom properties included (a
 * restated `--x` is the element's own value), as one comparable string —
 * read through the copy's own window. */
function computedOf(node: Element): string {
  const view = node.ownerDocument.defaultView ?? window;
  const style = view.getComputedStyle(node);
  let out = "";
  for (const name of Array.from(style)) {
    out += `|${name}:${style.getPropertyValue(name)}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dead rule — no element of the mounted page matches the selector.

function lintDeadRules(read: MountedPage, findings: Finding[]): void {
  for (const rule of read.rules) {
    if (!conditionsHold(read.doc, rule.conditions)) continue;
    let dead = !matchesAny(read, rule, selectorForMatching(rule.selector));
    if (dead && hasStatePseudo(rule.selector)) {
      // A second chance, state-stripped: a `.card:hover` that matches
      // SOME element once hovered is not a rule that matches nothing.
      dead = !matchesAny(
        read,
        rule,
        selectorForMatching(stripStatePseudo(rule.selector)),
      );
    }
    if (!dead) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: "html",
      rule: rule.index,
      message: `rule ${ruleName(rule)} in viewport ${read.page.id} matches no element`,
    });
  }
}

// ---------------------------------------------------------------------------
// A container query with no container, asked of a rule's matched elements.

function lintContainerQueries(read: MountedPage, findings: Finding[]): void {
  // Each node's container declarations, gathered once and only when a
  // rule asks: its own style, then every rule matching it — under any
  // condition, state-stripped, and never through a pseudo-element member
  // (a pseudo-element is no element's ancestor).
  const gathered = new Map<Element, ContainerDeclaration>();
  const declarationOf = (node: Element): ContainerDeclaration => {
    let out = gathered.get(node);
    if (out !== undefined) return out;
    out = emptyContainerDeclaration();
    mergeContainerDeclaration(out, read.own.get(node) ?? []);
    for (const rule of read.rules) {
      if (!declaresContainer(rule.declarations)) continue;
      const selector = splitTopLevelCommas(stripStatePseudo(rule.selector))
        .filter((member) => trailingPseudoElement(member) === null)
        .join(", ");
      if (selector.trim() !== "" && read.match(node, selector, rule.scopes)) {
        mergeContainerDeclaration(out, rule.declarations);
      }
    }
    gathered.set(node, out);
    return out;
  };

  for (const rule of read.rules) {
    for (const condition of rule.conditions) {
      if (atKeyword(condition) !== "container") continue;
      const { name, condition: inner } = splitContainerPrelude(condition);
      const needs = queryNeeds(inner);
      if (!needs.size && !needs.scrollState) continue; // style()-only
      const matched = read.nodes.filter((node) =>
        read.match(node, selectorForMatching(rule.selector), rule.scopes),
      );
      // A rule matching no element is the dead-rule finding's to report.
      if (matched.length === 0) continue;
      let typed = false;
      let satisfied = false;
      for (const node of matched) {
        for (let a = node.parentElement; a !== null; a = a.parentElement) {
          const declared = declarationOf(a);
          if (satisfies(declared, needs, null)) typed = true;
          if (satisfies(declared, needs, name)) {
            satisfied = true;
            break;
          }
        }
        if (satisfied) break;
      }
      if (satisfied) continue;
      const reason = !typed
        ? needs.size
          ? "declares container-type"
          : "declares container-type: scroll-state"
        : `declares a container named \`${name}\``;
      findings.push({
        tier: "static",
        severity: "blocking",
        rule: rule.index,
        message: `container query \`${condition}\` in rule ${ruleName({ ...rule, conditions: [] })} of viewport ${read.page.id} can never match: no ancestor of an element it matches ${reason}`,
      });
    }
  }
}

function declaresContainer(declarations: readonly CssDeclaration[]): boolean {
  return declarations.some(
    (d) =>
      d.property === "container" ||
      d.property === "container-type" ||
      d.property === "container-name",
  );
}
