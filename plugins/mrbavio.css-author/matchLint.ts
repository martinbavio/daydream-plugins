// The MATCH-DEPENDENT static findings (decision #71, plan phase 9;
// wayfinder/tickets/T07-what-the-lints-judge.md): facts that are "static"
// in spirit — no removal, no re-read, judged once — but that need the
// browser to ask, since matching a selector against a page is the
// browser's job, never a hand-rolled one (decision #71, "MATCHING IS THE
// BROWSER'S"). staticLint.ts reads the texts alone; this file is the one
// seam of the static gate that mounts the page, kept small on purpose.
//
// WHY THIS FILE MOUNTS, AND NEVER READS `dd.pageRuleMatches` /
// `dd.pageStack` / `dd.geometry`: those reads answer about the CANVAS's
// own mounted pages, and a gate's viewport need not be rendered there —
// asked about a page that never was, every one of them reports empty (the
// eval bug of 2026-09-17: a plainly-matching `.card` rule refused because
// the gate read the wrong DOM). So each viewport's page is MOUNTED
// (the gate's `ctx.mountViewport`, the live face of the page the gate is
// judging — at a finalize the page about to be written: the page's own
// text in an iframe, each live sheet a `<style>` of its own) and every
// match is asked of that document through native `Element.matches`.
//
// The rules are the copy's sheets, in cascade order, each paired with the
// page's sheet it renders (pageSheets.ts `writtenRules`), so a finding
// carries the same `rule` number the static and necessity lints give it
// and names the rule as the page writes it, with the sheet it is in; a
// read-only sheet's rule is matched and ranked like any other, and never
// a finding's subject. A nested rule's selector is resolved against its
// parents the way the browser desugars nesting, and a rule inside an
// `@scope` matched from its scope's roots, within its limits
// (ruleMatch.ts) — never by `Element.matches` alone, which reads its
// `:scope` as the element asked.
// An element's own declarations are its `style` attribute, and it is
// named by its unique selector in the page's stored markup (pageDom.ts
// storedNames), not in the mounted copy.
//
// REDUNDANCY: an element's own declaration a matched rule that applies
// wherever it matches (certain.ts: under no `@media`, `@supports`,
// `@container` or `@starting-style`, in no state; a layer or a scope
// gates nothing) already sets with the identical value — the element's
// line does nothing a rule does not already do, so the finding names it
// as the one to remove. Sharing a value is not enough: the cascade
// decides what the element gets without its line (an `!important`
// elsewhere, a layer, a later rule), so the claim is MEASURED — the line
// cut from the copy, the element's computed style read, the line put
// back, as the necessity lint removes a declaration — and holds only when
// nothing changed. What the frame cannot show is refused outright: a rule
// reaching the element that touches the property and is not certain could
// win without the line at another width or in another state.
//
// AN EXPLICIT INITIAL VALUE (rule 2 of the static gate): a declaration
// restating its property's initial value (initialValues.ts) — an
// element's own, or a certain rule's — MEASURED the same way: the line
// cut, the element (or everything the rule styles, each pseudo-element
// read as `getComputedStyle(el, "::before")` reads it) read, and a
// finding only when nothing changed; a rule styling a pseudo-element the
// browser's computed style cannot read is never one. So an initial the UA
// sheet overrides (`<dialog open>`'s `position: absolute`, a popover's
// `inset: 0`, an `img`'s clipped overflow) or a rule sets is an override
// the page needs, never a redundant line; what the frame cannot show is
// refused the same way as a redundancy.
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
// query asks (containers.ts). An ancestor is one when the mounted copy
// computes it one (`container-type` and `container-name` as the cascade
// resolved them), or when its container declarations — gathered from its
// own style and every rule matching it under any condition — say it could
// be: generous, because a static lint must never flag a query the browser
// could match at some width.
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
// A SHEET SEVERAL PAGES LINK is one sheet: a rule finding is said once,
// and holds only where every judged viewport with a say finds it — for a
// dead rule, each one its conditions hold in (one page matching the rule
// acquits it: the INTERSECTION of the dead verdicts); for a restated
// initial, a restatement or a container query, each one the rule
// reaches an element in (what a rule does to what it styles is judged
// where it styles something, and a page it styles nothing in has no
// say: never a veto). A page the judged document does not show — every
// other page at a finalize, the rest under `lint {viewportIds}`, a page
// no viewport shows — was never mounted, so a finding about a rule of a
// sheet it links is advisory, naming it, and the dead rules of such a
// sheet are one advisory (pageSheets.ts `unjudgedLinks`).
//
// A selector member's trailing `::pseudo-element` has no element for
// `Element.matches` to test, so every match strips it first
// (pageCss.ts `trailingPseudoElement`) and keeps its name for the
// questions that need it: a pseudo-element match still answers the
// dead-rule question (a `.card::before` rule is not dead while `.card`
// exists), is skipped for an element's redundancy (a pseudo-element's box
// has no `style` attribute for a rule to restate), and is what a rule's
// measurement reads.

