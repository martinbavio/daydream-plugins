// impeccable_html's work on a live mount's document (index.tsx): find the
// target by selector, prune the page to it, and make its urls stand
// alone. The document is the mount's own copy — the caller disposes it and
// nothing here is ever stored.

/** The one element `selector` names in `doc` — the same addressing
 * get_viewport and the draft tools use (decision #76) — or an error that
 * says why not: a selector the browser refuses, none, or several. */
export function soleMatch(doc: Document, selector: string, viewportId: string): Element {
  let matches: Element[];
  try {
    matches = Array.from(doc.querySelectorAll(selector));
  } catch {
    throw new Error(`\`element\` must be a CSS selector: the browser refused "${selector}"`);
  }
  if (matches.length === 0) {
    throw new Error(`no element matches "${selector}" in viewport "${viewportId}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `"${selector}" matches ${matches.length} elements in viewport "${viewportId}"; name one of them`,
    );
  }
  return matches[0]!;
}

/**
 * PRUNE the page to the target: its subtree, its ancestors (the cascade
 * the detector's contrast and size rules read — inherited colour and
 * font, the backgrounds behind it), and nothing else — every ancestor's
 * other children go, `head` excepted. The detector reports no element,
 * only text and colours, so a page holding nothing but the target is the
 * one way a finding is the target's for sure. The subtree is marked
 * `data-impeccable-target`.
 */
export function pruneTo(node: Element): { kept: number; pruned: number } {
  const subtree = [node, ...node.querySelectorAll("*")];
  for (const n of subtree) n.setAttribute("data-impeccable-target", "");
  let pruned = 0;
  for (let el: Element | null = node.parentElement; el !== null; el = el.parentElement) {
    for (const child of [...el.children]) {
      if (child === node || child.contains(node) || child.localName === "head") continue;
      child.remove();
      pruned += 1;
    }
  }
  return { kept: subtree.length, pruned };
}

const URL_ATTRIBUTES = ["src", "href", "poster", "xlink:href"];

/** A root-relative url (`/api/…`, `/assets/…`) — not a protocol-relative
 * `//host`, which already names its host. */
const rootRelative = (url: string): boolean => /^\/(?!\/)/.test(url.trim());

/** Every root-relative url in the document made absolute to `origin`:
 * the url attributes, each `srcset` candidate, and `url()` in every
 * `<style>` and `style` attribute. The mount points a page's own
 * `assets/<file>` at this host's route for its document, so the exported
 * file loads them from wherever it is opened. */
export function absoluteUrls(doc: Document, origin: string): void {
  for (const el of doc.querySelectorAll("*")) {
    for (const name of URL_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value !== null && rootRelative(value)) {
        el.setAttribute(name, origin + value.trim());
      }
    }
    const srcset = el.getAttribute("srcset");
    if (srcset !== null) {
      el.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((candidate) => {
            const trimmed = candidate.trim();
            return rootRelative(trimmed) ? origin + trimmed : trimmed;
          })
          .join(", "),
      );
    }
    const style = el.getAttribute("style");
    if (style !== null) el.setAttribute("style", absoluteCssUrls(style, origin));
  }
  for (const sheet of doc.querySelectorAll("style")) {
    sheet.textContent = absoluteCssUrls(sheet.textContent ?? "", origin);
  }
}

/** `url(/…)`, quoted or not, made `url(<origin>/…)`. */
export function absoluteCssUrls(css: string, origin: string): string {
  return css.replace(/url\(\s*(['"]?)\/(?!\/)/g, (_, quote: string) => `url(${quote}${origin}/`);
}
