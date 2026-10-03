// What the Pages panel shows and where it places, as pure functions over
// the document: the project's pages as `daydream.json` lists them
// (decision #78), each with the viewports the shown canvas holds of it,
// and the spot and the frame a new viewport of one takes. No DOM, no
// reactivity: the panel reads them inside its memos, and the unit tests
// call them with plain data.

import type { DeepReadonly, DreamDocument } from "@daydream/plugin-api";

/** The frame a page's first viewport takes: the format's default page
 * width (knowledge/format.md, "the source's width, else 960"), full page
 * — no height, so the viewport is as tall as its page. */
export const DEFAULT_FRAME = { width: 960 } as const;

export interface Frame {
  width: number;
  height?: number;
}

/** A viewport as this module reads one: its id, its frame and the page it
 * shows. `variant` set is a variant's viewport (decision #80): scratch the
 * kernel owns, never one of the page's own. */
export interface ViewportLike {
  readonly id: string;
  readonly frame?: { readonly width: number; readonly height?: number };
  readonly payload: { readonly page: string; readonly variant?: unknown };
}

/** One row of the panel: a page of the project. */
export interface PageRow {
  /** Project-relative, forward slashes: `blog/post.html`. */
  path: string;
  /** The folder part with its trailing slash, `blog/`, or `""` at the
   * root. */
  folder: string;
  /** The file name: `post.html`. */
  name: string;
  /** The page's own viewports on the shown canvas, in canvas order — a
   * variant's viewport is not one. */
  viewports: string[];
}

/** Every page `daydream.json` lists, sorted by path (so a folder's pages
 * sit together), each with its own viewports on the shown canvas. */
export function pageRows(
  doc: DeepReadonly<DreamDocument>,
  viewports: readonly ViewportLike[],
): PageRow[] {
  const byPage = new Map<string, string[]>();
  for (const viewport of viewports) {
    if (viewport.payload.variant !== undefined) continue;
    const ids = byPage.get(viewport.payload.page) ?? [];
    ids.push(viewport.id);
    byPage.set(viewport.payload.page, ids);
  }
  return doc.pages
    .map(({ path }) => {
      const slash = path.lastIndexOf("/");
      return {
        path,
        folder: path.slice(0, slash + 1),
        name: path.slice(slash + 1),
        viewports: byPage.get(path) ?? [],
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The frame a new viewport of `page` takes: the last of its own
 * viewports' on the canvas, so a second one matches what is there, else
 * the default. A copy: nothing of the document's is handed on. */
export function frameFor(
  page: string,
  viewports: readonly ViewportLike[],
): Frame {
  for (let index = viewports.length - 1; index >= 0; index--) {
    const viewport = viewports[index]!;
    if (
      viewport.payload.page !== page ||
      viewport.payload.variant !== undefined
    )
      continue;
    if (viewport.frame === undefined) break;
    const { width, height } = viewport.frame;
    return height === undefined ? { width } : { width, height };
  }
  return { ...DEFAULT_FRAME };
}

/** Where a viewport placed at the view's center goes: its top-left, so
 * the frame is centered across and its top a quarter-width above the
 * center — a full-page viewport has no height until its page renders.
 * The paste plugin's rule (mrbavio.html-paste), so a placed page lands
 * where a pasted one would. */
export function centeredAt(
  center: { x: number; y: number },
  frame: Frame,
): { x: number; y: number } {
  return {
    x: Math.round(center.x - frame.width / 2),
    y: Math.round(center.y - frame.width / 4),
  };
}

/** A full-page viewport's height before its page has rendered: the
 * kernel's nominal viewport (960 × 600), as a share of the width. */
export const NOMINAL_HEIGHT_RATIO = 600 / 960;

/** The outline a page's drag carries, in screen px: the box its last
 * viewport shows at (`rendered`, already scaled), else its frame at the
 * canvas's zoom — a full-page frame as tall as the nominal viewport. */
export function ghostSize(
  frame: Frame,
  zoom: number,
  rendered: { width: number; height: number } | null,
): { width: number; height: number } {
  if (rendered !== null && rendered.width > 0 && rendered.height > 0)
    return {
      width: Math.round(rendered.width),
      height: Math.round(rendered.height),
    };
  return {
    width: Math.round(frame.width * zoom),
    height: Math.round(
      (frame.height ?? frame.width * NOMINAL_HEIGHT_RATIO) * zoom,
    ),
  };
}

/** How far a placement steps aside from an item already at its spot. */
export const CASCADE_STEP = 16;

/** `position`, stepped down and right while an item already has its
 * top-left there — so placing twice in a row, or at the same view, never
 * hides one viewport exactly under another. */
export function clearOf(
  position: { x: number; y: number },
  taken: readonly { readonly x: number; readonly y: number }[],
): { x: number; y: number } {
  let { x, y } = position;
  while (taken.some((at) => at.x === x && at.y === y)) {
    x += CASCADE_STEP;
    y += CASCADE_STEP;
  }
  return { x, y };
}

/** The viewport a click on a page selects: the one after the selected one
 * among the page's own, wrapping, else its first; null when the page has
 * none on the canvas. */
export function nextViewport(
  viewports: readonly string[],
  selected: string | null,
): string | null {
  if (viewports.length === 0) return null;
  const at = selected === null ? -1 : viewports.indexOf(selected);
  return viewports[(at + 1) % viewports.length]!;
}

/** The markup of a new, empty page titled `title`: a whole document, so
 * a browser opening the file renders it as the canvas does, and the
 * title is what the host names its file after (`Pricing & plans` →
 * `pricing-plans.html`). Its one rule is the white a browser paints an
 * empty page: without it the canvas shows through, and the new page
 * reads as nothing at all. */
export function emptyPage(title: string): string {
  const text = title
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text}</title>
<style>
html { background: #fff; }
</style>
</head>
<body>
</body>
</html>
`;
}
