// The converter (decisions.md #56): a parsed HTML document in, one
// viewport item and a report out. PURE — no `dd`, no store, no clipboard:
// it takes `dd.core` for the allowlist faces and fresh ids, and returns
// what it could not do synchronously (data: images to vendor) as work for
// the caller. Everything the model cannot hold is downgraded or dropped
// HERE and counted in the report, so the tree that comes out always lands.
//
// The model as it is (packages/plugin-api/document.ts): one `text` per
// element rendered before its children, so mixed inline runs become
// `span` children; a closed tag allowlist (`core.tagProblem`); the
// attribute allowlist (`core.attrProblem`), `class`, `id` and `data-*`
// among them since the selectors step; styles as a verbatim map on the
// element, and the page's `<style>` blocks as the viewport's SHEET
// (decisions.md #71, stylesheet.ts) — flat rules the browser parsed, a
// `@font-face` lifted into `fonts`. A linked stylesheet is still lost: a
// fetch is a network call beyond the host.

import type {
  CoreApi,
  DreamElement,
  DreamViewport,
  StyleRule,
} from "@daydream/plugin-api";
import type { FontFace } from "@daydream/plugin-api/document";

import { count, emptyReport, type PasteReport } from "./report";
import {
  cssLength,
  parseStyleAttribute,
  preservesWhitespace,
} from "./styleAttribute";
import { sheetFromStyleText } from "./stylesheet";
import {
  dropRule,
  insideDroppedTag,
  insideParagraph,
  isDroppedTag,
  resolveTag,
  TABLE_CONTAINERS,
} from "./tags";

/** Every pasted viewport's frame width: the frame rule (knowledge/
 * format.md) wants a width and no height, and 960 is the desktop page a
 * copied section was designed for. */
export const VIEWPORT_WIDTH = 960;

/** The deepest nesting a landed tree may have, `html` at 0. The kernel's
 * renderer recurses once per element and a real page never comes close;
 * a paste that does is not a section, and past this depth an element
 * lands as a leaf holding its words, the structure below it counted. */
export const MAX_DEPTH = 64;

/** The most characters a label carries: four words, and never a wall. */
export const MAX_LABEL = 40;

/** The kind constant, as the format names it. */
const VIEWPORT_KIND = "daydream.viewport";

/** A `data:` image decoded to a File, and the `img` element whose `src`
 * it becomes once the caller has vendored it. The tree is plain data
 * until it lands, so the element itself is the handle. */
export interface DataImage {
  element: DreamElement;
  file: File;
}

export interface Conversion {
  item: DreamViewport;
  report: PasteReport;
  /** Async work left for the caller: vendor each file, write the returned
   * src onto `element.attrs`, then land. */
  dataImages: DataImage[];
}

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

interface Context {
  core: CoreApi;
  report: PasteReport;
  dataImages: DataImage[];
}

/** One viewport from a parsed document at `position`, with the report. */
export function convertDocument(
  doc: Document,
  core: CoreApi,
  position: { x: number; y: number },
): Conversion {
  const ctx: Context = { core, report: emptyReport(), dataImages: [] };
  // The head is packaging — dropped whole — except that a script in it is
  // content the page had. Count it like one in the body.
  const scripts = doc.head.querySelectorAll("script").length;
  if (scripts > 0) count(ctx.report.dropped, "script", scripts);
  // A linked stylesheet, wherever it sits, is exactly what a class-styled
  // fragment lost; other links (icons, preloads) are packaging.
  const sheets = doc.querySelectorAll('link[rel~="stylesheet"]').length;
  if (sheets > 0) count(ctx.report.dropped, "link", sheets);
  const { sheet, fonts } = sheetOf(doc, ctx);
  const html = doc.documentElement;
  const root: DreamElement = {
    id: core.generateId(),
    tag: "html",
    styles: stylesOf(html, ctx),
    children: [],
    label: "html",
  };
  takeAttributes(html, root, ctx, { kept: false });
  const body = convertElement(doc.body, ctx, false, 1);
  if (body === null) throw new Error("body is never dropped");
  root.children = [body.element];
  const title = doc.title.trim();
  const item: DreamViewport = {
    id: core.generateId(),
    kind: VIEWPORT_KIND,
    position,
    frame: { width: VIEWPORT_WIDTH },
    payload: {
      root,
      ...(title === "" ? {} : { meta: { title } }),
      ...(fonts.length === 0 ? {} : { fonts }),
      ...(sheet.length === 0 ? {} : { sheet }),
    },
  };
  return { item, report: ctx.report, dataImages: ctx.dataImages };
}