import type {
  CoreApi,
  CssDeclaration,
  DeepReadonly,
  DreamDocument,
  Finding,
} from "@daydream/plugin-api";

import { isCertain } from "./certain";
import {
  computedContainer,
  emptyContainerDeclaration,
  mergeContainerDeclaration,
  queryNeeds,
  satisfies,
  splitContainerPrelude,
  type ContainerDeclaration,
  type QueryNeeds,
} from "./containers";
import {
  atKeyword,
  declarationMap,
  ruleName,
  selectorForMatching,
  splitTopLevelCommas,
  trailingPseudoElement,
  type PageRule,
} from "./pageCss";
import { restatesInitial, ruleInitialCandidates } from "./initialValues";
import {
  lintElements,
  mountedStyles,
  storedNames,
} from "./pageDom";
import {
  conditionsHold,
  mountedSheets,
  readWithout,
  withMount,
  type MountContext,
  type MountedSheets,
  type SheetRange,
  type TextRange,
} from "./pageMount";
import {
  judgedPaths,
  listText,
  noteWith,
  readSheets,
  shownPages,
  unjudgedClause,
  unjudgedLinks,
  unjudgedNote,
  UNJUDGED_NAMED,
  viewportsText,
  type ProjectPaths,
  type Viewport,
  type WrittenRule,
} from "./pageSheets";
import { ruleMatcher, type RuleMatcher } from "./ruleMatch";
import {
  relatedProperties,
  ruleRestatements,
  type RedundancyRule,
} from "./ruleRedundancy";
import { hasStatePseudo, stripStatePseudo } from "./statePseudo";
import {
  goneClause,
  inlineValue,
  inRound,
  markupClause,
  siteClause,
  type SiteHow,
  type VariantRound,
} from "./variantRound";

/** One viewport's page mounted, read once: its elements in tree order,
 * each one's own declarations and unique selector, and the rules. */
interface MountedPage {
  viewport: Viewport;
  doc: Document;
  /** The copy's `<style>`s, which a measurement cuts from and restores
   * (`unchangedWithout`). */
  styles: HTMLStyleElement[];
  /** Every rule of the copy, in cascade order: `index` its position here,
   * the one the ranking and ruleRedundancy.ts read. */
  rules: PageRule[];
  /** Each rule, by index, as the page writes it: what a finding numbers,
   * names and may be about (pageSheets.ts). */
  written: WrittenRule[];
  nodes: Element[];
  own: Map<Element, CssDeclaration[]>;
  nameOf(node: Element): string;
  /** Matching in the copy, a rule's `@scope` included (ruleMatch.ts). */
  match: RuleMatcher;
  /** Each finding whose subject is a rule (`ruleFinding`): what it says
   * of which rule of which sheet, the same wherever the sheet is linked. */
  about: Map<Finding, RuleSubject>;
  /** The variant round this viewport is judged in (variantRound.ts), or
   * null: an element's own line the page already has is advisory there. */
  round: VariantRound | null;
}

/** What a rule finding says of which rule: the rule across pages (its
 * sheet's `sheetKey` and its place there), the finding's identity, which
 * viewports have a say in it (`Say`), and its sheet — its key and its
 * name — and its rule's name, for an advisory about pages not judged. */
interface RuleSubject {
  rule: string;
  id: string;
  say: Say;
  key: string;
  sheet: string;
  name: string;
  /** What the finding's sentence ends with to say what to do (`; remove
   * it from …`), or "": left out where the rule is the site's at a
   * variant's finalize, which the round never writes. */
  fix: string;
  /** The finding's `rule`: the rule's place among the page's rules. */
  index: number;
  /** A rule that matches no element, at a variant's finalize, that
   * matches one of the page's markup (`VariantRound.matchedOnPage`):
   * the variant's markup is what leaves it dead. */
  gone: boolean;
}

