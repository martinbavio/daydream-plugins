// The STATIC lint (docs/agent-css-knowledge-prd.md, "Lints"; decisions.md
// #43, #48 P9): what can be said about a document from its JSON alone, with
// no render. Deliberately small — five rules, each a fact about CSS the
// browser would enforce silently (a query that can never match, a
// declaration the parser drops, a declaration that changes nothing, a font
// face nothing names, a class no selector names) — because anything that needs a render is the
// necessity lint's job (necessity.ts), never this file's. Runs on a
// validated document; the format gate (core) comes first. The facts about
// CSS it reads — container axes, family names, the condition grammar —
// are core's, through `dd.core` (one implementation, decisions.md #48 P4);
// the OPINION that these four are worth refusing a landing for is this
// plugin's.

import type {
  CoreApi,
  DreamDocument,
  DreamElement,
  DreamViewport,
  Finding,
} from "@daydream/plugin-api";

/** Every static finding for the document, in tree order, one element's
 * findings together (container queries, then unit-less lengths, then
 * restated initials), then the viewport's rule-level findings (decisions.md
 * #71, plan phase 9: the same four facts extended to a viewport's `sheet` —
 * everything here is JSON-only, no browser). Empty when the document is
 * clean. */
export function staticLint(core: CoreApi, doc: DreamDocument): Finding[] {
  const findings: Finding[] = [];
  for (const viewport of core.viewportItems(doc) as DreamViewport[]) {
    // Each viewport is its own tree: html → body → content, and a container
    // in one viewport is invisible to a query in another.
    lintElement(core, viewport.payload.root, [], findings);
    lintUnusedFontFaces(core, viewport, findings);
    lintUnitlessLengthsOnRules(viewport, findings);
    lintRestatedInitialsOnRules(viewport, findings);
    lintUnreferencedClasses(viewport, findings);
  }
  return findings;
}

/** What an element declares about being a query container: which
 * container-type kinds any of its style maps give it, and every name it
 * carries. Base styles and every layer alike — a media layer can turn an
 * element into a container (environment.ts, containerAxes), a container
 * layer can too, and a static lint cannot know at which width the query is
 * asked, so any map counts. */
export interface ContainerDeclaration {
  /** `container-type: size | inline-size` — what size features query. */
  size: boolean;
  /** `container-type: scroll-state` — what scroll-state() queries. */
  scrollState: boolean;
  names: Set<string>;
}

function lintElement(
  core: CoreApi,
  el: DreamElement,
  ancestors: readonly ContainerDeclaration[],
  findings: Finding[],
): void {
  lintContainerQueries(core, el, ancestors, findings);
  lintUnitlessLengths(el, findings);
  lintRestatedInitials(el, findings);

  const own = containerDeclaration(core, el);
  const chain =
    own.size || own.scrollState || own.names.size > 0
      ? [...ancestors, own]
      : ancestors;
  for (const child of el.children) lintElement(core, child, chain, findings);
}

// ---------------------------------------------------------------------------
// Rule 1 — a container query with no container to ask.
//
// `@container` matches against the nearest ANCESTOR that is a query
// container for what the condition asks (css-contain-3 §4.1, css-contain-4
// §5): a SIZE feature (`(width > 400px)`, `(min-width: …)`, `(orientation:
// …)`) needs `container-type: size | inline-size`; `scroll-state(…)` needs
// `container-type: scroll-state`; `style(…)` needs nothing — every element is
// a style container — so a style-only query is never flagged, named or not
// (a name there only needs `container-name`, which no type check should
// second-guess). A named query further needs the satisfying ancestor to
// carry the name, via `container-name` or the shorthand's first half. The
// element's own declarations never count, and neither does a root default:
// decisions #38 pins that a containerless query never matches, in real
// browsers and on the canvas alike. The nearest-ancestor rule is checked
// generously — ANY ancestor that is typed for what the query needs (and,
// when named, so named) passes — because the lint is static and must never
// flag a query the browser could match.

