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
  dataImages,
  describePaste,
  hasElements,
  pageFromPaste,
  parseHtml,
  VIEWPORT_WIDTH,
  withStoredImages,
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

/** Each distinct entry once, with `×n` when it repeats, in first-seen
 * order — the kernel landing's own counting. */
function counted(items: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, n]) => (n === 1 ? item : `${item} ×${n}`));
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
      `[${dd.plugin.id}] ${describePaste(pasted.elements, pasted.said)}`,
    );
  };

  /** A page stores no `data:` url (decision #76): each image is stored
   * through the host first and the page's name for the copy written in
   * place of its url. One that cannot be is left as written, for the
   * cleaning to take its `src` off and say so; the `img` stays, with its
   * `alt`. Then the text is cleaned as a landing cleans it, and lands —
   * unless another document was loaded meanwhile. */
  const cleanThenLand = async (
    source: HtmlSource,
    position: { x: number; y: number },
    load: number,
  ): Promise<void> => {
    const said: string[] = [];
    const stored = new Map<string, string>();
    for (const { url, file } of dataImages(source.doc)) {
      // Not an image: the cleaning's to remove and say.
      if (file === null) continue;
      if (!source.text.includes(url)) {
        said.push(
          "a data: image written with character references was not stored",
        );
        continue;
      }
      try {
        stored.set(url, (await dd.vendorFile(file)).pageSrc);
      } catch (error) {
        said.push(
          `the host could not store a data: image (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    let pasted: PastedPage;
    try {
      pasted = await pageFromPaste(dd, withStoredImages(source.text, stored), {
        id: dd.core.generateId(),
        position,
        said: counted(said),
      });
    } catch (error) {
      console.error(
        `[${dd.plugin.id}] paste refused: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (untrack(() => dd.loadVersion()) !== load) {
      console.info(
        `[${dd.plugin.id}] paste abandoned: another document was loaded before it landed`,
      );
      return;
    }
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
      const size = source.doc.body.getElementsByTagName("*").length;
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
