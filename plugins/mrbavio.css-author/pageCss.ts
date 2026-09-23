// A PAGE'S CSS AS THE LINTS READ IT (decision #76). A page stores its
// stylesheet as text, and every lint judges a DECLARATION as the author
// wrote it: `margin: 0` is one line to keep or drop, not four longhands
// the CSSOM expands it into, and `width: 100` is a line the author wrote
// even though the browser's parser drops it and the CSSOM never shows it.
// So the text is scanned here — a tokenizer that knows strings, comments,
// escapes, parentheses and braces, which is all it takes to find where a
// rule and a declaration begin and end — and the browser is asked what
// only it can answer: which elements a selector matches, what an element
// computes, what a page looks like without a line (matchLint.ts,
// necessity.ts). The same split the kernel makes for its own editor
// (src/render/cssRanges.ts): a CSSOM rule has no offsets, and a rule the
// browser refuses is simply absent, so lining the CSSOM up with the text
// by counting drifts.
//
// Pure and DOM-free, so it is proved under node (pageCss.test.ts).
//
// THE RULES a lint judges (`pageRules`) are the style rules, in source
// order, each with its declarations: a top-level rule, a rule nested in
// another (CSS nesting, its selector resolved against its parents the way
// the browser desugars it, `&` → `:is(parent)`), and the declarations an
// at-rule nested in a style rule holds for that rule's subject
// (`.card { @media (…) { padding: 8px } }`). Only the group at-rules are
// looked into — the ones whose blocks style elements; a `@font-face`, a
// `@keyframes`, a `@page` hold no rule of the page's.
//
// THE MEASURER'S PROBES. The live face core mounts (dd.mountViewport)
// carries decision #42's container probes on its copy of the css: a
// `--dream-container-N` declaration, an `@media all` reach copy before
// each `@container` rule, an `@property` per probe. Scanning the MOUNTED
// text (necessity.ts, which removes a declaration by editing it) must see
// the same rules as scanning the stored text, so those are left out here.

/** One declaration as written. */
export interface CssDeclaration {
  /** Lower-cased; a custom property keeps its case (it is
   * case-sensitive). */
  property: string;
  /** The value, trimmed, its comments and any `!important` taken out. */
  value: string;
  important: boolean;
  /** `[start, end)` of the declaration in the scanned text, from its name
   * through its `;` when it has one: cutting this range removes the line
   * and nothing else. */
  range: [number, number];
}

/** One block (or statement) of the text, nested as the text nests it. */
export interface CssBlock {
  /** The text before the block — a selector list or an at-rule prelude —
   * comments taken out, trimmed. */
  prelude: string;
  /** `[start, end)` of the whole block, prelude included. */
  range: [number, number];
  /** A statement at-rule (`@import …;`, `@layer a, b;`) has no block. */
  statement: boolean;
  /** The block's own declarations, outside any block nested in it. */
  declarations: CssDeclaration[];
  children: CssBlock[];
}

/** One style rule of a page, as the lints judge it. */
export interface PageRule {
  /** Its position among the page's rules, in source order. What a
   * finding's `rule` holds: the gate runner keys a declaration by it
   * (a page has no sheet of rules to index, decision #76), and the static
   * and necessity lints, reading the same text, agree on it. */
  index: number;
  /** The selector as written (`&:hover` for a nested rule). For an
   * at-rule's own declarations inside a style rule, that style rule's. */
  prelude: string;
  /** The style rules it is nested inside, outermost first, each prelude
   * as written. */
  parents: string[];
  /** The at-rule preludes it sits inside, outermost first. */
  conditions: string[];
  /** The selector the browser matches: nesting resolved against the
   * parents (`.card { &:hover {…} }` → `:is(.card):hover`). */
  selector: string;
  declarations: CssDeclaration[];
}

/** The at-rules whose blocks hold rules (or, inside a style rule,
 * declarations) that style elements — the kernel's own list for the same
 * question (src/measure/livePage.ts). */
