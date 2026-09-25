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
// `@keyframes`, a `@page` hold no rule of the page's. A rule inside an
// `@scope` is relative to the scope's root, as the browser reads it (its
// `selector` and `scopes`; ruleMatch.ts matches it), and the `@scope`'s
// own declarations style the root.
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
   * parents (`.card { &:hover {…} }` → `:is(.card):hover`), and inside
   * an `@scope` relative to its root the way the browser reads it — a
   * member naming neither `:scope` nor `&` is the root's descendant
   * (`img` → `:where(:scope) img`), and `&` is `:where(:scope)`. Where
   * `scopes` is not empty, `:scope` in it is the innermost scope's root,
   * which `Element.matches` does not know: ruleMatch.ts matches it. */
  selector: string;
  /** The `@scope` rules it sits inside, outermost first; empty outside
   * any. */
  scopes: PageScope[];
  declarations: CssDeclaration[];
}

/** One `@scope` a rule sits inside, its selectors resolved as a rule's
 * are: the roots' against the style rule the `@scope` is nested in, or
 * relative to the enclosing scope's root; the limits' relative to the
 * scope's own root. */
export interface PageScope {
  /** The roots' selector, or null for a prelude with none — whose root
   * is the parent of the `<style>` holding the sheet. */
  start: string | null;
  /** The limits' selector, or null for none. */
  end: string | null;
}

// mirrors: src/measure/livePage.ts GROUP_RULES
/** The at-rules whose blocks hold rules (or, inside a style rule,
 * declarations) that style elements — the kernel's own list for the same
 * question, to the letter: the measurer copies and probes through these,
 * so the rules read here are the rules its probes stand in. */
