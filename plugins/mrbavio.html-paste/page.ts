// The page a paste lands (decision #76): a viewport's payload is the
// page's markup and its stylesheet as text, `{ html, css }`, rendered in a
// shadow root. So a paste converts nothing: it hands the pasted text to
// the kernel's cleaning (`dd.cleanPage`, the function every landing runs)
// and stores what comes back — the author's text with what the cleaning
// removes cut out where it was written (an `<iframe>` stays, under the
// renderer's forced sandbox), every `<style>` block and linked
// stylesheet folded into the css in document order — with the cleaning's
// own findings for the report. The browser is the vocabulary: every
// element, attribute, selector and at-rule the cleaning keeps lands as
// written.

import type { DaydreamApi, DreamPage } from "@daydream/plugin-api";

/** Every pasted viewport's frame width: the frame rule (knowledge/
 * format.md) wants a width and no height, and 960 is the desktop page a
 * copied section was designed for. */
export const VIEWPORT_WIDTH = 960;

/** The kind constant, as the format names it. */
const VIEWPORT_KIND = "daydream.viewport";

/** DOMParser over the whole clipboard text: a fragment gets a synthetic
 * `html`/`body`, a Chrome copy (`<meta charset>` and StartFragment
 * comments around the fragment) parses as the document it claims to be,
 * and a real document keeps its own root, head and title. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Whether the parse produced any element in the body — the difference
 * between markup and text that happens to start with `<`. */
export function hasElements(doc: Document): boolean {
  return doc.body.firstElementChild !== null;
}

/** A `data:` URL an `img` names as its `src`, or a css `url()` names in a
 * `style` attribute or a `<style>`. The cleaning takes a `data:` url out
 * of an `img`'s `src` and keeps one in css as written; the paste vendors
 * the bytes of an image and names the stored copy in its place, so the
 * page stores neither. `url` is the URL as the parser read it; `file` is
 * null when it is not an image; `inCss` is true when a css `url()` names
 * it. */
export interface DataImage {
  url: string;
  file: File | null;
  inCss: boolean;
}

/** Each distinct `data:` URL an `img` names as its `src`, or a css `url()`
 * in a `style` attribute or a `<style>`, in document order: the same
 * image twice is one file. */
export function dataImages(doc: Document): DataImage[] {
  const found = new Map<string, boolean>();
  const add = (url: string, inCss: boolean): void => {
    if (/^\s*data:/i.test(url))
      found.set(url, inCss || found.get(url) === true);
  };
  const cssUrls = (css: string): void => {
    for (const { start, end } of cssUrlSpans(css, 0, css.length)) {
      add(css.slice(start, end), true);
    }
  };
  for (const element of Array.from(
    doc.querySelectorAll("img[src], [style], style"),
  )) {
    const src =
      element.localName === "img" ? element.getAttribute("src") : null;
    if (src !== null) add(src, false);
    const style = element.getAttribute("style");
    if (style !== null) cssUrls(style);
    if (element.localName === "style") cssUrls(element.textContent ?? "");
  }
  return Array.from(found, ([url, inCss]) => ({
    url,
    file: fileFromDataUrl(url.trim()),
    inCss,
  }));
}

/** Elements whose content is text to the parser, never tags: an `<img`
 * written inside one is not an image. Not `noscript`: DOMParser runs no
 * script, so its content is markup. */
const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
]);

/** `[start, end)` of a span of text. */
interface Span {
  start: number;
  end: number;
}

/** A start tag's pieces, read in place (sticky). */
const TAG_NAME = /[^\s/>]+/y;
const GAP = /[\s/]*/y;
const ATTRIBUTE = /[^\s/>][^\s/>=]*/y;
const EQUALS = /\s*=\s*/y;
const UNQUOTED = /[^\s>]*/y;

/** A css `url()` token read in place (sticky): its url quoted, either
 * way, or bare. */
const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)/iy;

/**
 * Where each `url()` token's url is written in the css `text` holds in
 * `[from, to)`, `[start, end)` inside its quotes, in order. Comments and
 * strings are stepped over, so a url in either is not one, and so is a
 * name that only ends in `url(`.
 */
