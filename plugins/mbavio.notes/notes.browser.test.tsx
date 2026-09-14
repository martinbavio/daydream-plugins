// The plugin through the loader seam (decisions.md #48, testing
// decisions): the real shell, the plugin enabled by config, assertions
// from the DOM. The P5 acceptance: the pane follows the selection's
// viewport exactly as it did as a strip inside the CSS editor — the same
// fallbacks when nothing is selected, the same markup semantics — and
// renders nothing without meta while staying in the dock.
import { afterEach, describe, expect, test } from "vitest";

import type {
  DreamDocument,
  DreamMeta,
  DreamViewport,
  ElementId,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  fixtureDocument,
  fixtureRoot,
  flush,
  mountPlugin,
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
  first: DreamViewport;
  second: DreamViewport;
  /** The grid element inside each viewport. */
  gridInFirst: ElementId;
  gridInSecond: ElementId;
}

/** Two fixture viewports in one document, fresh ids on every call. */
function twoViewports(): TwoViewports {
  const doc = fixtureDocument();
  const other = fixtureDocument();
  const gridInFirst = fixtureRoot(doc).children[0]!.children[0]!.id;
  const gridInSecond = fixtureRoot(other).children[0]!.children[0]!.id;
  doc.items.push(other.items[0]!);
  return {
    doc,
    first: doc.items[0] as DreamViewport,
    second: doc.items[1] as DreamViewport,
    gridInFirst,
    gridInSecond,
  };
}

const notes = (): HTMLElement | null =>
  mounted!.panel()!.querySelector('[aria-label="Document notes"]');

const title = (): string | undefined =>
  notes()?.querySelector(".daydream-notes-title")?.textContent ?? undefined;

function select(id: ElementId | null): void {
  mounted!.store.setSelectedId(id);
  flush();
}

describe("mbavio.notes in the shell", () => {
  test("the manifest is first-party and declares the notes panel", () => {
    expect(manifest.id).toBe("mbavio.notes");
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
    select(two.gridInFirst);
    const section = notes();
    expect(section).not.toBeNull();
    expect(title()).toBe("Holy grail");

    const paragraph = section!.querySelector(".daydream-notes-paragraph")!;
    expect(paragraph.textContent).toBe(
      "What this teaches. Three columns from one grid.",
    );
    expect(paragraph.querySelector("strong")!.textContent).toBe(
      "What this teaches.",
    );

    const items = section!.querySelectorAll(".daydream-notes-list li");
    expect(Array.from(items, (li) => li.textContent)).toEqual([
      "Drag the frame under 600px.",
      "Read the gap.",
    ]);
    expect(items[1]!.querySelector("strong")!.textContent).toBe("gap");

    const link = section!.querySelector<HTMLAnchorElement>(
      ".daydream-notes-source",
    )!;
    expect(link.href).toBe("https://example.com/holy-grail");
    expect(link.textContent).toBe("example.com/holy-grail");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  test("follows the selection from viewport to viewport, and back to the canvas meta when nothing is selected", async () => {
    const two = twoViewports();
    two.doc.meta = canvas;
    two.first.payload.meta = holyGrail;
    two.second.payload.meta = sidebar;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    expect(title()).toBe("The canvas");
    expect(notes()!.querySelector(".daydream-notes-source")).toBeNull();

    select(two.gridInFirst);
    expect(title()).toBe("Holy grail");
    select(two.gridInSecond);
    expect(title()).toBe("Sidebar");
    expect(notes()!.querySelector(".daydream-notes-source")).toBeNull();
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
    select(two.gridInFirst);
    expect(title()).toBe("The canvas");
    select(two.gridInSecond);
    expect(title()).toBe("Sidebar");
  });

  test("a one-viewport document falls back to its sole viewport's meta; two viewports without canvas meta show nothing", async () => {
    const doc = fixtureDocument();
    const grid = fixtureRoot(doc).children[0]!.children[0]!.id;
    (doc.items[0] as DreamViewport).payload.meta = holyGrail;
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    expect(title()).toBe("Holy grail");
    select(grid);
    expect(title()).toBe("Holy grail");
    mounted.dispose();

    const two = twoViewports();
    two.first.payload.meta = holyGrail;
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: two.doc,
    });
    expect(notes()).toBeNull();
    select(two.gridInFirst);
    expect(title()).toBe("Holy grail");
    select(two.gridInSecond);
    expect(notes()).toBeNull();
  });

  test("renders nothing without meta, and the panel stays in the dock", async () => {
    const doc = fixtureDocument();
    const grid = fixtureRoot(doc).children[0]!.children[0]!.id;
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const panel = mounted.panel()!;
    expect(panel).not.toBeNull();
    expect(notes()).toBeNull();
    // The root holds its one <style> and nothing else — and takes no
    // height: the padding is the body's, so an empty pane is a zero-height
    // row under the dock's caption, not a blank inset.
    const body = panel.querySelector<HTMLElement>(".daydream-notes-panel")!;
    expect(Array.from(body.children, (el) => el.tagName)).toEqual(["STYLE"]);
    expect(body.getBoundingClientRect().height).toBe(0);
    select(grid);
    expect(notes()).toBeNull();
    // Meta landing later (a document load) shows up without a remount.
    const next = fixtureDocument();
    (next.items[0] as DreamViewport).payload.meta = sidebar;
    mounted.store.loadDocument(next, { slug: null });
    flush();
    expect(title()).toBe("Sidebar");
  });

  test("a copy under another id styles its own nodes: the class prefix derives from dd.plugin.id", async () => {
    const doc = fixtureDocument();
    (doc.items[0] as DreamViewport).payload.meta = sidebar;
    const copy: PluginManifest = { ...manifest, id: "acme.notes" };
    mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: doc,
      also: [{ entry: activate, manifest: copy }],
    });
    const ours = mounted.panel()!;
    const theirs = mounted.panel("acme.notes")!;
    expect(ours.querySelector(".daydream-notes-title")!.textContent).toBe(
      "Sidebar",
    );
    expect(theirs.querySelector(".acme-notes-title")!.textContent).toBe(
      "Sidebar",
    );
    // Neither carries the other's classes; each stylesheet targets its own.
    expect(theirs.querySelector("[class^='daydream-notes']")).toBeNull();
    expect(ours.querySelector("[class^='acme-notes']")).toBeNull();
    expect(ours.querySelector("style")!.textContent).toContain(
      ".daydream-notes-panel",
    );
    expect(theirs.querySelector("style")!.textContent).not.toContain(
      "daydream-notes",
    );
  });
});