/** Which viewports have a say in a rule finding: `applies`, every one
 * where the rule's `@media` and `@supports` hold (a dead rule: one page
 * matching it acquits it); `reaches`, every one where it reaches an
 * element (a restated initial, a restatement, a container query: said of
 * what the rule styles, so a page it styles nothing in has nothing to
 * say, and never vetoes what the pages it styles find). */
type Say = "applies" | "reaches";

/** The rule across pages: its sheet's `sheetKey` and its place there. */
function ruleKey({ key, at }: WrittenRule): string {
  return `${key}\u0000${at}`;
}

/** Push a finding whose subject is the rule at `index` of the copy,
 * `what` saying what it finds of it (the kind and the declaration), so
 * the lint can tell the same finding in every page that links the rule's
 * sheet (`matchLint`). */
function ruleFinding(
  read: MountedPage,
  index: number,
  what: string,
  say: Say,
  finding: Finding,
  findings: Finding[],
  fix = "",
  gone = false,
): void {
  const written = read.written[index]!;
  const rule = ruleKey(written);
  const said = { ...finding, message: `${finding.message}${fix}` };
  read.about.set(said, {
    rule,
    id: `${rule}\u0000${what}`,
    say,
    key: written.key,
    sheet: written.sheet,
    name: ruleName(written.written),
    fix,
    index: written.rule,
    gone,
  });
  findings.push(said);
}

/** Every match-dependent static finding for the document, per viewport
 * in canvas order (a rule's once, below): explicit initial values (the elements' own in tree
 * order, then the rules'), redundancy (an element's, and a rule's against
 * the rule beneath it), dead rules, and a rule's container query with no
 * container. Each viewport's page (the gate's `ctx.page`) is mounted once
 * through the same context (`ctx.mountViewport`, pageMount.ts) — the
 * ranked matches are read once for every node and answer every question
 * here — and disposed before the next; a viewport whose page the context
 * does not hold is skipped (the static lint reports it).
 * A finding about a rule of a sheet several mounted pages link — a dead
 * rule, a restated initial, a restatement, a container query — holds
 * only when every viewport with a say in it finds it (`Say`: a rule one
 * page matches is not dead because another does not, and a line that
 * restates the initial wherever the rule styles an element is not
 * acquitted by a page it styles nothing in), and is said once, from the
 * first. One of a sheet a page the lint did not judge links too
 * (`project`, the project's pages; pageSheets.ts `unjudgedLinks`) is
 * advisory, naming those pages, and the dead rules of each such sheet
 * are one advisory, after the rest.
 * Empty when nothing in the mounted pages disagrees with their css. */