function lintContainerQueries(
  core: CoreApi,
  el: DreamElement,
  ancestors: readonly ContainerDeclaration[],
  findings: Finding[],
): void {
  if (el.conditionals === undefined) return;
  for (const layer of el.conditionals) {
    if (core.conditionKind(layer.condition) !== "container") continue;
    const prelude = layer.condition.trim();
    const { name, condition } = splitContainerPrelude(prelude);
    const needs = queryNeeds(condition);
    if (!needs.size && !needs.scrollState) continue; // style()-only
    const typed = ancestors.filter(
      (a) => (!needs.size || a.size) && (!needs.scrollState || a.scrollState),
    );
    let reason: string | null = null;
    if (typed.length === 0) {
      reason = needs.size
        ? "no ancestor declares container-type"
        : "no ancestor declares container-type: scroll-state";
    } else if (name !== null && !typed.some((a) => a.names.has(name))) {
      reason = `no ancestor declares a container named \`${name}\``;
    }
    if (reason === null) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: el.id,
      layer: layer.condition,
      message: `container query \`${prelude}\` on ${nameOf(el)} can never match: ${reason}`,
    });
  }
}

/** The `<container-name>` a prelude asks for (null for an unnamed query)
 * and the condition after it. The name is the first token after
 * `@container` when it is an ident followed by whitespace — `card (…)`,
 * `card not (…)`. `not (…)` opens a condition, and `style(…)` /
 * `scroll-state(…)` run straight into their parenthesis, so neither reads
 * as a name. */
export function splitContainerPrelude(prelude: string): {
  name: string | null;
  condition: string;
} {
  const rest = prelude.replace(/^@container/i, "").trim();
  const match = /^(-?[a-z_][\w-]*)(?=\s)/i.exec(rest);
  if (match === null || (match[1] as string).toLowerCase() === "not") {
    return { name: null, condition: rest };
  }
  const name = match[1] as string;
  return { name, condition: rest.slice(name.length).trim() };
}

export interface QueryNeeds {
  size: boolean;
  scrollState: boolean;
}

/** Which container-type kinds the condition's features need. Every `(` is
 * classified by what precedes and follows it: `style(` is a style feature
 * (skipped whole, nested parens included), `scroll-state(` a scroll-state
 * one, another `ident(` a general-enclosed unknown (never true, never
 * flagged); a bare `(` followed by `not`, another `(`, or a function is a
 * grouping paren, and a bare `(` followed by anything else — `(width …`,
 * `(min-width: …)`, `(orientation: …)` — is a size feature. */
export function queryNeeds(condition: string): QueryNeeds {
  const needs: QueryNeeds = { size: false, scrollState: false };
  for (let i = 0; i < condition.length; i++) {
    if (condition[i] !== "(") continue;
    const ident = identBefore(condition, i);
    if (ident === "style") {
      i = closingParen(condition, i);
      continue;
    }
    if (ident === "scroll-state") {
      needs.scrollState = true;
      i = closingParen(condition, i);
      continue;
    }
    if (ident !== "") continue;
    const after = condition.slice(i + 1).trimStart();
    if (
      after.startsWith("(") ||
      /^not(?![\w-])/i.test(after) ||
      /^[a-z-]+\(/i.test(after)
    ) {
      continue; // grouping, not a feature of its own
    }
    needs.size = true;
  }
  return needs;
}

/** The ident glued to the `(` at `at` (`style` in `style(`), lower-cased;
 * "" when the paren stands alone. */
function identBefore(text: string, at: number): string {
  let start = at;
  while (start > 0 && /[a-z-]/i.test(text[start - 1] as string)) start--;
  return text.slice(start, at).toLowerCase();
}

/** Index of the `)` matching the `(` at `open`, or the text's end when the
 * prelude is unbalanced (the validator refuses those; this only stays
 * total). */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
}

export function containerDeclaration(
  core: CoreApi,
  el: DreamElement,
): ContainerDeclaration {
  const out: ContainerDeclaration = {
    size: false,
    scrollState: false,
    names: new Set(),
  };
  mergeContainerDeclaration(core, out, el.styles);
  for (const layer of el.conditionals ?? []) {
    mergeContainerDeclaration(core, out, layer.styles);
  }
  return out;
}

