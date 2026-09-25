// The plugin through the loader seam (decision #48, testing
// decisions): the real shell, the plugin enabled by config, assertions
// from the DOM. The P5 acceptance: the pane follows the selection's
// viewport exactly as it did as a strip inside the CSS editor — the same
// fallbacks when nothing is selected, the same markup semantics — and
// renders nothing without meta while staying in the dock. A viewport is a
// page (decision #76): an element inside it is selected by the id its
// mount stamped, and the pane finds its page through the kernel.
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  DreamDocument,
  DreamMeta,
  DreamPage,
  ElementId,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  fixturePage,
  flush,
  mountPlugin,
  pageElementId,
  pageFixtureDocument,
  type MountedPlugin,
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
  sourceUrl: "https://example.com/holy-grail",
};
const sidebar: DreamMeta = { title: "Sidebar", notes: "A second page." };
const canvas: DreamMeta = { title: "The canvas", notes: "Two pages." };

interface TwoViewports {
  doc: DreamDocument;
  first: DreamPage;
  second: DreamPage;
}

/** The page fixture with no meta of its own (it is titled "Viewport"). */
function bareFixture(): DreamDocument {
  const doc = pageFixtureDocument();
  delete fixturePage(doc).payload.meta;
  return doc;
}

/** Two fixture pages in one document, neither with meta, fresh ids on
 * every call, the second beside the first. */
function twoViewports(): TwoViewports {
  const doc = bareFixture();
  const second = fixturePage(bareFixture());
  second.position = { x: 1200, y: 0 };
  doc.items.push(second);
  return { doc, first: doc.items[0] as DreamPage, second };
}

/** The render-time id of a page's `.grid`, once the page has mounted. */
async function gridIn(page: DreamPage): Promise<ElementId> {
  let id: string | null = null;
  await vi.waitFor(() => {
    id = pageElementId(page.id, ".grid");
    expect(id).not.toBeNull();
  });
  return id!;
}

const notes = (): HTMLElement | null =>
  mounted!.panel()!.querySelector('[aria-label="Document notes"]');

const title = (): string | undefined =>
  notes()?.querySelector(".mrbavio-notes-title")?.textContent ?? undefined;

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

  test("shows the selected element's viewport meta: title, notes blocks with bold, the source link", async () => {
    const two = twoViewports();
    two.first.payload.meta = holyGrail;
    two.second.payload.meta = sidebar;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    select(await gridIn(two.first));
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
    expect(link.href).toBe("https://example.com/holy-grail");
    expect(link.textContent).toBe("example.com/holy-grail");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  test("follows the selection from viewport to viewport — an element inside a page or the viewport item itself — and back to the canvas meta when nothing is selected", async () => {
    const two = twoViewports();
    two.doc.meta = canvas;
    two.first.payload.meta = holyGrail;
    two.second.payload.meta = sidebar;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    const gridInFirst = await gridIn(two.first);
    const gridInSecond = await gridIn(two.second);
    expect(title()).toBe("The canvas");
    expect(notes()!.querySelector(".mrbavio-notes-source")).toBeNull();

    select(gridInFirst);
    expect(title()).toBe("Holy grail");
    select(gridInSecond);
    expect(title()).toBe("Sidebar");
    expect(notes()!.querySelector(".mrbavio-notes-source")).toBeNull();
    select(two.first.id);
    expect(title()).toBe("Holy grail");
    select(two.second.id);
    expect(title()).toBe("Sidebar");
    select(null);
    expect(title()).toBe("The canvas");
  });

  test("a selection whose viewport has no meta falls back to the canvas meta", async () => {
    const two = twoViewports();
    two.doc.meta = canvas;
    two.second.payload.meta = sidebar;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    const gridInFirst = await gridIn(two.first);
    const gridInSecond = await gridIn(two.second);
    select(gridInFirst);
    expect(title()).toBe("The canvas");
    select(gridInSecond);
    expect(title()).toBe("Sidebar");
  });

  test("a one-viewport document falls back to its sole viewport's meta; two viewports without canvas meta show nothing", async () => {
    const doc = pageFixtureDocument();
    fixturePage(doc).payload.meta = holyGrail;
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    expect(title()).toBe("Holy grail");
    select(await gridIn(fixturePage(doc)));
    expect(title()).toBe("Holy grail");
    mounted.dispose();

    const two = twoViewports();
    two.first.payload.meta = holyGrail;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    const gridInFirst = await gridIn(two.first);
    const gridInSecond = await gridIn(two.second);
    expect(notes()).toBeNull();
    select(gridInFirst);
    expect(title()).toBe("Holy grail");
    select(gridInSecond);
    expect(notes()).toBeNull();
  });

  test("the pane follows a page's meta edited while one of its elements stays selected", async () => {
    const two = twoViewports();
    two.first.payload.meta = holyGrail;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    select(await gridIn(two.first));
    expect(title()).toBe("Holy grail");
    // A css write restyles the page in place: same nodes, same ids, same
    // selection — and the page it belongs to is still known.
    mounted.store.setDocument((d) => {
      const page = d.items.find((i) => i.id === two.first.id) as DreamPage;
      page.payload.css += "\n.grid { gap: 8px; }\n";
      page.payload.meta = { ...holyGrail, title: "Holy grail, tighter" };
    });
    flush();
    expect(title()).toBe("Holy grail, tighter");
  });

  test("renders nothing without meta, and the panel stays in the dock", async () => {
    const doc = bareFixture();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const panel = mounted.panel()!;
    expect(panel).not.toBeNull();
    expect(notes()).toBeNull();
    // The root holds nothing (its CSS is the kernel's <style> in the
    // panel section, from `styles` — decision #71) — and takes no
    // height: the padding is the body's, so an empty pane is a zero-height
    // row under the dock's caption, not a blank inset.
    const styles = panel.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);
    const body = panel.querySelector<HTMLElement>(".mrbavio-notes-panel")!;
    expect(body.children).toHaveLength(0);
    expect(body.getBoundingClientRect().height).toBe(0);
    select(await gridIn(fixturePage(doc)));
    expect(notes()).toBeNull();
    // Meta landing later (a document load) shows up without a remount.
    const next = pageFixtureDocument();
    fixturePage(next).payload.meta = sidebar;
    mounted.store.loadDocument(next, { slug: null });
    flush();
    expect(title()).toBe("Sidebar");
  });

  test("a copy under another id styles its own nodes: the class prefix derives from dd.plugin.id", async () => {
    const doc = pageFixtureDocument();
    fixturePage(doc).payload.meta = sidebar;
    const copy: PluginManifest = { ...manifest, id: "acme.notes" };
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: doc,
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
