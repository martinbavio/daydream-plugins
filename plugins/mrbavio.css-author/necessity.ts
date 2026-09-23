// The NECESSITY lint (docs/agent-css-knowledge-prd.md, "Lints"; decision
// #43, #46, #48 P9): per declaration, remove it in-page, re-read, restore —
// and call it DEAD when nothing observable moved. "Observable" is the
// browser's own answer twice over: every element's border box and its
// computed style, both read from the live-strategy iframe core mounts
// (`dd.mountViewport`). No layout is reimplemented and no rule of thumb
// decides what a property "should" do: a declaration is live exactly when
// the page differs without it. Core owns the mount; this file owns the
// JUDGEMENT — which is why it lives in the css-author plugin and not in
// the kernel.
//
// A PAGE (decision #76) is text, so a declaration is removed from the
// TEXT: the mount is the caller's alone and nothing done to it is stored
// (`MountedViewport.document()`), so the page's `<style>` in the mounted
// copy has the declaration cut out of it — exactly the characters the
// author wrote, found by the scanner (pageCss.ts) — and is put back after
// the read; an element's own declaration is cut from its `style`
// attribute the same way. The browser parses what is left, so the answer
// is the page without that line, whatever the line was: a shorthand, a
// fallback, a declaration the parser drops, a custom property. One
// preparation keeps that honest: the page's top-level `@font-face` rules
// are moved to a `<style>` of their own before the baseline, since
// re-parsing a sheet that declares a face reloads it, and a face still
// loading reads as a changed page. The kernel's container probes in the
// mounted css are the measurer's, not the page's, and the scanner leaves
// them out.
//
// What that catches is the "just in case" class of failure: explicit
// initial values, a custom property nothing reads, a declaration the
// parser dropped, a container query no swept width lets match. What it
// deliberately does not judge: interaction-state properties (transition*,
// animation*) and `cursor`, exempt by the PRD's rule; a rule under a state
// pseudo-class, since nobody hovers a lint run; a rule under
// `@starting-style`, which styles only the moment before an element's
// first style; a rule under an `@media` or `@supports` that holds neither
// at the frame nor at any swept width (`@media print`, a height or a
// preference the window never has), which no read of the lint can see
// apply; a rule whose selector the browser refuses (the static gate's dead
// rule says so); and a vendor-prefixed property this browser does not
// know, which is another engine's. Two declarations of one property in
// one block are ONE judgement, named by the last: the earlier is a
// fallback (`height: 100vh; height: 100dvh`), and where this browser takes
// both to the same value, either alone would read dead.
//
// An IMAGE THE COPY COULD NOT LOAD (an `img` complete with natural width
// 0) is not the page's image: Chrome lays a broken image out as its alt
// text and ignores the width and height asked of it, so `width: 100%` on
// it would read dead when the loaded image needs it. Its sizing and
// `object-*` declarations — its own, and a rule's that reaches it — are
// not judged (they count as live), and the lint says so once per
// viewport, as an advisory finding naming the images.
//
// Motion is neutralised in the LINT copy only (`still: true` on the
// mount): a `transition: all 200ms` would otherwise make every
// remove→read→restore (synchronous, so the computed value is still the
// start value) read dead for colours, paddings, gaps, radii.
//
// Three rules keep a CORRECT responsive page landable (the PRD's "dead
// means no change in any viewport of the document"):
//
// 1. PAIRED CHECK. A rule's declaration of P is judged TOGETHER with P in
//    every conditional branch of the same selector — a rule of that
//    selector under further at-rules (`.card { @media (…) { … } }`, or an
//    `@media` block of its own holding the same selector) — one combined
//    removal, one read, one restore, and is dead only if that changes
//    nothing. (Removed alone, a base that a matching `@supports` or
//    `@container` branch overrides at every width would read dead.) Each
//    branch's declaration is still judged on its own. The same pairing
//    joins a rule's declaration with the elements it matches that set P
//    in their own style (the inline copy would hide the rule's), and an
//    element's own declaration with the unconditional rules restating it
//    verbatim (that shape is matchLint.ts's redundancy finding).
// 2. WIDTH SWEEP (#46). A page is not a photo: `minmax(0, 1fr)`, a
//    `flex-wrap`, a rule for a breakpoint the frame is not at, all change
//    nothing at THIS width and everything at another. So a declaration
//    that reads dead at the viewport's own frame is judged again with the
//    same window at a sweep of other widths — the fixed SWEEP_WIDTHS plus
//    every px breakpoint the page's `@media` preludes name, with one px
//    either side of each — and is dead only if it changes nothing at
//    every one of them. The frame is judged first and in full; the probes
//    re-judge only the survivors, so a clean page (the common landing)
//    never mounts a probe at all. The finding names every width it was
//    dead at. This only ever ACQUITS — and a rule whose `@media` or
//    `@supports` held at none of those widths is not judged at all: the
//    sweep reads width, and cannot make a window print or grow taller.
// 3. CROSS-VIEWPORT INTERSECTION. With several viewports, a declaration is
//    dead only if it is dead in EVERY viewport where it exists (and
//    applies: a rule not judged in one viewport has no say there). An
//    element's own declaration corresponds by the element's unique
//    selector and the property; a rule's by its selector as written, the
//    rules it is nested in, its at-rules and its occurrence among rules of
//    that shape — never by its index, which is a position in one page. A
//    finding names the declaration as it appears in the first viewport.
//
// Cost model: one write, one read, one restore per declaration, where the
// read walks every element and stops at the first difference — so LIVE
// declarations (the common case) exit early and only dead ones pay a full
// sweep, and only dead ones are carried into the probe mounts. A rule's
// removal re-parses the page's css, which is cheap beside the read.
// Computed style is snapshotted as the FULL getComputedStyle enumeration
// minus custom properties (see snapshotProperties for why).