const GROUP_RULES: ReadonlySet<string> = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "starting-style",
]);

/** A measurer probe's property (src/measure/livePage.ts). */
const PROBE_PROPERTY = /^--dream-container-\d+$/;

// ---------------------------------------------------------------------------
// The scanner.

/** Every block of the text, nested. Malformed input never throws: an
 * unclosed block runs to the end, as it does in a browser. */
export function scanCss(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  let i = 0;
  while (i < css.length) {
    const scanned = scanBody(css, i, css.length);
    out.push(...scanned.blocks);
    // A stray `}` at the top level closes nothing; step over it.
    i = scanned.end + 1;
  }
  return out;
}

/** The declarations of a declaration list with no blocks — a `style`
 * attribute's text. */
export function scanDeclarations(text: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  let i = 0;
  while (i < text.length) {
    const scanned = scanBody(text, i, text.length);
    declarations.push(...scanned.declarations);
    i = scanned.end + 1;
  }
  return declarations;
}

/** Scan from `from` until the `}` that closes the body (its index is
 * `end`) or `to`. */
function scanBody(
  css: string,
  from: number,
  to: number,
): { blocks: CssBlock[]; declarations: CssDeclaration[]; end: number } {
  const blocks: CssBlock[] = [];
  const declarations: CssDeclaration[] = [];
  let i = from;
  let start = -1;
  let depth = 0;

  const segment = (end: number, next: number): void => {
    if (start === -1) return;
    const text = css.slice(start, end);
    if (text.trimStart().startsWith("@")) {
      blocks.push({
        prelude: withoutComments(text).trim(),
        range: [start, next],
        statement: true,
        declarations: [],
        children: [],
      });
    } else {
      const declaration = parseDeclaration(css, start, end, next);
      if (declaration !== null) declarations.push(declaration);
    }
    start = -1;
  };

  while (i < to) {
    const ch = css[i]!;
    if (ch === "/" && css[i + 1] === "*") {
      i = commentEnd(css, i, to);
      continue;
    }
    if (start === -1 && !/\s/.test(ch)) start = i;
    if (ch === '"' || ch === "'") {
      i = stringEnd(css, i, to);
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ";") {
      segment(i, i + 1);
      i++;
      continue;
    } else if (depth === 0 && ch === "{") {
      const blockStart = start === -1 ? i : start;
      const prelude = withoutComments(css.slice(blockStart, i)).trim();
      const inner = scanBody(css, i + 1, to);
      const close = inner.end;
      blocks.push({
        prelude,
        range: [blockStart, Math.min(close + 1, to)],
        statement: false,
        declarations: inner.declarations,
        children: inner.blocks,
      });
      start = -1;
      i = close + 1;
      continue;
    } else if (depth === 0 && ch === "}") {
      segment(i, i);
      return { blocks, declarations, end: i };
    }
    i++;
  }
  segment(to, to);
  return { blocks, declarations, end: to };
}

/** A declaration from `[start, end)` (`next` past its `;`), or null for
 * text that names no property. */
function parseDeclaration(
  css: string,
  start: number,
  end: number,
  next: number,
): CssDeclaration | null {
  const text = withoutComments(css.slice(start, end));
  const colon = text.indexOf(":");
  if (colon === -1) return null;
  const name = text.slice(0, colon).trim();
  if (!/^(?:--|-?[a-zA-Z_])[\w-]*$/.test(name)) return null;
  let value = text.slice(colon + 1).trim();
  const important = /!\s*important$/i.test(value);
  if (important) value = value.replace(/!\s*important$/i, "").trim();
  return {
    property: name.startsWith("--") ? name : name.toLowerCase(),
    value,
    important,
    range: [start, next],
  };
}