/** One style map's contribution. The SIZE question is containerAxes's — the
 * same insertion-order read the renderer trusts, so an unslashed `container:
 * card` written after a `container-type` resets it here too. Scroll-state
 * containment is not an axis the renderer needs, so it is read here with
 * the same later-wins walk. Names are gathered on top: `container-name` and
 * the shorthand's pre-slash half, each a space-separated ident list where
 * `none` names nothing. */
function mergeContainerDeclaration(
  core: CoreApi,
  into: ContainerDeclaration,
  styles: Record<string, string>,
): void {
  const axes = core.containerAxes(styles);
  if (axes.inline || axes.block) into.size = true;
  let scrollState = false;
  for (const [property, value] of Object.entries(styles)) {
    const name = property.trim().toLowerCase();
    if (
      name !== "container-name" &&
      name !== "container-type" &&
      name !== "container"
    ) {
      continue;
    }
    const slash = value.indexOf("/");
    if (name === "container-type") {
      scrollState = typeTokens(value).includes("scroll-state");
    } else if (name === "container") {
      scrollState =
        slash !== -1 &&
        typeTokens(value.slice(slash + 1)).includes("scroll-state");
    }
    if (name === "container-type") continue;
    const list =
      name === "container" && slash !== -1 ? value.slice(0, slash) : value;
    for (const ident of list.trim().split(/\s+/)) {
      if (ident !== "" && ident.toLowerCase() !== "none") into.names.add(ident);
    }
  }
  if (scrollState) into.scrollState = true;
}

function typeTokens(type: string): string[] {
  return type.trim().toLowerCase().split(/\s+/);
}

// ---------------------------------------------------------------------------
// Rule 2 — a unit-less number where a length is required.
//
// `width: 100` is not "100px": the parser drops the whole declaration and
// the element renders as if it were never written. Only `0` is a legal
// unit-less length. The property set is explicit and length-only — every
// property here takes <length-percentage> (plus keywords) and nothing that
// is a bare <number>; properties with a unit-less grammar (line-height,
// opacity, z-index, flex, font-weight, grid lines, columns, …) are not in it
// and never will be.

const LENGTH_PROPERTIES: ReadonlySet<string> = new Set([
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "inline-size",
  "block-size",
  "min-inline-size",
  "min-block-size",
  "max-inline-size",
  "max-block-size",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "gap",
  "row-gap",
  "column-gap",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-inline-width",
  "border-inline-start-width",
  "border-inline-end-width",
  "border-block-width",
  "border-block-start-width",
  "border-block-end-width",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-start-start-radius",
  "border-start-end-radius",
  "border-end-start-radius",
  "border-end-end-radius",
  "outline-width",
  "outline-offset",
  "font-size",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "translate",
  "flex-basis",
]);

const BARE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function lintUnitlessLengths(el: DreamElement, findings: Finding[]): void {
  lintUnitlessMap(el, el.styles, undefined, findings);
  for (const layer of el.conditionals ?? []) {
    lintUnitlessMap(el, layer.styles, layer.condition, findings);
  }
}

function lintUnitlessMap(
  el: DreamElement,
  styles: Record<string, string>,
  layer: string | undefined,
  findings: Finding[],
): void {
  for (const [property, value] of Object.entries(styles)) {
    if (!LENGTH_PROPERTIES.has(property.trim().toLowerCase())) continue;
    if (!topLevelTokens(value).some(isNonZeroBareNumber)) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: el.id,
      property,
      ...(layer === undefined ? {} : { layer }),
      message: `${property}: ${value.trim()} on ${nameOf(el)} has no unit; a length needs one (px, rem, %, …)`,
    });
  }
}

function isNonZeroBareNumber(token: string): boolean {
  return BARE_NUMBER.test(token) && parseFloat(token) !== 0;
}

/** The value's tokens outside any parenthesis, split on whitespace, commas
 * and slashes. A number INSIDE `calc(100 * 1px)` or `min(10, 2px)` is a
 * multiplier or the function's own business, never a length of ours. */
function topLevelTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  const flush = (): void => {
    if (current !== "") tokens.push(current);
    current = "";
  };
  for (const ch of value) {
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0 && /[\s,/]/.test(ch)) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return tokens;
}

