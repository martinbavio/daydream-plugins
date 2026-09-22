// A PAGE'S MARKUP AS THE LINTS READ IT (decision #76). The browser parses
// it — `DOMParser`, the same parser the canvas renders it with — and the
// lints walk what comes back: no hand-rolled HTML reading. Browser only
// (a gate runs in the canvas tab).
//
// An element is NAMED in a finding by its unique selector in the page's
// STORED markup — what `canvas_state`, `measure` and the draft tools
// answer and resolve, and so what an agent can address it back with. A
// lint that reads a mounted copy (`dd.mountViewport`) names each of its
// nodes by the node's twin in that parse (`storedNames`): the copy is the
// markup after the safety walk, and where the walk removed an element that
// shared an id with one it kept, the copy's own shortest name is not the
// stored text's. `dd.pageElement` answers exactly this name, but only for
// an element of a page mounted ON THE CANVAS: a gate judges an incoming
// page, and a `mountViewport` copy's nodes are in no registry.

import type { PagePayload } from "@daydream/plugin-api";

import { uniqueSelector } from "./uniqueSelector";

/** The elements that hold no page content of their own: the head and
 * everything the safety walk or the css fold takes out of the markup
 * (render/sanitize.ts in the kernel). */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  "head",
  "style",
  "script",
  "link",
  "meta",
  "title",
  "base",
]);

/** The stored markup as the browser reads it in STANDARDS mode — the
 * kernel's one parse of a page (render/parsePage.ts), to the letter. A
 * text with no doctype would parse in quirks mode, where class and id
 * selectors match case-insensitively; the canvas and every mount render
 * in standards mode, and an agent's selectors resolve against this. */
function parseMarkup(html: string): Document {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  if (parsed.compatMode === "CSS1Compat") return parsed;
  // A second doctype is a parse error the parser ignores, so a page whose
  // own doctype is a quirky one is read under this one instead.
  const standard = parser.parseFromString(
    `<!doctype html>${html}`,
    "text/html",
  );
  if (parsed.doctype === null) standard.doctype?.remove();
  return standard;
}

/** A page parsed: its document, and its whole css — the stored text
 * with each `<style>` block the markup still carries folded in after it,
 * in document order, where the renderer and the measurer put it. A
 * landed page carries none (a landing folds them); a gate's dry run may
 * see one. */
export interface ParsedPage {
  doc: Document;
  css: string;
}

export function parsePage(page: Pick<PagePayload, "html" | "css">): ParsedPage {
  const doc = parseMarkup(page.html);
  const folded = Array.from(doc.querySelectorAll("style")).map(
    (style) => style.textContent ?? "",
  );
  return { doc, css: [page.css, ...folded].join("\n") };
}

/** In a page MOUNTED by `dd.mountViewport` (the live face), the `<style>`
 * holding the page's css: the one in the head the measurer did not add
 * for itself (its motion pin is marked `data-dream-lint`). Its text is the
 * page's css as the copy renders it — the stored text with the markup's
 * `<style>` blocks folded in, `@import` taken out, `assets/` urls pointed
 * at the document's route, and the measurer's container probes, which
 * pageCss.ts leaves out of every rule — so its rules line up with the
 * stored text's one for one, and its values with the copy's own `style`
 * attributes, whose urls were pointed the same way. */
export function mountedStyle(doc: Document): HTMLStyleElement | null {
  return doc.head.querySelector<HTMLStyleElement>(
    "style:not([data-dream-lint]):not([data-css-author])",
  );
}

/** The page's elements the lints judge, in tree order: the root, and
 * every element outside the head that is page content (an `svg`'s shapes
 * included — a rule may style them). */
export function lintElements(doc: Document): Element[] {
  const out: Element[] = [];
  const visit = (el: Element): void => {
    if (NOT_CONTENT.has(el.localName)) return;
    out.push(el);
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(doc.documentElement);
  return out;
}

/** How a lint names the nodes of a MOUNTED copy of a page: by the unique
 * selector of each node's twin in the stored markup's parse (`stored`,
 * `parsePage(...).doc`), memoised. The copy is that markup with the
 * safety walk's removals (a `<script>`, a `<style>`, a stylesheet link)
 * and the mount's own additions (its `<style>`s in the head); every
 * element it keeps keeps its tag, `id` and `class`. So the two trees are
 * paired child list by child list: each child of the copy with the first
 * stored sibling left that has the same three, the stored siblings
 * skipped between being what the walk removed. A node with no twin, which
 * only the mount's own head holds, is named in the copy. */
export function storedNames(
  stored: Document,
  mounted: Document,
): (node: Element) => string {
  const twins = new Map<Element, Element>();
  pairTrees(stored.documentElement, mounted.documentElement, twins);
  const names = new Map<Element, string>();
  return (node) => {
    let name = names.get(node);
    if (name === undefined) {
      const twin = twins.get(node);
      name =
        twin === undefined
          ? uniqueSelector(node, mounted)
          : uniqueSelector(twin, stored);
      names.set(node, name);
    }
    return name;
  };
}

function pairTrees(
  stored: Element,
  mounted: Element,
  twins: Map<Element, Element>,
): void {
  if (!sameElement(stored, mounted)) return;
  twins.set(mounted, stored);
  const siblings = Array.from(stored.children);
  let next = 0;
  for (const child of Array.from(mounted.children)) {
    for (let i = next; i < siblings.length; i++) {
      if (!sameElement(siblings[i]!, child)) continue;
      pairTrees(siblings[i]!, child, twins);
      next = i + 1;
      break;
    }
  }
}

/** The same element as far as a selector can tell: its tag, `id` and
 * `class`, the attributes a unique selector is made of. */
function sameElement(a: Element, b: Element): boolean {
  return (
    a.localName === b.localName &&
    a.id === b.id &&
    a.getAttribute("class") === b.getAttribute("class")
  );
}
