// The plugin through the loader seam, over the page fixture (a `.grid`
// of `1fr 2fr 1fr` with a 16px gap, 960 wide): mounted into the real
// shell and driven with pointer events on its bands, asserted from the
// DOM and the page's css — what a user sees and what the file holds.
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";

import type { PluginManifest } from "@daydream/plugin-api";
import {
  appStore,
  createFileHost,
  createPageItem,
  fixturePage,
  flush,
  loadPageFixtureProject,
  mountPlugin,
  overrideHostForTests,
  PAGE_FIXTURE_CSS,
  PAGE_FIXTURE_HTML,
  pageElementId,
  testProject,
  type FileHost,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import activate from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;

let mounted: MountedPlugin | null = null;

/** The plugin's overlay in one slot: it registers two, the guides in
 * `overlay.screen` and the handles in `overlay.interactive`. */
const overlayIn = (slot: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-plugin-overlay-slot="${slot}"] [data-plugin-overlay="${manifest.id}"]`,
  );

afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** Mount over the fixture — or the same page with `cssText` as its
 * sheet — and wait for the page: the grid's runtime id, its page's path
 * (what the store keys the page by), and the page's files on a host
 * faked at HTTP, so every write the drag makes lands on that disk and
 * can be read back from it. */
async function mountOnPage(
  cssText: string = PAGE_FIXTURE_CSS,
  htmlText: string = PAGE_FIXTURE_HTML,
): Promise<{
  itemId: string;
  path: string;
  cssPath: string;
  files: FileHost;
  grid: string;
}> {
  let itemId: string;
  let title: string;
  if (cssText === PAGE_FIXTURE_CSS && htmlText === PAGE_FIXTURE_HTML) {
    ({ itemId, title } = loadPageFixtureProject());
  } else {
    const project = testProject([
      createPageItem(
        { html: htmlText, css: cssText },
        { frame: { width: 960 } },
      ),
    ]);
    appStore.loadProject(project);
    const viewport = fixturePage(project);
    itemId = viewport.id;
    title = viewport.payload.page;
  }
  mounted = await mountPlugin({ entry: activate, manifest });
  let grid: string | null = null;
  await vi.waitFor(() => {
    grid = pageElementId(itemId, ".grid");
    expect(grid).not.toBeNull();
  });
  const source = mounted.store.page(title)!.sheets[0]!.source;
  const cssPath = "file" in source ? source.file : title;
  const files = createFileHost({
    [title]: htmlText,
    [cssPath]: cssText,
  });
  overrideHostForTests({ project: files.project });
  onTestFinished(() => overrideHostForTests(null));
  return { itemId, path: title, cssPath, files, grid: grid! };
}

const handles = (axis: "cols" | "rows"): HTMLElement[] =>
  Array.from(
    overlayIn("overlay.interactive")!.querySelectorAll<HTMLElement>(
      `.mrbavio-grid-editor-handle-${axis}`,
    ),
  );
/** The bands on the gaps, in line order (line 1 first). */
const bands = (axis: "cols" | "rows"): HTMLElement[] =>
  handles(axis).filter((node) => !node.hasAttribute("data-edge"));
/** The two edge bands: the start edge, then the end edge. */
const edges = (axis: "cols" | "rows"): HTMLElement[] =>
  handles(axis).filter((node) => node.hasAttribute("data-edge"));
const noteText = (): string | null =>
  overlayIn("overlay.interactive")!.querySelector(".mrbavio-grid-editor-note")
    ?.textContent ?? null;

/** The page's one sheet, as the store holds it now. */
const css = (path: string): string =>
  mounted!.store.page(path)!.sheets[0]!.text;

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A primary-button drag on a band, in window px, one frame per move so
 * the drag's rAF batching applies it. */
async function drag(
  node: HTMLElement,
  delta: { x: number; y: number },
  options: {
    meta?: boolean;
    shift?: boolean;
    held?: () => void;
    /** End with a `pointercancel` (what Escape and a lost window do)
     * instead of a release. */
    cancel?: boolean;
    /** Milliseconds to hold still between the two moves — past
     * history's typing burst when over 500. */
    pause?: number;
  } = {},
): Promise<void> {
  const rect = node.getBoundingClientRect();
  const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const pointer = (type: string, x: number, y: number) =>
    node.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
        metaKey: options.meta ?? false,
        shiftKey: options.shift ?? false,
      }),
    );
  pointer("pointerdown", from.x, from.y);
  pointer("pointermove", from.x + delta.x / 2, from.y + delta.y / 2);
  await frame();
  if (options.pause !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, options.pause));
  }
  pointer("pointermove", from.x + delta.x, from.y + delta.y);
  await frame();
  // What the drag shows while the pointer is still down.
  options.held?.();
  pointer(
    options.cancel === true ? "pointercancel" : "pointerup",
    from.x + delta.x,
    from.y + delta.y,
  );
  flush();
}

/** A press and release with no movement: a click. */
function press(
  node: HTMLElement,
  options: { meta?: boolean; shift?: boolean; held?: () => void } = {},
): void {
  const rect = node.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    pointerId: 8,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    metaKey: options.meta ?? false,
    shiftKey: options.shift ?? false,
  };
  node.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  flush();
  options.held?.();
  node.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
  flush();
}

/** The fixture's page with its grid rule replaced. */
const gridCss = (rule: string): string =>
  PAGE_FIXTURE_CSS.replace(
    ".grid { display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 16px; }",
    rule,
  );

const doubleClick = (
  node: HTMLElement,
  options: { shift?: boolean } = {},
): void => {
  const rect = node.getBoundingClientRect();
  node.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      shiftKey: options.shift ?? false,
    }),
  );
  flush();
};

describe("mrbavio.grid-editor", () => {
  test("the manifest declares everything the entry registers", () => {
    expect(manifest.id).toBe("mrbavio.grid-editor");
    expect(manifest.api).toMatch(/^\d+\.\d+$/);
    expect(manifest.contributes?.overlays).toEqual(["grid", "grid-handles"]);
    expect(manifest.unstable).toBeUndefined();
  });

  test("a selected grid grows a band per line, in the interactive slot; a child shows its parent's", async () => {
    const { itemId, grid } = await mountOnPage();
    expect(handles("cols")).toHaveLength(0);

    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    // And a band on each edge, there to grab but unseen until hovered.
    expect(edges("cols")).toHaveLength(2);
    expect(getComputedStyle(edges("cols")[0]!).opacity).toBe("0");
    expect(
      overlayIn("overlay.interactive")!
        .closest("[data-plugin-overlay-slot]")!
        .getAttribute("data-plugin-overlay-slot"),
    ).toBe("overlay.interactive");
    // Two rows (the header spans the top row; aside spans both), one gap.
    expect(bands("rows")).toHaveLength(1);
    // The band stands on the gap: 16px wide at zoom 1, never thinner
    // than the hit minimum.
    const [first] = bands("cols");
    expect(Number.parseFloat(first!.style.width)).toBeGreaterThanOrEqual(10);
    const styles = overlayIn("overlay.interactive")!.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);

    const header = pageElementId(itemId, ".header")!;
    mounted!.store.setSelectedId(header);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
  });

  test("dragging the band between two shares trades them, keeps their sum, and writes the css", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    const before = css(path);
    const left = Number.parseFloat(bands("cols")[0]!.style.left);
    // The fixture: 960 − 48 padding − 32 of gaps = 880 free; 1fr = 220px.
    // Moving line 2 by 44 layout px: 264px · 396px → 1.2fr · 1.8fr.
    await drag(bands("cols")[0]!, { x: 44 * zoom, y: 0 });
    const match = /grid-template-columns: ([\d.]+)fr ([\d.]+)fr 1fr;/.exec(
      css(path),
    );
    expect(match).not.toBeNull();
    const [, a, b] = match!;
    expect(Number(a)).toBeCloseTo(1.2, 1);
    expect(Number(b)).toBeCloseTo(1.8, 1);
    expect(Number(a) + Number(b)).toBeCloseTo(3, 5);
    // The rule's other declarations and every other rule are as written
    // (the saved rule is re-flowed in shape by the kernel, never in
    // content).
    expect(css(path)).toContain("display: grid;");
    expect(css(path)).toContain("gap: 16px;");
    for (const line of before.split("\n")) {
      if (!line.startsWith(".grid")) expect(css(path)).toContain(line);
    }
    // The band followed the boundary it moved.
    expect(Number.parseFloat(bands("cols")[0]!.style.left)).toBeGreaterThan(
      left,
    );
    // The note is gone once the drag ends.
    expect(
      overlayIn("overlay.interactive")!.querySelector(
        ".mrbavio-grid-editor-note",
      ),
    ).toBeNull();
    // And the file on the host's disk holds what the store shows.
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
    expect(files.text(cssPath)).toContain(
      `grid-template-columns: ${a}fr ${b}fr 1fr;`,
    );
  });

  test("a ⌘-drag resizes the gap instead, in the shorthand the author wrote", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    await drag(bands("cols")[1]!, { x: 8 * zoom, y: 0 }, { meta: true });
    expect(css(path)).toContain("gap: 16px 24px;");
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
    expect(css(path)).toContain("grid-template-columns: 1fr 2fr 1fr;");
    // And the row gap through the row band.
    await vi.waitFor(() => expect(bands("rows")).toHaveLength(1));
    await drag(bands("rows")[0]!, { x: 0, y: -8 * zoom }, { meta: true });
    expect(css(path)).toContain("gap: 8px 24px;");
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
  });

  test("a ⇧-drag pulls a new track out of the line, carved from the neighbour it points at", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    // Line 1 pulled 110 layout px to the right: a quarter of the 2fr.
    await drag(
      bands("cols")[0]!,
      { x: 110 * zoom, y: 0 },
      {
        shift: true,
        held: () => expect(noteText()).toBe("new 0.5fr · 1.5fr"),
      },
    );
    expect(css(path)).toContain("grid-template-columns: 1fr 0.5fr 1.5fr 1fr;");
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(3));
    expect(noteText()).toBeNull();
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
  });

  test("a drag inward on an edge pulls a track in from that end", async () => {
    const { path, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(edges("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    await drag(edges("cols")[1]!, { x: -55 * zoom, y: 0 });
    expect(css(path)).toContain(
      "grid-template-columns: 1fr 2fr 0.75fr 0.25fr;",
    );
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(3));
    await drag(edges("cols")[0]!, { x: 55 * zoom, y: 0 });
    expect(css(path)).toContain(
      "grid-template-columns: 0.25fr 0.75fr 2fr 0.75fr 0.25fr;",
    );
    // Pulled outward, an edge opens nothing.
    const before = css(path);
    await drag(
      edges("cols")[0]!,
      { x: -40 * zoom, y: 0 },
      {
        held: () => expect(noteText()).toBe("pull inward to open a column"),
      },
    );
    expect(css(path)).toBe(before);
  });

  test("a double-click on a band writes a twin of the track before it", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    doubleClick(bands("cols")[1]!);
    expect(css(path)).toContain("grid-template-columns: 1fr 2fr 2fr 1fr;");
    expect(noteText()).toBe("+2fr");
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(3));
    await vi.waitFor(() => expect(noteText()).toBeNull(), { timeout: 2000 });
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
  });

  test("a track dragged shut stays at 0fr; ⇧-double-click removes the track before the line", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    // Line 1 dragged past the whole first track's width to the left: the
    // track closes and stays, and the note says how to remove it.
    await drag(
      bands("cols")[0]!,
      { x: -260 * zoom, y: 0 },
      {
        held: () =>
          expect(noteText()).toBe("0fr · 3fr — ⇧-double-click to remove"),
      },
    );
    expect(css(path)).toContain("grid-template-columns: 0fr 3fr 1fr;");
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    // The closed track is the one before line 1. (A double-click within
    // 600ms of the drag would be read as the drag's own release.)
    await new Promise((resolve) => setTimeout(resolve, 650));
    doubleClick(bands("cols")[0]!, { shift: true });
    expect(css(path)).toContain("grid-template-columns: 3fr 1fr;");
    expect(noteText()).toBe("column 1 removed");
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(1));
    // And at the start edge, the first track.
    doubleClick(edges("cols")[0]!, { shift: true });
    expect(css(path)).toContain("grid-template-columns: 1fr;");
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
  });

  test("a press without a drag writes nothing, whatever the modifier", async () => {
    // Values a rewrite would reformat, and no gap to scale.
    const { path, files, grid } = await mountOnPage(
      gridCss(
        ".grid { display: grid; grid-template-columns: 1.333fr auto 1fr; }",
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const before = css(path);
    press(bands("cols")[0]!, {
      held: () => expect(noteText()).toBe("1.333fr · auto"),
    });
    press(bands("cols")[0]!, {
      meta: true,
      held: () => expect(noteText()).toBe("column gap 0px"),
    });
    press(bands("cols")[0]!, {
      shift: true,
      held: () => expect(noteText()).toBe("pull to open a column"),
    });
    press(edges("cols")[1]!, {
      held: () => expect(noteText()).toBe("pull to open a column"),
    });
    expect(css(path)).toBe(before);
    expect(files.writes()).toHaveLength(0);
    expect(noteText()).toBeNull();
  });

  test("a cancelled drag puts the rule back as it was", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    const before = css(path);
    await drag(
      bands("cols")[0]!,
      { x: 44 * zoom, y: 0 },
      {
        held: () =>
          expect(css(path)).not.toContain(
            "grid-template-columns: 1fr 2fr 1fr;",
          ),
        cancel: true,
      },
    );
    // Every declaration as written (the kernel re-flows the saved rule's
    // shape, never its content), and the disk agrees.
    expect(css(path)).toContain("grid-template-columns: 1fr 2fr 1fr;");
    expect(css(path)).toContain("gap: 16px;");
    for (const line of before.split("\n")) {
      if (!line.startsWith(".grid")) expect(css(path)).toContain(line);
    }
    expect(noteText()).toBeNull();
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(css(path)));
  });

  test("named lines keep their bands, and the drag keeps the names", async () => {
    const { path, grid } = await mountOnPage(
      gridCss(
        ".grid { display: grid; grid-template-columns: [full-start] 1fr [content-start] 2fr [content-end] 1fr [full-end]; gap: 16px; }",
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    await drag(bands("cols")[0]!, { x: 44 * zoom, y: 0 });
    expect(css(path)).toContain(
      "grid-template-columns: [full-start] 1.2fr [content-start] 1.8fr [content-end] 1fr [full-end];",
    );
  });

  test("the drag writes the declaration that wins, not the last on the stack", async () => {
    // The less specific rule wins by !important; the sizes come from it.
    const { path, grid } = await mountOnPage(
      gridCss(
        ".grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }\ndiv { grid-template-columns: 1fr 2fr 1fr !important; }",
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    await drag(bands("cols")[0]!, { x: 44 * zoom, y: 0 });
    expect(css(path)).toContain(
      "grid-template-columns: 1.2fr 1.8fr 1fr !important;",
    );
    expect(css(path)).toContain("grid-template-columns: 1fr 1fr 1fr;");
  });

  test("a gap written as a function is left to the panel", async () => {
    const { path, files, grid } = await mountOnPage(
      gridCss(
        ":root { --g: 16px; }\n.grid { display: grid; grid-template-columns: 1fr 2fr 1fr; gap: var(--g); }",
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const before = css(path);
    await drag(
      bands("cols")[0]!,
      { x: 8 * mounted!.store.zoom(), y: 0 },
      {
        meta: true,
        held: () =>
          expect(noteText()).toBe(
            "the gap uses a value only the CSS panel can edit",
          ),
      },
    );
    expect(css(path)).toBe(before);
    expect(files.writes()).toHaveLength(0);
  });

  test("a drag that pauses past the typing burst is still one undo step", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    const before = css(path);
    expect(mounted!.store.canUndo()).toBe(false);
    await drag(bands("cols")[0]!, { x: 44 * zoom, y: 0 }, { pause: 700 });
    expect(css(path)).toContain("grid-template-columns: 1.2fr 1.8fr 1fr;");
    expect(mounted!.store.canUndo()).toBe(true);
    mounted!.store.undo();
    flush();
    // One step back: the sheet exactly as it was before the press.
    expect(css(path)).toBe(before);
    expect(mounted!.store.canUndo()).toBe(false);
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(before));
  });

  test("a drag cancelled after a pause leaves no undo step", async () => {
    const { path, cssPath, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    const before = css(path);
    await drag(
      bands("cols")[0]!,
      { x: 44 * zoom, y: 0 },
      {
        pause: 700,
        cancel: true,
      },
    );
    expect(css(path)).toBe(before);
    expect(mounted!.store.canUndo()).toBe(false);
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(before));
  });

  test("a cancelled drag that had added a rule leaves no rule behind", async () => {
    // The grid is inline; no rule reaches it, so the gap is an `add`.
    const { path, cssPath, files, grid } = await mountOnPage(
      gridCss(""),
      PAGE_FIXTURE_HTML.replace(
        '<div class="grid">',
        '<div class="grid" style="display: grid; grid-template-columns: 1fr 2fr 1fr">',
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    const before = css(path);
    await drag(
      bands("cols")[0]!,
      { x: 8 * zoom, y: 0 },
      {
        meta: true,
        held: () => expect(css(path)).toContain("column-gap:"),
        cancel: true,
      },
    );
    expect(css(path)).toBe(before);
    expect(mounted!.store.canUndo()).toBe(false);
    await vi.waitFor(() => expect(files.text(cssPath)).toBe(before));
  });

  test("the rewrite lands on the declaration that wins inside the rule, not the last", async () => {
    const { path, grid } = await mountOnPage(
      gridCss(
        ".grid { display: grid; grid-template-columns: 1fr 1fr 1fr !important; grid-template-columns: 1fr 2fr 1fr; gap: 16px; }",
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    // Three equal tracks (the !important ones) of 293.3px; +44 on line 1.
    await drag(bands("cols")[0]!, { x: 44 * zoom, y: 0 });
    expect(css(path)).toContain(
      "grid-template-columns: 1.15fr 0.85fr 1fr !important;",
    );
    expect(css(path)).toContain("grid-template-columns: 1fr 2fr 1fr;");
  });

  test("a double-click right after a drag is the drag's release, not an insert", async () => {
    const { path, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const zoom = mounted!.store.zoom();
    await drag(bands("cols")[0]!, { x: 44 * zoom, y: 0 });
    doubleClick(bands("cols")[0]!);
    expect(css(path)).toContain("grid-template-columns: 1.2fr 1.8fr 1fr;");
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    // A double-click on its own, later, still inserts.
    await new Promise((resolve) => setTimeout(resolve, 650));
    doubleClick(bands("cols")[0]!);
    expect(css(path)).toContain(
      "grid-template-columns: 1.2fr 1.2fr 1.8fr 1fr;",
    );
  });

  test("a track written with a function is left to the panel rather than rewritten in px", async () => {
    const { path, files, grid } = await mountOnPage(
      gridCss(
        ".grid { display: grid; grid-template-columns: minmax(100px, 1fr) auto 1fr; gap: 16px; }",
      ),
    );
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("cols")).toHaveLength(2));
    const before = css(path);
    await drag(
      bands("cols")[0]!,
      { x: 20 * mounted!.store.zoom(), y: 0 },
      {
        held: () =>
          expect(noteText()).toBe(
            "columns use minmax() — the CSS panel edits that",
          ),
      },
    );
    expect(css(path)).toBe(before);
    expect(files.writes()).toHaveLength(0);
  });

  test.each([
    ["a negative line before the first", "grid-column: -5 / -4;"],
    ["a span that ends on line 1", "grid-column: span 2 / 1;"],
    ["an auto start before line 1", "grid-column: auto / 1;"],
  ])(
    "a grid with tracks before its first (%s) is left to the panel",
    async (_name, placement) => {
      // Each names a line before the first: Chromium resolves an implicit
      // track ahead of the explicit ones.
      const { path, files, grid } = await mountOnPage(
        PAGE_FIXTURE_CSS.replace("grid-column: span 2;", placement),
      );
      mounted!.store.setSelectedId(grid);
      flush();
      await vi.waitFor(() =>
        expect(bands("cols").length).toBeGreaterThanOrEqual(3),
      );
      const before = css(path);
      await drag(
        bands("cols")[1]!,
        { x: 20 * mounted!.store.zoom(), y: 0 },
        {
          held: () =>
            expect(noteText()).toBe(
              "columns start before the first — the CSS panel edits that",
            ),
        },
      );
      expect(css(path)).toBe(before);
      expect(files.writes()).toHaveLength(0);
    },
  );

  test("a plain drag on an implicit row boundary writes nothing", async () => {
    const { path, files, grid } = await mountOnPage();
    mounted!.store.setSelectedId(grid);
    flush();
    await vi.waitFor(() => expect(bands("rows")).toHaveLength(1));
    const before = css(path);
    await drag(bands("rows")[0]!, { x: 0, y: 30 });
    expect(css(path)).toBe(before);
    expect(files.writes()).toHaveLength(0);
  });
});
