// The STATIC lint (docs/agent-css-knowledge-prd.md, "Lints"; decision
// #43, #48 P9): what can be said about a page from its text alone, with
// no render. Deliberately small — four rules, each a fact about CSS the
// browser would enforce silently (a declaration the parser drops, a
// declaration that changes nothing, a font face nothing names, a class
// no selector names) — because anything that needs a render is the
// necessity lint's (necessity.ts), and anything that needs a selector
// MATCHED — dead rules, redundancy, a container query with no container —
// is matchLint.ts's, which mounts the page. The facts about CSS it reads
// (family names) are core's, through `dd.core` (one implementation,
// decision #48 P4); the OPINION that these are worth refusing a landing
// for is this plugin's.
//
// A page (decision #76) is two texts. The markup is parsed by the
// browser (`DOMParser`, pageDom.ts): an element's own declarations are
// its `style` attribute, and it is named in a finding by its unique
// selector (uniqueSelector.ts), as `measure` names it. The css is scanned
// (pageCss.ts) so each declaration is judged as the author wrote it — the
// CSSOM drops `width: 100` before anyone could read it, which is the
// point of rule 1 — and a rule finding carries the rule's position among
// the page's rules in `rule`, the address the gate runner keys a
// declaration by. What only the browser can answer (a `font` shorthand's
// family list) is asked of the CSSOM.

import type {
  CoreApi,
  DreamDocument,
  DreamPage,
  Finding,
} from "@daydream/plugin-api";

import {
  fontFaces,
  pageRules,
  ruleName,
  scanDeclarations,
  selectorPreludes,
  splitTopLevelCommas,
  type CssDeclaration,
  type PageRule,
} from "./pageCss";
import { lintElements, parsePage } from "./pageDom";
import { uniqueSelector } from "./uniqueSelector";

/** Every static finding for the document: per page, the elements' own
 * declarations in tree order (one element's findings together: unit-less
 * lengths, then restated initials), then the page's unused font faces,
 * then its rules' unit-less lengths and restated initials, then the
 * classes no rule names. Empty when the document is clean. Browser only:
 * the markup is parsed by the browser. */
export function staticLint(core: CoreApi, doc: DreamDocument): Finding[] {
  const findings: Finding[] = [];
  for (const page of core.viewportItems(doc) as DreamPage[]) {
    const parsed = parsePage(page.payload);
    const rules = pageRules(parsed.css);
    const elements = lintElements(parsed.doc);
    const names = new Map<Element, string>();
    const nameOf = (el: Element): string => {
      let name = names.get(el);
      if (name === undefined) {
        name = uniqueSelector(el, parsed.doc);
        names.set(el, name);
      }
      return name;
    };
    for (const el of elements) {
      const own = scanDeclarations(el.getAttribute("style") ?? "");
      if (own.length === 0) continue;
      lintUnitlessLengths(own, nameOf(el), findings);
      lintRestatedInitials(own, el.localName, nameOf(el), findings);
    }
    lintUnusedFontFaces(core, page, parsed.css, rules, elements, findings);
    lintUnitlessLengthsOnRules(rules, page.id, findings);
    lintRestatedInitialsOnRules(rules, page.id, findings);
    lintUnreferencedClasses(
      selectorPreludes(parsed.css),
      elements,
      nameOf,
      page.id,
      findings,
    );
  }
  return findings;
}

/** An element as a finding's sentence names it. */
function named(selector: string): string {
  return `\`${selector}\``;
}

// ---------------------------------------------------------------------------
// Rule 1 — a unit-less number where a length is required.
//
// `width: 100` is not "100px": the parser drops the whole declaration and
// the element renders as if it were never written. Only `0` is a legal
// unit-less length. The property set is explicit and length-only — every
// property here takes <length-percentage> (plus keywords) and nothing that
// is a bare <number>; properties with a unit-less grammar (line-height,
// opacity, z-index, flex, font-weight, grid lines, columns, …) are not in it
// and never will be. Read from the TEXT: the CSSOM never holds a
// declaration its parser dropped.

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

function hasUnitlessLength(declaration: CssDeclaration): boolean {
  if (!LENGTH_PROPERTIES.has(declaration.property)) return false;
  return topLevelTokens(declaration.value).some(isNonZeroBareNumber);
}