import type {
  CoreApi,
  DreamDocument,
  DreamPage,
  Finding,
  MountedViewport,
} from "@daydream/plugin-api";

import {
  atKeyword,
  mediaPreludes,
  pageRules,
  ruleName,
  scanCss,
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
import { ruleMatcher } from "./ruleMatch";
import { hasStatePseudo } from "./statePseudo";

/** What the lint needs from the API object: the pure helpers and the
 * live mount (pageMount.ts). */
export type NecessityHost = MountHost;

export interface NecessityOptions {
  /** Restrict to these viewports (unknown id → error). Default: all. */
  viewportIds?: string[];
}

/** The widths every viewport's dead-at-the-frame declarations are re-judged
 * at (rule 2), besides the breakpoints its own `@media` rules name: a
 * phone, a tablet, a laptop and a wide desktop. A declaration that matters
 * only in a band between these, at a width no condition names, is the
 * residual — add a viewport there. */
export const SWEEP_WIDTHS: readonly number[] = [360, 768, 1280, 1920];

/** Properties the lint never checks — the PRD's exemption, exactly:
 * interaction-state properties (transition*, animation*) and `cursor`.
 * Transitions and animations could never read live anyway: the lint copy
 * neutralises motion (the mount's `still`). Prefix matches cover the
 * longhands and vendor prefixes (`transition-delay`, `-webkit-animation`). */
const EXEMPT_PREFIX = /^(?:-[a-z]+-)?(?:transition|animation)/i;

export function isExemptProperty(property: string): boolean {
  const name = property.trim().toLowerCase();
  if (EXEMPT_PREFIX.test(name)) return true;
  return name.replace(/^-[a-z]+-/, "") === "cursor";
}

/**
 * Every dead declaration of the document, as findings — dead at every
 * swept width (rule 2) in every viewport where it exists (rule 3). Each
 * viewport is mounted once at its frame (one iframe), baselined, then
 * every element's own declarations and every rule's are removed, read
 * against the baseline and restored, in that order; the survivors are then
 * re-judged at each probe width in a fresh mount. Every iframe is
 * disposed, a thrown read included. After the dead declarations, one
 * advisory finding per viewport whose copy could not load an image.
 * Browser only.
 */
export async function necessityLint(
  dd: NecessityHost,
  doc: DreamDocument,
  options: NecessityOptions = {},
): Promise<Finding[]> {
  const perViewport: Candidate[][] = [];
  const notes: Finding[] = [];
  for (const page of selectViewports(dd.core, doc, options.viewportIds)) {
    const judged = await lintViewport(dd, page);
    perViewport.push(judged.candidates);
    notes.push(...judged.notes);
  }
  return [...intersect(perViewport), ...notes];
}

/** The document's viewports, or the named subset in document order. An
 * unknown id is an error, not a silent skip — the same rule as core's
 * measure. */
function selectViewports(
  core: CoreApi,
  doc: DreamDocument,
  viewportIds: string[] | undefined,
): DreamPage[] {
  const viewports = core.viewportItems(doc) as DreamPage[];
  if (viewportIds === undefined) return viewports;
  const wanted = new Set(viewportIds);
  const known = new Set(viewports.map((vp) => vp.id));
  const unknown = viewportIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`No such viewport: ${unknown.join(", ")}`);
  }
  return viewports.filter((vp) => wanted.has(vp.id));
}

