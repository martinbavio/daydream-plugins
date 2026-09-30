// The STATIC lint (docs/agent-css-knowledge-prd.md, "Lints"; decision
// #43, #48 P9): what can be said about a page from its text alone, with
// no render. Deliberately small — four rules, each a fact about CSS the
// browser would enforce silently (a declaration the parser drops, a font
// face nothing names, a class no selector names, a rule a stray `;` has
// the parser drop) — because anything that
// needs a render is the necessity lint's (necessity.ts), and anything
// that needs a selector MATCHED or a value MEASURED — dead rules,
// redundancy, an explicit initial value (rule 2, initialValues.ts), a
// container query with no container — is matchLint.ts's, which mounts the
// page. The facts about CSS it reads
// (family names) are core's, through `dd.core` (one implementation,
// decision #48 P4); the OPINION that these are worth refusing a landing
// for is this plugin's.
//
// A page (decision #76) is two texts. The markup is parsed as the kernel
// parses it (`dd.core.parsePage`, the browser's parser in standards mode;
// pageDom.ts walks it): an element's own declarations are its `style`
// attribute, and it is named in a finding by its unique selector
// (`dd.core.uniqueSelector`), as `measure` names it. The css is read once
// by the kernel's scan (`dd.core.cssBlocks`, walked by pageCss.ts) so
// each declaration is judged as the author wrote it — the
// CSSOM drops `width: 100` before anyone could read it, which is the
// point of rule 1 — and a rule finding carries the rule's position among
// the page's rules in `rule`, the address the gate runner keys a
// declaration by. What only the browser can answer (a `font` shorthand's
// family list) is asked of the CSSOM.

import type {
  CoreApi,
  CssBlock,
  CssDeclaration,
  DreamDocument,
  DreamPage,
  Finding,
} from "@daydream/plugin-api";

import {
  fontFaceBlocks,
  pageRules,
  refused,
  ruleName,
  selectorPreludes,
  strayDelimiter,
  type PageRule,
} from "./pageCss";
import { lintElements } from "./pageDom";

/** Every static finding for the document: per page, the elements' own
 * unit-less lengths in tree order, then the page's unused font faces,
 * then its rules' unit-less lengths, then the classes no rule names, then
 * the stray `;`s that drop a rule. Empty when the document is clean.
 * Browser only: the markup is parsed by the browser. */
