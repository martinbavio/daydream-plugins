// The paste hook (decisions.md #56): priority 5 — after Media (10), which
// claims media-only HTML, before Text (0), the plain-text fallback. Claims
// a transfer with no files whose `text/plain` is markup (an editor's copy:
// VS Code puts a syntax-highlighted rendering in `text/html` and the
// markup itself in `text/plain`, so the plain face wins), or whose
// `text/html` parses to at least one element and is more than a single
// paragraph of prose (prose.ts) — a paragraph is text however a browser
// wrapped it, and is left for Text. Lands ONE item as one undo step, the
// way the Text plugin does — `dd.mutateItems` then `dd.select` — and
// reports what the conversion lost in one console line. No gates: a
// paste is the user's own hand on the canvas, not an agent's landing.

import type { DaydreamApi } from "@daydream/plugin-api";
import { flush, untrack } from "solid-js";

import {
  convertDocument,
  countElements,
  hasElements,
  parseHtml,
  VIEWPORT_WIDTH,
  type Conversion,
} from "./convert";
import { hasContent, isSingleParagraph } from "./prose";
import { count, describeReport } from "./report";

export const PASTE_PRIORITY = 5;

/** The most elements one paste may land. A copied section is hundreds;
 * a whole site's DOM is not a viewport, and every later edit would
 * clone it into history. Refused with a console line, nothing lands. */
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

/** The document a transfer carries as markup, or null when this plugin
 * should not claim it: no markup at all, nothing a page could show, or
 * a single paragraph of prose that Text can hold as the plain text. */
export function htmlSource(transfer: DataTransfer | null): Document | null {
  if (transfer === null || transfer.files.length > 0) return null;
  const text = transfer.getData("text/plain");
  // Markup typed or copied as plain text is deliberate and always lands.
  if (looksLikeMarkup(text)) {
    const doc = parseHtml(text);
    if (hasElements(doc) && hasContent(doc)) return doc;
  }
  const html = transfer.getData("text/html");
  if (html === "") return null;
  const doc = parseHtml(html);
  if (!hasElements(doc) || !hasContent(doc)) return null;
  // A browser copies prose as HTML: a paragraph is text however it was
  // wrapped. Text lands the plain face; with none, nothing lands.
  if (isSingleParagraph(doc)) return null;
  return doc;
}

export function registerHtmlPaste(dd: DaydreamApi): void {
  // The Text plugin's cascade, copied on purpose (decisions.md #56):
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

  const land = ({ item, report }: Conversion): void => {
    pasting = true;
    try {
      dd.mutateItems((items) => {
        items.push(item);
      });
      // The viewport's root is its selection id, as core's chrome writes it.
      dd.select(item.payload.root.id);
      // Flush the paste's own notifications while suppression is explicit.
      flush();
    } catch (error) {
      console.error(
        `[${dd.plugin.id}] paste refused: ${error instanceof Error ? error.message : String(error)}`,
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
      `[${dd.plugin.id}] ${describeReport(report, countElements(item.payload.root))}`,
    );
  };

  const vendorThenLand = async (conversion: Conversion): Promise<void> => {
    const load = untrack(() => dd.loadVersion());
    for (const { element, file } of conversion.dataImages) {
      try {
        const { src } = await dd.vendorFile(file);
        element.attrs = { ...element.attrs, src };
      } catch {
        // No storage, a refused upload, or unload: the img keeps its alt.
        count(conversion.report.images, "data:");
      }
    }
    if (untrack(() => dd.loadVersion()) !== load) {
      console.info(
        `[${dd.plugin.id}] paste abandoned: another document was loaded while its images were vendored`,
      );
      return;
    }
    land(conversion);
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
      const size = source.body.getElementsByTagName("*").length;
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
      const conversion = convertDocument(source, dd.core, {
        x: center.x - VIEWPORT_WIDTH / 2 + cascade,
        y: center.y - VIEWPORT_WIDTH / 4 + cascade,
      });
      if (conversion.dataImages.length === 0) land(conversion);
      else void vendorThenLand(conversion);
    },
    { priority: PASTE_PRIORITY },
  );
}