/** Where a declaration is: an element's own (`node`, its position among
 * the page's elements) or a rule's (`rule`, its index), and its position
 * among that list's declarations. Positions, not objects, so the same
 * removal addresses every mount of the page (rule 2). */
type At = { node: number; at: number } | { rule: number; at: number };

/** One declaration's judgement in one viewport. */
interface Candidate {
  /** Correspondence across viewports (rule 3). */
  key: string;
  /** An element's own declaration, or a rule's: kept apart in the output
   * (elements first), as the finding's address differs. */
  element: boolean;
  property: string;
  value: string;
  /** What is removed together (rule 1), the declaration itself first. */
  removal: At[];
  /** Whether the declaration's own conditions held in some mount so far
   * (`conditionsHold`) — always, for an element's own. One that never
   * holds at the frame nor at any swept width is not judged here. */
  applies: boolean;
  dead: boolean;
  finding: Finding;
}

/** A mounted page prepared for removals. */
interface Prepared {
  doc: Document;
  /** The page's `<style>` in the copy, or null when there is none. Its
   * text once prepared is what every removal is cut from and every
   * restore puts back (pageMount.ts readWithout). */
  style: HTMLStyleElement | null;
  rules: PageRule[];
  nodes: Element[];
  /** Each node's declarations, from its `style` attribute. */
  own: { declarations: CssDeclaration[] }[];
}

/** The viewport at its frame, every declaration judged; then the sweep
 * (rule 2) over whatever read dead, each probe width a fresh mount of the
 * same window at that width. A finding that survives names every width.
 * `notes` is the advisory on the images the copy could not load. */
async function lintViewport(
  dd: NecessityHost,
  page: DreamPage,
): Promise<{ candidates: Candidate[]; notes: Finding[] }> {
  // The page as stored (its markup's `<style>` blocks folded in, as the
  // mount folds them), for naming: the mounted copy's css has the asset
  // route in its urls, and a finding should quote what the author wrote;
  // an element is named by its selector in the stored markup.
  const stored = parsePage(page.payload);
  const { css } = stored;
  const authored = pageRules(css);
  const { own, naming, candidates, unloaded } = await withMount(dd, page, undefined, async (m) => {
    const prepared = await prepare(m);
    const nameOf = storedNames(stored.doc, prepared.doc);
    const width = prepared.doc.defaultView?.innerWidth ?? page.frame?.width ?? 0;
    // The two scans line up rule for rule unless the mounted copy is not
    // this text (it always is, cleaned as a landing cleans it); if they
    // do not, the copy's own text names the rules.
    const aligned =
      authored.length === prepared.rules.length &&
      authored.every(
        (rule, i) =>
          rule.prelude === prepared.rules[i]!.prelude &&
          rule.declarations.length === prepared.rules[i]!.declarations.length,
      );
    const naming = aligned ? authored : prepared.rules;
    return {
      own: width,
      naming,
      candidates: judgeAll(page, prepared, naming, width, nameOf),
      unloaded: prepared.nodes.filter(isUnloadedImage).map(nameOf),
    };
  });
  let pending = candidates.filter((c) => c.dead);
  const swept = [own];
  for (const width of probeWidths(dd.core, css, own)) {
    if (pending.length === 0) break;
    await withMount(dd, page, width, async (m) => {
      const prepared = await prepare(m);
      const probe = baseline(prepared);
      for (const c of pending) {
        c.applies ||= appliesIn(prepared, c.removal[0]!);
        c.dead = isDead(prepared, probe, c.removal);
      }
    });
    swept.push(width);
    pending = pending.filter((c) => c.dead);
  }
  for (const c of pending) c.finding = findingFor(page, c, swept, naming);
  // A declaration whose conditions held nowhere it was read is not judged
  // in this viewport: it does not exist here for rule 3 either.
  return {
    candidates: candidates.filter((c) => c.applies || !c.dead),
    notes: unloaded.length === 0 ? [] : [unloadedNote(page, unloaded)],
  };
}