export async function matchLint(
  core: CoreApi,
  doc: DeepReadonly<DreamDocument>,
  ctx: MountContext,
  project: ProjectPaths = [],
  round: VariantRound | null = null,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  /** Each rule finding's identity → the viewports that found it; each
   * editable rule, by what gives a viewport a say (`Say`) → the
   * viewports that have one; the finding kept. */
  const found = new Map<string, number>();
  const says = new Map<string, number>();
  const kept = new Map<Finding, RuleSubject>();
  const { shown } = shownPages(core, doc, ctx.page);
  for (const { viewport, page } of shown) {
    // Every question here is about a rule or a restated initial, so a
    // page with neither has nothing to ask and pays for no mount.
    const stored = core.parsePage(page.html);
    const authored = readSheets(core, page);
    const restated = lintElements(stored).some((el) =>
      core.cssDeclarations(el.getAttribute("style") ?? "").some(restatesInitial),
    );
    if (authored.rules.length === 0 && !restated) continue;
    await withMount(ctx, viewport, undefined, async (mounted) => {
      const mdoc = mounted.document();
      const nodes = lintElements(mdoc);
      // The copy's own sheets, so a rule's values and an element's
      // `style` are compared as the copy holds both (pageDom.ts
      // mountedStyles), each paired with the page's sheet it renders.
      const sheets: MountedSheets = mountedSheets(
        core,
        page,
        authored,
        mountedStyles(mdoc),
      );
      const read: MountedPage = {
        viewport,
        doc: mdoc,
        ...sheets,
        nodes,
        own: new Map(
          nodes.map((node) => [
            node,
            core.cssDeclarations(node.getAttribute("style") ?? ""),
          ]),
        ),
        nameOf: storedNames(core, stored, mdoc),
        match: ruleMatcher(mdoc),
        about: new Map(),
        round: inRound(round, viewport) ? round : null,
      };
      const ranked = rankedMatches(core, read);
      const local: Finding[] = [];
      lintRestatedInitials(read, ranked, local);
      lintRedundancy(read, ranked, local);
      lintRuleRestatements(read, ranked, local);
      lintDeadRules(read, local);
      lintContainerQueries(read, local);
      const say = new Set<string>();
      for (const rule of read.rules) {
        if (!judgeable(read, rule.index)) continue;
        if (conditionsHold(mdoc, rule.conditions)) {
          say.add(`applies\u0000${ruleKey(read.written[rule.index]!)}`);
        }
      }
      for (const matches of ranked.values()) {
        for (const { index } of matches) {
          if (!judgeable(read, index)) continue;
          say.add(`reaches\u0000${ruleKey(read.written[index]!)}`);
        }
      }
      for (const key of say) says.set(key, (says.get(key) ?? 0) + 1);
      const ids = new Set<string>();
      for (const finding of local) {
        const about = read.about.get(finding);
        if (about === undefined) {
          findings.push(finding);
          continue;
        }
        if (ids.has(about.id)) continue;
        ids.add(about.id);
        const times = found.get(about.id) ?? 0;
        found.set(about.id, times + 1);
        if (times > 0) continue;
        kept.set(finding, about);
        findings.push(finding);
      }
    });
  }
  const held = findings.filter((finding) => {
    const about = kept.get(finding);
    return (
      about === undefined ||
      (found.get(about.id) ?? 0) >=
        (says.get(`${about.say}\u0000${about.rule}`) ?? 0)
    );
  });
  return unjudged(
    held,
    kept,
    unjudgedLinks(doc, ctx.page, project, judgedPaths(shown)),
    shown.map(({ viewport }) => viewport.id),
    round,
  );
}

/** Each held finding about a rule of a sheet a page not judged links too
 * (`outside`, pageSheets.ts `unjudgedLinks`) made advisory, naming those
 * pages; the dead rules among them — what the judged pages do not use
 * says nothing of a page that was not mounted — folded to one advisory
 * per sheet, after the rest (`unjudgedNote`), naming the viewports that
 * were judged (`viewports`). At a variant's finalize (`round`) a rule
 * the site keeps (variantRound.ts `siteOf`) is advisory the same way,
 * saying so instead and naming no fix (`siteClause`): the round never
 * writes it — but a dead one the page's markup has an element for, in a
 * sheet no page not judged links, is one advisory of its own, dead once
 * the variant is accepted (`goneClause`). */