/** Rule 2, extended to a viewport's `sheet` (decisions.md #71, plan phase
 * 9): a rule's declarations are the same grain as an element's base map,
 * so the same unit check applies verbatim — no layers to walk, a rule has
 * one flat style map. */
export function lintUnitlessLengthsOnRules(
  vp: DreamViewport,
  findings: Finding[],
): void {
  (vp.payload.sheet ?? []).forEach((rule, index) => {
    for (const [property, value] of Object.entries(rule.styles)) {
      if (!LENGTH_PROPERTIES.has(property.trim().toLowerCase())) continue;
      if (!topLevelTokens(value).some(isNonZeroBareNumber)) continue;
      findings.push({
        tier: "static",
        severity: "blocking",
        rule: index,
        property,
        message: `${property}: ${value.trim()} in rule ${rule.selector} (sheet[${index}]) of viewport ${vp.id} has no unit; a length needs one (px, rem, %, …)`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Rule 3 — an explicit initial value the UA never overrides.
//
// `position: static` in base styles is a declaration that changes nothing:
// the property's initial value is what the element would have had anyway,
// because no UA stylesheet sets it on any element the format allows
// (core/content.ts ALLOWED_TAGS). The table is restricted to exactly those
// properties, and to NON-INHERITED ones only — an inherited property
// (letter-spacing, text-transform, visibility, …) restated at its initial
// under an ancestor that changed it is a real reset, which the JSON alone
// cannot tell from a redundant one. Where Chrome's UA sheet DOES touch one
// of these on a tag — overflow on img and hr — that tag is excused, since
// restating the initial there is a reset too. Layers are never checked: a
// layer resetting to the initial overrides the base, which is legitimate.
// `outline-offset: 0` is deliberately absent — the UA sheet sets it on
// focused form controls, so it is not guaranteed redundant.
//
// The premise was re-read against Chromium's html.css when the vocabulary
// widened (decisions.md #57: tables, description lists, the phrasing
// elements, ruby, address/hgroup/menu/search): what the UA sets on the
// new tags is display, vertical-align, text-align, border-spacing,
// border-collapse, border-color, box-sizing and text-indent (table
// parts), padding (td/th), margins and list-style (dl/dd/menu),
// font-style, font-family, font-size, font-weight, text-decoration,
// unicode-bidi, colour and line-height (the phrasing set, sub/sup, rt) —
// and none of those is in this table, so no new tag needs excusing.
// Widening the vocabulary again means reading the sheet again
// (staticLint.test.ts pins the audit).

interface InitialValue {
  value: string;
  /** Tags whose UA styles set this property, so the initial is a reset. */
  except?: ReadonlySet<string>;
}

const REPLACED_OR_RULED: ReadonlySet<string> = new Set(["img", "hr"]);

const INITIAL_VALUES: ReadonlyMap<string, InitialValue> = new Map([
  ["position", { value: "static" }],
  ["float", { value: "none" }],
  ["clear", { value: "none" }],
  ["z-index", { value: "auto" }],
  ["top", { value: "auto" }],
  ["right", { value: "auto" }],
  ["bottom", { value: "auto" }],
  ["left", { value: "auto" }],
  ["inset", { value: "auto" }],
  ["flex-direction", { value: "row" }],
  ["flex-wrap", { value: "nowrap" }],
  ["flex-grow", { value: "0" }],
  ["flex-shrink", { value: "1" }],
  ["flex-basis", { value: "auto" }],
  ["opacity", { value: "1" }],
  ["transform", { value: "none" }],
  ["max-width", { value: "none" }],
  ["max-height", { value: "none" }],
  ["min-width", { value: "auto" }],
  ["min-height", { value: "auto" }],
  ["overflow", { value: "visible", except: REPLACED_OR_RULED }],
  ["box-shadow", { value: "none" }],
]);

function lintRestatedInitials(el: DreamElement, findings: Finding[]): void {
  for (const [property, value] of Object.entries(el.styles)) {
    const initial = INITIAL_VALUES.get(property.trim().toLowerCase());
    if (initial === undefined) continue;
    if (initial.except?.has(el.tag) === true) continue;
    if (value.trim().toLowerCase() !== initial.value) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: el.id,
      property,
      message: `${property}: ${value.trim()} on ${nameOf(el)} restates the initial value`,
    });
  }
}

/** Rule 3, extended to a viewport's `sheet` (decisions.md #71, plan phase
 * 9): a rule has no concrete tag, so the `img`/`hr` overflow exception is
 * APPROXIMATED from the selector alone — excused when its rightmost
 * compound (in any list member) could reach one of them: no type selector
 * at all (a bare `.card`, `#x`, `[attr]` or pseudo-class matches any tag),
 * an explicit universal `*`, or the literal `img`/`hr` type. A rule typed
 * to a different tag (`div`, `p`, …) can never match either replaced
 * element, so it is held to the table like an element is. */
export function lintRestatedInitialsOnRules(
  vp: DreamViewport,
  findings: Finding[],
): void {
  (vp.payload.sheet ?? []).forEach((rule, index) => {
    for (const [property, value] of Object.entries(rule.styles)) {
      const initial = INITIAL_VALUES.get(property.trim().toLowerCase());
      if (initial === undefined) continue;
      if (value.trim().toLowerCase() !== initial.value) continue;
      if (
        initial.except !== undefined &&
        selectorCanReachReplacedOrRuled(rule.selector)
      ) {
        continue;
      }
      findings.push({
        tier: "static",
        severity: "blocking",
        rule: index,
        property,
        message: `${property}: ${value.trim()} in rule ${rule.selector} (sheet[${index}]) of viewport ${vp.id} restates the initial value`,
      });
    }
  });
}

/** Whether some member of the selector list could, by its rightmost
 * compound alone, match an `img` or `hr` — the same excuse
 * `lintRestatedInitials` gives those two tags, approximated from the
 * selector text since a rule carries no element to ask. */
function selectorCanReachReplacedOrRuled(selector: string): boolean {
  return splitSelectorList(selector).some((member) => {
    const type = rightmostTypeSelector(member.trim());
    return type === null || type === "*" || REPLACED_OR_RULED.has(type);
  });
}

/** The selector list's members, split at top-level commas (outside
 * parens, brackets and strings) — the same grain a rule's `selector`
 * already stores it in (the CSSOM's `", "`), kept general for a
 * hand-written one too. */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
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

/** The rightmost compound's type selector, lower-cased — the tag a
 * `div.card` or `.a > img` names last — or null when the compound opens
 * with a class, id, attribute or pseudo instead (matches any tag). Split
 * at the last top-level combinator (whitespace, `>`, `+`, `~`), outside
 * parens, brackets and strings, so `:is(a, b) c` still finds `c`. */
function rightmostTypeSelector(complex: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  let cut = 0;
  for (let i = 0; i < complex.length; i++) {
    const ch = complex[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~")) {
      cut = i + 1;
    }
  }
  const compound = complex.slice(cut).trim();
  if (compound === "" || /^[.#:[]/.test(compound)) return null;
  const match = /^(\*|[a-z][\w-]*)/i.exec(compound);
  return match === null ? null : (match[1] as string).toLowerCase();
}

// ---------------------------------------------------------------------------
// Rule 4 — a @font-face no element names.
//
// A stored face (core/fonts.ts) is a download the bridge vendored and a
// rule every page of the viewport carries; one whose family no
// `font-family` in the viewport lists — base or any layer — is dead weight
// the browser never even fetches, since a face loads only when text uses
// it. Family names compare case-insensitively (css-fonts-4 §4.3). The
// `font` shorthand counts too, generously: a shorthand that contains the
// family name anywhere passes, because the JSON alone cannot parse the
// shorthand's family list and this lint must never flag a face a real
// declaration uses. The same generosity covers indirection: a family
// reached through a custom property (`--stack: "Noto Serif", serif` and
// `font-family: var(--stack)`) is named in the custom property's value,
// so every `--*` value is searched the same way. Necessity cannot see this
// either — a font face is not an element declaration to remove — so it is
// static by nature.

function lintUnusedFontFaces(
  core: CoreApi,
  vp: DreamViewport,
  findings: Finding[],
): void {
  const fonts = vp.payload.fonts ?? [];
  if (fonts.length === 0) return;
  const named = new Set<string>();
  /** Values searched by substring: `font` shorthands and custom properties. */
  const loose: string[] = [];
  const visit = (el: DreamElement): void => {
    const maps = [el.styles, ...(el.conditionals ?? []).map((l) => l.styles)];
    for (const map of maps) {
      for (const [property, value] of Object.entries(map)) {
        const key = property.trim().toLowerCase();
        if (key === "font-family") {
          for (const name of core.familyNames(value)) {
            named.add(name.toLowerCase());
          }
        } else if (key === "font" || key.startsWith("--")) {
          loose.push(value.toLowerCase());
        }
      }
    }
    for (const child of el.children) visit(child);
  };
  visit(vp.payload.root);
  // A rule's font-family counts as a use too (decisions.md #71, plan
  // phase 9): the sheet is the same page the elements render into, and a
  // face named only by a rule is exactly as used as one named by an
  // element's own map.
  for (const rule of vp.payload.sheet ?? []) {
    for (const [property, value] of Object.entries(rule.styles)) {
      const key = property.trim().toLowerCase();
      if (key === "font-family") {
        for (const name of core.familyNames(value)) named.add(name.toLowerCase());
      } else if (key === "font" || key.startsWith("--")) {
        loose.push(value.toLowerCase());
      }
    }
  }
  for (const face of fonts) {
    const family = core.familyNames(face["font-family"] ?? "")[0];
    if (family === undefined) continue;
    const lower = family.toLowerCase();
    if (named.has(lower)) continue;
    if (loose.some((value) => value.includes(lower))) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: vp.payload.root.id,
      message: `@font-face ${family} in viewport ${vp.id} is named by no element's font-family — remove the face or use it`,
    });
  }
}

// ---------------------------------------------------------------------------
// Rule 5 — a class no rule names (decisions.md #71's `class` hook; the CSS
// author's review after the selectors step landed). The mirror of the
// dead-rule finding (matchLint.ts): a class on an element that no selector
// in the viewport's sheet mentions is a hook nothing hangs on — the
// element carries it for nobody. Static by nature: whether a selector
// NAMES a class is read from its text, never from a match (a `.card` rule
// names `card` whether or not it matches this element right now). Named
// means: a `.class` compound anywhere in any rule's selector (inside
// `:is()`, `:not()`, `:where()` too — the regex reads the whole text),
// or a `[class…="…"]` attribute selector whose value lists it. Only
// `class` is judged: an `id` may be a fragment link's target and a
// `data-*` a state hook, neither of which a rule has to name.

/** Every class name some rule of `sheet` names, escapes resolved. */
export function referencedClasses(
  sheet: readonly { selector: string }[],
): Set<string> {
  const named = new Set<string>();
  for (const rule of sheet) {
    for (const match of rule.selector.matchAll(
      /\.((?:\\.|[\w-]|[^\x00-\x7f])+)/g,
    )) {
      named.add((match[1] as string).replace(/\\(.)/g, "$1"));
    }
    for (const match of rule.selector.matchAll(
      /\[\s*class\s*[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*[is]?\s*\]/gi,
    )) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      for (const token of value.split(/\s+/)) if (token !== "") named.add(token);
    }
  }
  return named;
}

export function lintUnreferencedClasses(
  vp: DreamViewport,
  findings: Finding[],
): void {
  const named = referencedClasses(vp.payload.sheet ?? []);
  const visit = (el: DreamElement): void => {
    const classes = (el.attrs?.["class"] ?? "").split(/\s+/).filter(Boolean);
    for (const name of classes) {
      if (named.has(name)) continue;
      findings.push({
        tier: "static",
        severity: "blocking",
        elementId: el.id,
        message: `class "${name}" on ${nameOf(el)} in viewport ${vp.id} is named by no rule; drop it, or write the rule that uses it`,
      });
    }
    for (const child of el.children) visit(child);
  };
  visit(vp.payload.root);
}

/** The label when present, else `tag#id` — the same naming the measure
 * report uses (core's src/measure/findings.ts), so every tier's findings
 * name an element the same way. */
export function nameOf(el: DreamElement): string {
  return el.label ?? `${el.tag}#${el.id}`;
}