export function staticLint(core: CoreApi, doc: DreamDocument): Finding[] {
  const findings: Finding[] = [];
  for (const page of core.viewportItems(doc) as DreamPage[]) {
    const { css } = page.payload;
    const parsed = core.parsePage(page.payload.html);
    // Read once: every walk below is over the same blocks.
    const blocks = core.cssBlocks(css);
    const rules = pageRules(blocks);
    const elements = lintElements(parsed);
    const names = new Map<Element, string>();
    const nameOf = (el: Element): string => {
      let name = names.get(el);
      if (name === undefined) {
        name = core.uniqueSelector(el, parsed);
        names.set(el, name);
      }
      return name;
    };
    for (const el of elements) {
      const own = core.cssDeclarations(el.getAttribute("style") ?? "");
      if (own.length === 0) continue;
      lintUnitlessLengths(own, nameOf(el), findings);
    }
    lintUnusedFontFaces(core, page, blocks, rules, elements, findings);
    lintUnitlessLengthsOnRules(rules, page.id, findings);
    lintUnreferencedClasses(
      selectorPreludes(blocks),
      elements,
      nameOf,
      page.id,
      findings,
    );
    lintStrayDelimiters(css, blocks, page.id, findings);
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

// Rule 2 — an explicit initial value — is measured against the mounted
// page, since whether the UA sheet sets the property on an element is the
// browser's to say (initialValues.ts, matchLint.ts).

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
  blocks: readonly CssBlock[],
  rules: readonly PageRule[],
  elements: readonly Element[],
  findings: Finding[],
): void {
  const faces = fontFaceBlocks(blocks).map(({ block }) => block);
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
    core.cssDeclarations(el.getAttribute("style") ?? "").forEach(use);
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

// ---------------------------------------------------------------------------
// Rule 5 — a stray `;` that drops a rule. Where the parser reads rules
// alone — the sheet's top level, and the block of a `@media`, `@supports`,
// `@container`, `@layer`, `@starting-style` or `@keyframes` no style rule
// encloses — a `;` ends nothing: `.a { … };` followed by `.b { … }` reads
// `; .b` as the next rule's selector, and the browser drops that rule
// whole, with nothing said. The kernel's scan reads it as the parser does
// (`CssBlock.prelude` holds the `;`, its `range` starts at it); among
// declarations, and after the last rule, a `;` is harmless and no prelude
// holds one. A statement after the `;` is swallowed too (`; @layer q;
// .c` drops the `@layer q` and the rule `.c`), so the finding names what
// is dropped. One finding per stray `;`: the refused rule is none of the
// page's for every other walk (pageCss.ts `refused`), so it is never also
// a rule that matches nothing, a dead declaration, or an unused face.
// Blocking, as every static finding is: a rule silently gone is a defect,
// and the fix is one character. A `Finding` carries no text range, so the
// sentence names the line of the css the `;` is on.

/** Rule 5 over a page's blocks, read from `css`. */
export function lintStrayDelimiters(
  css: string,
  blocks: readonly CssBlock[],
  viewportId: string,
  findings: Finding[],
): void {
  const levels: { blocks: readonly CssBlock[]; at: number; within: string[] }[] = [
    { blocks, at: 0, within: [] },
  ];
  while (levels.length > 0) {
    const level = levels[levels.length - 1]!;
    const block = level.blocks[level.at++];
    if (block === undefined) {
      levels.pop();
      continue;
    }
    const label = refused(block)
      ? strayFinding(css, block, level.within, viewportId, findings)
      : block.prelude;
    if (block.children.length > 0) {
      levels.push({ blocks: block.children, at: 0, within: [...level.within, label] });
    }
  }
}

/** The finding for one refused block; answers what the block reads as
 * without its stray `;`, which is what a stray `;` nested in it is said
 * to be inside. */
function strayFinding(
  css: string,
  block: CssBlock,
  within: readonly string[],
  viewportId: string,
  findings: Finding[],
): string {
  // Named on one line, however the text breaks it.
  const prelude = block.prelude.replace(/\s+/g, " ");
  const at = strayDelimiter(prelude);
  const head = prelude.slice(0, at).trim();
  // What follows the `;`: any statement it swallowed, then the rule.
  const after = splitStray(prelude.slice(at + 1));
  const where = within.length === 0 ? "" : ` in \`${within.join(" › ")}\``;
  const inKeyframes = /^@(?:-\w+-)?keyframes\b/i.test(within.at(-1) ?? "");
  const line = lineOf(css, block);
  const place = `${where} of viewport ${viewportId} (line ${line} of its css)`;
  if (head !== "") {
    findings.push({
      tier: "static",
      severity: "blocking",
      message: `the stray \`;\` after \`${head}\`${place} makes the browser drop the rule \`${prelude}\` whole; remove the \`;\`, and \`${head}\` too if it is a leftover`,
    });
    return prelude;
  }
  // The run of `;` itself, however many (`;;`).
  const stray = /^[;\s]*/.exec(prelude)![0].replace(/\s+/g, "");
  const rule = after.at(-1);
  if (rule === undefined) {
    findings.push({
      tier: "static",
      severity: "blocking",
      message: `the stray \`${stray}\`${place} makes the browser drop the block after it; remove it`,
    });
    return prelude;
  }
  const noun = inKeyframes ? "the keyframe" : "the rule";
  const dropped = listed([
    ...after.slice(0, -1).map((part) => `\`${part}\``),
    `${noun} \`${rule}\``,
  ]);
  findings.push({
    tier: "static",
    severity: "blocking",
    message: `the stray \`${stray}\` before \`${after.join("; ")}\`${place} makes the browser drop ${dropped}; remove it`,
  });
  return rule;
}

/** The parts of a prelude's text after a stray `;`, split at each
 * further top-level `;`, trimmed, the empty ones (`;;`) left out. */
function splitStray(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  for (let at = strayDelimiter(rest); at !== -1; at = strayDelimiter(rest)) {
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at + 1);
  }
  parts.push(rest.trim());
  return parts.filter((part) => part !== "");
}

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The line of `css` the block's stray `;` is on, counted from 1: where
 * the scan's range starts, or, for a prelude with text before its `;`
 * (`.a;b`), that `;` found in the text. */
function lineOf(css: string, block: CssBlock): number {
  const [start, end] = block.range;
  const found = strayDelimiter(css, start, end);
  const at = found === -1 ? start : found;
  let line = 1;
  for (let i = 0; i < at && i < css.length; i++) if (css[i] === "\n") line++;
  return line;
}
