// The plugin through the loader seam (decision #48, testing
// decisions): the real shell, the plugin enabled by config, assertions
// from the DOM. The pane shows the project's meta (decision #78: a
// project's title and notes, never a viewport's), with the source link of
// the page in view — the page of the selection's viewport, or of a sole
// viewport when nothing is selected — and renders nothing without meta
// while its panel stays. An element inside a page is selected by the
// id its mount stamped, and the pane finds its viewport through the
// kernel.
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  DreamMeta,
  ElementId,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  createPageItem,
  flush,
  mountPlugin,
  PAGE_FIXTURE_CSS,
  PAGE_FIXTURE_HTML,
  pageElementId,
  testProject,
  type MountedPlugin,
  type TestPage,
  type TestProject,
} from "@daydream/plugin-testing";

import activate from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;

let mounted: MountedPlugin | null = null;

afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

const holyGrail: DreamMeta = {
  title: "Holy grail",
  notes:
    "**What this teaches.** Three columns\nfrom one grid.\n\n" +
    "1. Drag the frame\n   under 600px.\n2. Read the **gap**.",
};
const HOLY_GRAIL_SOURCE = "https://example.com/holy-grail";
const SIDEBAR_SOURCE = "https://example.com/sidebar";

/** A fixture page of its own (html › body › `.grid`), at `x`. */
function fixturePageAt(x: number): TestPage {
  return createPageItem(
    { html: PAGE_FIXTURE_HTML, css: PAGE_FIXTURE_CSS },
    { frame: { width: 960 }, position: { x, y: 0 } },
  );
}

/** A project of `pages`, with `meta`, each page's source as given (in
 * `daydream.json`'s page list, where a page's provenance lives). */
function projectOf(
  pages: { page: TestPage; sourceUrl?: string }[],
  meta?: DreamMeta,
): TestProject {
  const project = testProject(
    pages.map(({ page }) => page),
    meta === undefined ? {} : { meta },
  );
  for (const { page, sourceUrl } of pages) {
    if (sourceUrl === undefined) continue;
    const entry = project.document.pages.find(
      (listed) => listed.path === page.page.path,
    )!;
    entry.meta = { sourceUrl };
  }
  return project;
}

/** The render-time id of a page's `.grid`, once the page has mounted. */
async function gridIn(page: TestPage): Promise<ElementId> {
  let id: string | null = null;
  await vi.waitFor(() => {
    id = pageElementId(page.item.id, ".grid");
    expect(id).not.toBeNull();
  });
  return id!;
}

const notes = (): HTMLElement | null =>
  mounted!.panel()!.querySelector('[aria-label="Project notes"]');

const title = (): string | undefined =>
  notes()?.querySelector(".mrbavio-notes-title")?.textContent ?? undefined;

const source = (): string | undefined =>
  notes()?.querySelector<HTMLAnchorElement>(".mrbavio-notes-source")?.href;

function select(id: ElementId | null): void {
  mounted!.store.setSelectedId(id);
  flush();
}

