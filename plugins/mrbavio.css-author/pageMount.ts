// A PAGE MOUNTED FOR A LINT, and what both mounting lints do with it
// (matchLint.ts, necessity.ts): mount the page, cut declarations out of
// it, read, put them back, and ask whether a rule's conditions hold. One
// copy of each, so the static gate's match lint and the necessity gate
// never judge the same rule by two answers — a preference or a height
// query read one way by one and another way by the other. Browser only.
//
// A mount is the live face core renders (`ctx.mountViewport`, the page's
// own text in an iframe, each live sheet a `<style>` of its own), bare —
// nothing the measurer adds for its own read — and motion pinned off: a
// remove-and-read is synchronous, and a transition would answer it with
// its start value.
// What a condition answers is the mounted window's own — the one the page
// renders with.
//
// A MOUNT SHOWS THE PAGE THE GATE IS JUDGING: it is the gate's own,
// `ctx.mountViewport`, never `dd.mountViewport` (which mounts the
// project's page and refuses one the project does not hold). At a
// `draft_finalize` that is the page about to be written — a new path no
// file holds yet, or a rework as it will be read — so both mounting lints
// judge the page `ctx.page` hands them, and at `lint` the project's.

import type {
  BareMountedViewport,
  CoreApi,
  GateContext,
} from "@daydream/plugin-api";

import { atKeyword, sheetRules, withoutRanges, type PageRule } from "./pageCss";
import {
  writtenRules,
  type Page,
  type ReadSheets,
  type Viewport,
  type WrittenRule,
} from "./pageSheets";

/** What a mounting lint is handed: the gate's context — the page each
 * viewport shows (`page`) and the live mount of that same page
 * (`mountViewport`), so what the lint reads and what it mounts are one
 * page. A gate hands in its `ctx`; a test hands in plugin-testing's
 * `gateContext`. */
export type MountContext = Pick<GateContext, "page" | "mountViewport">;

/** `[start, end)` of a declaration in a text: its `style` attribute's,
 * or a sheet's. */
export type TextRange = readonly [number, number];

/** A declaration's place in a mounted copy's css: which of its sheets
 * (`MountedSheets.styles`), and where in that sheet's text. */
export interface SheetRange {
  sheet: number;
  range: TextRange;
}

/** Mount (motion pinned off), run, dispose — the one lifecycle every
 * mount of a lint follows, a thrown read included. The viewport's page
 * is the one `ctx.page` answers for it (`ctx.mountViewport`, the gate's:
 * see the header). `width` undefined is the frame's own; a number is the
 * same window at that width. */
export async function withMount<T>(
  ctx: MountContext,
  viewport: Viewport,
  width: number | undefined,
  run: (mounted: BareMountedViewport) => Promise<T>,
): Promise<T> {
  const mounted = await ctx.mountViewport(viewport, {
    still: true,
    // The page alone: nothing of the measurer's own in the copy, so its
    // `<style>`s are the page's live sheets (pageDom.ts mountedStyles).
    bare: true,
    ...(width === undefined ? {} : { width }),
  });
  try {
    return await run(mounted);
  } finally {
    mounted.dispose();
  }
}

/** A mounted copy's css, read: its `<style>`s in cascade order, every
 * style rule across them — `index` its position in that order, `sheet`
 * its `<style>`'s position in `styles`, its ranges in that `<style>`'s
 * text — and each rule as the page writes it (pageSheets.ts
 * `writtenRules`), by index: how a finding numbers and names it. */
export interface MountedSheets {
  styles: HTMLStyleElement[];
  rules: PageRule[];
  written: WrittenRule[];
}

/** Read the copy's `styles` (pageDom.ts mountedStyles), each as `texts`
 * holds it — by default, its text as it stands — against the page's own
 * sheets (`read`). */
export function mountedSheets(
  core: CoreApi,
  page: Page,
  read: ReadSheets,
  styles: HTMLStyleElement[],
  texts: readonly string[] = styles.map((style) => style.textContent ?? ""),
): MountedSheets {
  const rules = sheetRules(texts.map((text) => core.cssBlocks(text)));
  const bySheet = styles.map((_, sheet) =>
    rules.filter((rule) => rule.sheet === sheet),
  );
  return { styles, rules, written: writtenRules(page, read, bySheet).flat() };
}

/**
 * Remove, read, restore: `css` ranges cut from the copy's `<style>`s
 * (`styles`, each range from the one it names) and `inline` ranges from
 * each element's `style`, in one write; then `read`; then everything put
 * back as it was, a thrown read included. The ranges are offsets in the
 * texts as they stand when this is called.
 */
export function readWithout<T>(
  styles: readonly HTMLStyleElement[],
  css: readonly SheetRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
  read: () => T,
): T {
  const restore = cut(styles, css, inline);
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
  styles: readonly HTMLStyleElement[],
  css: readonly SheetRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
  read: () => T | Promise<T>,
): Promise<T> {
  const restore = cut(styles, css, inline);
  try {
    doc.documentElement.getBoundingClientRect();
    if (doc.fonts.status === "loading") await doc.fonts.ready;
    // Awaited, so a read that yields to the event loop (necessity.ts
    // `slicer`) is put back after it ends, not when it first yields.
    return await read();
  } finally {
    restore();
  }
}

/** The write of `readWithout`, answering what puts it back: each
 * `<style>` a range names written once, with all of its ranges cut. */
function cut(
  styles: readonly HTMLStyleElement[],
  css: readonly SheetRange[],
  inline: ReadonlyMap<Element, readonly TextRange[]>,
): () => void {
  const ranges = new Map<HTMLStyleElement, TextRange[]>();
  for (const { sheet, range } of css) {
    const style = styles[sheet];
    if (style === undefined) continue;
    const list = ranges.get(style) ?? [];
    list.push(range);
    ranges.set(style, list);
  }
  const sheets = new Map(
    Array.from(ranges.keys(), (style) => [style, style.textContent ?? ""]),
  );
  const attributes = new Map(
    Array.from(inline.keys(), (node) => [node, node.getAttribute("style") ?? ""]),
  );
  const restore = (): void => {
    for (const [style, text] of sheets) style.textContent = text;
    for (const [node, text] of attributes) node.setAttribute("style", text);
  };
  try {
    for (const [style, list] of ranges) {
      style.textContent = withoutRanges(sheets.get(style)!, list);
    }
    for (const [node, list] of inline) {
      node.setAttribute("style", withoutRanges(attributes.get(node)!, list));
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
