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

/** How many elements a paste of `doc` would store, as the element cap
 * counts them: every one in the head and the body — a `<meta>`, a
 * `<style>` too — and every one in a `<template>`'s content, which is not
 * in the tree and is stored all the same; not the `html`, `head` and
 * `body` every page has. */
export function pastedElements(doc: Document): number {
  const count = (root: ParentNode): number => {
    let n = 0;
    for (const el of root.querySelectorAll("*")) {
      n += 1;
      if (el.localName === "template" && "content" in el) {
        n += count((el as HTMLTemplateElement).content);
      }
    }
    return n;
  };
  return count(doc.head) + count(doc.body);
}

/** Whether the parse produced any element in the body — the difference
 * between markup and text that happens to start with `<`. */
export function hasElements(doc: Document): boolean {
  return doc.body.firstElementChild !== null;
}

/** A `data:` URL an `img` names as its `src`, or a css `url()` names in a
 * `style` attribute, a `<style>` or a page's css. The cleaning takes a
 * `data:` url out of an `img`'s `src` and keeps one in css as written;
 * the paste vendors the bytes of an image and names the stored copy in
 * its place, so the page stores neither. `url` is the URL as the parser
 * read it; `file` is null when it is not an image; `inCss` is true when a
 * css `url()` names it. */
export interface DataImage {
  url: string;
  file: File | null;
  inCss: boolean;
}

/** Each distinct `data:` URL an `img` names as its `src`, or a css `url()`
 * in a `style` attribute or a `<style>` — then in `css`, a page's own
 * stylesheet — in document order: the same image twice is one file. */
export function dataImages(doc: Document, css = ""): DataImage[] {
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
  cssUrls(css);
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
 * `style` attribute or a `<style>`, that is a key of `stored` — an
 * image's `data:` URL, whole — replaced by its value, where the author
 * wrote it: nothing else in the text moves — not the same URL in text, in
 * a comment, in a css string or in another attribute, and not a longer
 * URL it begins. */
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
  /** How many image files the host stored for it. */
  stored: number;
}

/** A paste cleaned, none of its images stored yet: what `storePaste`
 * finishes once the landing is going ahead. */
export interface CleanedPaste {
  options: { id: string; position: { x: number; y: number }; said: string[] };
  /** Each `data:` image the cleaning kept, as written, by the name it
   * was cleaned under: the files `storePaste` stores. */
  kept: Map<string, string>;
  page: { html: string; css: string };
  findings: string[];
}

/** Each distinct entry once, with `×n` when it repeats, in first-seen
 * order — the kernel landing's own counting. */
function counted(items: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, n]) => (n === 1 ? item : `${item} ×${n}`));
}

/** The name the `n`th `data:` image of paste `id` goes by through the
 * cleaning: a url a page may store, so the cleaning keeps it wherever it
 * keeps what names it; this paste's own, so nothing the author wrote is
 * taken for it; and closed (`.held`), so no name begins another. */
const heldName = (id: string, n: number): string =>
  `assets/daydream-paste-${id}-${n}.held`;

/** `text` with each key of `names` replaced by its value, everywhere. */
function renamed(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [from, to] of names) out = out.split(from).join(to);
  return out;
}

/**
 * The viewport `html` lands as, at `position`: the text cleaned exactly
 * as every landing cleans a page (`cleanPaste`), then its images stored
 * (`storePaste`) — the two a paste runs apart, so that nothing is stored
 * for a paste that is abandoned before it lands.
 */
export async function pageFromPaste(
  dd: Pick<DaydreamApi, "cleanPage" | "vendorFile">,
  html: string,
  options: {
    id: string;
    position: { x: number; y: number };
    said: string[];
  },
): Promise<PastedPage> {
  return storePaste(dd, await cleanPaste(dd, html, options));
}

