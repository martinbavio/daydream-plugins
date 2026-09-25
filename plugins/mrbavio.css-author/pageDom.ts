// A PAGE'S MARKUP AS THE LINTS READ IT (decision #76). The browser parses
// it — `DOMParser`, the same parser the canvas renders it with — and the
// lints walk what comes back: no hand-rolled HTML reading. Browser only
// (a gate runs in the canvas tab).
//
// A gate judges a page as a landing stores it: every landing door runs
// the kernel's clean before any gate (src/ai/cleanPage.ts), so the markup
// carries no `<style>` but a noscript's or a template's — which stay
// where they were written and are not the page's css — and nothing the
// safety walk would take out. The page's css is its `css` text, as
// stored. (The `lint` tool's dry run judges a page as sent, before any
// clean: a `<style>` it still carries is read only by the lints that
// mount the page, whose live face folds it.)
//
// An element is NAMED in a finding by its unique selector in the page's
// STORED markup — what `canvas_state`, `measure` and the draft tools
// answer and resolve, and so what an agent can address it back with: the
// kernel's own parse and unique selector (`dd.core.parsePage`,
// `dd.core.uniqueSelector`), over a parse this plugin holds. A lint that
// reads a mounted copy (`dd.mountViewport`) names each of its nodes by the
// node's twin in that parse (`storedNames`). `dd.pageElement` answers the
// same name, but only for an element of a page mounted ON THE CANVAS: a
// gate judges an incoming page, and a `mountViewport` copy's nodes are in
// no registry.

import type { CoreApi } from "@daydream/plugin-api";

/** The elements that hold no page content of their own: the head and
 * everything the safety walk takes out of the markup, or the kernel's
 * clean folds into the css (render/sanitize.ts in the kernel). */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  "head",
  "style",
  "script",
  "link",
  "meta",
  "title",
  "base",
]);

/** In a page MOUNTED by `dd.mountViewport` (the live face), the `<style>`
 * holding the page's css: the one the live face appends to the head
 * after everything the page's head holds (src/measure/livePage.ts) — the
 * last `<style>` child of the head that the measurer's motion pin
 * (`data-dream-lint`) or this plugin's (`data-css-author`) did not add.
 * Never a noscript's `<style>`, which the measurer's copy (no scripting
 * there) parses as a style inside the noscript, nor a template's, which
 * is in no tree. The lints mount a page `bare` (pageMount.ts), so its text
 * is the page's css as the copy renders it and nothing else — the stored
 * text with `@import` taken out and `assets/` urls pointed at the
 * document's route — and its rules line up with the stored text's one for
 * one, and its values with the copy's own `style` attributes, whose urls
 * were pointed the same way. */
export function mountedStyle(doc: Document): HTMLStyleElement | null {
  const own = Array.from(doc.head.children).filter(
    (el): el is HTMLStyleElement =>
      el.localName === "style" &&
      !el.hasAttribute("data-dream-lint") &&
      !el.hasAttribute("data-css-author"),
  );
  return own.at(-1) ?? null;
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
 * `dd.core.parsePage(html)`), memoised. The copy is that markup as the live face
 * renders it: the safety walk has nothing left to take out of a cleaned
 * page, and what the mount adds — its `<style>`s — is in the head, which
 * holds no page content. So the two trees' page elements (`lintElements`)
 * pair one for one, in order. Where they do not — a page judged before
 * any clean, whose walk removed an element — each node is named in the
 * copy. */
export function storedNames(
  core: Pick<CoreApi, "uniqueSelector">,
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
