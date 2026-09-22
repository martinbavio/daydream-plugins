// A PAGE'S MARKUP AS THE LINTS READ IT (decision #76). The browser parses
// it — `DOMParser`, the same parser the canvas renders it with — and the
// lints walk what comes back: no hand-rolled HTML reading. Browser only
// (a gate runs in the canvas tab).

import type { PagePayload } from "@daydream/plugin-api";

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
  const doc = new DOMParser().parseFromString(page.html, "text/html");
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
