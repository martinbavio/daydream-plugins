// Prose stays text (decision #56, amended the same day): a browser
// copies every selection as HTML — a paragraph, or a few words, arrives
// as a `p` or a `span` with the page's computed styles inlined — and the
// user who copies a sentence wants a text item, not a page. So the hook
// claims a paste by the fragment's SHAPE, not by the presence of
// `text/html`: no more than a single paragraph of phrasing content is
// left for the Text plugin; anything with structure — two blocks, a
// list, a card, a table, an image inside the paragraph — is a fragment
// and lands as a viewport.

/** Block-level by UA default (the HTML spec's rendering section). Every
 * other tag flows inside a line, an unknown one included (`<font>`,
 * Word's `<o:p>`), as the browser's default does. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  ...["html", "body", "address", "article", "aside", "blockquote"],
  ...["caption", "center", "col", "colgroup", "dd", "details", "dialog"],
  ...["dir", "div", "dl", "dt", "fieldset", "figcaption", "figure"],
  ...["footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header"],
  ...["hgroup", "hr", "legend", "li", "main", "menu", "nav", "ol"],
  ...["optgroup", "option", "p", "pre", "search", "section", "summary"],
  ...["table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"],
]);

/** What a page never shows: document packaging, code, and what the
 * canvas removes before it mounts. A shape scan looks past them. */
const UNSHOWN_TAGS: ReadonlySet<string> = new Set([
  ...["head", "meta", "link", "title", "base", "style"],
  ...["script", "noscript", "template", "object", "embed"],
]);

/** Replaced content a paragraph cannot carry as plain text: with one of
 * these inside, a paragraph is a page fragment, not prose. */
const REPLACED_TAGS: ReadonlySet<string> = new Set([
  ...["img", "picture", "video", "audio", "svg", "iframe"],
]);

/** Generic containers a browser or an editor wraps a copy in (Chrome's
 * `div › p`, Google Docs' `b › p`, Word's `p › o:p`) and the paragraph
 * blocks themselves: a sole one of these is looked through. A list, a
 * table, a form or a figure is STRUCTURE even with one item in it, and
 * never unwraps. */
const WRAPPER_TAGS: ReadonlySet<string> = new Set([
  ...["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "address", "div"],
  ...["section", "article", "main", "header", "footer", "aside", "nav"],
  ...["blockquote", "center"],
]);

/** Whether the parsed body is at most one paragraph: after looking past
 * what a page never shows, a chain of sole wrappers down to content that
 * is text and phrasing elements only, with no replaced content. An empty
 * body counts too. */
export function isSingleParagraph(doc: Document): boolean {
  let scope: Element = doc.body;
  for (;;) {
    const children = contentChildren(scope);
    const elements = children.filter(
      (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
    );
    const hasText = children.some((node) => node.nodeType === Node.TEXT_NODE);
    const only = elements[0];
    if (elements.length === 1 && !hasText && only !== undefined) {
      const tag = only.localName;
      if (WRAPPER_TAGS.has(tag) || (inline(tag) && !REPLACED_TAGS.has(tag))) {
        scope = only;
        continue;
      }
    }
    return elements.every(isPhrasingOnly);
  }
}

/** Whether the body holds anything a page could show: words, or replaced
 * content. Whitespace-only structure (`<p> </p><p> </p>`) is nothing —
 * Text would refuse it too. */
export function hasContent(doc: Document): boolean {
  if ((doc.body.textContent ?? "").trim() !== "") return true;
  return Array.from(doc.body.querySelectorAll("*")).some((element) =>
    REPLACED_TAGS.has(element.localName),
  );
}

function inline(tag: string): boolean {
  return !BLOCK_TAGS.has(tag);
}

/** The nodes a page shows: elements it renders, and text with something
 * in it. */
function contentChildren(scope: Element): ChildNode[] {
  return Array.from(scope.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE)
      return (node as Text).data.trim() !== "";
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return !UNSHOWN_TAGS.has((node as Element).localName);
  });
}

/** An inline element whose whole subtree is inline and never replaced. */
function isPhrasingOnly(element: Element): boolean {
  const tag = element.localName;
  if (UNSHOWN_TAGS.has(tag)) return true;
  if (!inline(tag) || REPLACED_TAGS.has(tag)) return false;
  return Array.from(element.children).every(isPhrasingOnly);
}
