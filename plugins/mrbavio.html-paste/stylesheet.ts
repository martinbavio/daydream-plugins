// A pasted `<style>` as the viewport's sheet (decisions.md #71). THE
// BROWSER PARSES, never a hand parser: the text goes through
// `CSSStyleSheet.replaceSync` and the CSSOM it builds is walked into the
// flat rule list the format stores — one rule per selector list in the
// CSSOM's own spelling, nesting desugared the way css-nesting-1 says,
// at-rule ancestry as `conditions` outermost first, `!important` stripped
// and counted, a `@font-face` lifted into `fonts` in its exact grain.
// Every rule is judged by the kernel's own faces (`dd.core`) before it is
// kept, so what the paste stores is exactly what a landing would admit,
// and what it refuses is counted in the report by the reason: the
// at-keyword that failed, or `rule` for a selector.
//
// The walk is PURE — it reads rules that merely LOOK like CSSOM rules
// (`RuleLike`, which the browser's own satisfy structurally), so it runs
// under node over plain objects (stylesheet.test.ts); only
// `sheetFromStyleText` touches the browser.
//
// What `replaceSync` drops, it drops WITHOUT A WORD (the research,
// wayfinder/research/cascade-spec-facts.md §5): a style rule with one
// invalid selector, an unknown at-rule, every `@import`, an invalid
// declaration. The report must still name them, so a brace-level
// tokenizer counts the source's top-level rules and at-rules and the
// difference against what the walk saw is reported — `rule` for a
// selector the parser refused, the keyword for an at-rule. A tokenizer,
// not a parser: it knows braces, strings, comments and the `@` that opens
// an at-rule, and nothing of what is inside.

import type { CoreApi, StyleRule } from "@daydream/plugin-api";
import type { FontFace } from "@daydream/plugin-api/document";

import { count } from "./report";
import { parseStyleAttribute, stripComments } from "./styleAttribute";

/** The kernel's faces the walk asks, as `dd.core` hands them: the
 * selector grammar, the condition grammar, the declaration grammars, the
 * `src` rule and the family splitter. */
export type SheetRules = Pick<
  CoreApi,
  | "selectorProblem"
  | "conditionKind"
  | "conditionPreludeProblem"
  | "isPropertyName"
  | "isSafeValue"
  | "attrProblem"
  | "familyNames"
>;

/** What the walk needs of a CSSOM rule. A real `CSSRule` satisfies it as
 * it is; the unit tests build plain objects. The KIND is read from the
 * parts, never from a class name: a style rule has `selectorText`, an
 * at-rule's `cssText` opens with its keyword, a nested declarations rule
 * has a `style` and neither. */
export interface RuleLike {
  /** The rule serialized — the one thing every rule has. */
  readonly cssText: string;
  /** A style rule's selector list, in the CSSOM's canonical spelling. */
  readonly selectorText?: string;
  /** The declarations of a style, nested-declarations or `@font-face`
   * rule. `cssText` and never the indexed longhands: iterating a
   * declaration block expands `margin: 0 0 8px` into four, and the
   * author's shorthand is what the format keeps verbatim. */
  readonly style?: { readonly cssText: string };
  /** A grouping rule's children — a style rule's nested rules, a
   * conditional group's contents. */
  readonly cssRules?: ArrayLike<RuleLike>;
  /** A conditional group's prelude without its keyword (`screen and
   * (min-width: 600px)`, `card (min-width: 100px)`, `(display: grid)`). */
  readonly conditionText?: string;
}

export interface SheetWalk {
  rules: StyleRule[];
  fonts: FontFace[];
  /** Rules lost, by reason: an at-keyword (`@import`, `@keyframes`, a
   * refused condition's) or `rule` for a selector. */
  dropped: Record<string, number>;
  /** Declarations the renderer would refuse, as `style (<property>)`;
   * a `@font-face` descriptor the format does not hold, as
   * `@font-face (<descriptor>)`. */
  stripped: Record<string, number>;
  /** `!important` flags stripped from rule declarations. */
  important: number;
}

/** The at-rules whose contents the walk descends, prelude to `conditions`. */
const CONDITIONAL_GROUPS: ReadonlySet<string> = new Set([
  "@media",
  "@container",
  "@supports",
]);

/** The descriptors a stored `@font-face` may carry — the kernel's own
 * closed set (src/core/fonts.ts FONT_FACE_DESCRIPTORS, css-fonts-4 §4.1
 * and the metric overrides of §4.6), which `dd.core` does not hand out;
 * a face carrying another descriptor is refused at the door, so the
 * descriptor is stripped here and counted. */