function cssUrlSpans(text: string, from: number, to: number): Span[] {
  const spans: Span[] = [];
  let i = from;
  while (i < to) {
    const char = text[i]!;
    if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 || close >= to ? to : close + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = i + 1;
      while (end < to && text[end] !== char) end += text[end] === "\\" ? 2 : 1;
      i = end + 1;
      continue;
    }
    URL_TOKEN.lastIndex = i;
    const token =
      (char === "u" || char === "U") && !/[\w-]/.test(text[i - 1] ?? "")
        ? URL_TOKEN.exec(text)
        : null;
    if (token === null || i + token[0].length > to) {
      i++;
      continue;
    }
    const url = token[1] ?? token[2] ?? token[3]!;
    // The url is where the token ends, less its close and any quote.
    const close = /["']?\s*\)$/.exec(token[0])![0].length;
    const end = i + token[0].length - close;
    spans.push({ start: end - url.length, end });
    i += token[0].length;
  }
  return spans;
}

/**
 * Where each url a stored image may replace is written in `text`,
 * `[start, end)` inside its quotes, in document order: each `img`'s `src`
 * — the first `src` of a tag, as the parser keeps the first of a repeated
 * attribute — and each css `url()` in a `style` attribute (the first of a
 * tag's) or a `<style>`'s text. A tokenizer of start tags alone —
 * comments, doctypes, end tags and the content of other raw-text elements
 * are stepped over — so a URL in text content or in any other attribute
 * is never one of these.
 */
function imageUrlSpans(text: string): Span[] {
  const spans: Span[] = [];
  // Sticky, so each read starts where the last ended: a paste may be
  // millions of characters, and no read copies the rest of the text.
  const read = (pattern: RegExp, at: number): string => {
    pattern.lastIndex = at;
    return pattern.exec(text)?.[0] ?? "";
  };
  // Where `token` next is from `from`, any case: the text's end when it
  // is nowhere.
  const seek = (from: number, token: string): Span => {
    const pattern = new RegExp(token, "gi");
    pattern.lastIndex = from;
    const found = pattern.exec(text);
    return found === null
      ? { start: text.length, end: text.length }
      : { start: found.index, end: found.index + found[0].length };
  };
  const past = (from: number, token: string): number => seek(from, token).end;
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open === -1) break;
    const next = text[open + 1] ?? "";
    if (text.startsWith("<!--", open)) {
      i = past(open + 4, "-->");
      continue;
    }
    if (!/[a-z]/i.test(next)) {
      // An end tag, a doctype, a processing instruction — or text.
      i = /[!/?]/.test(next) ? past(open, ">") : open + 1;
      continue;
    }
    const name = read(TAG_NAME, open + 1);
    let at = open + 1 + name.length;
    let src: Span | null = null;
    let style: Span | null = null;
    for (;;) {
      at += read(GAP, at).length;
      if (at >= text.length || text[at] === ">") break;
      const attribute = read(ATTRIBUTE, at);
      at += attribute.length;
      const equals = read(EQUALS, at);
      if (equals === "") continue;
      at += equals.length;
      const quote = text[at];
      let value: Span;
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, at + 1);
        value = { start: at + 1, end: close === -1 ? text.length : close };
        at = value.end + 1;
      } else {
        value = { start: at, end: at + read(UNQUOTED, at).length };
        at = value.end;
      }
      const lower = attribute.toLowerCase();
      if (src === null && lower === "src") src = value;
      if (style === null && lower === "style") style = value;
    }
    i = at + 1;
    const tag = name.toLowerCase();
    if (tag === "img" && src !== null) spans.push(src);
    if (style !== null)
      spans.push(...cssUrlSpans(text, style.start, style.end));
    if (RAW_TEXT.has(tag)) {
      const close = seek(i, `</${tag}`);
      if (tag === "style") spans.push(...cssUrlSpans(text, i, close.start));
      i = close.end;
    }
  }
  // A tag's `style` may come before its `src`.
  return spans.sort((a, b) => a.start - b.start);
}