const GROUP_RULES = new Set([
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
 * unclosed block runs to the end, as it does in a browser, and a stray
 * `}` at the top level closes nothing. */
export function scanCss(css: string): CssBlock[] {
  return scan(css, true).blocks;
}

/** The declarations of a declaration list with no blocks — a `style`
 * attribute's text. */
export function scanDeclarations(text: string): CssDeclaration[] {
  return scan(text, false).declarations;
}

/** One body being scanned: the sheet's (or the declaration list's) own,
 * or a block's, whose lists it fills. */
interface Body {
  blocks: CssBlock[];
  declarations: CssDeclaration[];
  /** The block this is the body of; null for the text's own. */
  block: CssBlock | null;
}

/**
 * The text's own body — its blocks and declarations — with every block's
 * nested in it. One loop over the text with an explicit stack of the
 * bodies open, so no nesting, however deep, can exhaust the call stack,
 * and every turn of the loop moves past at least one character. A `{`
 * opens a body, the `}` that closes it pops it, and one with none open
 * closes nothing and is stepped over; a body still open at the end runs
 * to it. `topLevel` is the stylesheet's own list of rules, where the
 * legacy markers `<!--` and `-->` between rules are skipped, as the CSS
 * tokenizer's CDO and CDC tokens are; inside a block they are part of the
 * next rule's prelude, which they make invalid.
 */
function scan(
  css: string,
  topLevel: boolean,
): { blocks: CssBlock[]; declarations: CssDeclaration[] } {
  const to = css.length;
  const root: Body = { blocks: [], declarations: [], block: null };
  const open: Body[] = [root];
  let body = root;
  let start = -1;
  let depth = 0;

  const segment = (end: number, next: number): void => {
    if (start === -1) return;
    const text = css.slice(start, end);
    if (text.trimStart().startsWith("@")) {
      body.blocks.push({
        prelude: withoutComments(text).trim(),
        range: [start, next],
        statement: true,
        declarations: [],
        children: [],
      });
    } else {
      const declaration = parseDeclaration(css, start, end, next);
      if (declaration !== null) body.declarations.push(declaration);
    }
    start = -1;
  };

  let i = 0;
  while (i < to) {
    const ch = css[i]!;
    // Where the next turn starts; every branch moves it past `i`.
    let next = i + 1;
    if (ch === "/" && css[i + 1] === "*") {
      next = commentEnd(css, i, to);
    } else if (
      body === root &&
      topLevel &&
      start === -1 &&
      /^(?:<!--|-->)/.test(css.slice(i, i + 4))
    ) {
      next = i + (ch === "<" ? 4 : 3);
    } else {
      if (start === -1 && !/\s/.test(ch)) start = i;
      if (ch === '"' || ch === "'") {
        next = stringEnd(css, i, to);
      } else if (ch === "\\") {
        next = i + 2;
      } else if (ch === "(" || ch === "[") {
        depth++;
      } else if (ch === ")" || ch === "]") {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && ch === ";") {
        segment(i, i + 1);
      } else if (depth === 0 && ch === "{") {
        const blockStart = start === -1 ? i : start;
        const block: CssBlock = {
          prelude: withoutComments(css.slice(blockStart, i)).trim(),
          range: [blockStart, to],
          statement: false,
          declarations: [],
          children: [],
        };
        body.blocks.push(block);
        body = { blocks: block.children, declarations: block.declarations, block };
        open.push(body);
        start = -1;
      } else if (depth === 0 && ch === "}") {
        segment(i, i);
        if (body.block !== null) {
          body.block.range[1] = i + 1;
          open.pop();
          body = open[open.length - 1]!;
        }
      }
    }
    i = Math.max(next, i + 1);
  }
  segment(to, to);
  return { blocks: root.blocks, declarations: root.declarations };
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

// The kernel's own two token ends (a plugin may not import its source),
// each marked so the kernel test compares it with the kernel's.

// mirrors: src/render/cssRanges.ts commentEnd
function commentEnd(css: string, from: number, to: number): number {
  const end = css.indexOf("*/", from + 2);
  return end === -1 || end >= to ? to : end + 2;
}

// mirrors: src/render/cssRanges.ts stringEnd
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

// ---------------------------------------------------------------------------
// The rules.

/** A prelude's at-keyword, lower-cased, or null for a style rule's
 * selector list. */
export function atKeyword(prelude: string): string | null {
  const match = /^@([\w-]+)/.exec(prelude);
  return match === null ? null : (match[1] as string).toLowerCase();
}

/** Every style rule of the text, in source order (see PageRule). The
 * blocks are walked with an explicit stack, as they were scanned, so no
 * nesting exhausts the call stack; a rule's lists of parents, conditions
 * and scopes are built only for a rule the walk keeps (`Chain`). */
export function pageRules(css: string): PageRule[] {
  const rules: PageRule[] = [];
  /** A list of sibling blocks being walked, and what they sit inside. */
  interface Level {
    blocks: readonly CssBlock[];
    at: number;
    conditions: Chain<string>;
    parents: Chain<string>;
    parentSelector: string | null;
    scopes: Chain<PageScope>;
  }
  const levels: Level[] = [
    {
      blocks: scanCss(css),
      at: 0,
      conditions: null,
      parents: null,
      parentSelector: null,
      scopes: null,
    },
  ];
  while (levels.length > 0) {
    const level = levels[levels.length - 1]!;
    if (level.at >= level.blocks.length) {
      levels.pop();
      continue;
    }
    const at = level.at++;
    const block = level.blocks[at]!;
    const { conditions, parents, parentSelector, scopes } = level;
    if (block.statement) continue;
    if (isProbeCopy(level.blocks, at)) continue;
    const keyword = atKeyword(block.prelude);
    if (keyword === null) {
      const selector =
        parentSelector !== null
          ? resolveNested(block.prelude, parentSelector)
          : scopes !== null
            ? relativeToScope(block.prelude)
            : block.prelude;
      rules.push({
        index: rules.length,
        prelude: block.prelude,
        parents: listOf(parents),
        conditions: listOf(conditions),
        selector,
        scopes: listOf(scopes),
        declarations: ownDeclarations(block),
      });
      levels.push({
        blocks: block.children,
        at: 0,
        conditions,
        parents: link(parents, block.prelude),
        parentSelector: selector,
        scopes,
      });
      continue;
    }
    if (!GROUP_RULES.has(keyword)) continue;
    const inner = link(conditions, block.prelude);
    // An `@scope` starts afresh: the rules in it are relative to its
    // root, not nested in the style rule around it (whose selector its
    // roots' resolve against instead).
    const scoped = keyword === "scope";
    const innerScopes = scoped
      ? link(scopes, scopeOf(block.prelude, parentSelector, scopes !== null))
      : scopes;
    const innerParent = scoped ? null : parentSelector;
    // The block's own declarations style the style rule's subject — or,
    // an `@scope`'s own, the scope's root, named `:scope` (Chromium
    // applies none written in another at-rule directly inside one).
    const own = ownDeclarations(block);
    if (own.length > 0 && (innerParent !== null || scoped)) {
      rules.push({
        index: rules.length,
        // A parent selector is a style rule's, so `parents` holds it.
        ...(innerParent !== null
          ? {
              prelude: parents!.value,
              parents: listOf(parents!.up),
              selector: innerParent,
            }
          : { prelude: ":scope", parents: listOf(parents), selector: SCOPE_ROOT }),
        conditions: listOf(inner),
        scopes: listOf(innerScopes),
        declarations: own,
      });
    }
    levels.push({
      blocks: block.children,
      at: 0,
      conditions: inner,
      parents,
      parentSelector: innerParent,
      scopes: innerScopes,
    });
  }
  return rules;
}

/** A list grown one item per level of nesting, shared by everything
 * below that level: growing it costs the same at any depth, and its items
 * are written out (`listOf`) only for a rule that needs them — so text
 * nested deep but holding few rules is read in time linear in its
 * length. Null is the empty list. */
type Chain<T> = { value: T; up: Chain<T>; list?: T[] } | null;

function link<T>(up: Chain<T>, value: T): Chain<T> {
  return { value, up };
}

/** The chain's items, outermost first, written out once per link. */
function listOf<T>(chain: Chain<T>): T[] {
  if (chain === null) return [];
  if (chain.list === undefined) {
    const out: T[] = [];
    for (let c: Chain<T> = chain; c !== null; c = c.up) out.push(c.value);
    chain.list = out.reverse();
  }
  return chain.list;
}

/** Each of `blocks` and every block nested in it, in source order — a
 * block before those inside it — walked with an explicit stack; `enter`
 * answers whether to look inside the block. */
function walkBlocks(
  blocks: readonly CssBlock[],
  enter: (block: CssBlock) => boolean,
): void {
  const levels: { blocks: readonly CssBlock[]; at: number }[] = [
    { blocks, at: 0 },
  ];
  while (levels.length > 0) {
    const level = levels[levels.length - 1]!;
    const block = level.blocks[level.at++];
    if (block === undefined) {
      levels.pop();
      continue;
    }
    if (enter(block) && block.children.length > 0) {
      levels.push({ blocks: block.children, at: 0 });
    }
  }
}

/** What `&`, and the implicit start of a member naming no root, is
 * inside an `@scope`: its root, adding no specificity. */
const SCOPE_ROOT = ":where(:scope)";

/** A selector list read inside an `@scope`, relative to its root, as the
 * browser reads it: a member that starts with a combinator, or names
 * neither `:scope` nor `&`, is the root's descendant (`img` →
 * `:where(:scope) img`), and `&` is the root. Checked against Chromium:
 * `:scope` itself is the root, `> img` its child, and `.page img` needs
 * `.page` inside the root. */
function relativeToScope(selector: string): string {
  return splitTopLevelCommas(selector)
    .map((member) => {
      const trimmed = member.trim();
      if (/^[>+~]/.test(trimmed)) return `${SCOPE_ROOT} ${trimmed}`;
      const rooted = replaceNestingSelector(trimmed, SCOPE_ROOT);
      return hasScopePseudo(rooted)
        ? rooted
        : `${SCOPE_ROOT} ${trimmed}`;
    })
    .join(", ");
}

/** An `@scope` prelude (`@scope (<start>) to (<end>)`, either part
 * optional) as a PageScope: the roots resolved against the style rule it
 * is nested in (`parentSelector`, as nesting resolves a rule), or, in
 * another scope, relative to that scope's root; the limits relative to
 * this scope's root. A prelude the browser would refuse makes a scope
 * with no root, so nothing in it matches — as nothing in it applies. */
function scopeOf(
  prelude: string,
  parentSelector: string | null,
  inScope: boolean,
): PageScope {
  const parsed = scopePrelude(prelude);
  if (parsed === null) return { start: ":not(*)", end: null };
  const { start, end } = parsed;
  return {
    start:
      start === null
        ? null
        : parentSelector !== null
          ? resolveNested(start, parentSelector)
          : inScope
            ? relativeToScope(start)
            : start,
    end: end === null ? null : relativeToScope(end),
  };
}

/** The two selector lists of an `@scope` prelude, or null when it is
 * not one. */
function scopePrelude(
  prelude: string,
): { start: string | null; end: string | null } | null {
  let rest = prelude.replace(/^@scope/i, "").trim();
  const group = (): string | null => {
    const close = closingParen(rest);
    if (close === -1) return null;
    const inside = rest.slice(1, close).trim();
    rest = rest.slice(close + 1).trim();
    return inside;
  };
  let start: string | null = null;
  if (rest.startsWith("(")) {
    start = group();
    if (start === null) return null;
  }
  let end: string | null = null;
  const to = /^to\s*(?=\()/i.exec(rest);
  if (to !== null) {
    rest = rest.slice(to[0].length);
    end = group();
    if (end === null) return null;
  }
  return rest === "" ? { start, end } : null;
}

/** The index of the `)` closing the `(` that `text` opens with, outside
 * strings, or -1. */
function closingParen(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'") i = stringEnd(text, i, text.length) - 1;
    else if (ch === "\\") i++;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Whether the selector names the `:scope` pseudo-class
 * (`replaceScopePseudo`). */
export function hasScopePseudo(selector: string): boolean {
  return replaceScopePseudo(selector, "\u0000").includes("\u0000");
}

/** The selector with each `:scope` pseudo-class replaced by `by` — a real
 * one only, as the selector parser reads it: never text inside a string
 * or an attribute selector's brackets (`[data-value=":scope"]`), and
 * never after an escape (`.a\:scope` is a class). Checked against
 * Chromium. */
export function replaceScopePseudo(selector: string, by: string): string {
  let out = "";
  let quote: string | null = null;
  let bracket = false;
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
    else if (ch === "[") bracket = true;
    else if (ch === "]") bracket = false;
    else if (!bracket && ch === ":" && SCOPE_PSEUDO.test(selector.slice(i, i + 7))) {
      out += by;
      i += ":scope".length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** `:scope` at the start of the text, and not the start of a longer
 * name. */
const SCOPE_PSEUDO = /^:scope(?![\w\\-]|[^\x00-\x7f])/i;

/** Every `@font-face` block of the text, wherever a group rule holds it,
 * with its declarations. */
export function fontFaces(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  walkBlocks(scanCss(css), (block) => {
    if (block.statement) return false;
    const keyword = atKeyword(block.prelude);
    if (keyword === "font-face") {
      out.push(block);
      return false;
    }
    return keyword === null || GROUP_RULES.has(keyword);
  });
  return out;
}

/** Every `@font-face` block the browser reads as a face — at the top
 * level or inside group rules, never inside a style rule, where none is
 * one — with the preludes of the group rules around it, outermost first.
 * Walked with an explicit stack, as the rules are. */
export function fontFaceBlocks(
  css: string,
): { block: CssBlock; within: string[] }[] {
  const out: { block: CssBlock; within: string[] }[] = [];
  const levels: { blocks: readonly CssBlock[]; at: number; within: Chain<string> }[] = [
    { blocks: scanCss(css), at: 0, within: null },
  ];
  while (levels.length > 0) {
    const level = levels[levels.length - 1]!;
    const block = level.blocks[level.at++];
    if (block === undefined) {
      levels.pop();
      continue;
    }
    if (block.statement) continue;
    const keyword = atKeyword(block.prelude);
    if (keyword === "font-face") {
      out.push({ block, within: listOf(level.within) });
    } else if (keyword !== null && GROUP_RULES.has(keyword)) {
      levels.push({
        blocks: block.children,
        at: 0,
        within: link(level.within, block.prelude),
      });
    }
  }
  return out;
}

/** Every `@media` prelude of the text, nested ones included, as written. */
export function mediaPreludes(css: string): string[] {
  const out: string[] = [];
  walkBlocks(scanCss(css), (block) => {
    if (block.statement) return false;
    const keyword = atKeyword(block.prelude);
    if (keyword === "media") out.push(block.prelude);
    return keyword === null || GROUP_RULES.has(keyword);
  });
  return out;
}

/** Every selector-bearing prelude of the text — each style rule's
 * selector as written, nested ones included, and each `@scope`'s — what
 * the unreferenced-class rule reads for names (staticLint.ts). */
export function selectorPreludes(css: string): string[] {
  const out: string[] = [];
  walkBlocks(scanCss(css), (block) => {
    if (block.statement) return false;
    const keyword = atKeyword(block.prelude);
    if (keyword === null || keyword === "scope") out.push(block.prelude);
    return keyword === null || GROUP_RULES.has(keyword);
  });
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
  let next = at + 1;
  while (next < blocks.length && blocks[next]!.statement) next++;
  if (next >= blocks.length || atKeyword(blocks[next]!.prelude) !== "container") {
    return false;
  }
  let probes = 0;
  let onlyProbes = true;
  walkBlocks([block], (b) => {
    for (const d of b.declarations) {
      if (!PROBE_PROPERTY.test(d.property)) onlyProbes = false;
      else probes++;
    }
    return onlyProbes;
  });
  return onlyProbes && probes > 0;
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