/** The XHTML namespace: an SVG `<style>` styles the drawing, which goes
 * with its tag. */
const HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Every `<style>` in head or body (the parser hoists a fragment's leading
 * one into the head), in document order — a page's cascade is its
 * stylesheets in order — each parsed by the browser as the sheet it is
 * (an unterminated block in one never swallows the next, exactly as the
 * page would have it) and the results laid end to end as ONE sheet. The
 * element itself is consumed here, not dropped: tags.ts treats it as
 * packaging on the tree walk. A `<style>` under a dropped element — a
 * `<noscript>`'s, which the page never applies while scripts run — goes
 * with that element, counted once under its tag.
 */
function sheetOf(
  doc: Document,
  ctx: Context,
): { sheet: StyleRule[]; fonts: FontFace[] } {
  const sheet: StyleRule[] = [];
  const fonts: FontFace[] = [];
  for (const element of Array.from(doc.querySelectorAll("style"))) {
    if (element.namespaceURI !== HTML_NS || insideDroppedTag(element)) continue;
    const walked = sheetFromStyleText(element.textContent ?? "", ctx.core);
    sheet.push(...walked.rules);
    fonts.push(...walked.fonts);
    ctx.report.important += walked.important;
    for (const [key, n] of Object.entries(walked.dropped))
      count(ctx.report.dropped, key, n);
    for (const [key, n] of Object.entries(walked.stripped))
      count(ctx.report.stripped, key, n);
  }
  return { sheet, fonts };
}

/** Every element in a tree, the report's "landed" figure. */
export function countElements(element: DreamElement): number {
  return 1 + element.children.reduce((n, child) => n + countElements(child), 0);
}

/** The element's own inline styles, parsed; `!important` flags and
 * refused property names go to the report. */
function stylesOf(source: Element, ctx: Context): Record<string, string> {
  const attribute = source.getAttribute("style");
  if (attribute === null) return {};
  const parsed = parseStyleAttribute(attribute, ctx.core);
  ctx.report.important += parsed.important;
  for (const name of parsed.invalid)
    count(ctx.report.stripped, `style (${name.slice(0, 24)})`);
  return parsed.styles;
}

/** One pass over the element's attributes. `style` was parsed already.
 * A KEPT tag keeps what `attrProblem` accepts, an `img`'s `src` through
 * the image rule; a downgraded tag's attributes belonged to the tag that
 * was lost. Everything else is counted. */
function takeAttributes(
  source: Element,
  element: DreamElement,
  ctx: Context,
  options: { kept: boolean },
): void {
  for (const { name, value } of Array.from(source.attributes)) {
    if (name === "style") continue;
    if (options.kept) {
      if (element.tag === "img" && name === "src") {
        imageSource(value, element, ctx);
        continue;
      }
      if (ctx.core.attrProblem(name, value) === null) {
        element.attrs = { ...element.attrs, [name]: value };
        continue;
      }
    }
    count(ctx.report.stripped, name);
  }
}

interface Converted {
  element: DreamElement;
  /** Whether the element flows inside a line — the whitespace rule its
   * parent applies around it. */
  inline: boolean;
}