/** Each url a stored image may replace (`withStoredImages`) as it is
 * written in `text`. A `data:` URL the parser reads (`dataImages`) that
 * is not among them was written with a character reference, and cannot be
 * replaced where it was written. */
export function writtenImageUrls(text: string): Set<string> {
  return new Set(
    imageUrlSpans(text).map(({ start, end }) => text.slice(start, end)),
  );
}

/** The pasted text with each `img` `src`, and each css `url()`'s url in a
 * `style` attribute or a `<style>`, that is a stored image's `data:` URL,
 * whole, replaced by the page's name for its copy, where the author wrote
 * it: nothing else in the text moves — not the same URL in text, in a
 * comment, in a css string or in another attribute, and not a longer URL
 * it begins. */
export function withStoredImages(
  text: string,
  stored: ReadonlyMap<string, string>,
): string {
  if (stored.size === 0) return text;
  let out = "";
  let from = 0;
  for (const { start, end } of imageUrlSpans(text)) {
    const src = stored.get(text.slice(start, end));
    if (src === undefined) continue;
    out += text.slice(from, start) + src;
    from = end;
  }
  return out + text.slice(from);
}

/** A `data:` URL as a File named for its type, or null when it is not an
 * image or does not decode. */
export function fileFromDataUrl(url: string): File | null {
  const match = /^data:([^,]*?)(;base64)?,([\s\S]*)$/i.exec(url);
  if (match === null) return null;
  const mime = (match[1] === "" ? "text/plain" : match[1]!)
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (!mime.startsWith("image/")) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    if (match[2] !== undefined) {
      const binary = atob(match[3]!.replace(/\s+/g, ""));
      bytes = new Uint8Array(new ArrayBuffer(binary.length));
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(match[3]!));
    }
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const extension =
    mime === "image/jpeg"
      ? "jpg"
      : mime === "image/svg+xml"
        ? "svg"
        : mime.slice("image/".length).replace(/[^a-z0-9]/g, "");
  return new File([bytes], `pasted-image.${extension}`, { type: mime });
}

/** What a paste lands, and what was said about it. */
export interface PastedPage {
  item: DreamPage;
  /** Elements in the landed markup: the `html` and `body` and everything
   * in the body. */
  elements: number;
  /** What the paste changed or could not keep, in order: the paste's own
   * sentences, then the cleaning's findings in the kernel's words. */
  said: string[];
}

/**
 * The viewport `html` lands as, at `position`: the text cleaned exactly
 * as every landing cleans a page, and stored as the cleaning answers it.
 * `said` carries what the paste said before this point (an image it
 * could not store). A clipboard carries no address — no `<base>` or
 * source-URL comment is read from it — so no `sourceUrl` is passed: a
 * relative stylesheet `href` resolves against nothing, and the cleaning
 * removes and reports it.
 */
export async function pageFromPaste(
  dd: Pick<DaydreamApi, "cleanPage">,
  html: string,
  options: {
    id: string;
    position: { x: number; y: number };
    said: string[];
  },
): Promise<PastedPage> {
  const cleaned = await dd.cleanPage({ html, css: "" }, { where: "paste" });
  const landed = parseHtml(cleaned.html);
  const title = landed.title.trim();
  const item: DreamPage = {
    id: options.id,
    kind: VIEWPORT_KIND,
    position: options.position,
    frame: { width: VIEWPORT_WIDTH },
    payload: {
      html: cleaned.html,
      css: cleaned.css,
      ...(title === "" ? {} : { meta: { title } }),
    },
  };
  return {
    item,
    elements: landed.body.getElementsByTagName("*").length + 2,
    said: [
      ...options.said,
      ...cleaned.findings.map((finding) => finding.message),
    ],
  };
}

/** One line for the console: what landed, then what was said about it. */
export function describePaste(
  elements: number,
  said: readonly string[],
): string {
  const landed = `landed ${elements} element${elements === 1 ? "" : "s"}`;
  return said.length === 0
    ? `${landed}, nothing lost`
    : `${landed}; ${said.join("; ")}`;
}