/**
 * `html` cleaned exactly as every landing cleans a page, nothing stored.
 *
 * A page names its images by url, not by their bytes (decision #76). So
 * each `data:` image written in an `img`'s `src` or a css `url()` (a
 * `style` attribute, a `<style>`) goes through the cleaning under a name
 * of its own (`heldName`), and those the cleaning kept — not one in a
 * subtree it removed — are the ones `storePaste` stores. A clipboard
 * carries no address — no `<base>` or source-URL comment is read from it
 * — so no `sourceUrl` is passed: a relative stylesheet `href` resolves
 * against nothing, and the cleaning removes and reports it.
 */
export async function cleanPaste(
  dd: Pick<DaydreamApi, "cleanPage">,
  html: string,
  options: CleanedPaste["options"],
): Promise<CleanedPaste> {
  // Each data: image as written, by the name it is cleaned under.
  const held = new Map<string, string>();
  for (const url of writtenImageUrls(html)) {
    if (held.has(url) || fileFromDataUrl(url.trim()) === null) continue;
    held.set(url, heldName(options.id, held.size));
  }
  const cleaned = await dd.cleanPage(
    { html: withStoredImages(html, held), css: "" },
    { where: "paste" },
  );
  const kept = new Map<string, string>();
  for (const [url, name] of held) {
    if (cleaned.html.includes(name) || cleaned.css.includes(name)) kept.set(url, name);
  }
  return {
    options,
    kept,
    page: { html: cleaned.html, css: cleaned.css },
    findings: cleaned.findings.map((finding) => finding.message),
  };
}

/**
 * A cleaned paste's images stored through the host (`dd.vendorFile`),
 * the page's name for each copy written where its held name was, and the
 * page it lands as. One the host cannot store is put back as written and
 * the page cleaned again, as it would have been: taken off an `img`
 * (which stays, with its `alt`) and kept in css, as the cleaning keeps
 * any `data:` url there. With no `data:` image and nothing to take out,
 * the text lands byte for byte. `progress.stored` counts the files
 * stored as they are, so a caller whose landing fails can say how many
 * it left.
 *
 * `said` carries what was said before this point; the paste's own
 * sentences follow it, then the cleaning's findings.
 */
export async function storePaste(
  dd: Pick<DaydreamApi, "cleanPage" | "vendorFile">,
  cleaned: CleanedPaste,
  progress: { stored: number } = { stored: 0 },
): Promise<PastedPage> {
  const said: string[] = [];
  const findings = [...cleaned.findings];
  // What each kept name becomes: the stored copy's name, or the url as
  // written when the host could not store it.
  const names = new Map<string, string>();
  const unstored = new Set<string>();
  for (const [url, name] of cleaned.kept) {
    try {
      names.set(name, (await dd.vendorFile(fileFromDataUrl(url.trim())!)).pageSrc);
      progress.stored += 1;
    } catch (error) {
      said.push(
        `the host could not store a data: image (${error instanceof Error ? error.message : String(error)})`,
      );
      names.set(name, url);
      unstored.add(url);
    }
  }
  let page = {
    html: renamed(cleaned.page.html, names),
    css: renamed(cleaned.page.css, names),
  };
  if (unstored.size > 0) {
    const again = await dd.cleanPage(page, { where: "paste" });
    page = { html: again.html, css: again.css };
    findings.push(...again.findings.map((finding) => finding.message));
  }

  // A data: url left in css (no image, or one the host could not store)
  // is emptied by the cleaning, which says so in its findings.
  const landed = parseHtml(page.html);

  const { options } = cleaned;
  const title = landed.title.trim();
  const item: DreamPage = {
    id: options.id,
    kind: VIEWPORT_KIND,
    position: options.position,
    frame: { width: VIEWPORT_WIDTH },
    payload: {
      ...page,
      ...(title === "" ? {} : { meta: { title } }),
    },
  };
  return {
    item,
    elements: landed.body.getElementsByTagName("*").length + 2,
    said: [...options.said, ...counted(said), ...findings],
    stored: progress.stored,
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