/** The text with every comment taken out — outside strings. */
export function withoutComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "*") {
      i = commentEnd(text, i, text.length);
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = stringEnd(text, i, text.length);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function commentEnd(css: string, from: number, to: number): number {
  const end = css.indexOf("*/", from + 2);
  return end === -1 || end >= to ? to : end + 2;
}

function stringEnd(css: string, from: number, to: number): number {
  const quote = css[from];
  for (let i = from + 1; i < to; i++) {
    if (css[i] === "\\") i++;
    else if (css[i] === quote) return i + 1;
    // An unterminated string ends at the newline, as the CSS tokenizer's
    // bad-string token does.
    else if (css[i] === "\n") return i;
  }
  return to;
}

/** Each bracket that opens a block in CSS, and the one that closes it. */
const CLOSER: Readonly<Record<string, string>> = {
  "{": "}",
  "(": ")",
  "[": "]",
};

/**
 * Whether `css` can be put inside a block as written and the block's own
 * `}` after it still close that block — the kernel's own test, to the
 * letter (src/render/cssRanges.ts closesItsOwnBlocks), which decides how
 * its landing folds a `<style media>` (pageDom.ts withMedia): every `{`,
 * `(` and `[` it opens is closed by its own closer and it closes nothing
 * it did not open, and no comment, string or unquoted `url(…)` runs off
 * its end. Read as the CSS tokenizer reads it: a bracket in a comment, a
 * string, a url or an escape is not one, and a url is known by its name
 * with escapes decoded (`\75rl(` is `url(`). Where it is unsure it
 * answers no — a stray `)` the CSS parser would keep as a token is
 * refused here too.
 */
export function closesItsOwnBlocks(text: string): boolean {
  // The tokenizer's preprocessing: every newline is one `\n`.
  const css = text.replace(/\r\n?|\f/g, "\n");
  const open: string[] = [];
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    const name = nameAt(css, i);
    if (name !== null) {
      i = name.end - 1;
      if (name.value.toLowerCase() !== "url" || css[name.end] !== "(") {
        continue;
      }
      let j = name.end + 1;
      while (j < css.length && /[\t\n ]/.test(css[j]!)) j++;
      // A quoted url is an ordinary function around a string.
      if (css[j] === '"' || css[j] === "'") continue;
      // An unquoted one is one token to its `)`, a bad one included: a
      // quote or a bracket inside it is the url's.
      while (j < css.length && css[j] !== ")") j += css[j] === "\\" ? 2 : 1;
      if (j >= css.length) return false;
      i = j;
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return false;
      i = end + 1;
    } else if (ch === '"' || ch === "'") {
      // Ends at its quote, or at a newline (the tokenizer's bad string);
      // an escaped newline continues it.
      let j = i + 1;
      while (j < css.length && css[j] !== ch && css[j] !== "\n") {
        j += css[j] === "\\" ? 2 : 1;
      }
      if (j >= css.length) return false;
      i = j;
    } else if (ch in CLOSER) {
      open.push(CLOSER[ch]!);
    } else if (ch === "}" || ch === ")" || ch === "]") {
      if (open.pop() !== ch) return false;
    }
  }
  return open.length === 0;
}

/** The run of name characters starting at `i` — letters, digits, `_`,
 * `-`, anything non-ASCII, and escapes, decoded — or null when none
 * starts there. What the tokenizer reads as one name (a number's unit
 * included), so no part of it is taken for anything else. A `\` before a
 * newline is no escape, and starts no name. */
function nameAt(css: string, i: number): { value: string; end: number } | null {
  let value = "";
  let j = i;
  while (j < css.length) {
    const ch = css[j]!;
    if (/[\w-]/.test(ch) || ch.charCodeAt(0) >= 0x80) {
      value += ch;
      j++;
    } else if (ch === "\\" && j + 1 < css.length && css[j + 1] !== "\n") {
      const hex = /^[\dA-Fa-f]{1,6}/.exec(css.slice(j + 1, j + 7))?.[0];
      if (hex === undefined) {
        value += css[j + 1];
        j += 2;
        continue;
      }
      const code = parseInt(hex, 16);
      value +=
        code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
          ? "�"
          : String.fromCodePoint(code);
      j += 1 + hex.length;
      if (/[\t\n ]/.test(css[j] ?? "")) j++;
    } else break;
  }
  return j === i ? null : { value, end: j };
}