describe("mrbavio.notes in the shell", () => {
  test("the manifest is first-party and declares the notes panel", () => {
    expect(manifest.id).toBe("mrbavio.notes");
    expect(manifest.contributes?.panels).toEqual(["notes"]);
    expect(manifest.unstable).toBeUndefined();
  });

  test("shows the project's meta — title, notes blocks with bold — and the selected page's source link", async () => {
    const first = fixturePageAt(0);
    const second = fixturePageAt(1200);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf(
        [{ page: first, sourceUrl: HOLY_GRAIL_SOURCE }, { page: second }],
        holyGrail,
      ),
    });
    select(await gridIn(first));
    const section = notes();
    expect(section).not.toBeNull();
    expect(title()).toBe("Holy grail");

    const paragraph = section!.querySelector(".mrbavio-notes-paragraph")!;
    expect(paragraph.textContent).toBe(
      "What this teaches. Three columns from one grid.",
    );
    expect(paragraph.querySelector("strong")!.textContent).toBe(
      "What this teaches.",
    );

    const items = section!.querySelectorAll(".mrbavio-notes-list li");
    expect(Array.from(items, (li) => li.textContent)).toEqual([
      "Drag the frame under 600px.",
      "Read the gap.",
    ]);
    expect(items[1]!.querySelector("strong")!.textContent).toBe("gap");

    const link = section!.querySelector<HTMLAnchorElement>(
      ".mrbavio-notes-source",
    )!;
    expect(link.href).toBe(HOLY_GRAIL_SOURCE);
    expect(link.textContent).toBe("example.com/holy-grail");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  test("the source follows the selection from page to page — an element inside a page or the viewport item itself — and the title stays the project's", async () => {
    const first = fixturePageAt(0);
    const second = fixturePageAt(1200);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf(
        [
          { page: first, sourceUrl: HOLY_GRAIL_SOURCE },
          { page: second, sourceUrl: SIDEBAR_SOURCE },
        ],
        holyGrail,
      ),
    });
    const gridInFirst = await gridIn(first);
    const gridInSecond = await gridIn(second);
    // Two viewports and nothing selected: no page is in view.
    expect(title()).toBe("Holy grail");
    expect(source()).toBeUndefined();

    select(gridInFirst);
    expect(source()).toBe(HOLY_GRAIL_SOURCE);
    select(gridInSecond);
    expect(source()).toBe(SIDEBAR_SOURCE);
    select(first.item.id);
    expect(source()).toBe(HOLY_GRAIL_SOURCE);
    select(second.item.id);
    expect(source()).toBe(SIDEBAR_SOURCE);
    expect(title()).toBe("Holy grail");
    select(null);
    expect(source()).toBeUndefined();
    expect(title()).toBe("Holy grail");
  });

  test("a page with no source shows the project's meta alone, and a project with no meta shows a selected page's source alone", async () => {
    const first = fixturePageAt(0);
    const second = fixturePageAt(1200);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf(
        [{ page: first }, { page: second, sourceUrl: SIDEBAR_SOURCE }],
        holyGrail,
      ),
    });
    select(await gridIn(first));
    expect(title()).toBe("Holy grail");
    expect(source()).toBeUndefined();
    mounted.dispose();

    const third = fixturePageAt(0);
    const fourth = fixturePageAt(1200);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf([
        { page: third, sourceUrl: HOLY_GRAIL_SOURCE },
        { page: fourth },
      ]),
    });
    const gridInThird = await gridIn(third);
    const gridInFourth = await gridIn(fourth);
    expect(notes()).toBeNull();
    select(gridInThird);
    expect(title()).toBeUndefined();
    expect(source()).toBe(HOLY_GRAIL_SOURCE);
    select(gridInFourth);
    expect(notes()).toBeNull();
  });

  test("a one-viewport project shows its sole page's source with nothing selected", async () => {
    const page = fixturePageAt(0);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf([{ page, sourceUrl: HOLY_GRAIL_SOURCE }]),
    });
    expect(source()).toBe(HOLY_GRAIL_SOURCE);
    select(await gridIn(page));
    expect(source()).toBe(HOLY_GRAIL_SOURCE);
  });

  test("the pane follows the project's meta, and the page's source, edited while an element stays selected", async () => {
    const page = fixturePageAt(0);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf([{ page }], holyGrail),
    });
    select(await gridIn(page));
    expect(title()).toBe("Holy grail");
    expect(source()).toBeUndefined();
    mounted.store.setDocument((d) => {
      d.meta = { ...holyGrail, title: "Holy grail, tighter" };
    });
    flush();
    expect(title()).toBe("Holy grail, tighter");
    mounted.store.setDocument((d) => {
      d.pages[0]!.meta = { sourceUrl: SIDEBAR_SOURCE };
    });
    flush();
    expect(source()).toBe(SIDEBAR_SOURCE);
  });

  test("renders nothing without meta, and the panel stays", async () => {
    const page = fixturePageAt(0);
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf([{ page }]),
    });
    const panel = mounted.panel()!;
    expect(panel).not.toBeNull();
    expect(notes()).toBeNull();
    // The root holds nothing (its CSS is the kernel's <style> in the
    // panel section, from `styles` — decision #71) — and takes no
    // height: the padding is the body's, so an empty pane is a zero-height
    // row under the panel's header, not a blank inset.
    const styles = panel.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);
    const body = panel.querySelector<HTMLElement>(".mrbavio-notes-panel")!;
    expect(body.children).toHaveLength(0);
    expect(body.getBoundingClientRect().height).toBe(0);
    select(await gridIn(page));
    expect(notes()).toBeNull();
    // Meta arriving later (another project opened) shows up without a
    // remount.
    mounted.store.loadProject(
      projectOf([{ page: fixturePageAt(0) }], { title: "Sidebar" }),
    );
    flush();
    expect(title()).toBe("Sidebar");
  });

  test("minimized, its body is gone; opened again, it shows the project's meta", async () => {
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf([{ page: fixturePageAt(0) }], { title: "Sidebar" }),
    });
    // The header's icon, found by its name (decision #79: the kernel's
    // chrome). The layout is remembered per project, so the panel is
    // opened again whatever happens.
    const toggle = (name: "Minimize" | "Expand"): void => {
      mounted!
        .panel()!
        .querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
        .click();
      flush();
    };
    try {
      expect(title()).toBe("Sidebar");
      toggle("Minimize");
      expect(mounted.panel()!.querySelector(".mrbavio-notes-panel")).toBeNull();
      toggle("Expand");
      expect(title()).toBe("Sidebar");
    } finally {
      if (mounted.panel()!.querySelector('button[aria-label="Expand"]') !== null) {
        toggle("Expand");
      }
    }
  });

  test("a copy under another id styles its own nodes: the class prefix derives from dd.plugin.id", async () => {
    const copy: PluginManifest = { ...manifest, id: "acme.notes" };
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      project: projectOf([{ page: fixturePageAt(0) }], { title: "Sidebar" }),
      also: [{ entry: activate, manifest: copy }],
    });
    const ours = mounted.panel()!;
    const theirs = mounted.panel("acme.notes")!;
    expect(ours.querySelector(".mrbavio-notes-title")!.textContent).toBe(
      "Sidebar",
    );
    expect(theirs.querySelector(".acme-notes-title")!.textContent).toBe(
      "Sidebar",
    );
    // Neither carries the other's classes; each stylesheet targets its own.
    expect(theirs.querySelector("[class^='mrbavio-notes']")).toBeNull();
    expect(ours.querySelector("[class^='acme-notes']")).toBeNull();
    expect(ours.querySelector("style")!.textContent).toContain(
      ".mrbavio-notes-panel",
    );
    expect(theirs.querySelector("style")!.textContent).not.toContain(
      "mrbavio-notes",
    );
  });
});
