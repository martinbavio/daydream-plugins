// A PAGE'S MARKUP AS THE LINTS READ IT (decision #76). The kernel parses
// it — `dd.core.parsePage`, the browser's own parser in standards mode,
// as the canvas renders it — and the lints walk what comes back: no
// hand-rolled HTML reading. Browser only (a gate runs in the canvas tab).
//
// A gate judges a page as the project's file holds it (decision #78):
// its `<style>` blocks and the stylesheets it links are its sheets
// (pageSheets.ts), never page content, and the markup may still carry
// what the safety walk takes out of a mount (a `<script>`).
//
// An element is NAMED in a finding by its unique selector in the page's
// STORED markup — what `canvas_state`, `measure` and the draft tools
// answer and resolve, and so what an agent can address it back with: the
// kernel's own parse and unique selector (`dd.core.parsePage`,
// `dd.core.uniqueSelector`), over a parse this plugin holds. A lint that
// reads a mounted copy (the gate's mount, `ctx.mountViewport`) names each
// of its nodes by the node's twin in that parse (`storedNames`).
// `dd.pageElement` answers the same name, but only for an element of a
// page mounted ON THE CANVAS: a gate reads a copy of its own, whose nodes
// are in no registry.

import type { CoreApi } from "@daydream/plugin-api";

/** The elements that hold no page content of their own: the head, the
 * page's sheets, and everything the safety walk takes out of the markup
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

/** In a page MOUNTED bare by the gate's mount (`ctx.mountViewport`, the
 * live face; pageMount.ts), the `<style>`s holding the page's live
 * sheets, in cascade order: the live face appends one per live sheet to
 * the head, after everything the page's head holds, and takes the page's
 * own `<style>` and `<link>` elements out of the tree — so they are the
 * head's `<style>` children this plugin (`data-css-author`) did not add;
 * the kernel's motion pin is a sheet the document adopts, in no element.
 * Each holds its sheet as the copy renders it — its `@import`s out, its
 * urls routed, under its `media` — and pageSheets.ts `writtenRules` pairs
 * it with the page's sheet it renders. */
export function mountedStyles(doc: Document): HTMLStyleElement[] {
  return Array.from(doc.head.children).filter(
    (el): el is HTMLStyleElement =>
      el.localName === "style" && !el.hasAttribute("data-css-author"),
  );
}

/** The page's elements the lints judge, in tree order: the root, and
 * every element outside the head that is page content (an `svg`'s shapes
 * included — a rule may style them). A `<noscript>` is, but not what it
 * holds: the fallback a visitor running the page's scripts never sees,
 * which the kernel's parse reads as elements (it parses with scripting
 * off) and every mount — the canvas's, the live face — leaves out. */
export function lintElements(doc: Document): Element[] {
  const out: Element[] = [];
  const visit = (el: Element): void => {
    if (NOT_CONTENT.has(el.localName)) return;
    out.push(el);
    if (el.localName === "noscript") return;
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(doc.documentElement);
  return out;
}

/** How a lint names the nodes of a MOUNTED copy of a page: by the unique
 * selector of each node's twin in the stored markup's parse (`stored`,
 * `dd.core.parsePage(html)`), memoised. The copy is that markup as the live face
 * renders it: what the safety walk takes out and what the mount adds —
 * its `<style>`s, in the head — are no page content. So the two trees'
 * page elements (`lintElements`) pair one for one, in order. Where they
 * do not — a page whose walk removed an element the lints count — each
 * node is named in the copy. */
export function storedNames(
  core: CoreApi,
  stored: Document,
  mounted: Document,
): (node: Element) => string {
  const ours = lintElements(stored);
  const theirs = lintElements(mounted);
  const paired =
    ours.length === theirs.length &&
    ours.every((el, i) => el.localName === theirs[i]!.localName);
  const twins = new Map<Element, Element>(
    paired ? theirs.map((node, i) => [node, ours[i]!]) : [],
  );
  const names = new Map<Element, string>();
  return (node) => {
    let name = names.get(node);
    if (name === undefined) {
      const twin = twins.get(node);
      name =
        twin === undefined
          ? core.uniqueSelector(node, mounted)
          : core.uniqueSelector(twin, stored);
      names.set(node, name);
    }
    return name;
  };
}
