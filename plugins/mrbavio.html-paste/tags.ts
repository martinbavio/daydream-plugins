// The downgrade table (decision #56): what becomes of a tag the kernel
// does not create. The plugin owns this table — the kernel owns only the
// allowlist, asked through `dd.core.tagProblem` — so widening what the
// model holds is a kernel change and this file shrinks to match (the
// `svg` row left with decision #75: an svg is kept as the drawing it is).
//
// ONE question decides both the downgrade target and the whitespace
// rules: does the element flow inside a line? The answer is the
// element's own inline `display` when the paste carries one, else the
// tag's UA default — and an UNKNOWN tag's default is inline, as the
// browser's is (`<font>`, Word's `<o:p>`), so the block list below is
// the closed one and everything else is a span.

import type { CoreApi } from "@daydream/plugin-api";

/** Block-level by UA default (the HTML spec's rendering section). */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "html",
  "body",
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "legend",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "optgroup",
  "option",
  "p",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** Dropped with their content and COUNTED: code and foreign content —
 * the things a paste really loses. */
const DROPPED_TAGS: ReadonlySet<string> = new Set([
  "script",
  "template",
  "noscript",
  "iframe",
  "object",
  "embed",
  "canvas",
]);

/** Dropped SILENTLY on the tree walk: document packaging, never content.
 * Chrome wraps every copy in a charset meta; a report that named it on
 * every paste would measure the clipboard, not the model. Comments are
 * dropped the same way. A `<style>` is here because it is CONSUMED, not
 * lost: convert.ts reads every one into the viewport's sheet before the
 * walk (decision #71), and what its text loses is counted there. */
const PACKAGING_TAGS: ReadonlySet<string> = new Set([
  "head",
  "meta",
  "link",
  "title",
  "base",
  "style",
]);

/** Why the converter drops a tag — `"counted"` in the report, `"silent"`
 * as packaging — or null when the element lands. */
export function dropRule(tag: string): "counted" | "silent" | null {
  if (DROPPED_TAGS.has(tag)) return "counted";
  if (PACKAGING_TAGS.has(tag)) return "silent";
  return null;
}

/** Whether the converter drops the tag, counted or not — what a scan of
 * the fragment's shape looks past. */
export function isDroppedTag(tag: string): boolean {
  return dropRule(tag) !== null;
}

/** Whether an ancestor of the source element is one the converter drops
 * WITH its content (`noscript`, `template`, `iframe`…): what sits under
 * it goes with it, however the parser kept it. */
export function insideDroppedTag(source: Element): boolean {
  for (
    let node = source.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    if (dropRule(node.localName) === "counted") return true;
  }
  return false;
}

/** The tag's UA default: inline unless the spec makes it a block. */
export function defaultInline(tag: string): boolean {
  return !BLOCK_TAGS.has(tag);
}

/** The element's box, from its own inline `display` when the paste
 * carries one, else the tag's default. `box` marks a flex or grid
 * container: every child an item, no whitespace between them. */
export function displayOf(
  tag: string,
  styles: Readonly<Record<string, string>>,
): { inline: boolean; box: boolean } {
  const display = styles["display"]?.trim().toLowerCase() ?? "";
  const box = /^(inline-)?(flex|grid)$/.test(display);
  if (display === "" || display === "inherit" || display === "initial")
    return { inline: defaultInline(tag), box };
  return {
    inline: display.startsWith("inline") || display === "contents",
    box,
  };
}

/** One row of the table for one source element that lands (ask
 * `dropRule` first). */
export interface TagRow {
  kind: "keep" | "downgrade";
  /** The tag the element lands with. */
  tag: string;
  inline: boolean;
  box: boolean;
}

/** The parser closes an open `p` at a `div` — anywhere below it until a
 * button-scope boundary (html.spec "has an element in button scope") —
 * and the kernel's validator refuses the structure the parser would not
 * keep (decision #57). An element the parser DID leave inside a `p`
 * (an svg icon in a sentence, an `option` in a `select`) must therefore
 * downgrade to a `span`, whatever its default box: the styles it carries
 * make the box, and a `span` carries `display: block` as well as a `div`. */
const BUTTON_SCOPE_BOUNDARY: ReadonlySet<string> = new Set([
  ...["html", "table", "td", "th", "caption", "button"],
]);

/** Whether the source element sits inside an open `p` — a `p` ancestor
 * with no button-scope boundary between. */
export function insideParagraph(source: Element): boolean {
  for (
    let node = source.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const tag = node.localName;
    if (tag === "p") return true;
    if (BUTTON_SCOPE_BOUNDARY.has(tag)) return false;
  }
  return false;
}

/** The row for an HTML-namespace element. An `svg` is kept as itself
 * (decision #75) and its subtree is the converter's SVG path, never this
 * table's; an SVG-only tag the parser met OUTSIDE an svg (`<path>` in a
 * paragraph) is an unknown HTML element there, and `tagProblem` judged
 * outside an svg says so, so it downgrades like any unknown tag. */
export function resolveTag(
  tag: string,
  styles: Readonly<Record<string, string>>,
  core: CoreApi,
  options: { insideParagraph: boolean } = { insideParagraph: false },
): TagRow {
  const { inline, box } = displayOf(tag, styles);
  if (core.tagProblem(tag, false) === null) {
    return { kind: "keep", tag, inline, box };
  }
  const block = options.insideParagraph ? "span" : "div";
  return { kind: "downgrade", tag: inline ? "span" : block, inline, box };
}

/** The table containers the kernel holds to their parts and no text
 * (decision #57) — at the depth cap, their words cannot stay. */
export const TABLE_CONTAINERS: ReadonlySet<string> = new Set([
  ...["table", "colgroup", "thead", "tbody", "tfoot", "tr"],
]);
