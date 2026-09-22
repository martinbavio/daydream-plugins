// The page a paste lands (decision #76): a viewport's payload is the
// page's markup and its stylesheet as text, `{ html, css }`, rendered in a
// shadow root. So a paste converts nothing: it hands the pasted text to
// the kernel's cleaning (`dd.cleanPage`, the function every landing runs)
// and stores what comes back — the author's text with whatever could run
// cut out where it was written, every `<style>` block and linked
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

/** A `data:` URL an `img` names as its `src`: a page stores no `data:`
 * url, so the paste vendors the bytes and names the stored copy in its
 * place. `url` is the `src` as the parser read it; `file` is null when
 * the URL is not an image. */
export interface DataImage {
  url: string;
  file: File | null;
}

/** Each distinct `data:` URL an `img` names as its `src`, in document
 * order: the same image twice is one file. */
export function dataImages(doc: Document): DataImage[] {
  const urls = new Set(
    Array.from(
      doc.querySelectorAll("img[src]"),
      (img) => img.getAttribute("src") ?? "",
    ).filter((src) => /^\s*data:/i.test(src)),
  );
  return Array.from(urls, (url) => ({
    url,
    file: fileFromDataUrl(url.trim()),
  }));
}

/** The pasted text with each stored image's `data:` URL replaced by the
 * page's name for its copy, where the author wrote it: nothing else in
 * the text moves. Only a URL written as the parser reads it — with no
 * character reference in it — is in the text to replace, so the paste
 * stores only those (`text.includes(url)`). */
export function withStoredImages(
  text: string,
  stored: ReadonlyMap<string, string>,
): string {
  let out = text;
  for (const [url, src] of stored) out = out.split(url).join(src);
  return out;
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
