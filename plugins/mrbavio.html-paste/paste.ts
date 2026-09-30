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
// (`index.html` in a project with no page yet, else after its `<title>`),
// downloads the remote media it names into `assets/`, and places a
// viewport of it as one undo step; the paste selects it. One console line
// says what was made, and one more names each file that could not be
// downloaded, left as written; a refusal (no project open, no host) is
// the paste's one console line. No gates: a paste is the user's own hand
// on the canvas, not an agent's page.

import type { DaydreamApi } from "@daydream/plugin-api";
import { flush, untrack } from "solid-js";

import {
  hasElements,
  parseHtml,
  pastedElements,
  VIEWPORT_WIDTH,
} from "./page";
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
   * writes as the new page's file. */
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
  // Pastes whose page is being written: while one is, the page landing
  // and its selection are the paste's own, not an action in between.
  let pasting = 0;
  let camera = untrack(() => dd.geometry.camera());
  const reset = () => {
    if (pasting === 0) consecutivePastes = 0;
  };
  dd.canvas.onActivity(reset);
  dd.on("document", reset);
  dd.on("selection", reset);
  dd.on("geometry", () => {
    const next = untrack(() => dd.geometry.camera());
    if (
      next.panX !== camera.panX ||
      next.panY !== camera.panY ||
      next.zoom !== camera.zoom
    )
      reset();
    camera = next;
  });

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
      const made = await dd.createPage(text, {
        position,
        frame: { width: VIEWPORT_WIDTH },
      });
      // A page is selected as an item is: by its envelope id. (One made
      // while another project opened is refused, placed nowhere.)
      dd.select(made.viewportId);
      // Flush the paste's own notifications while suppression is explicit.
      flush();
      console.info(
        `[${dd.plugin.id}] pasted a page: ${made.path}, ${VIEWPORT_WIDTH}px wide`,
      );
      for (const { url, reason } of made.unvendored) {
        console.warn(
          `[${dd.plugin.id}] ${url} could not be downloaded into assets/ (${reason}): it stays as written`,
        );
      }
    } catch (error) {
      console.error(
        `[${dd.plugin.id}] paste refused: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      void land(source.text, position);
    },
    { priority: PASTE_PRIORITY },
  );
}
