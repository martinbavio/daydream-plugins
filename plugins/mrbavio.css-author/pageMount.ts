// A PAGE MOUNTED FOR A LINT, and what both mounting lints do with it
// (matchLint.ts, necessity.ts): mount the page, cut declarations out of
// it, read, put them back, and ask whether a rule's conditions hold. One
// copy of each, so the static gate's match lint and the necessity gate
// never judge the same rule by two answers — a preference or a height
// query read one way by one and another way by the other. Browser only.
//
// A mount is the live face core renders (`dd.mountViewport`, the page's
// own text in an iframe), bare — nothing the measurer adds for its own
// read — and motion pinned off: a remove-and-read is synchronous, and a
// transition would answer it with its start value.
// What a condition answers is the mounted window's own — the one the page
// renders with.

import type {
  BareMountedViewport,
  DaydreamApi,
  DreamPage,
} from "@daydream/plugin-api";

import { atKeyword, withoutRanges } from "./pageCss";

/** What a mounting lint needs from the API object: the pure helpers and
 * the live mount. A gate hands in its `dd`; a test hands in a test
 * kernel's. */
export type MountHost = Pick<DaydreamApi, "core" | "mountViewport">;

/** `[start, end)` of a declaration in a text: its `style` attribute's,
 * or the page's css. */
export type TextRange = readonly [number, number];

/** Mount (motion pinned off), run, dispose — the one lifecycle every
 * mount of a lint follows, a thrown read included. `width` undefined is
 * the frame's own; a number is the same window at that width. */
export async function withMount<T>(
  dd: MountHost,
  page: DreamPage,
  width: number | undefined,
  run: (mounted: BareMountedViewport) => Promise<T>,
): Promise<T> {
  const mounted = await dd.mountViewport(page, {
    still: true,
    // The page alone: nothing of the measurer's own in the copy, so its
    // `<style>` is the page's css (pageDom.ts mountedStyle).
    bare: true,
    ...(width === undefined ? {} : { width }),
  });
  try {
    return await run(mounted);
  } finally {
    mounted.dispose();
  }
}

/**
 * Remove, read, restore: `css` ranges cut from the page's `<style>` in
 * the copy (pageDom.ts mountedStyle) and `inline` ranges from each
 * element's `style`, in one write; then `read`; then everything put back
 * as it was, a thrown read included. The ranges are offsets in the texts
 * as they stand when this is called. With no `<style>`, the css ranges
 * cut nothing.
 */
export function readWithout<T>(
  style: HTMLStyleElement | null,
  css: readonly TextRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
  read: () => T,
): T {
  const restore = cut(style, css, inline);
  try {
    return read();
  } finally {
    restore();
  }
}

/**
 * `readWithout`, the read waiting for the web fonts the write made the
 * page load again. A sheet parsed again can drop the faces it holds, and
 * in Chromium a page with an `@layer` drops every face of the page, the
 * ones in a sheet the write never touched included: each is asked for
 * again, and one whose file must be asked of the network (served
 * `no-cache`) arrives later — a read in between sees the fallback face,
 * and a page that changed. So the page is laid out, which starts every
 * face its text needs, and read once they have loaded.
 */
export async function readWithoutReloading<T>(
  doc: Document,
  style: HTMLStyleElement | null,
  css: readonly TextRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
  read: () => T,
): Promise<T> {
  const restore = cut(style, css, inline);
  try {
    doc.documentElement.getBoundingClientRect();
    if (doc.fonts.status === "loading") await doc.fonts.ready;
    return read();
  } finally {
    restore();
  }
}

/** The write of `readWithout`, answering what puts it back. */
function cut(
  style: HTMLStyleElement | null,
  css: readonly TextRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
): () => void {
  const sheet = style?.textContent ?? "";
  const attributes = new Map(
    Array.from(inline.keys(), (node) => [node, node.getAttribute("style") ?? ""]),
  );
  const restore = (): void => {
    if (style !== null && css.length > 0) style.textContent = sheet;
    for (const [node, text] of attributes) node.setAttribute("style", text);
  };
  try {
    if (style !== null && css.length > 0) {
      style.textContent = withoutRanges(sheet, css);
    }
    for (const [node, ranges] of inline) {
      node.setAttribute("style", withoutRanges(attributes.get(node)!, ranges));
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

/**
 * Whether every condition a rule sits under holds in a mounted copy — the
 * browser's own answer in that window: an `@media` is asked of the
 * iframe's `matchMedia`, so its width, its height, its orientation and
 * its preferences are the copy's; an `@supports` of `CSS.supports`. An
 * `@container` is left to the lint that reads the rule (its query is a
 * container's size, not the window's); `@layer` and `@scope` gate
 * nothing by themselves, and `@starting-style` is each lint's to decide.
 */
export function conditionsHold(
  doc: Document,
  conditions: readonly string[],
): boolean {
  const view = doc.defaultView;
  if (view === null) return true;
  return conditions.every((condition) => {
    const keyword = atKeyword(condition);
    const text = condition.replace(/^@[\w-]+/, "").trim();
    if (keyword === "media") return view.matchMedia(text).matches;
    if (keyword === "supports") {
      try {
        return CSS.supports(text);
      } catch {
        return false;
      }
    }
    return true;
  });
}