/**
 * Whether the conditions of the declaration at `where` hold in the
 * mounted copy; an element's own always do. The mounted window's answer,
 * the one the static gate's match lint reads too (pageMount.ts
 * conditionsHold). A rule under one that holds neither at the frame nor
 * at any swept width — `@media print`, a height or a preference the
 * window never has, a feature this browser lacks — is not the page's at
 * any width the lint can read, so it is not judged (the width sweep can
 * acquit a rule for a width the frame is not at; it cannot make a window
 * print). An `@container` is left to the removal itself: its query is a
 * container's size, which the sweep varies, and a rule no swept width
 * lets it match is dead. `@starting-style` is never judged
 * (`isStartingStyle`).
 */
function appliesIn(prepared: Prepared, where: At): boolean {
  if (!("rule" in where)) return true;
  const rule = prepared.rules[where.rule];
  return rule === undefined || conditionsHold(prepared.doc, rule.conditions);
}

/** Whether a rule sits under `@starting-style`: its declarations style an
 * element only before its first style change, the start of a transition
 * into the page. No remove-and-read sees that moment — the copy is past
 * it, and pins motion off — so they are never judged, like the
 * transitions they start. */
function isStartingStyle(rule: Pick<PageRule, "conditions">): boolean {
  return rule.conditions.some(
    (condition) => atKeyword(condition) === "starting-style",
  );
}

/** Read the mounted copy once and move its top-level `@font-face` rules
 * to a `<style>` of their own (see the header), waiting for the faces to
 * load again. The rest of the css keeps every offset: each moved face's
 * characters become spaces. */
async function prepare(mounted: MountedViewport): Promise<Prepared> {
  const doc = mounted.document();
  const style = mountedStyle(doc);
  let base = style?.textContent ?? "";
  const faces = scanCss(base).filter(
    (block) => !block.statement && atKeyword(block.prelude) === "font-face",
  );
  if (style !== null && faces.length > 0) {
    const fonts = doc.createElement("style");
    fonts.setAttribute("data-css-author", "fonts");
    fonts.textContent = faces
      .map((face) => base.slice(face.range[0], face.range[1]))
      .join("\n");
    style.before(fonts);
    for (const face of faces) {
      const [start, end] = face.range;
      base = base.slice(0, start) + " ".repeat(end - start) + base.slice(end);
    }
    style.textContent = base;
    // A face loads when text first uses it: lay the page out, then wait.
    doc.documentElement.getBoundingClientRect();
    await doc.fonts.ready;
  }
  const nodes = lintElements(doc);
  return {
    doc,
    style,
    rules: pageRules(base),
    nodes,
    own: nodes.map((node) => ({
      declarations: scanDeclarations(node.getAttribute("style") ?? ""),
    })),
  };
}

/**
 * The widths rule 2 sweeps for a page rendered at `own`, ascending,
 * without `own` itself: SWEEP_WIDTHS plus one px either side of every px
 * breakpoint its css's `@media` preludes name (`(width >= 900px)` flips
 * between 899 and 900, `(width > 900px)` between 900 and 901, so all three
 * are probed). Container conditions name a container's width, not the
 * window's, and contribute nothing; em/rem breakpoints convert at the
 * initial font size.
 */
