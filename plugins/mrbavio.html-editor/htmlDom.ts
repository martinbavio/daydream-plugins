// The browser half of parsing (decisions.md #58): DOMParser builds the
// nodes — the page's own parser, so the pane accepts what a browser would
// build, recovery included — and parse.ts walks them. Which nodes are the
// pane's depends on WHAT is selected, because an HTML document parser
// always synthesises the `html › head › body` skeleton around a fragment:
// - the viewport root (`html`): the document element, minus its `head` —
//   which must be empty, since a page has no place for what the parser
//   puts there (`title`, `meta`, `style`, `script`) and dropping it
//   silently would lose what was typed;
// - the `body`: the document's body;
// - anything else: the body's children — the fragment as written.

import { treeFromNodes, type ContentRules, type ParseResult } from "./parse";

export type PaneLevel = "root" | "body" | "fragment";

export function parseHtml(
  text: string,
  level: PaneLevel,
  rules: ContentRules,
): ParseResult {
  const doc = new DOMParser().parseFromString(text, "text/html");
  if (level === "fragment") return treeFromNodes(doc.body.childNodes, rules);
  if (level === "body") return treeFromNodes([doc.body], rules);
  const html = doc.documentElement;
  const inHead = doc.head.firstElementChild;
  if (inHead !== null) {
    const tag = inHead.tagName.toLowerCase();
    return {
      ok: false,
      problem:
        rules.tagProblem(tag) ??
        `<${tag}> belongs to the head, and the page has no place for it.`,
    };
  }
  const view = {
    nodeType: html.nodeType,
    nodeName: html.nodeName,
    nodeValue: null,
    childNodes: Array.from(html.childNodes).filter(
      (node) => node.nodeName !== "HEAD",
    ),
    getAttributeNames: () => html.getAttributeNames(),
    getAttribute: (name: string) => html.getAttribute(name),
  };
  return treeFromNodes([view], rules);
}