// ---------------------------------------------------------------------------
// The rules.

/** A prelude's at-keyword, lower-cased, or null for a style rule's
 * selector list. */
export function atKeyword(prelude: string): string | null {
  const match = /^@([\w-]+)/.exec(prelude);
  return match === null ? null : (match[1] as string).toLowerCase();
}

/** Every style rule of the text, in source order (see PageRule). */
export function pageRules(css: string): PageRule[] {
  const rules: PageRule[] = [];
  const visit = (
    blocks: readonly CssBlock[],
    conditions: string[],
    parents: string[],
    parentSelector: string | null,
  ): void => {
    blocks.forEach((block, at) => {
      if (block.statement) return;
      if (isProbeCopy(blocks, at)) return;
      const keyword = atKeyword(block.prelude);
      if (keyword === null) {
        const selector =
          parentSelector === null
            ? block.prelude
            : resolveNested(block.prelude, parentSelector);
        rules.push({
          index: rules.length,
          prelude: block.prelude,
          parents,
          conditions,
          selector,
          declarations: ownDeclarations(block),
        });
        visit(
          block.children,
          conditions,
          [...parents, block.prelude],
          selector,
        );
        return;
      }
      if (!GROUP_RULES.has(keyword)) return;
      const inner = [...conditions, block.prelude];
      const own = ownDeclarations(block);
      if (parentSelector !== null && own.length > 0) {
        rules.push({
          index: rules.length,
          prelude: parents[parents.length - 1] as string,
          parents: parents.slice(0, -1),
          conditions: inner,
          selector: parentSelector,
          declarations: own,
        });
      }
      visit(block.children, inner, parents, parentSelector);
    });
  };
  visit(scanCss(css), [], [], null);
  return rules;
}

/** Every `@font-face` block of the text, wherever a group rule holds it,
 * with its declarations. */
export function fontFaces(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  const visit = (blocks: readonly CssBlock[]): void => {
    for (const block of blocks) {
      if (block.statement) continue;
      const keyword = atKeyword(block.prelude);
      if (keyword === "font-face") out.push(block);
      else if (keyword === null || GROUP_RULES.has(keyword)) {
        visit(block.children);
      }
    }
  };
  visit(scanCss(css));
  return out;
}

/** Every `@media` prelude of the text, nested ones included, as written. */
export function mediaPreludes(css: string): string[] {
  const out: string[] = [];
  const visit = (blocks: readonly CssBlock[]): void => {
    for (const block of blocks) {
      if (block.statement) continue;
      const keyword = atKeyword(block.prelude);
      if (keyword === "media") out.push(block.prelude);
      if (keyword === null || GROUP_RULES.has(keyword)) visit(block.children);
    }
  };
  visit(scanCss(css));
  return out;
}

/** Every selector-bearing prelude of the text — each style rule's
 * selector as written, nested ones included, and each `@scope`'s — what
 * the unreferenced-class rule reads for names (staticLint.ts). */
export function selectorPreludes(css: string): string[] {
  const out: string[] = [];
  const visit = (blocks: readonly CssBlock[]): void => {
    for (const block of blocks) {
      if (block.statement) continue;
      const keyword = atKeyword(block.prelude);
      if (keyword === null || keyword === "scope") out.push(block.prelude);
      if (keyword === null || GROUP_RULES.has(keyword)) visit(block.children);
    }
  };
  visit(scanCss(css));
  return out;
}

function ownDeclarations(block: CssBlock): CssDeclaration[] {
  return block.declarations.filter((d) => !PROBE_PROPERTY.test(d.property));
}

/** Whether `blocks[at]` is a measurer's reach copy: an `@media all`
 * right before an `@container` rule, holding nothing but probe
 * declarations (src/measure/livePage.ts withContainerProbes). */