export function probeWidths(core: CoreApi, css: string, own: number): number[] {
  const widths = new Set<number>(SWEEP_WIDTHS);
  for (const prelude of mediaPreludes(css)) {
    for (const px of core.mediaPreludePxValues(prelude)) {
      widths.add(px - 1);
      widths.add(px);
      widths.add(px + 1);
    }
  }
  widths.delete(own);
  return Array.from(widths)
    .filter((width) => width >= 1)
    .sort((a, b) => a - b);
}

/** Every checked declaration of the page judged once at the mounted
 * width: the elements' own in tree order, then the rules' in source
 * order. The finding each carries is provisional — named for the frame
 * alone — and is rewritten with the swept widths for the ones that stay
 * dead. A declaration on an image the copy could not load that a loaded
 * one would answer (`isImageSizing`) is recorded live, unjudged. */
function judgeAll(
  page: DreamPage,
  prepared: Prepared,
  authored: readonly PageRule[],
  own: number,
  nameOf: (node: Element) => string,
): Candidate[] {
  const probe = baseline(prepared);
  const { rules, nodes } = prepared;
  const nameAt = (node: number): string => nameOf(nodes[node]!);
  const unloaded = nodes.map(isUnloadedImage);
  // Which elements each rule reaches through a member that styles the
  // element itself (never only its pseudo-element), read once, a rule
  // inside an `@scope` from its scope's roots (ruleMatch.ts).
  const match = ruleMatcher(prepared.doc);
  const reached = rules.map((rule) => {
    const selector = plainMembers(rule.selector);
    return selector === ""
      ? []
      : nodes.flatMap((node, index) =>
          match(node, selector, rule.scopes) ? [index] : [],
        );
  });
  const candidates: Candidate[] = [];
  const record = (
    key: string,
    element: boolean,
    declaration: CssDeclaration,
    removal: At[],
    unjudged: boolean,
  ): void => {
    const candidate: Candidate = {
      key,
      element,
      property: declaration.property,
      value: shown(declaration),
      removal,
      applies: appliesIn(prepared, removal[0]!),
      dead: !unjudged && isDead(prepared, probe, removal),
      finding: { tier: "necessity", severity: "blocking", message: "" },
    };
    candidate.finding = findingFor(page, candidate, [own], authored, nameAt);
    candidates.push(candidate);
  };

  // An element's own declarations, paired with the unconditional rules
  // that restate them verbatim (rule 1, mirrored from redundancy).
  prepared.own.forEach(({ declarations }, node) => {
    declarations.forEach((declaration, at) => {
      if (!isChecked(declaration, declarations, at)) return;
      const removal: At[] = [
        { node, at },
        ...fallbacks(declarations, at, (k) => ({ node, at: k })),
      ];
      rules.forEach((rule, r) => {
        if (rule.conditions.length > 0 || hasStatePseudo(rule.selector)) return;
        if (!reached[r]!.includes(node)) return;
        const last = lastOf(rule.declarations, declaration.property);
        if (last === -1) return;
        if (shown(rule.declarations[last]!) !== shown(declaration)) return;
        for (const k of allOf(rule.declarations, declaration.property)) {
          removal.push({ rule: r, at: k });
        }
      });
      record(
        `${nameAt(node)}\u0000${declaration.property}`,
        true,
        declaration,
        removal,
        unloaded[node]! && isImageSizing(declaration.property),
      );
    });
  });

  // The rules' declarations, paired with their conditional branches and
  // the elements shadowing them in their own style (rule 1).
  const occurrences = new Map<string, number>();
  rules.forEach((rule, r) => {
    const shape = `${[...rule.parents, rule.prelude].join(" › ")}\u0000${rule.conditions.join("\u0000")}`;
    const occurrence = occurrences.get(shape) ?? 0;
    occurrences.set(shape, occurrence + 1);
    if (hasStatePseudo(rule.selector) || isStartingStyle(rule)) return;
    // A selector the browser refuses styles nothing: that rule is the
    // static gate's dead rule, and every line of it would only repeat it.
    if (refused(prepared.doc, rule.selector)) return;
    const branches = rules.flatMap((other, b) =>
      other.selector === rule.selector &&
      other.conditions.length > rule.conditions.length &&
      rule.conditions.every((c, i) => other.conditions[i] === c)
        ? [b]
        : [],
    );
    rule.declarations.forEach((declaration, at) => {
      if (!isChecked(declaration, rule.declarations, at)) return;
      const removal: At[] = [
        { rule: r, at },
        ...fallbacks(rule.declarations, at, (k) => ({ rule: r, at: k })),
      ];
      for (const b of branches) {
        for (const k of allOf(rules[b]!.declarations, declaration.property)) {
          removal.push({ rule: b, at: k });
        }
      }
      for (const node of reached[r]!) {
        const list = prepared.own[node]!.declarations;
        for (const k of allOf(list, declaration.property)) {
          removal.push({ node, at: k });
        }
      }
      record(
        `\u0001${shape}\u0000${occurrence}\u0000${declaration.property}`,
        false,
        declaration,
        removal,
        isImageSizing(declaration.property) &&
          reached[r]!.some((node) => unloaded[node]),
      );
    });
  });
  return candidates;
}