function unjudged(
  held: readonly Finding[],
  kept: ReadonlyMap<Finding, RuleSubject>,
  outside: ReadonlyMap<string, string[]>,
  viewports: readonly string[],
  round: VariantRound | null,
): Finding[] {
  const out: Finding[] = [];
  const dead = new Map<
    string,
    { key: string; sheet: string; how: SiteHow | null; names: string[] }
  >();
  for (const finding of held) {
    const about = kept.get(finding);
    const how =
      about === undefined ? null : (round?.siteOf(about.key, about.index) ?? null);
    const pages = about === undefined ? undefined : outside.get(about.key);
    if (about === undefined || (how === null && pages === undefined)) {
      out.push(finding);
      continue;
    }
    const fact = finding.message.slice(0, finding.message.length - about.fix.length);
    if (about.id.endsWith("\u0000dead")) {
      // A rule the variant's markup leaves dead, in a sheet only the page
      // links: said on its own, as dead once the variant is accepted.
      if (how !== null && pages === undefined && about.gone) {
        out.push({
          ...finding,
          severity: "advisory",
          message: `${fact}${goneClause(round!, about.sheet)}`,
        });
        continue;
      }
      const fold = `${about.key}\u0000${how ?? ""}`;
      const entry = dead.get(fold) ?? { key: about.key, sheet: about.sheet, how, names: [] };
      entry.names.push(about.name);
      dead.set(fold, entry);
      continue;
    }
    out.push({
      ...finding,
      severity: "advisory",
      message:
        how !== null
          ? `${fact}${siteClause(round!, about.sheet, 1, how)}`
          : `${finding.message}${unjudgedClause(about.sheet, pages!)}`,
    });
  }
  for (const { key, sheet, how, names } of dead.values()) {
    const one = names.length === 1;
    const subject = `${one ? "rule" : "rules"} ${listText(names, UNJUDGED_NAMED)}`;
    const found = `${one ? "matches" : "match"} no element in ${viewportsText(viewports)}`;
    out.push(
      how !== null
        ? noteWith("static", sheet, subject, found, siteClause(round!, sheet, names.length, how))
        : unjudgedNote("static", sheet, subject, found, outside.get(key)!, names.length),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// How a finding names a rule: as the page writes it, in the sheet it is
// written in, and the viewport whose copy was read.

/** `\`.card\` of \`site.css\``: the rule at `index` as the page writes it,
 * and its sheet. */
function ruleOf(read: MountedPage, index: number): string {
  const written = read.written[index]!;
  return `${ruleName(written.written)} of ${written.sheet}`;
}

/** Whether a finding may be about the rule at `index`: never a read-only
 * sheet's (pageSheets.ts). */
function judgeable(read: MountedPage, index: number): boolean {
  return read.written[index]?.editable === true;
}

/** Each declaration's place in the copy's sheets, for a cut. */
function inSheet(
  rule: PageRule,
  declarations: readonly CssDeclaration[],
): SheetRange[] {
  return declarations.map((d) => ({ sheet: rule.sheet, range: d.range }));
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
 * every matching member ended in one. What it styles — the element's own
 * box (`box`), and each pseudo-element a matching member names
 * (`pseudos`) — is what a measurement reads (`targetsOf`). */
interface RuleMatch {
  index: number;
  pseudo?: string;
  specificity: [number, number, number];
  box: boolean;
  pseudos: string[];
}

/** Every rule matching `node`, winner-first: specificity descending, then
 * source order descending (a later rule wins ties). Each member of a
 * selector list is tried, since a rule may match through more than one
 * and the more specific one ranks it. A member with a state pseudo-class
 * matches as though the state were in effect (state-stripped): nobody
 * hovers the mount, but the redundancy questions must see the rule that
 * would win once somebody does — and never take it for a certain one
 * (certain.ts). Every condition is ignored the same way. */
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
    const pseudos = new Set<string>();
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
      else pseudos.add(trailing.pseudo);
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
      box: plain,
      pseudos: [...pseudos],
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
// What a measured line is weighed against: what a rule styles, and the
// rules styling it.

/** What a measurement reads: an element's own box (`pseudo` null), or
 * one of its pseudo-elements. */
interface Target {
  node: Element;
  pseudo: string | null;
}

/** The pseudo-elements the browser's computed style answers for — asked
 * of Chromium: a rule on any other (`::placeholder`, `::selection`, a
 * `::part()`) is read back as the element's own style, never its own. */
const MEASURED_PSEUDO: ReadonlySet<string> = new Set([
  "::before",
  "::after",
  "::marker",
  "::first-line",
  "::first-letter",
  "::backdrop",
]);

/** What rule `index` styles among the mounted nodes: each box and each
 * pseudo-element a member of it reaches — or null when one of those is a
 * pseudo-element the browser cannot measure, so no measurement can
 * speak for the rule. */
function targetsOf(
  read: MountedPage,
  ranked: ReadonlyMap<Element, readonly RuleMatch[]>,
  index: number,
): Target[] | null {
  const out: Target[] = [];
  for (const node of read.nodes) {
    const match = ranked.get(node)?.find((m) => m.index === index);
    if (match === undefined) continue;
    if (match.box) out.push({ node, pseudo: null });
    for (const pseudo of match.pseudos) {
      if (!MEASURED_PSEUDO.has(pseudo)) return null;
      out.push({ node, pseudo });
    }
  }
  return out;
}

/** The rules styling `target`, winner first: the element's own box, or
 * the one pseudo-element — a match on another box styles what the
 * target's line never reaches. */
function matchesOf(
  ranked: ReadonlyMap<Element, readonly RuleMatch[]>,
  target: Target,
): RuleMatch[] {
  return (ranked.get(target.node) ?? []).filter((match) =>
    target.pseudo === null ? match.box : match.pseudos.includes(target.pseudo),
  );
}

/** Whether one of `matched` could win without a line of `property` at
 * another width or in another state (it is not certain, certain.ts) and
 * touches the property: the frame cannot say the line changes nothing
 * there. */
function contested(
  read: MountedPage,
  matched: readonly RuleMatch[],
  property: string,
): boolean {
  return matched.some((match) => {
    const rule = read.rules[match.index];
    return (
      rule !== undefined &&
      !isCertain(rule) &&
      rule.declarations.some((d) => relatedProperties(property, d.property))
    );
  });
}

// ---------------------------------------------------------------------------
// An explicit initial value — a line the page would compute without.

function lintRestatedInitials(
  read: MountedPage,
  ranked: ReadonlyMap<Element, readonly RuleMatch[]>,
  findings: Finding[],
): void {
  for (const node of read.nodes) {
    const box: Target = { node, pseudo: null };
    const matched = matchesOf(ranked, box);
    for (const declaration of read.own.get(node) ?? []) {
      if (!restatesInitial(declaration)) continue;
      if (contested(read, matched, declaration.property)) continue;
      const cut = new Map([[node, [declaration.range]]]);
      if (!unchangedWithout(read, [], cut, [box])) continue;
      const selector = read.nameOf(node);
      const had =
        read.round?.hadStyle(selector, declaration.property, inlineValue(declaration)) ===
        true;
      const fact = `${declaration.property}: ${declaration.value} on \`${selector}\` restates the initial value`;
      findings.push({
        tier: "static",
        severity: had ? "advisory" : "blocking",
        elementId: selector,
        property: declaration.property,
        message: had ? `${fact}${markupClause(read.round!)}` : fact,
      });
    }
  }
  for (const { rule, declaration } of ruleInitialCandidates(read.rules)) {
    if (!judgeable(read, rule.index)) continue;
    // What the rule styles, its pseudo-elements included: a reset there
    // is read on the pseudo-element, never on the element beside it.
    const reached = targetsOf(read, ranked, rule.index);
    if (reached === null) continue;
    if (
      reached.some((target) =>
        contested(read, matchesOf(ranked, target), declaration.property),
      )
    ) {
      continue;
    }
    if (!unchangedWithout(read, inSheet(rule, [declaration]), new Map(), reached)) {
      continue;
    }
    ruleFinding(
      read,
      rule.index,
      `initial\u0000${declaration.property}\u0000${declaration.value}`,
      "reaches",
      {
        tier: "static",
        severity: "blocking",
        rule: read.written[rule.index]!.rule,
        property: declaration.property,
        message: `${declaration.property}: ${declaration.value} in rule ${ruleOf(read, rule.index)} in viewport ${read.viewport.id} restates the initial value`,
      },
      findings,
    );
  }
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
    const box: Target = { node, pseudo: null };
    const matched = matchesOf(ranked, box);
    if (own.length === 0 || matched.length === 0) continue;
    for (const [property, value] of Object.entries(declarationMap(own))) {
      // A rule that could win without the line at another width or in
      // another state: the frame cannot say the line is redundant there.
      if (contested(read, matched, property)) continue;
      // Winner first: the first matching rule that restates the
      // declaration is the one worth naming.
      for (const match of matched) {
        const rule = read.rules[match.index];
        // Only a rule that applies wherever the element is can restate
        // its line (certain.ts).
        if (rule === undefined || !isCertain(rule)) continue;
        if (maps[rule.index]?.[property] !== value) continue;
        // The cascade without the line may still pick another rule.
        const lines = allOf(own, property).map((d) => d.range);
        if (!unchangedWithout(read, [], new Map([[node, lines]]), [box])) {
          break;
        }
        const selector = read.nameOf(node);
        const had = read.round?.hadStyle(selector, property, value) === true;
        const fact = `${property}: ${value} on \`${selector}\` restates rule ${ruleOf(read, rule.index)}`;
        findings.push({
          tier: "static",
          severity: had ? "advisory" : "blocking",
          elementId: selector,
          property,
          rule: read.written[rule.index]!.rule,
          message: had
            ? `${fact}${markupClause(read.round!)}`
            : `${fact}; remove it from the element's style`,
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
    scopes: rule.scopes,
    styles: declarationMap(rule.declarations),
  }));
  for (const hit of ruleRestatements(sheet, ranked)) {
    const rule = read.rules[hit.rule];
    if (rule === undefined || !judgeable(read, hit.rule)) continue;
    // Measured: the rule's line cut from the copy, everything it styles
    // read against the page with it.
    const reached = targetsOf(read, ranked, hit.rule);
    if (reached === null) continue;
    const lines = inSheet(rule, allOf(rule.declarations, hit.property));
    if (!unchangedWithout(read, lines, new Map(), reached)) continue;
    const written = read.written[hit.rule]!;
    // A rule beneath is named with its sheet where that is another.
    const beneath = hit.restates
      .map((index) => read.written[index])
      .filter((r): r is WrittenRule => r !== undefined)
      .map((r) =>
        r.sheet === written.sheet
          ? ruleName(r.written)
          : `${ruleName(r.written)} of ${r.sheet}`,
      )
      .join(" and ");
    ruleFinding(
      read,
      hit.rule,
      `restates\u0000${hit.property}\u0000${hit.value}`,
      "reaches",
      {
        tier: "static",
        severity: "blocking",
        rule: written.rule,
        property: hit.property,
        message: `${hit.property}: ${hit.value} in rule ${ruleOf(read, hit.rule)} in viewport ${read.viewport.id} restates ${hit.restates.length === 1 ? "rule" : "rules"} ${beneath} for every element it reaches`,
      },
      findings,
      `; remove it from ${ruleName(written.written)}`,
    );
  }
}

function allOf(
  list: readonly CssDeclaration[],
  property: string,
): CssDeclaration[] {
  return list.filter((d) => d.property === property);
}

/**
 * Remove, read, restore — the necessity lint's measurement, through the
 * same helper (pageMount.ts readWithout), asked of what a redundancy is
 * about: whether every one of `targets` — an element's box or one of its
 * pseudo-elements — computes exactly what it did with the `css` ranges
 * (each in the copy's sheet it names) and the `inline` ranges cut. The
 * computed style decides a box and everything that inherits from it, so
 * a box computing the same is a page unchanged by the cut. Nothing to
 * read proves nothing: with no target, the answer is a change.
 */
function unchangedWithout(
  read: MountedPage,
  css: readonly SheetRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
  targets: readonly Target[],
): boolean {
  if (targets.length === 0) return false;
  const before = targets.map(computedOf);
  return readWithout(read.styles, css, inline, () =>
    targets.every((target, i) => computedOf(target) === before[i]),
  );
}

/** Every computed value of the box, custom properties included (a
 * restated `--x` is the element's own value), as one comparable string —
 * read through the copy's own window. */
function computedOf({ node, pseudo }: Target): string {
  const view = node.ownerDocument.defaultView ?? window;
  const style = view.getComputedStyle(node, pseudo);
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
    if (!judgeable(read, rule.index)) continue;
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
    const written = read.written[rule.index]!;
    ruleFinding(
      read,
      rule.index,
      "dead",
      "applies",
      {
        tier: "static",
        severity: "blocking",
        elementId: "html",
        rule: written.rule,
        message: `rule ${ruleOf(read, rule.index)} in viewport ${read.viewport.id} matches no element`,
      },
      findings,
      "",
      read.round?.matchedOnPage(written.written) === true,
    );
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
  // And what each node IS at the mounted width — the cascade's own
  // answer, `!important`, `var()` and `inherit` resolved — which the
  // declarations only add to: a type declared under a condition the
  // frame is not in is still a container at some width.
  const measured = new Map<Element, ContainerDeclaration>();
  const measuredOf = (node: Element): ContainerDeclaration => {
    let out = measured.get(node);
    if (out === undefined) {
      const style = (node.ownerDocument.defaultView ?? window).getComputedStyle(node);
      out = computedContainer(
        style.getPropertyValue("container-type"),
        style.getPropertyValue("container-name"),
      );
      measured.set(node, out);
    }
    return out;
  };
  const answers = (
    node: Element,
    needs: QueryNeeds,
    name: string | null,
  ): boolean =>
    satisfies(measuredOf(node), needs, name) ||
    satisfies(declarationOf(node), needs, name);

  for (const rule of read.rules) {
    if (!judgeable(read, rule.index)) continue;
    const written = read.written[rule.index]!;
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
          if (answers(a, needs, null)) typed = true;
          if (answers(a, needs, name)) {
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
      ruleFinding(read, rule.index, `container\u0000${condition}`, "reaches", {
        tier: "static",
        severity: "blocking",
        rule: written.rule,
        message: `container query \`${condition}\` in rule ${ruleName({ ...written.written, conditions: [] })} of ${written.sheet} in viewport ${read.viewport.id} can never match: no ancestor of an element it matches ${reason}`,
      }, findings);
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