function lintUnitlessLengths(
  own: readonly CssDeclaration[],
  selector: string,
  findings: Finding[],
): void {
  for (const declaration of own) {
    if (!hasUnitlessLength(declaration)) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: selector,
      property: declaration.property,
      message: `${declaration.property}: ${declaration.value} on ${named(selector)} has no unit; a length needs one (px, rem, %, …)`,
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

/** Rule 1 on the page's rules: a rule's declarations are the same grain
 * as an element's own, so the same check applies verbatim, under any
 * condition — a dropped declaration is dropped at every width. */
export function lintUnitlessLengthsOnRules(
  rules: readonly PageRule[],
  viewportId: string,
  findings: Finding[],
): void {
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      if (!hasUnitlessLength(declaration)) continue;
      findings.push({
        tier: "static",
        severity: "blocking",
        rule: rule.index,
        property: declaration.property,
        message: `${declaration.property}: ${declaration.value} in rule ${ruleName(rule)} of viewport ${viewportId} has no unit; a length needs one (px, rem, %, …)`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2 — an explicit initial value the UA never overrides.
//
// `position: static` in an element's own style is a declaration that
// changes nothing: the property's initial value is what the element would
// have had anyway, because no UA stylesheet sets it on the elements a page
// is made of. The table is restricted to exactly those properties, and to
// NON-INHERITED ones only — an inherited property (letter-spacing,
// text-transform, visibility, …) restated at its initial under an
// ancestor that changed it is a real reset, which the text alone cannot
// tell from a redundant one. Where Chrome's UA sheet DOES touch one of
// these on a tag — overflow on img and hr — that tag is excused, since
// restating the initial there is a reset too. `outline-offset: 0` is
// deliberately absent — the UA sheet sets it on focused form controls, so
// it is not guaranteed redundant. An `!important` declaration is never
// judged: it is there to win, which a reset may need to.
//
// The premise was re-read against Chromium's html.css when the tree's
// vocabulary widened (decision #57: tables, description lists, the
// phrasing elements, ruby, address/hgroup/menu/search): what the UA sets
// on those tags is display, vertical-align, text-align, border-spacing,
// border-collapse, border-color, box-sizing and text-indent (table
// parts), padding (td/th), margins and list-style (dl/dd/menu),
// font-style, font-family, font-size, font-weight, text-decoration,
// unicode-bidi, colour and line-height (the phrasing set, sub/sup, rt) —
// and none of those is in this table, so none needs excusing
// (staticLint.browser.test.ts pins the audit). A page may use any element
// HTML has (decision #76); one whose UA styles set a property of the
// table wants its own exception here.

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

/** The table's entry the declaration restates, or undefined. */
function restatedInitial(declaration: CssDeclaration): InitialValue | undefined {
  if (declaration.important) return undefined;
  const initial = INITIAL_VALUES.get(declaration.property);
  if (initial === undefined) return undefined;
  return declaration.value.toLowerCase() === initial.value ? initial : undefined;
}

function lintRestatedInitials(
  own: readonly CssDeclaration[],
  tag: string,
  selector: string,
  findings: Finding[],
): void {
  for (const declaration of own) {
    const initial = restatedInitial(declaration);
    if (initial === undefined) continue;
    if (initial.except?.has(tag) === true) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: selector,
      property: declaration.property,
      message: `${declaration.property}: ${declaration.value} on ${named(selector)} restates the initial value`,
    });
  }
}

/** Rule 2 on the page's rules. Judged only where it holds as it does for
 * an element's own style: a TOP-LEVEL rule under no at-rule. A rule inside
 * an `@media`, `@container` or `@supports`, or nested in another rule (the
 * shape a tree's conditional layers take in a page, decision #76), exists
 * to override something under a condition, and resetting to the initial
 * there is the override — as a conditional layer's was. A rule has no
 * concrete tag, so the `img`/`hr` overflow exception is APPROXIMATED from
 * the selector: excused when its rightmost compound (in any list member)
 * could reach one of them — no type selector at all, `*`, or `img`/`hr`
 * itself. */
export function lintRestatedInitialsOnRules(
  rules: readonly PageRule[],
  viewportId: string,
  findings: Finding[],
): void {
  for (const rule of rules) {
    if (rule.conditions.length > 0 || rule.parents.length > 0) continue;
    for (const declaration of rule.declarations) {
      const initial = restatedInitial(declaration);
      if (initial === undefined) continue;
      if (
        initial.except !== undefined &&
        selectorCanReachReplacedOrRuled(rule.selector)
      ) {
        continue;
      }
      findings.push({
        tier: "static",
        severity: "blocking",
        rule: rule.index,
        property: declaration.property,
        message: `${declaration.property}: ${declaration.value} in rule ${ruleName(rule)} of viewport ${viewportId} restates the initial value`,
      });
    }
  }
}

/** Whether some member of the selector list could, by its rightmost
 * compound alone, match an `img` or `hr`. */
function selectorCanReachReplacedOrRuled(selector: string): boolean {
  return splitTopLevelCommas(selector).some((member) => {
    const type = rightmostTypeSelector(member.trim());
    return type === null || type === "*" || REPLACED_OR_RULED.has(type);
  });
}

/** The rightmost compound's type selector, lower-cased — the tag a
 * `div.card` or `.a > img` names last — or null when the compound opens
 * with a class, id, attribute or pseudo instead (matches any tag). Split
 * at the last top-level combinator, outside parens, brackets and strings,
 * so `:is(a, b) c` still finds `c`. */
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
// Rule 3 — a @font-face nothing names.
//
// A face is a download the bridge vendored and a rule the page carries; one
// whose family no `font-family` in the page lists — a rule's, under any
// condition, or an element's own — is dead weight the browser never even
// fetches, since a face loads only when text uses it. Family names compare
// case-insensitively (css-fonts-4 §4.3). The `font` shorthand counts: the
// browser parses it (the CSSOM's `font-family` longhand of the value), and
// where it cannot say — a `var()` in the shorthand — a shorthand that
// contains the family name anywhere passes, because this lint must never
// flag a face a real declaration uses. The same generosity covers
// indirection: a family reached through a custom property (`--stack:
// "Noto Serif", serif` and `font-family: var(--stack)`) is named in the
// custom property's value, so every `--*` value is searched the same way.
// Necessity cannot see this either — a font face is not a rule's
// declaration to remove — so it is static by nature.

function lintUnusedFontFaces(
  core: CoreApi,
  page: DreamPage,
  css: string,
  rules: readonly PageRule[],
  elements: readonly Element[],
  findings: Finding[],
): void {
  const faces = fontFaces(css);
  if (faces.length === 0) return;
  const named = new Set<string>();
  /** Values searched by substring: `font` shorthands the browser could
   * not resolve, and custom properties. */
  const loose: string[] = [];
  const scratch = elements[0]?.ownerDocument.createElement("div");
  const use = (declaration: CssDeclaration): void => {
    const { property, value } = declaration;
    if (property === "font-family") {
      for (const name of core.familyNames(value)) named.add(name.toLowerCase());
    } else if (property === "font") {
      const family = shorthandFamily(scratch, value);
      if (family === "") loose.push(value.toLowerCase());
      else for (const name of core.familyNames(family)) named.add(name.toLowerCase());
    } else if (property.startsWith("--")) {
      loose.push(value.toLowerCase());
    }
  };
  for (const rule of rules) rule.declarations.forEach(use);
  for (const el of elements) {
    scanDeclarations(el.getAttribute("style") ?? "").forEach(use);
  }
  for (const face of faces) {
    const declared = face.declarations.find((d) => d.property === "font-family");
    const family = core.familyNames(declared?.value ?? "")[0];
    if (family === undefined) continue;
    const lower = family.toLowerCase();
    if (named.has(lower)) continue;
    if (loose.some((value) => value.includes(lower))) continue;
    findings.push({
      tier: "static",
      severity: "blocking",
      elementId: "html",
      message: `@font-face ${family} in viewport ${page.id} is named by no font-family in the page — remove the face or use it`,
    });
  }
}

/** The family list the browser reads out of a `font` shorthand, or ""
 * when it cannot say (an invalid shorthand, a `var()` in it). */
function shorthandFamily(scratch: HTMLElement | undefined, value: string): string {
  if (scratch === undefined) return "";
  scratch.style.cssText = "";
  scratch.style.setProperty("font", value);
  return scratch.style.getPropertyValue("font-family");
}

// ---------------------------------------------------------------------------
// Rule 4 — a class no rule names (decision #71's `class` hook). The mirror
// of the dead-rule finding (matchLint.ts): a class on an element that no
// selector in the page's css mentions is a hook nothing hangs on — the
// element carries it for nobody. Static by nature: whether a selector
// NAMES a class is read from its text, never from a match (a `.card` rule
// names `card` whether or not it matches this element right now). Named
// means: a `.class` compound anywhere in any rule's selector (nested rules
// and `@scope` preludes too, inside `:is()`, `:not()`, `:where()` — the
// regex reads the whole text), or a `[class…="…"]` attribute selector:
// `=` and `~=` name their value's tokens outright, while `^=`, `$=`, `*=`
// and `|=` match the attribute STRING by prefix, suffix or substring, so a
// class counts as named by one of those when the token itself satisfies
// the test (`[class*="i-"]` names `i-home`) — approximate, erring toward
// named, since a false "unreferenced" would refuse a valid landing. Only
// `class` is judged: an `id` may be a fragment link's target and a
// `data-*` a state hook, neither of which a rule has to name.

/** Every class name some selector names OUTRIGHT (a `.class` compound, a
 * `[class=]`/`[class~=]` token), escapes resolved. The prefix/suffix/
 * substring attribute forms are `classNamer`'s. */
export function referencedClasses(selectors: readonly string[]): Set<string> {
  const named = new Set<string>();
  for (const selector of selectors) {
    for (const match of selector.matchAll(
      /\.((?:\\.|[\w-]|[^\x00-\x7f])+)/g,
    )) {
      named.add((match[1] as string).replace(/\\(.)/g, "$1"));
    }
    for (const { operator, value } of classAttributeSelectors(selector)) {
      if (operator !== "=" && operator !== "~=") continue;
      for (const token of value.split(/\s+/)) if (token !== "") named.add(token);
    }
  }
  return named;
}

/** Whether some selector names a class token: outright
 * (`referencedClasses`) or through a prefix/suffix/substring `[class…=]`
 * test the token satisfies. */
export function classNamer(
  selectors: readonly string[],
): (token: string) => boolean {
  const named = referencedClasses(selectors);
  const tests: ((token: string) => boolean)[] = [];
  for (const selector of selectors) {
    for (const { operator, value } of classAttributeSelectors(selector)) {
      if (value === "") continue;
      if (operator === "^=" || operator === "|=") {
        tests.push((token) => token.startsWith(value));
      } else if (operator === "$=") {
        tests.push((token) => token.endsWith(value));
      } else if (operator === "*=") {
        // A value with whitespace spans tokens; no single token can be
        // told apart, so every token counts as named.
        tests.push((token) => /\s/.test(value) || token.includes(value));
      }
    }
  }
  return (token) => named.has(token) || tests.some((test) => test(token));
}

function classAttributeSelectors(
  selector: string,
): { operator: string; value: string }[] {
  const out: { operator: string; value: string }[] = [];
  for (const match of selector.matchAll(
    /\[\s*class\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*[is]?\s*\]/gi,
  )) {
    out.push({
      operator: match[1] as string,
      value: match[2] ?? match[3] ?? match[4] ?? "",
    });
  }
  return out;
}

/** Rule 4 over a page's elements, given every selector its css writes
 * (`selectorPreludes`) and how an element is named. */
export function lintUnreferencedClasses(
  selectors: readonly string[],
  elements: readonly Element[],
  nameOf: (el: Element) => string,
  viewportId: string,
  findings: Finding[],
): void {
  const names = classNamer(selectors);
  for (const el of elements) {
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    for (const name of classes) {
      if (names(name)) continue;
      findings.push({
        tier: "static",
        severity: "blocking",
        elementId: nameOf(el),
        message: `class "${name}" on ${named(nameOf(el))} in viewport ${viewportId} is named by no rule; drop it, or write the rule that uses it`,
      });
    }
  }
}