/** The earlier declarations of the same property in the same block as
 * `list[at]` — its fallbacks, judged with it (`height: 100vh; height:
 * 100dvh` is one decision; where the two agree, either alone reads dead). */
function fallbacks(
  list: readonly CssDeclaration[],
  at: number,
  where: (k: number) => At,
): At[] {
  const property = list[at]!.property;
  return allOf(list, property)
    .filter((k) => k < at)
    .map(where);
}

/** A declaration the lint judges: not exempt, not another engine's
 * prefixed property, and the LAST of its property in its own block — an
 * earlier one is a fallback, judged together with the last (`fallbacks`). */
function isChecked(
  declaration: CssDeclaration,
  list: readonly CssDeclaration[],
  at: number,
): boolean {
  const { property } = declaration;
  if (isExemptProperty(property)) return false;
  if (/^-[a-z]/i.test(property) && !CSS.supports(property, "inherit")) {
    return false;
  }
  return lastOf(list, property) === at;
}

/** An image the copy could not load: an `img` done loading with no
 * natural width. Chrome lays it out as its alt text, so what sizes or
 * fits the image is not what it would do to the loaded one. */
function isUnloadedImage(node: Element): boolean {
  if (node.localName !== "img") return false;
  const img = node as HTMLImageElement;
  return img.complete && img.naturalWidth === 0;
}

/** What a broken image ignores and a loaded one answers: its box's size
 * and how its content fits the box (`object-*`). */
const IMAGE_SIZING =
  /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio|object-[a-z-]+)$/;

function isImageSizing(property: string): boolean {
  return IMAGE_SIZING.test(property.trim().toLowerCase());
}

/** How many of the unloaded images the advisory names; the rest it counts. */
const UNLOADED_NAMED = 3;

/** The one advisory for a viewport whose copy could not load images: what
 * the lint left unjudged, and on which images. */
function unloadedNote(page: DreamPage, names: readonly string[]): Finding {
  const one = names.length === 1;
  const rest = names.length - UNLOADED_NAMED;
  const images =
    names
      .slice(0, UNLOADED_NAMED)
      .map((name) => `\`${name}\``)
      .join(", ") + (rest > 0 ? ` and ${rest} more` : "");
  return {
    tier: "necessity",
    severity: "advisory",
    message: `${one ? "An image" : `${names.length} images`} could not be loaded in the necessity lint's copy of viewport ${page.id} (${images}), so ${one ? "its" : "their"} sizing and object-* declarations were not judged`,
  };
}

function lastOf(list: readonly CssDeclaration[], property: string): number {
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k]!.property === property) return k;
  }
  return -1;
}

function allOf(list: readonly CssDeclaration[], property: string): number[] {
  return list.flatMap((d, k) => (d.property === property ? [k] : []));
}

