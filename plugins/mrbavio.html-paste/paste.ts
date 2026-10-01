// The paste hook (decision #56): priority 5 — after Media (10), which
// claims media-only HTML, before Text (0), the plain-text fallback. Claims
// a transfer with no files whose `text/plain` is markup (an editor's copy:
// VS Code puts a syntax-highlighted rendering in `text/html` and the
// markup itself in `text/plain`, so the plain face wins), or whose
// `text/html` parses to at least one element and is more than a single
// paragraph of prose (prose.ts) — a paragraph is text however a browser
// wrapped it, and is left for Text. A claimed paste is a new PAGE, and a
// page is a file of the project (decision #78): the pasted text is
// written as a new html file through `dd.createPage`, which names it
// (`index.html` in a project with no page yet, else after its `<title>`,
// `page.html` with none), downloads the remote media it names into
// `assets/`, and places a viewport of it as one undo step; the paste
// selects it. The file is the pasted text as it arrived — nothing is
// cleaned or folded: what would run is the render walk's to leave off
// the mount, as for every page — save one line: a fragment, which has no
// doctype, is written after `<!doctype html>`, so a browser opening the
// file renders it in standards mode, as the canvas renders every page.
// One console line says what was made, and one more names each file
// that could not be downloaded, left as written; a refusal (no project
// open, no host) is the paste's one console line, and a viewport made
// that could not be selected says so. No gates: a paste is the user's
// own hand on the canvas, not an agent's page.

import type { DaydreamApi } from "@daydream/plugin-api";
import { flush, untrack } from "solid-js";

import { hasContent, isSingleParagraph } from "./prose";

export const PASTE_PRIORITY = 5;

/** The most elements one paste may make a page of. A copied section is
 * hundreds; a whole site's DOM is not a viewport. Refused with a console
 * line before the kernel is asked. */
export const MAX_ELEMENTS = 10_000;

/** The most characters of source one paste may carry — a cap on bytes
 * beside the one on elements, since one `p` can hold a novel and a
 * style value a whole image. */
export const MAX_SOURCE = 4_000_000;

/** Every pasted viewport's frame width: the frame rule (knowledge/
 * format.md) wants a width and no height, and 960 is the desktop page a
 * copied section was designed for. */
export const VIEWPORT_WIDTH = 960;

/** DOMParser over the whole clipboard text: a fragment gets a synthetic
 * `html`/`body`, a Chrome copy (`<meta charset>` and StartFragment
 * comments around the fragment) parses as the document it claims to be,
 * and a real document keeps its own root, head, title and doctype. A
 * leading byte order mark is left out of the parse, as a browser
 * decoding the file takes it out: DOMParser would read it as text, and a
 * doctype after it as no doctype at all. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(withoutBom(html), "text/html");
}

/** A byte order mark: an encoding's mark at a file's start, never its
 * text. */
const BOM = "\uFEFF";

function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/** How many elements a page made of `doc` would hold, as the element cap
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

/** The doctype a fragment's file is written after. */
export const DOCTYPE = "<!doctype html>\n";

/** The file a paste writes: the text as it arrived, after `DOCTYPE`
 * when its parse has none — a fragment, which a browser would otherwise
 * render in quirks mode. A document's own doctype, whatever it says, is
 * the author's. A byte order mark the text begins with stays first, the
 * doctype after it, as a file carries one. */
export function pageFile(source: HtmlSource): string {
  if (source.doc.doctype !== null) return source.text;
  const rest = withoutBom(source.text);
  return source.text.slice(0, source.text.length - rest.length) + DOCTYPE + rest;
}

/** Whether plain text is markup and not prose that happens to open with
 * `<` — `<T> extends Foo`, `<Component /> renders`, `<x@y.z> wrote:`.
 * The parser makes an element out of any of those; a closing tag is
 * what an author of markup writes. */
export function looksLikeMarkup(text: string): boolean {
  return text.trimStart().startsWith("<") && /<\/[a-z][\w:-]*\s*>/i.test(text);
}

/** What a transfer carries as markup: the text, and its parse. */
export interface HtmlSource {
  /** The face that was parsed, as it arrived: the markup the paste
   * writes as the new page's file (`pageFile`). */
  text: string;
  doc: Document;
}

/** The markup a transfer carries, or null when this plugin should not
 * claim it: no markup at all, nothing a page could show, or a single
 * paragraph of prose that Text can hold as the plain text. */