const FONT_FACE_DESCRIPTORS: ReadonlySet<string> = new Set([
  "font-family",
  "src",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-display",
  "unicode-range",
  "ascent-override",
  "descent-override",
  "line-gap-override",
  "size-adjust",
  "font-feature-settings",
  "font-variation-settings",
]);

const AT_KEYWORD = /^@[a-z-]+/i;

/** At-rules that are packaging, never content: a `@charset` names the
 * encoding of a file the page has already decoded, and the parser drops
 * it as it drops the charset meta (tags.ts) — counting it would measure
 * the file, not the model. */
const PACKAGING_AT_RULES: ReadonlySet<string> = new Set(["@charset"]);

/** The at-keyword an at-rule opens with, lower-cased, or null for a rule
 * that is not one. */
function atKeyword(rule: RuleLike): string | null {
  const match = AT_KEYWORD.exec(rule.cssText.trimStart());
  return match === null ? null : match[0].toLowerCase();
}

/**
 * One `<style>`'s text as stored rules and fonts, parsed by the browser.
 * `replaceSync` never throws for a constructed sheet: what it cannot
 * parse it drops, and the tokenizer diff below reports the drops.
 */
export function sheetFromStyleText(text: string, core: SheetRules): SheetWalk {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return walkStyleSheet(sheet.cssRules, text, core);
}

interface Walk extends SheetWalk {
  core: SheetRules;
  /** What the walk met at the sheet's TOP LEVEL, the tokenizer's
   * vantage: style rules and at-rules by keyword, whatever became of
   * them. The diff against the source is what vanished in the parser. */
  seen: { rules: number; atRules: Record<string, number> };
}

/**
 * The CSSOM walk over a parsed sheet's rules, `source` the text they were
 * parsed from (empty when unknown: then nothing is diffed).
 */
export function walkStyleSheet(
  rules: ArrayLike<RuleLike>,
  source: string,
  core: SheetRules,
): SheetWalk {
  const walk: Walk = {
    core,
    rules: [],
    fonts: [],
    dropped: {},
    stripped: {},
    important: 0,
    seen: { rules: 0, atRules: {} },
  };
  walkRules(rules, walk, null, [], true);
  if (source !== "") {
    const counted = countSource(source);
    const lostRules = counted.rules - walk.seen.rules;
    if (lostRules > 0) count(walk.dropped, "rule", lostRules);
    for (const [keyword, n] of Object.entries(counted.atRules)) {
      const lost = n - (walk.seen.atRules[keyword] ?? 0);
      if (lost > 0) count(walk.dropped, keyword, lost);
    }
  }
  const { rules: out, fonts, dropped, stripped, important } = walk;
  return { rules: out, fonts, dropped, stripped, important };
}

/** `parent` is the enclosing style rule's FLATTENED selector (null at the
 * top level), `conditions` the at-rule ancestry so far, outermost first. */
function walkRules(
  list: ArrayLike<RuleLike>,
  walk: Walk,
  parent: string | null,
  conditions: string[],
  top: boolean,
): void {
  for (const rule of Array.from(list)) {
    if (rule.selectorText !== undefined) {
      if (top) walk.seen.rules += 1;
      walkStyleRule(rule, walk, parent, conditions);
      continue;
    }
    const keyword = atKeyword(rule);
    if (keyword === null) {
      // A nested declarations rule: declarations after or between nested
      // rules, which css-nesting-1 gives the parent's selector and
      // specificity. At the top level nothing is bare, so no parent
      // means a rule the walk does not know, left alone.
      if (rule.style !== undefined && parent !== null)
        storeRule(parent, conditions, rule.style.cssText, walk);
      continue;
    }
    if (top) count(walk.seen.atRules, keyword);
    if (CONDITIONAL_GROUPS.has(keyword) && rule.cssRules !== undefined) {
      const prelude = `${keyword} ${rule.conditionText ?? ""}`.trim();
      walkRules(rule.cssRules, walk, parent, [...conditions, prelude], false);
    } else if (keyword === "@font-face" && rule.style !== undefined) {
      liftFontFace(rule.style.cssText, walk);
    } else {
      // `@import`, `@keyframes`, `@layer`, `@property`, `@page`,
      // `@namespace`, `@scope`… — not stored this step, counted by name,
      // contents lost with the block (a `@layer` block's rules go with
      // it: the entry says so).
      count(walk.dropped, keyword);
    }
  }
}