/** A declaration's value as a finding quotes it. */
function shown(declaration: CssDeclaration): string {
  return declaration.important
    ? `${declaration.value} !important`
    : declaration.value;
}

/** The selector list's members that style an element itself — every
 * member ending in a pseudo-element dropped — or "" when none does. */
function plainMembers(selector: string): string {
  return splitTopLevelCommas(selector)
    .filter((member) => trailingPseudoElement(member) === null)
    .map((member) => member.trim())
    .join(", ");
}

function refused(doc: Document, selector: string): boolean {
  try {
    doc.querySelector(selectorForMatching(selector));
    return false;
  } catch {
    return true;
  }
}

/** Remove, read, restore (pageMount.ts readWithout): the declarations
 * cut from the page's css and from their elements' `style` in one write,
 * one read, then everything put back as it was. The read is a single
 * sweep that stops at the first element whose observation left the
 * baseline. */
function isDead(prepared: Prepared, probe: Probe, removal: readonly At[]): boolean {
  const cssRanges: TextRange[] = [];
  const inline = new Map<Element, TextRange[]>();
  for (const where of removal) {
    if ("rule" in where) {
      const declaration = prepared.rules[where.rule]?.declarations[where.at];
      if (declaration !== undefined) cssRanges.push(declaration.range);
    } else {
      const declaration = prepared.own[where.node]?.declarations[where.at];
      const node = prepared.nodes[where.node];
      if (declaration === undefined || node === undefined) continue;
      const ranges = inline.get(node) ?? [];
      ranges.push(declaration.range);
      inline.set(node, ranges);
    }
  }
  return readWithout(prepared.style, cssRanges, inline, () => unchanged(probe));
}

/** Rule 3: dead only where dead everywhere the declaration exists. Order
 * is first appearance — the first viewport's order, then whatever later
 * viewports add — elements' own before rules', and the finding is the
 * first viewport's. */
function intersect(perViewport: readonly Candidate[][]): Finding[] {
  const merged = new Map<string, { dead: boolean; element: boolean; finding: Finding }>();
  for (const candidates of perViewport) {
    for (const c of candidates) {
      const seen = merged.get(c.key);
      if (seen === undefined) {
        merged.set(c.key, { dead: c.dead, element: c.element, finding: c.finding });
      } else {
        seen.dead = seen.dead && c.dead;
      }
    }
  }
  const entries = [...merged.values()].filter((entry) => entry.dead);
  return [
    ...entries.filter((entry) => entry.element),
    ...entries.filter((entry) => !entry.element),
  ].map((entry) => entry.finding);
}

/** The finding's sentence names every width the declaration was dead at,
 * ascending — the fact is "changes nothing at any of these", never
 * "changes nothing". An element's own declaration is addressed by the
 * element's unique selector; a rule's by the rule's index among the page's
 * rules (`Finding.rule`), and named by its selector as written. */
function findingFor(
  page: DreamPage,
  c: Candidate,
  widths: number[],
  authored: readonly PageRule[],
  nameAt?: (node: number) => string,
): Finding {
  const first = c.removal[0] as At;
  if ("node" in first) {
    const selector = nameAt?.(first.node) ?? c.finding.elementId ?? "";
    return {
      tier: "necessity",
      severity: "blocking",
      elementId: selector,
      property: c.property,
      message: `${c.property}: ${c.value} on \`${selector}\` changes nothing at ${widthsText(widths)}`,
    };
  }
  const rule = authored[first.rule];
  const declaration = rule?.declarations[first.at];
  const value =
    declaration !== undefined && declaration.property === c.property
      ? shown(declaration)
      : c.value;
  const name =
    rule === undefined ? `#${first.rule}` : ruleName(rule);
  return {
    tier: "necessity",
    severity: "blocking",
    rule: first.rule,
    property: c.property,
    message: `${c.property}: ${value} in rule ${name} of viewport ${page.id} changes nothing at ${widthsText(widths)}`,
  };
}

/** `360, 400, 768, 1280 or 1920px`; one width is `400px`. */
export function widthsText(widths: readonly number[]): string {
  const sorted = Array.from(new Set(widths)).sort((a, b) => a - b);
  if (sorted.length === 1) return `${sorted[0]}px`;
  const head = sorted.slice(0, -1).join(", ");
  return `${head} or ${sorted[sorted.length - 1]}px`;
}

