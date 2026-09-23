// FROM A PAGE'S ELEMENTS TO ITS TEXT (decision #76). The editor shows a
// page's `html` as the author wrote it, and a selection on the canvas is
// a node of the page's MOUNT. Three steps join them, each the browser's
// answer where it has one:
//
// 1. THE TAG AN ELEMENT CAME FROM. Every start tag in the text
//    (sourceTags.ts) is marked with its index, and the browser parses the
//    marked copy: each element it built from a tag carries that tag's
//    index, wherever the parser's repairs put it, and an element the
//    parser supplied with no tag of its own (an implied `<body>`, a
//    `<tbody>`) carries none. The kernel finds an element's tag the same
//    way to splice its `style`.
// 2. WHERE IT ENDS. Its end tag, found after its last child's end and
//    before the next tag outside it (sourceTags.ts `elementEnd`).
// 3. WHICH STORED ELEMENT A MOUNTED ONE IS. The mount is the stored
//    markup parsed and then made safe: the renderer's walk took some
//    elements out (a `<script>`, a `<style>`, a stylesheet link) and
//    none in. So a mounted element's place is found in the stored parse
//    by walking both trees from the root, pairing each mounted child with
//    the next stored child of its tag — the stored children the walk
//    removed are the ones skipped.
//
// Every parse is read in standards mode, as the canvas reads a page:
// without a doctype a browser parses in quirks mode, where a few trees
// are built differently (the kernel's src/render/parsePage.ts).

import { elementEnd, startTags, type SourceTag } from "./sourceTags";

/** The stored markup as the browser reads it in standards mode. The
 * doctype is the parse's, taken back out when the text had none. */
export function parsePage(html: string): Document {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  if (parsed.compatMode === "CSS1Compat") return parsed;
  const standard = parser.parseFromString(
    `<!doctype html>${html}`,
    "text/html",
  );
  if (parsed.doctype === null) standard.doctype?.remove();
  return standard;
}

/** The attribute a marked copy of the text carries on every tag: the
 * tag's index in the text. Never stored, never mounted. */
const SOURCE_ATTR = "data-mrbavio-html-editor-source";

/** Where an element was written: `[start, end)` of the whole of it, and
 * where its start tag ends. */
export interface SourceRange {
  start: number;
  openEnd: number;
  end: number;
}

/** A page's text read for its elements' places. */
export interface PageSource {
  /** The text this was read from. */
  html: string;
  /** The browser's parse of it, every element marked with its tag. */
  parsed: Document;
  /** Where `el` (an element of `parsed`) was written, or null when the
   * parser supplied it with no tag of its own. */
  rangeOf(el: Element): SourceRange | null;
}

/** Read `html` for its elements' places. */
export function pageSource(html: string): PageSource {
  const tags = startTags(html);
  let marked = "";
  let at = 0;
  tags.forEach((tag, k) => {
    marked += `${html.slice(at, tag.nameEnd)} ${SOURCE_ATTR}="${k}"`;
    at = tag.nameEnd;
  });
  marked += html.slice(at);
  const parsed = parsePage(marked);

  const tagOf = (el: Element): number | null => {
    const k = Number(el.getAttribute(SOURCE_ATTR) ?? NaN);
    const tag = tags[k];
    return tag !== undefined && tag.name === el.localName.toLowerCase()
      ? k
      : null;
  };

  // Each element's range, the highest tag index in its subtree and how
  // far into the text its subtree reaches (an element with no tag of its
  // own reaches as far as its children do), computed children first and
  // kept.
  interface Read {
    range: SourceRange | null;
    last: number;
    reach: number;
  }
  const known = new Map<Element, Read>();
  const visit = (el: Element): Read => {
    const done = known.get(el);
    if (done !== undefined) return done;
    const k = tagOf(el);
    const tag: SourceTag | undefined = k === null ? undefined : tags[k];
    let inner = tag?.end ?? 0;
    let last = k ?? -1;
    for (const child of childElements(el)) {
      const read = visit(child);
      last = Math.max(last, read.last);
      inner = Math.max(inner, read.reach);
    }
    let range: SourceRange | null = null;
    if (tag !== undefined) {
      const bound = tags[last + 1]?.start ?? html.length;
      const end = elementEnd(html, tag, Math.min(inner, bound), bound);
      range = {
        start: tag.start,
        openEnd: tag.end,
        end: Math.max(end, tag.end),
      };
    }
    const read = { range, last, reach: range?.end ?? inner };
    known.set(el, read);
    return read;
  };

  return { html, parsed, rangeOf: (el) => visit(el).range };
}

/** An element's children, a template's content included: its markup is
 * in the text like any other. */
function childElements(el: Element): Element[] {
  const scope = el instanceof HTMLTemplateElement ? el.content : el;
  return Array.from(scope.children);
}

/**
 * The element of `parsed` that the mounted `node` was made from, or
 * null: the node is not inside a mounted page, or the stored text holds
 * no element of its kind at its place (it changed since the mount).
 */
export function storedElement(parsed: Document, node: Element): Element | null {
  const shadow = node.getRootNode();
  const mountedRoot =
    shadow instanceof ShadowRoot ? shadow.firstElementChild : null;
  if (mountedRoot === null) return null;
  const path: Element[] = [];
  for (let el: Element | null = node; el !== mountedRoot;) {
    if (el === null) return null;
    path.unshift(el);
    el = el.parentElement;
  }
  let stored: Element = parsed.documentElement;
  if (stored.localName !== mountedRoot.localName) return null;
  for (const mounted of path) {
    const next = pairedChild(stored, mounted);
    if (next === null) return null;
    stored = next;
  }
  return stored;
}

/** The stored child of `stored` that the mounted `child` is: mounted and
 * stored children paired in order by tag, a stored child with no mounted
 * twin (one the safety walk removed) skipped. */
function pairedChild(stored: Element, child: Element): Element | null {
  const mountedSiblings = Array.from(child.parentElement?.children ?? []);
  const storedChildren = Array.from(stored.children);
  let j = 0;
  for (const mounted of mountedSiblings) {
    while (
      j < storedChildren.length &&
      storedChildren[j]!.localName !== mounted.localName
    ) {
      j++;
    }
    const twin = storedChildren[j];
    if (twin === undefined) return null;
    if (mounted === child) return twin;
    j++;
  }
  return null;
}
