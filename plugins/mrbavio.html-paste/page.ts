// The page a paste lands (decision #76): a viewport's payload is the
// page's markup and its stylesheet as text, `{ html, css }`, rendered in a
// shadow root. So a paste no longer converts anything. It gathers the
// pasted document's `<style>` text into `css`, in document order, and
// keeps the rest as `html` — the pasted text itself when there was
// nothing to gather, the parser's serialization when there was. The
// browser is the vocabulary: every element, attribute, selector and
// at-rule the paste carried lands as written.
//
// What the kernel's LANDING does beside that — its safety walk, which
// cuts what could run out of the author's text and reports it
// (src/ai/cleanPage.ts in the Daydream repository) — the plugin API does
// not expose yet, and a plugin copy of a security rule is the second
// authority the kernel exists to avoid. Until it does, a pasted page is
// stored as gathered here, and the canvas's own walk (the renderer's, the
// same function a landing uses) keeps it inert at every mount.
// TODO(decision #76): clean through the kernel once the API offers it.

import type { DreamPage } from "@daydream/plugin-api";

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

/** An `img` whose `src` is a `data:` URL: a page stores no `data:` url,
 * so the paste vendors the bytes and points the `img` at the stored
 * copy. `file` is null when the URL is not an image. */
export interface DataImage {
  img: Element;
  file: File | null;
}

/** Every `img` in the document whose `src` is a `data:` URL, in document
 * order. */
export function dataImages(doc: Document): DataImage[] {
  return Array.from(doc.querySelectorAll("img[src]"))
    .filter((img) => /^\s*data:/i.test(img.getAttribute("src") ?? ""))
    .map((img) => ({
      img,
      file: fileFromDataUrl((img.getAttribute("src") ?? "").trim()),
    }));
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

/** The `src` a page stores for a file `dd.vendorFile` answered with. The
 * host answers the shared store's host-neutral `/assets/<file>`, which a
 * page may not name (a root-absolute path leaves its bundle); the page's
 * own `assets/<file>` is gathered from that same store when the document
 * is saved, so the relative name is the one that renders and travels.
 * Null for an answer outside `/assets/`. */
export function pageAssetSrc(vendored: string): string | null {
  const match = /^\/assets\/([^?#]+)$/.exec(vendored);
  return match === null ? null : `assets/${match[1]!}`;
}

/** What a paste lands, and what it could not keep. */
export interface PastedPage {
  item: DreamPage;
  /** Elements in the landed markup: the `html` and `body` and everything
   * in the body. */
  elements: number;
  /** What the page lost, each in the kernel's landing vocabulary. */
  lost: string[];
}

/**
 * The viewport a pasted document lands as, at `position`. `source` is
 * the text that was parsed into `doc`; `edited` says the paste has
 * already changed `doc` (a vendored image's `src`), so the markup must
 * be written from the tree. `lost` carries what the paste lost before
 * this point.
 */
export function pageFromPaste(
  source: string,
  doc: Document,
  options: {
    id: string;
    position: { x: number; y: number };
    edited: boolean;
    lost: string[];
  },
): PastedPage {
  const lost = [...options.lost];
  // Every stylesheet the markup carries, in document order — the order
  // the cascade reads them in and the order the kernel's landing folds
  // them. A `<style>` is the page's own css and moves there; a linked
  // sheet is a fetch a paste cannot make (the landing fetches one on the
  // host), so it is removed and said, as the landing says it.
  const css: string[] = [];
  const sheets = Array.from(doc.querySelectorAll("style, link")).filter(
    (node) => node.localName === "style" || isStylesheetLink(node),
  );
  for (const node of sheets) {
    if (node.localName === "style") css.push(node.textContent ?? "");
    else {
      const href = node.getAttribute("href") ?? "";
      lost.push(
        `the stylesheet <link href="${href}"> could not be fetched (a paste fetches nothing) — removed, and its rules are not in the css; put them there to keep them`,
      );
    }
    node.remove();
  }
  const html = sheets.length === 0 && !options.edited ? source : serialize(doc);
  const title = doc.title.trim();
  const item: DreamPage = {
    id: options.id,
    kind: VIEWPORT_KIND,
    position: options.position,
    frame: { width: VIEWPORT_WIDTH },
    payload: {
      html,
      // Joined as the kernel's landing joins them: an empty block adds
      // nothing, not a blank line.
      css: css.filter((text) => text !== "").join("\n"),
      ...(title === "" ? {} : { meta: { title } }),
    },
  };
  return {
    item,
    elements: doc.body.getElementsByTagName("*").length + 2,
    lost,
  };
}

/** A `<link>` whose `rel` names a stylesheet: every other `rel` — icon,
 * preload, canonical — is inert markup and stays. */
function isStylesheetLink(node: Element): boolean {
  return (
    node.localName === "link" &&
    (node.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .includes("stylesheet")
  );
}

/** The tree as text, with the doctype it was written with: a page with
 * one renders in standards mode, and one without it did not have. */
function serialize(doc: Document): string {
  return (
    (doc.doctype === null ? "" : "<!DOCTYPE html>") +
    doc.documentElement.outerHTML
  );
}

/** One line for the console: what landed and what was lost. */
export function describePaste(
  elements: number,
  lost: readonly string[],
): string {
  const landed = `landed ${elements} element${elements === 1 ? "" : "s"}`;
  return lost.length === 0
    ? `${landed}, nothing lost`
    : `${landed}; ${lost.join("; ")}`;
}
