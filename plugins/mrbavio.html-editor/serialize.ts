// The pane's face of a subtree: STRUCTURE ONLY (decision #58). Tag,
// attributes, text and children — never a style attribute (styling is the
// CSS editor's), never a label (labels are not HTML), never the MODEL id
// (the kernel's handle, kept by tag-and-position matching on the way
// back, reconcile.ts). An author's `class` and `id` are ordinary
// attributes since the selectors step (decision #71) — the hooks a
// sheet's selectors match — and are written like any other; #58's "never
// a class or an id" retired with the reason that made it true. Pure: a
// DreamElement in, HTML text out, so the same text re-parses (parse.ts)
// to the same tree.
//
// Layout: two-space indentation, one element per line. A text-only element
// stays on one line (`<h1>Title</h1>`); text beside children goes on its
// own line before them, the way the model renders it (text first, then
// children); a void element has no end tag. A `pre` and everything under
// it is written on ONE line with no indentation, since there every
// character would be content (parse.ts keeps them all).
//
// Round trip: the text re-parses to the same structure, with one
// deliberate exception — text stored BESIDE children comes back as a
// `span` child in its place (the model's grain, parse.ts), which renders
// the same and keeps every sibling's identity.

import type { DeepReadonly, DreamElement } from "@daydream/plugin-api";

/** HTML void elements: no end tag, no content. The language's set, not
 * the allowlist's, so an allowlist extension never yields `<input></input>`. */
export const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export const INDENT = "  ";

/** The subtree rooted at `el` as HTML text, without a trailing newline. */
export function serializeElement(
  el: DeepReadonly<DreamElement>,
  depth = 0,
): string {
  const pad = INDENT.repeat(depth);
  const open = `${pad}<${el.tag}${attributes(el.attrs)}>`;
  if (VOID_TAGS.has(el.tag)) return open;
  const close = `</${el.tag}>`;
  const text = el.text === undefined ? "" : escapeText(el.text);
  if (el.tag === "pre") return `${open}${text}${inline(el)}${close}`;
  if (el.children.length === 0) return `${open}${text}${close}`;
  const lines: string[] = [open];
  if (text !== "") lines.push(`${pad}${INDENT}${text}`);
  for (const child of el.children)
    lines.push(serializeElement(child, depth + 1));
  lines.push(`${pad}${close}`);
  return lines.join("\n");
}

/** A `pre` subtree's children, verbatim, with no layout of the pane's. */
function inline(el: DeepReadonly<DreamElement>): string {
  let out = "";
  for (const child of el.children) {
    const open = `<${child.tag}${attributes(child.attrs)}>`;
    if (VOID_TAGS.has(child.tag)) {
      out += open;
      continue;
    }
    const text = child.text === undefined ? "" : escapeText(child.text);
    out += `${open}${text}${inline(child)}</${child.tag}>`;
  }
  return out;
}

function attributes(
  attrs: DeepReadonly<Record<string, string>> | undefined,
): string {
  if (attrs === undefined) return "";
  let out = "";
  for (const [name, value] of Object.entries(attrs)) {
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

export function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
