// Prose stays text (decision #56, amended the same day): a browser
// copies every selection as HTML — a paragraph, or a few words, arrives
// as a `p` or a `span` with the page's computed styles inlined — and the
// user who copies a sentence wants a text item, not a page. So the hook
// claims a paste by the fragment's SHAPE, not by the presence of
// `text/html`: no more than a single paragraph of phrasing content is
// left for the Text plugin; anything with structure — two blocks, a
// list, a card, a table, an image inside the paragraph — is a fragment
// and lands as a viewport.

import { defaultInline, isDroppedTag } from "./tags";

/** Replaced content a paragraph cannot carry as plain text: with one of
 * these inside, a paragraph is a page fragment, not prose. Only tags the
 * converter keeps or downgrades belong here — a dropped tag is looked
 * past before this is asked. */
const REPLACED_TAGS: ReadonlySet<string> = new Set([
  "img",
  "picture",
  "video",
  "audio",
  "svg",
]);

/** Generic containers a browser or an editor wraps a copy in (Chrome's
 * `div › p`, Google Docs' `b › p`, Word's `p › o:p`) and the paragraph
 * blocks themselves: a sole one of these is looked through. A list, a
 * table, a form or a figure is STRUCTURE even with one item in it, and
 * never unwraps. */
const WRAPPER_TAGS: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "address",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "blockquote",
  "center",
]);

/** Whether the parsed body is at most one paragraph: after looking past
 * packaging and dropped tags, a chain of sole wrappers down to content
 * that is text and phrasing elements only, with no replaced content. An
 * empty body counts too. */
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
      if (
        WRAPPER_TAGS.has(tag) ||
        (defaultInline(tag) && !REPLACED_TAGS.has(tag))
      ) {
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

/** The nodes that will become content: elements the converter keeps or
 * downgrades, and text with something in it. */
function contentChildren(scope: Element): ChildNode[] {
  return Array.from(scope.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE)
      return (node as Text).data.trim() !== "";
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return !isDroppedTag((node as Element).localName);
  });
}

/** An inline element whose whole subtree is inline and never replaced. */
function isPhrasingOnly(element: Element): boolean {
  const tag = element.localName;
  if (isDroppedTag(tag)) return true;
  if (!defaultInline(tag) || REPLACED_TAGS.has(tag)) return false;
  return Array.from(element.children).every(isPhrasingOnly);
}