function walkStyleRule(
  rule: RuleLike,
  walk: Walk,
  parent: string | null,
  conditions: string[],
): void {
  const selectorText = rule.selectorText ?? "";
  const selector =
    parent === null ? selectorText : flattenSelector(parent, selectorText);
  storeRule(selector, conditions, rule.style?.cssText ?? "", walk);
  // Nested rules come after their parent, as the CSSOM hands them over;
  // each is judged on its own flattened selector, so a refused parent
  // refuses its children by the same grammar and counts each.
  if (rule.cssRules !== undefined)
    walkRules(rule.cssRules, walk, selector, conditions, false);
}

/**
 * One stored rule, or a count of why not: the selector through the
 * kernel's grammar (`rule`), each condition through the rule grammar and
 * the no-state rule (its keyword), and only then each declaration through
 * the property and value grammars (stripped by name, the rule kept) — a
 * rule refused whole is ONE loss, and nothing of its declarations is
 * counted beside it. A rule left with no declaration stores nothing: an
 * empty block, or a parent that only nests.
 */
function storeRule(
  selector: string,
  conditions: string[],
  cssText: string,
  walk: Walk,
): void {
  if (cssText.trim() === "") return;
  if (walk.core.selectorProblem(selector) !== null) {
    count(walk.dropped, "rule");
    return;
  }
  for (const prelude of conditions) {
    if (conditionRefused(prelude, walk.core)) {
      count(walk.dropped, atKeyword({ cssText: prelude }) ?? "rule");
      return;
    }
  }
  const parsed = parseStyleAttribute(cssText, walk.core);
  walk.important += parsed.important;
  for (const name of parsed.invalid)
    count(walk.stripped, `style (${name.slice(0, 24)})`);
  if (Object.keys(parsed.styles).length === 0) return;
  walk.rules.push({
    selector,
    ...(conditions.length === 0 ? {} : { conditions: [...conditions] }),
    styles: parsed.styles,
  });
}

/**
 * Whether a rule's condition is one the format refuses: a state prelude
 * (in a rule, `:hover` belongs to the selector — the kernel's ruleProblem
 * says the same) or a prelude the layer grammar refuses.
 *
 * `@supports` is a RULE's to carry (decisions.md #71: emitted verbatim for
 * the browser), and the kernel's sheet validator admits it — but `dd.core`
 * hands out only the ELEMENT-LAYER face, `conditionPreludeProblem`, which
 * still reserves it (#38). So a `@supports` prelude is judged HERE by the
 * same lexical checks that face applies before its reservation: a
 * non-empty condition, balanced parentheses, none of the sheet-text
 * hazards (braces, semicolons, comment delimiters, quotes, control
 * characters). TEMPORARY: the kernel's next phase exposes
 * `dd.core.ruleProblem`, and this branch goes with it.
 */
function conditionRefused(prelude: string, core: SheetRules): boolean {
  const kind = core.conditionKind(prelude);
  if (kind === "state") return true;
  if (kind === "supports") return supportsPreludeProblem(prelude) !== null;
  return core.conditionPreludeProblem(prelude) !== null;
}

const PRELUDE_HAZARD = /[{};"']|\/\*|\*\/|[\u0000-\u001f]/;

/** The layer grammar's lexical checks over a `@supports` prelude — one
 * grammar, so a refused prelude never becomes sheet text. */
function supportsPreludeProblem(prelude: string): string | null {
  const trimmed = prelude.trim();
  if (PRELUDE_HAZARD.test(prelude)) {
    return `A condition cannot contain sheet punctuation: "${trimmed}"`;
  }
  const condition = trimmed.slice("@supports".length).trim();
  if (condition === "") return "@supports needs a condition";
  let depth = 0;
  for (const ch of condition) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) break;
  }
  if (depth !== 0) return "@supports condition has unbalanced parentheses";
  return null;
}

/** The `url()` sources a `src` descriptor names, unquoted — the kernel's
 * own token (src/core/fonts.ts fontSourceUrls). */
const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s'")]*))\s*\)/gi;

/**
 * A `@font-face` into `fonts` (decisions.md #47's grain): the descriptor
 * map from its `cssText`, a descriptor outside the closed set stripped
 * and counted; the face dropped and counted under `@font-face` when it
 * would not load — no family, no `url()` or `local()`, or a `url()` the
 * `src` rule refuses (https or `/assets/` only, the image rule).
 */