/** One source element as a DreamElement, or null when it is dropped. */
function convertElement(
  source: Element,
  ctx: Context,
  preformatted: boolean,
  depth: number,
): Converted | null {
  const tag = source.localName;
  const drop = dropRule(tag);
  if (drop !== null) {
    if (drop === "counted") count(ctx.report.dropped, tag);
    return null;
  }
  const styles = stylesOf(source, ctx);
  const row = resolveTag(tag, styles, ctx.core, {
    insideParagraph: insideParagraph(source),
  });
  if (row.kind === "downgrade") count(ctx.report.downgraded, tag);
  const element: DreamElement = {
    id: ctx.core.generateId(),
    tag: row.tag,
    styles,
    children: [],
    label: tag,
  };
  if (tag === "svg") return convertSvg(source, element, ctx, row.inline);
  takeAttributes(source, element, ctx, { kept: row.kind === "keep" });
  if (depth >= MAX_DEPTH) {
    // Past the cap: the words stay, the structure below is counted — except
    // on a table container, which holds no text (the parser would move it
    // out, and the kernel refuses it); its words go with the structure.
    const text = collapse(proseOf(source)).trim();
    if (text !== "" && !TABLE_CONTAINERS.has(row.tag)) element.text = text;
    const below = Array.from(source.querySelectorAll("*")).filter(
      (descendant) => !isDroppedTag(descendant.localName),
    ).length;
    if (below > 0) count(ctx.report.dropped, `deeper than ${MAX_DEPTH}`, below);
  } else {
    const content = convertChildren(source, ctx, {
      preformatted:
        preformatted || tag === "pre" || preservesWhitespace(styles),
      blockParent: !row.inline || row.box,
      itemized: row.box,
      depth: depth + 1,
    });
    if (content.text !== undefined) element.text = content.text;
    element.children = content.children;
  }
  element.label = labelFor(tag, element);
  return { element, inline: row.inline };
}

/** An svg is an icon: a sized box, inline like the svg it was, its
 * drawing gone with the tag. Its `width` and `height` become styles (a
 * bare number is user units, px on the page); every other attribute
 * belonged to the drawing and is counted. */
function convertSvg(
  source: Element,
  element: DreamElement,
  ctx: Context,
  inline: boolean,
): Converted {
  for (const { name, value } of Array.from(source.attributes)) {
    if (name === "style") continue;
    if (name === "width" || name === "height") {
      const length = cssLength(value);
      if (ctx.core.isSafeValue(length)) element.styles[name] = length;
      else count(ctx.report.stripped, `style (${name})`);
      continue;
    }
    count(ctx.report.stripped, name);
  }
  element.styles["display"] ??= "inline-block";
  return { element, inline };
}

/** An `img`'s `src`: https stays; data: becomes a File for the caller to
 * vendor; anything else — relative, http:, another scheme — is dropped
 * with the reason counted, and the element keeps its `alt`. */
function imageSource(value: string, element: DreamElement, ctx: Context) {
  const src = value.trim();
  if (ctx.core.attrProblem("src", src) === null) {
    element.attrs = { ...element.attrs, src };
    return;
  }
  if (/^data:/i.test(src)) {
    const file = fileFromDataUrl(src);
    if (file !== null) {
      ctx.dataImages.push({ element, file });
      return;
    }
    count(ctx.report.images, "data: (not an image)");
    return;
  }
  let reason = "relative";
  try {
    reason = new URL(src).protocol;
  } catch {
    // no scheme: relative to a page this canvas never sees
  }
  count(ctx.report.images, reason);
}

/** A `data:` URL as a File named for its type, or null when it is not an
 * image or cannot be decoded. Base64 and percent-encoded payloads both. */
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

type Run =
  | { kind: "text"; value: string }
  | { kind: "element"; element: DreamElement; inline: boolean };

