// The paste hook (decision #56): priority 5 — after Media (10), which
// claims media-only HTML, before Text (0), the plain-text fallback. Claims
// a transfer with no files whose `text/plain` is markup (an editor's copy:
// VS Code puts a syntax-highlighted rendering in `text/html` and the
// markup itself in `text/plain`, so the plain face wins), or whose
// `text/html` parses to at least one element and is more than a single
// paragraph of prose (prose.ts) — a paragraph is text however a browser
// wrapped it, and is left for Text. Lands ONE page (page.ts, decision
// #76), cleaned by the kernel as every landing is, as one undo step, the
// way the Text plugin does — `dd.mutateItems` then `dd.select` — and
// reports what the cleaning said in one console line. No gates: a paste
// is the user's own hand on the canvas, not an agent's landing.

import type { DaydreamApi } from "@daydream/plugin-api";
import { flush, untrack } from "solid-js";

import {
  cleanPaste,
  describePaste,
  hasElements,
  parseHtml,
  pastedElements,
  storePaste,
  VIEWPORT_WIDTH,
  type CleanedPaste,
  type PastedPage,
} from "./page";
import { hasContent, isSingleParagraph } from "./prose";

export const PASTE_PRIORITY = 5;

/** The most elements one paste may land. A copied section is hundreds;
 * a whole site's DOM is not a viewport, and every later edit would
 * clone it into history. Refused with a console line, nothing lands. */
export const MAX_ELEMENTS = 10_000;

/** The most characters of source one paste may carry — a cap on bytes
 * beside the one on elements, since one `p` can hold a novel and a
 * style value a whole image. */
export const MAX_SOURCE = 4_000_000;

/** What a paste that did not land says of the image files it stored:
 * nothing when it stored none. They stay in the document's files — the
 * host has no call to take one back — so it is said. */
function leftUnused(stored: number): string {
  if (stored === 0) return "";
  const one = stored === 1;
  return `; the ${stored} image${one ? "" : "s"} stored for it ${one ? "is" : "are"} left unused, since the host has no call to take a stored file back`;
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
  /** The face that was parsed, as it arrived: what the paste hands to
   * the cleaning, and what the page stores when the cleaning has nothing
   * to take out of it. */
  text: string;
  doc: Document;
}

/** The markup a transfer carries, or null when this plugin should not
 * claim it: no markup at all, nothing a page could show, or a single
 * paragraph of prose that Text can hold as the plain text. */
export function htmlSource(transfer: DataTransfer | null): HtmlSource | null {
  if (transfer === null || transfer.files.length > 0) return null;
  const text = transfer.getData("text/plain");
  // Markup typed or copied as plain text is deliberate and always lands.
  if (looksLikeMarkup(text)) {
    const doc = parseHtml(text);
    if (hasElements(doc) && hasContent(doc)) return { text, doc };
  }
  const html = transfer.getData("text/html");
  if (html === "") return null;
  const doc = parseHtml(html);
  if (!hasElements(doc) || !hasContent(doc)) return null;
  // A browser copies prose as HTML: a paragraph is text however it was
  // wrapped. Text lands the plain face; with none, nothing lands.
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
  let pasting = false;
  let camera = untrack(() => dd.geometry.camera());
  const reset = () => {
    if (!pasting) consecutivePastes = 0;
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

  const land = (pasted: PastedPage): void => {
    const { item } = pasted;
    pasting = true;
    try {
      dd.mutateItems((items) => {
        items.push(item);
      });
      // A page is selected as an item is: by its envelope id.
      dd.select(item.id);
      // Flush the paste's own notifications while suppression is explicit.
      flush();
    } catch (error) {
      // After the images were stored: a refusal here cannot unstore them.
      console.error(
        `[${dd.plugin.id}] paste refused: ${error instanceof Error ? error.message : String(error)}${leftUnused(pasted.stored)}`,
      );
      return;
    } finally {
      pasting = false;
    }
    // A write from a deactivated plugin is ignored, not thrown: say
    // "landed" only when it did.
    if (!untrack(() => dd.items().some((landed) => landed.id === item.id)))
      return;
    console.info(
      `[${dd.plugin.id}] ${describePaste(pasted.elements, pasted.said)}`,
    );
  };

  /** The text cleaned as a landing cleans it, the `data:` images the
   * cleaning kept stored through the host (page.ts), and landed — unless
   * another document was loaded meanwhile. Nothing is stored until the
   * landing is going ahead: the host has no call to take a stored file
   * back, so an image stored for a paste that does not land stays in the
   * document's files unused. Storing is the host's time, though, and a
   * load or a refusal can still come after it; then the line says so. */
  const cleanThenLand = async (
    source: HtmlSource,
    position: { x: number; y: number },
    load: number,
  ): Promise<void> => {
    const refused = (error: unknown, stored: number): void => {
      console.error(
        `[${dd.plugin.id}] paste refused: ${error instanceof Error ? error.message : String(error)}${leftUnused(stored)}`,
      );
    };
    const abandoned = (stored: number): boolean => {
      if (untrack(() => dd.loadVersion()) === load) return false;
      console.info(
        `[${dd.plugin.id}] paste abandoned: another document was loaded before it landed${leftUnused(stored)}`,
      );
      return true;
    };
    let cleaned: CleanedPaste;
    try {
      cleaned = await cleanPaste(dd, source.text, {
        id: dd.core.generateId(),
        position,
        said: [],
      });
    } catch (error) {
      refused(error, 0);
      return;
    }
    if (abandoned(0)) return;
    const progress = { stored: 0 };
    let pasted: PastedPage;
    try {
      pasted = await storePaste(dd, cleaned, progress);
    } catch (error) {
      refused(error, progress.stored);
      return;
    }
    if (abandoned(pasted.stored)) return;
    land(pasted);
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
      void cleanThenLand(
        source,
        position,
        untrack(() => dd.loadVersion()),
      );
    },
    { priority: PASTE_PRIORITY },
  );
}