function isProbeCopy(blocks: readonly CssBlock[], at: number): boolean {
  const block = blocks[at] as CssBlock;
  if (block.prelude.toLowerCase() !== "@media all") return false;
  const next = blocks.slice(at + 1).find((b) => !b.statement);
  if (next === undefined || atKeyword(next.prelude) !== "container") {
    return false;
  }
  let probes = 0;
  const onlyProbes = (b: CssBlock): boolean =>
    b.declarations.every((d) => {
      if (!PROBE_PROPERTY.test(d.property)) return false;
      probes++;
      return true;
    }) && b.children.every(onlyProbes);
  return onlyProbes(block) && probes > 0;
}

/** A nested rule's selector resolved against its parent's, the way the
 * browser desugars nesting: each `&` is `:is(parent)`, and a member with
 * none is a descendant of it (`> .x` a child). `:is()` carries the most
 * specific parent's weight, which is what nesting gives it too. */
export function resolveNested(prelude: string, parent: string): string {
  const is = `:is(${parent})`;
  return splitTopLevelCommas(prelude)
    .map((member) => {
      const trimmed = member.trim();
      return hasNestingSelector(trimmed)
        ? replaceNestingSelector(trimmed, is)
        : `${is} ${trimmed}`;
    })
    .join(", ");
}

function hasNestingSelector(selector: string): boolean {
  return replaceNestingSelector(selector, "\u0000").includes("\u0000");
}

function replaceNestingSelector(selector: string, by: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] as string;
    if (quote !== null) {
      out += ch;
      if (ch === "\\") out += selector[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\") {
      out += ch + (selector[++i] ?? "");
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    out += ch === "&" ? by : ch;
  }
  return out;
}

/** The selector list's members, split at top-level commas — outside
 * parens, brackets and strings. */
export function splitTopLevelCommas(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] as string;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") quote = ch;
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

/** The legacy one-colon spellings of pseudo-elements, which a selector
 * may still use. */
const LEGACY_PSEUDO_ELEMENTS = /:(before|after|first-line|first-letter)\s*$/i;

/** A selector member's trailing pseudo-element, split off, or null when
 * it has none. `Element.matches` has no element for a pseudo-element to
 * be, so every match strips it first and keeps its name aside. */
export function trailingPseudoElement(
  member: string,
): { base: string; pseudo: string } | null {
  const trimmed = member.trim();
  const match =
    /::([a-z-]+)(?:\([^)]*\))?\s*$/i.exec(trimmed) ??
    LEGACY_PSEUDO_ELEMENTS.exec(trimmed);
  if (match === null) return null;
  // `a::before` is a pseudo-element; `a:not(::before)` never parses.
  const base = trimmed.slice(0, match.index);
  return { base: base === "" ? "*" : base, pseudo: `::${(match[1] as string).toLowerCase()}` };
}

/** The selector with every member's trailing pseudo-element stripped:
 * what "does this rule match anything" asks of a page. */
export function selectorForMatching(selector: string): string {
  return splitTopLevelCommas(selector)
    .map((member) => trailingPseudoElement(member)?.base ?? member.trim())
    .join(", ");
}

/** What a finding calls a rule: its selector as written after the rules
 * it is nested in (`.card › &:hover`, the CSS editor's label), in
 * backticks, then the at-rules it sits inside. */
export function ruleName(rule: Pick<PageRule, "prelude" | "parents" | "conditions">): string {
  const label = `\`${[...rule.parents, rule.prelude].join(" › ")}\``;
  return rule.conditions.length === 0
    ? label
    : `${label} in \`${rule.conditions.join(" › ")}\``;
}

/** A declaration list as a map, later wins — the grain the redundancy
 * questions compare values in. */
export function declarationMap(
  declarations: readonly CssDeclaration[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of declarations) {
    out[d.property] = d.important ? `${d.value} !important` : d.value;
  }
  return out;
}

/** The text with the ranges cut out (any order; they must not overlap). */
export function withoutRanges(
  text: string,
  ranges: readonly (readonly [number, number])[],
): string {
  let out = text;
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