/** The element's content in the model's grain. Text alone becomes the
 * element's `text`; text beside elements becomes `span` children in
 * order, since the model renders one text before all children.
 *
 * Whitespace follows the browser's own processing, and nothing more:
 * runs collapse to one space (unless preformatted — a `pre`, or a
 * `white-space` that keeps text as written); a space at a block boundary
 * — the element's own edge when it is a block, or a block sibling's — is
 * one the page would not render and goes; a space beside an inline
 * sibling, or alone inside an inline element, is one it would and stays.
 * `blockParent` says the element's own edges are block boundaries — a
 * block, or a flex/grid container — and `itemized` that every child is
 * a flex or grid item, so no whitespace between children renders. */
function convertChildren(
  source: Element,
  ctx: Context,
  options: {
    preformatted: boolean;
    blockParent: boolean;
    itemized: boolean;
    depth: number;
  },
): { text?: string; children: DreamElement[] } {
  const { preformatted, blockParent, itemized } = options;
  const runs: Run[] = [];
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = preformatted
        ? (node as Text).data
        : collapse((node as Text).data);
      if (value === "") continue;
      const last = runs[runs.length - 1];
      // Adjacent runs — around a dropped element — merge into one.
      if (last?.kind === "text")
        last.value = preformatted
          ? last.value + value
          : collapse(last.value + value);
      else runs.push({ kind: "text", value });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue; // comments and the like
    const converted = convertElement(
      node as Element,
      ctx,
      preformatted,
      options.depth,
    );
    if (converted === null) continue;
    runs.push({ kind: "element", ...converted });
  }
  const kept: Run[] = [];
  runs.forEach((run, index) => {
    if (run.kind === "element") {
      kept.push(run);
      return;
    }
    let value = run.value;
    if (!preformatted) {
      // Runs merge, so a text run's neighbours are always elements. In a
      // flex or grid parent every run is its own item and the space
      // around it never renders, so both sides trim there.
      const previous = runs[index - 1];
      const next = runs[index + 1];
      const trimStart =
        itemized ||
        (previous === undefined
          ? blockParent
          : previous.kind === "element" && !previous.inline);
      const trimEnd =
        itemized ||
        (next === undefined
          ? blockParent
          : next.kind === "element" && !next.inline);
      if (trimStart) value = value.replace(/^ /, "");
      if (trimEnd) value = value.replace(/ $/, "");
    }
    if (value !== "") kept.push({ kind: "text", value });
  });
  const only = kept[0];
  if (kept.length === 1 && only?.kind === "text")
    return { text: only.value, children: [] };
  return {
    children: kept.map((run) =>
      run.kind === "element"
        ? run.element
        : {
            id: ctx.core.generateId(),
            tag: "span",
            styles: {},
            text: run.value,
            children: [],
            label: "text",
          },
    ),
  };
}

/** Whitespace runs to one space (HTML's collapsible whitespace). */
function collapse(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ");
}

/** The words under a source element, dropped tags' content left out —
 * `textContent` would read a script's source as prose. */
function proseOf(source: Element): string {
  let text = "";
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data;
    else if (
      node.nodeType === Node.ELEMENT_NODE &&
      !isDroppedTag((node as Element).localName)
    )
      text += proseOf(node as Element);
  }
  return text;
}

/** The text a converted element holds, its own then its children's, as
 * the runs were cut — a run keeps the space it ends with, so joining
 * them back reads as the source did. */
function textOf(element: DreamElement): string {
  return (element.text ?? "") + element.children.map(textOf).join("");
}

/** The tag — the SOURCE tag, so a downgraded element remembers what it
 * was — and, for headings and paragraphs, the first few words, never
 * more than MAX_LABEL characters. */
function labelFor(tag: string, element: DreamElement): string {
  if (!/^(h[1-6]|p)$/.test(tag)) return tag;
  const words = collapse(textOf(element))
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return tag;
  let few = words.slice(0, 4).join(" ");
  let cut = words.length > 4;
  if (few.length > MAX_LABEL) {
    few = few.slice(0, MAX_LABEL).trimEnd();
    cut = true;
  }
  return `${tag}: ${few}${cut ? "…" : ""}`;
}
