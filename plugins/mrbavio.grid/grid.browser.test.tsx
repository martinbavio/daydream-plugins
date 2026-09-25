// The plugin through the loader seam (decision #48, testing
// decisions): mounted into the real shell by @daydream/plugin-testing and
// asserted from the DOM. The precedence and alignment promises are pinned
// in src/overlay/overlay.browser.test.tsx; this file is the plugin's own
// contract: where it draws and that it follows the selection, into a
// page's shadow root (decision #76).
import { afterEach, describe, expect, test, vi } from "vitest";

import type { PluginManifest } from "@daydream/plugin-api";
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

/** Mount the plugin over the page fixture (html › body › `.grid` of
 * `.header`, `.aside`, `.footer`, three columns) and wait for the page:
 * the render-time id of each element a selector names, which the store
 * selects it by. */
async function mountOnPage(
  ...selectors: string[]
): Promise<Record<string, string>> {
  const doc = pageFixtureDocument();
  const itemId = fixturePage(doc).id;
  mounted = await mountPlugin({ entry: activate, manifest, document: doc });
  const ids: Record<string, string> = {};
  await vi.waitFor(() => {
    for (const selector of selectors) {
      const id = pageElementId(itemId, selector);
      expect(id).not.toBeNull();
      ids[selector] = id!;
    }
  });
  return ids;
}

/** The line-number badges' labels. */
const labels = (overlay: HTMLElement): string[] =>
  Array.from(overlay.querySelectorAll("text"), (t) => t.textContent ?? "");

describe("mrbavio.grid", () => {
  test("the manifest is first-party and declares the grid overlay", () => {
    expect(manifest.id).toBe("mrbavio.grid");
    expect(manifest.minCore).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.contributes?.overlays).toEqual(["grid"]);
    expect(manifest.contributes?.panels).toBeUndefined();
    expect(manifest.unstable).toBeUndefined();
  });

  test("draws in the screen slot, for the selected grid only", async () => {
    const ids = await mountOnPage(".grid");
    const overlay = mounted!.overlay();
    expect(overlay).not.toBeNull();
    expect(
      overlay!
        .closest("[data-plugin-overlay-slot]")
        ?.getAttribute("data-plugin-overlay-slot"),
    ).toBe("overlay.screen");
    // One <style> — the kernel's, from `styles`, in the plugin layer
    // (decision #71); prefixed classes; nothing drawn without a
    // selection.
    const styles = overlay!.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);
    expect(styles[0]!.textContent).toContain(".mrbavio-grid-line");
    expect(overlay!.querySelectorAll("line")).toHaveLength(0);

    mounted!.store.setSelectedId(ids[".grid"]!);
    flush();
    // Class names and the hatch pattern id derive from the plugin id
    // (`mrbavio.grid` → `mrbavio-grid-…`), so a copy under another id
    // collides with neither; the gap bands reference THIS pattern.
    expect(
      overlay!.querySelectorAll("line.mrbavio-grid-line").length,
    ).toBeGreaterThan(0);
    expect(overlay!.querySelector("#mrbavio-grid-gap-hatch")).not.toBeNull();
    expect(overlay!.querySelector("[id^='dd-grid']")).toBeNull();
    expect(
      getComputedStyle(overlay!.querySelector("rect.mrbavio-grid-gap-band")!)
        .fill,
    ).toContain("mrbavio-grid-gap-hatch");
    // Three columns → column lines 1..4 badged; positive numbers only.
    expect(labels(overlay!)).toEqual(
      expect.arrayContaining(["1", "2", "3", "4"]),
    );
    expect(labels(overlay!).some((l) => l.startsWith("-"))).toBe(false);

    mounted!.store.setSelectedId(null);
    flush();
    expect(overlay!.querySelectorAll("line")).toHaveLength(0);
  });

  test("a selected grid item shows its parent's grid; an element with no grid above it shows none", async () => {
    const ids = await mountOnPage(".grid", ".header", "body");
    const overlay = mounted!.overlay()!;
    const drawn = (id: string): string[] => {
      mounted!.store.setSelectedId(id);
      flush();
      return labels(overlay);
    };
    // The grid's own lines, then the same lines from one of its items
    // (decision #11: a non-grid child shows its parent's grid).
    const own = drawn(ids[".grid"]!);
    expect(own).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
    expect(drawn(ids[".header"]!)).toEqual(own);
    // The page's body is not a grid, and neither is its parent.
    expect(drawn(ids["body"]!)).toEqual([]);
    expect(overlay.querySelectorAll("line")).toHaveLength(0);
    // Back to the item: its parent's grid again.
    expect(drawn(ids[".header"]!)).toEqual(own);
  });
});
