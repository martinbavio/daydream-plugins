// HTML text → the pane's tree (decisions.md #58). The BROWSER parses
// (htmlDom.ts: DOMParser, the parser the page itself uses, so what the
// pane accepts is what a browser would build); this module is the pure
// half — it walks nodes that merely LOOK like DOM nodes (`NodeLike`, which
// a real Node satisfies structurally) and turns them into the model's
// grain, refusing anything the format would refuse. Pure so it runs under
// Node in the unit tests, over hand-built nodes.
//
// The model's grain (packages/plugin-api/document.ts): one `text` string
// per element, rendered before children, no mixed inline runs. So:
// - an element holding text alone keeps it as `text`;
// - text beside element children becomes a `span` child per run, in
//   place — `<p>Hello <strong>world</strong></p>` is a `p` with a `span`
//   "Hello " and a `strong` "world", which serialize.ts writes back as
//   exactly that;
// - indentation is not content: whitespace runs that carry a newline are
//   the serializer's own layout and are dropped; a same-line whitespace
//   run between inline children (`<b>a</b> <i>b</i>`) is content and
//   stays. Inside `pre` — the element and everything under it — every
//   character is content and nothing is dropped (serialize.ts writes a
//   `pre` subtree on one line for the same reason).
// - comments are dropped; there is nowhere to keep them.
//
// Tags and attributes go through the kernel's own rules (`dd.core.
// tagProblem`, `dd.core.attrProblem`) so the pane refuses, with the same
// sentence, exactly what the format validator would — before any write.

import type { CoreApi } from "@daydream/plugin-api";

/** The parsed tree, before identities are assigned (reconcile.ts). */
export interface ParsedElement {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children: ParsedElement[];
}

/** What the walker needs of a node. A DOM `Node` satisfies it as it is;
 * the unit tests build plain objects. */
export interface NodeLike {
  /** 1 element, 3 text, 8 comment — the DOM's numbering. */
  readonly nodeType: number;
  /** Upper-case for HTML elements in the DOM; folded here. */
  readonly nodeName: string;
  /** A text node's characters. */
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<NodeLike>;
  getAttributeNames?(): string[];
  getAttribute?(name: string): string | null;
}

/** The kernel's vocabulary rules, as `dd.core` carries them. */
export type ContentRules = Pick<CoreApi, "tagProblem" | "attrProblem">;

export type ParseResult =
  { ok: true; element: ParsedElement } | { ok: false; problem: string };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The pane's top level: exactly one element, since the pane shows one
 * subtree. Whitespace and comments around it are ignored; text or a second
 * element is refused with a sentence that says what was found.
 */
export function treeFromNodes(
  nodes: ArrayLike<NodeLike>,
  rules: ContentRules,
): ParseResult {
  const elements: NodeLike[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === ELEMENT_NODE) {
      elements.push(node);
    } else if (node.nodeType === TEXT_NODE && !isBlank(node.nodeValue)) {
      return {
        ok: false,
        problem: `Text outside an element ("${preview(node.nodeValue ?? "")}"): the pane holds one element, so wrap it in one.`,
      };
    }
  }
  if (elements.length === 0) {
    return {
      ok: false,
      problem:
        "Write one element: the pane holds the selected element's subtree. Delete removes the element itself.",
    };
  }
  if (elements.length > 1) {
    const tags = elements.map((el) => el.nodeName.toLowerCase()).join(", ");
    return {
      ok: false,
      problem: `The pane holds one element; found ${elements.length} (${tags}). Wrap them in one, or select their parent and edit there.`,
    };
  }
  return convert(elements[0]!, rules, false);
}

function convert(
  node: NodeLike,
  rules: ContentRules,
  inPre: boolean,
): ParseResult {
  const tag = node.nodeName.toLowerCase();
  const tagProblem = rules.tagProblem(tag);
  if (tagProblem !== null) return { ok: false, problem: tagProblem };

  const element: ParsedElement = { tag, children: [] };

  const names = node.getAttributeNames?.() ?? [];
  if (names.length > 0) {
    const attrs: Record<string, string> = {};
    for (const name of names) {
      const value = node.getAttribute?.(name) ?? "";
      const problem = rules.attrProblem(name, value);
      if (problem !== null) {
        return { ok: false, problem: `<${tag} ${name}>: ${problem}` };
      }
      attrs[name] = value;
    }
    element.attrs = attrs;
  }

  const children = Array.from(node.childNodes);
  const verbatim = inPre || tag === "pre";
  const mixed = children.some((child) => child.nodeType === ELEMENT_NODE);
  if (!mixed) {
    let text = "";
    for (const child of children) {
      if (child.nodeType === TEXT_NODE) text += child.nodeValue ?? "";
    }
    if (!verbatim) text = stripIndentation(text);
    if (text !== "") element.text = text;
    return { ok: true, element };
  }

  for (const child of children) {
    if (child.nodeType === ELEMENT_NODE) {
      const result = convert(child, rules, verbatim);
      if (!result.ok) return result;
      element.children.push(result.element);
    } else if (child.nodeType === TEXT_NODE) {
      const raw = child.nodeValue ?? "";
      if (verbatim) {
        element.children.push({ tag: "span", text: raw, children: [] });
        continue;
      }
      if (isBlank(raw)) {
        // Indentation between children is the serializer's; a same-line
        // gap between inline children is a real space — except around
        // the skeleton, where no space can render.
        if (raw.includes("\n") || tag === "html") continue;
        element.children.push({ tag: "span", text: raw, children: [] });
        continue;
      }
      element.children.push({
        tag: "span",
        text: stripIndentation(raw),
        children: [],
      });
    }
  }
  return { ok: true, element };
}

/**
 * Drop the layout around a text run, keeping its content: the leading
 * whitespace through its LAST newline and the indentation after it, and
 * the trailing whitespace from its FIRST newline on — so `"\n    Hello \n"`
 * reads "Hello " (a space before a line break is content; the spaces after
 * one are indentation). A run with no newline is untouched.
 */
export function stripIndentation(text: string): string {
  return text.replace(/^\s*\n[ \t]*/, "").replace(/\n\s*$/, "");
}

function isBlank(text: string | null): boolean {
  return text === null || text.trim() === "";
}

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}