export function htmlSource(transfer: DataTransfer | null): HtmlSource | null {
  if (transfer === null || transfer.files.length > 0) return null;
  const text = transfer.getData("text/plain");
  // Markup typed or copied as plain text is deliberate and always claimed.
  if (looksLikeMarkup(text)) {
    const doc = parseHtml(text);
    if (hasElements(doc) && hasContent(doc)) return { text, doc };
  }
  const html = transfer.getData("text/html");
  if (html === "") return null;
  const doc = parseHtml(html);
  if (!hasElements(doc) || !hasContent(doc)) return null;
  // A browser copies prose as HTML: a paragraph is text however it was
  // wrapped. Text takes the plain face; with none, nothing is pasted.
  if (isSingleParagraph(doc)) return null;
  return { text: html, doc };
}

export function registerHtmlPaste(dd: DaydreamApi): void {
  // The Text plugin's cascade, copied on purpose (decision #56):
  // consecutive pastes step 16px so they never stack exactly; anything
  // the user does in between starts over. Each plugin counts its own
  // pastes, so a text paste between two HTML pastes starts this one over.
  // TODO(#56): a canvas-owned "where does the next paste land" is the
  // dedupe, when a third kind wants it.
  let consecutivePastes = 0;
  // Pastes whose page is being written: while one is, a change of the
  // document or the selection is the paste's own — its viewport placed,
  // then selected — not an action in between. A gesture on the canvas
  // and a pan or a zoom are the user's, and start over even then.
  let pasting = 0;
  let camera = untrack(() => dd.geometry.camera());
  const startOver = () => {
    consecutivePastes = 0;
  };
  const reset = () => {
    if (pasting === 0) startOver();
  };
  dd.canvas.onActivity(startOver);
  dd.on("document", reset);
  dd.on("selection", reset);
  dd.on("geometry", () => {
    const next = untrack(() => dd.geometry.camera());
    if (
      next.panX !== camera.panX ||
      next.panY !== camera.panY ||
      next.zoom !== camera.zoom
    )
      startOver();
    camera = next;
  });

  const why = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  /** Write `text` as a new page of the project, its viewport at
   * `position`, and select it; say what was made. The kernel writes the
   * file and places the viewport as one undo step, or refuses — no
   * project open, no host — writing nothing. */
  const land = async (
    text: string,
    position: { x: number; y: number },
  ): Promise<void> => {
    pasting += 1;
    try {
      let made: Awaited<ReturnType<DaydreamApi["createPage"]>>;
      try {
        made = await dd.createPage(text, {
          position,
          frame: { width: VIEWPORT_WIDTH },
        });
      } catch (error) {
        console.error(`[${dd.plugin.id}] paste refused: ${why(error)}`);
        return;
      }
      try {
        // A page is selected as an item is: by its envelope id. (One made
        // while another project opened is refused, placed nowhere.)
        dd.select(made.viewportId);
        // Flush the paste's own notifications while suppression is
        // explicit.
        flush();
      } catch (error) {
        console.error(
          `[${dd.plugin.id}] pasted a page: ${made.path}, but its viewport could not be selected: ${why(error)}`,
        );
        return;
      }
      console.info(
        `[${dd.plugin.id}] pasted a page: ${made.path}, ${VIEWPORT_WIDTH}px wide`,
      );
      for (const { url, reason } of made.unvendored) {
        console.warn(
          `[${dd.plugin.id}] ${url} could not be downloaded into assets/ (${reason}): it stays as written`,
        );
      }
    } finally {
      pasting -= 1;
    }
  };

  dd.canvas.onPaste(
    (event) => {
      const transfer = event.clipboardData;
      const bytes = Math.max(
        transfer?.getData("text/html").length ?? 0,
        transfer?.getData("text/plain").length ?? 0,
      );
      if (bytes > MAX_SOURCE) {
        // Claimed and refused: Text would hold the same novel.
        event.preventDefault();
        console.error(
          `[${dd.plugin.id}] paste refused: ${bytes} characters; a paste carries at most ${MAX_SOURCE}`,
        );
        return;
      }
      const source = htmlSource(transfer);
      if (source === null) return;
      event.preventDefault();
      const size = pastedElements(source.doc);
      if (size > MAX_ELEMENTS) {
        console.error(
          `[${dd.plugin.id}] paste refused: ${size} elements; a viewport holds at most ${MAX_ELEMENTS}`,
        );
        return;
      }
      const cascade = consecutivePastes++ * 16;
      const center = dd.canvas.center();
      // Centered on the width; the height is the page's to decide once it
      // renders, so the top sits a quarter-width above the center.
      const position = {
        x: center.x - VIEWPORT_WIDTH / 2 + cascade,
        y: center.y - VIEWPORT_WIDTH / 4 + cascade,
      };
      void land(pageFile(source), position);
    },
    { priority: PASTE_PRIORITY },
  );
}
