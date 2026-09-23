// impeccable_html's work on a live mount's document (index.tsx): find the
// target by selector, mark it, take it out for the detector's baseline,
// and make the page's urls stand alone. The document is the mount's own
// copy — the caller disposes it and nothing here is ever stored.

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

/** MARK the target: `data-impeccable-target` on it and every element
 * inside it, the page otherwise untouched — a rule may reach the target
 * through its siblings (`.lead + .target`, `:nth-child(2)`), so nothing
 * around it is removed. Answers how many elements the subtree holds. */
export function markTarget(node: Element): number {
  const subtree = [node, ...node.querySelectorAll("*")];
  for (const n of subtree) n.setAttribute("data-impeccable-target", "");
  return subtree.length;
}

/** TAKE THE TARGET OUT, for the detector's baseline (bridge/detect.ts):
 * a bare element of its own tag in its place — no attribute, nothing
 * inside — so every other element keeps its position among its
 * siblings, and the rules that find them by it still do. */
export function takeOut(node: Element): void {
  node.replaceWith(node.ownerDocument.createElementNS(node.namespaceURI, node.localName));
}

const URL_ATTRIBUTES = ["src", "href", "poster", "xlink:href"];

/** A root-relative url (`/api/…`, `/assets/…`) — not a protocol-relative
 * `//host`, which already names its host. */
const rootRelative = (url: string): boolean => /^\/(?!\/)/.test(url.trim());

/** Every root-relative url in the document made absolute to `origin`:
 * the url attributes, each `srcset` candidate, and `url()` and an
 * `image-set()` string in every `<style>` and `style` attribute. The mount points a page's own
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
    if (srcset !== null) el.setAttribute("srcset", absoluteSrcset(srcset, origin));
    const style = el.getAttribute("style");
    if (style !== null) el.setAttribute("style", absoluteCssUrls(style, origin));
  }
  for (const sheet of doc.querySelectorAll("style")) {
    sheet.textContent = absoluteCssUrls(sheet.textContent ?? "", origin);
  }
}

/** Each root-relative candidate url of a `srcset` made absolute to
 * `origin`, every other character kept. A candidate is read as HTML's
 * srcset parser reads it — separators (whitespace and commas), then the
 * url up to whitespace (trailing commas end it, with no descriptor), then
 * its descriptors up to a comma outside parentheses — so a url holding a
 * comma stays one url. */
export function absoluteSrcset(srcset: string, origin: string): string {
  let out = "";
  let from = 0;
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i]!)) i += 1;
    if (i >= srcset.length) break;
    const start = i;
    while (i < srcset.length && !/\s/.test(srcset[i]!)) i += 1;
    if (rootRelative(srcset.slice(start, i))) {
      out += srcset.slice(from, start) + origin;
      from = start;
    }
    if (srcset[i - 1] === ",") continue;
    let depth = 0;
    for (; i < srcset.length; i++) {
      const c = srcset[i];
      if (c === "(") depth += 1;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === "," && depth === 0) break;
    }
  }
  return out + srcset.slice(from);
}

/** A character an identifier may continue with: CSS's name code points
 * (an escape is taken apart where it starts). */
const NAME = /[A-Za-z0-9_\-\u0080-￿]/;

/** A css text's urls made absolute to `origin`, read as CSS tokenizes it
 * so that only a URL is ever touched: a `url(/…)` token, quoted or not
 * (`url(` in any case), made `url(<origin>/…)`, and a root-relative
 * string inside `image-set()` (`image-set("/a.png" 1x)`, the `-webkit-`
 * spelling too) made `"<origin>/…"`. Every other string — the text a
 * `content` shows, a quoted family name — and every comment is skipped
 * whole, whatever it spells; a parenthesis in one opens or closes
 * nothing. */
export function absoluteCssUrls(css: string, origin: string): string {
  let out = "";
  let from = 0;
  /** `[at, end)`, a url's text: `origin` goes before it when it is
   * root-relative. */
  const urlAt = (at: number, end: number): void => {
    const text = css.slice(at, end);
    if (!rootRelative(text)) return;
    const start = at + text.search(/\S/);
    out += css.slice(from, start) + origin;
    from = start;
  };
  /** The end of the string whose opening quote is at `i`: just past its
   * closing quote, or where a newline or the text ends it. */
  const stringEnd = (i: number): number => {
    const quote = css[i];
    let end = i + 1;
    while (end < css.length && css[end] !== quote && css[end] !== "\n") {
      end += css[end] === "\\" ? 2 : 1;
    }
    return Math.min(end + 1, css.length);
  };
  /** The functions open at `i`, innermost last: which of them a string
   * directly inside is a url in. */
  const open: Array<"url" | "image-set" | "other"> = [];
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close === -1 ? css.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(i);
      const inside = open[open.length - 1];
      if (inside === "url" || inside === "image-set") urlAt(i + 1, end - 1);
      i = end;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (NAME.test(c)) {
      const start = i;
      while (i < css.length && (NAME.test(css[i]!) || css[i] === "\\")) i += css[i] === "\\" ? 2 : 1;
      if (css[i] !== "(") continue;
      const name = css.slice(start, i).toLowerCase();
      i += 1;
      if (name === "url") {
        let at = i;
        while (at < css.length && /\s/.test(css[at]!)) at += 1;
        if (css[at] === '"' || css[at] === "'") {
          // `url("…")`: a function holding a string, read as any other.
          open.push("url");
          continue;
        }
        // An unquoted url token runs to its `)`.
        let end = at;
        while (end < css.length && css[end] !== ")") end += css[end] === "\\" ? 2 : 1;
        urlAt(at, end);
        i = end + 1;
        continue;
      }
      open.push(name === "image-set" || name === "-webkit-image-set" ? "image-set" : "other");
      continue;
    }
    if (c === "(") open.push("other");
    else if (c === ")") open.pop();
    i += 1;
  }
  return out + css.slice(from);
}