// ---------------------------------------------------------------------------
// Observation.

/** One element's observation: its border box (to 0.01px) and its computed
 * style, as one comparable string. */
type Observation = string;

interface Probe {
  nodes: readonly Element[];
  /** The computed-style property names the snapshot reads, fixed once. */
  properties: string[];
  /** Pseudo-elements also snapshotted per node — empty unless a rule
   * names one, so a page with none pays nothing for this. */
  pseudoElements: readonly string[];
  baseline: Observation[];
}

/** The page as it stands, before any removal. The node list and the
 * property list are fixed here: removals never add or drop elements, and
 * the set of standard longhands the engine enumerates is the same for every
 * element, so both are read once. */
function baseline(prepared: Prepared): Probe {
  const { nodes } = prepared;
  const first = nodes[0];
  const properties =
    first === undefined ? [] : snapshotProperties(computedStyleOf(first));
  const pseudoElements = pseudoElementsIn(prepared.rules);
  return {
    nodes,
    properties,
    pseudoElements,
    baseline: nodes.map((node) => observe(node, properties, pseudoElements)),
  };
}

function unchanged(probe: Probe): boolean {
  for (let i = 0; i < probe.nodes.length; i++) {
    if (
      observe(probe.nodes[i] as Element, probe.properties, probe.pseudoElements) !==
      probe.baseline[i]
    ) {
      return false;
    }
  }
  return true;
}

/** Border box to 0.01px, every snapshotted computed value, then — per
 * pseudo-element a rule names — the SAME property set read from
 * `getComputedStyle(node, pseudo)`, no rect (a pseudo-element has none of
 * its own to read): a `::before` rule's declaration is otherwise
 * invisible to this lint. */
function observe(
  node: Element,
  properties: readonly string[],
  pseudoElements: readonly string[],
): Observation {
  const rect = node.getBoundingClientRect();
  const style = computedStyleOf(node);
  let out = `${hundredths(rect.left)},${hundredths(rect.top)},${hundredths(rect.width)},${hundredths(rect.height)}`;
  for (const property of properties) {
    out += `|${style.getPropertyValue(property)}`;
  }
  for (const pseudo of pseudoElements) {
    const pseudoStyle = computedStyleOf(node, pseudo);
    for (const property of properties) {
      out += `|${pseudo}:${property}=${pseudoStyle.getPropertyValue(property)}`;
    }
  }
  return out;
}

function hundredths(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The property names one observation reads: the engine's full computed
 * style enumeration MINUS custom properties. A custom property's own
 * computed value on its element vanishes the moment it is removed, so
 * including it would make every `--x` live by definition; excluded, `--x`
 * is live exactly when some `var(--x)` resolved differently without it —
 * which is what "an unread custom property is dead" means. (The
 * measurer's container probes drop out the same way.)
 */
function snapshotProperties(style: CSSStyleDeclaration): string[] {
  return Array.from(style).filter((name) => !name.startsWith("--"));
}

/** The pseudo-elements the page's rules need baselined: every trailing
 * one a selector names, plus `::before` and `::after` once any is named.
 * Empty when none is: a page with no pseudo-element rule pays nothing. */
function pseudoElementsIn(rules: readonly PageRule[]): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    for (const member of splitTopLevelCommas(rule.selector)) {
      const trailing = trailingPseudoElement(member);
      if (trailing !== null) found.add(trailing.pseudo);
    }
  }
  if (found.size === 0) return [];
  found.add("::before");
  found.add("::after");
  return Array.from(found).sort();
}

/** The iframe's own getComputedStyle: the node lives in the frame's
 * realm, and its window is the honest handle. `pseudo` reads a
 * pseudo-element's own computed style instead of the node's. */
function computedStyleOf(node: Element, pseudo?: string): CSSStyleDeclaration {
  const view = node.ownerDocument.defaultView ?? window;
  return view.getComputedStyle(node, pseudo);
}