function liftFontFace(cssText: string, walk: Walk): void {
  const parsed = parseStyleAttribute(cssText, {
    isPropertyName: (name) => FONT_FACE_DESCRIPTORS.has(name),
    isSafeValue: walk.core.isSafeValue,
  });
  walk.important += parsed.important;
  for (const name of parsed.invalid)
    count(walk.stripped, `@font-face (${name.slice(0, 24)})`);
  const face = parsed.styles;
  const family = face["font-family"];
  const src = face["src"];
  const urls = Array.from(
    (src ?? "").matchAll(URL_TOKEN),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  ).filter((url) => url !== "");
  const loads =
    family !== undefined &&
    walk.core.familyNames(family).length > 0 &&
    src !== undefined &&
    (urls.length > 0 || /\blocal\(/i.test(src)) &&
    urls.every((url) => walk.core.attrProblem("src", url) === null);
  if (!loads) {
    count(walk.dropped, "@font-face");
    return;
  }
  walk.fonts.push(face);
}

// ----------------------------------------------------------- nesting --

/**
 * A nested rule's selector under its parent's, desugared as css-nesting-1
 * §4 says (decisions.md #71): `&` is the parent list inside `:is()` —
 * which is what gives a list parent the specificity of its most specific
 * selector — except that a LEADING `&` under a single parent is the parent
 * written out (`.a .b` + `& .c` → `.a .b .c`), the same matches at the
 * same specificity and the plain descendant form a page would write. A
 * `&` anywhere else (`.w &`, `:not(&)`, a second `&`) keeps `:is()`,
 * since `.w .a .b` would match what `.w :is(.a .b)` does not. A relative
 * selector with no `&` (the CSSOM absolutizes, but a hand-built rule may
 * not) is a descendant. `&` inside a string is text.
 */
export function flattenSelector(parent: string, child: string): string {
  const single = splitTopLevel(parent).length === 1;
  const wrapped = `:is(${parent})`;
  return splitTopLevel(child)
    .map((complex) => {
      const text = complex.trim();
      const ampersands = nestingSelectors(text);
      if (ampersands.length === 0)
        return `${single ? parent : wrapped} ${text}`;
      if (single && ampersands.length === 1 && ampersands[0] === 0)
        return parent + text.slice(1);
      let out = "";
      let last = 0;
      for (const at of ampersands) {
        out += text.slice(last, at) + wrapped;
        last = at + 1;
      }
      return out + text.slice(last);
    })
    .join(", ");
}

/** The offsets of every `&` outside a string. */
function nestingSelectors(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") i += 2;
    else if (ch === '"' || ch === "'") i = stringEnd(text, i);
    else {
      if (ch === "&") out.push(i);
      i++;
    }
  }
  return out;
}

/** The selectors of a list, split at top-level commas — outside parens,
 * brackets and strings. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = stringEnd(text, i);
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(text.slice(start));
  return parts;
}

/** The index just past the string opened at `at` (its closing quote, or
 * the text's end when unterminated); escapes hide the next character. */
function stringEnd(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") i += 2;
    else if (ch === quote) return i + 1;
    else i++;
  }
  return text.length;
}

// --------------------------------------------------------- the source --

export interface SourceCount {
  /** Top-level blocks that do not open with `@`: the style rules the
   * author wrote, whatever the parser made of their selectors. */
  rules: number;
  /** Top-level at-rules by keyword, lower-cased — statements (`@import
   * …;`) and blocks alike. */
  atRules: Record<string, number>;
}

/**
 * What the source text says it holds at its top level, for the diff
 * against the CSSOM walk. Comments go first (the style attribute's own
 * stripper, quote-aware); then a scan that knows strings, parentheses
 * and braces: a statement starts at the first non-blank character and
 * ends at a top-level `;` or at the close of the block its `{` opens —
 * EOF closes a block, as it does for the parser, and a prelude that
 * never opens one is nothing, as it is for the parser.
 */
export function countSource(source: string): SourceCount {
  const text = stripComments(source);
  const out: SourceCount = { rules: 0, atRules: {} };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch) || ch === ";") {
      i++;
      continue;
    }
    const keyword = ch === "@" ? AT_KEYWORD.exec(text.slice(i))?.[0] : null;
    // The statement: to a top-level `;`, or through its block.
    let depth = 0;
    let paren = 0;
    let opened = false;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i = stringEnd(text, i);
        continue;
      }
      i++;
      if (c === "(") paren++;
      else if (c === ")") paren = Math.max(0, paren - 1);
      else if (paren > 0) continue;
      else if (c === "{") {
        depth++;
        opened = true;
      } else if (c === "}") {
        if (--depth <= 0) break;
      } else if (c === ";" && depth === 0) break;
    }
    if (keyword !== null && keyword !== undefined) {
      const lower = keyword.toLowerCase();
      if (!PACKAGING_AT_RULES.has(lower)) count(out.atRules, lower);
    } else if (opened) out.rules += 1;
  }
  return out;
}
