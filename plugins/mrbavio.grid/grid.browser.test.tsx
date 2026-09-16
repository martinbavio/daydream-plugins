// The plugin through the loader seam (decisions.md #48, testing
// decisions): mounted into the real shell by @daydream/plugin-testing and
// asserted from the DOM. The precedence and alignment promises are pinned
// in src/overlay/overlay.browser.test.tsx; this file is the plugin's own
// contract: where it draws and that it follows the selection.
import { afterEach, describe, expect, test } from "vitest";

import type { PluginManifest } from "@daydream/plugin-api";
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

describe("mrbavio.grid", () => {
  test("the manifest is first-party and declares the grid overlay", () => {
    expect(manifest.id).toBe("mrbavio.grid");
    expect(manifest.minCore).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.contributes?.overlays).toEqual(["grid"]);
    expect(manifest.contributes?.panels).toBeUndefined();
    expect(manifest.unstable).toBeUndefined();
  });

  test("draws in the screen slot, for the selected grid only", async () => {
    const doc = fixtureDocument();
    const grid = fixtureRoot(doc).children[0]!.children[0]!;
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const overlay = mounted.overlay();
    expect(overlay).not.toBeNull();
    expect(
      overlay!
        .closest("[data-plugin-overlay-slot]")
        ?.getAttribute("data-plugin-overlay-slot"),
    ).toBe("overlay.screen");
    // One <style> — the kernel's, from `styles`, in the plugin layer
    // (decisions.md #71); prefixed classes; nothing drawn without a
    // selection.
    const styles = overlay!.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);
    expect(styles[0]!.textContent).toContain(".mrbavio-grid-line");
    expect(overlay!.querySelectorAll("line")).toHaveLength(0);

    mounted.store.setSelectedId(grid.id);
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
    const labels = Array.from(overlay!.querySelectorAll("text")).map(
      (t) => t.textContent,
    );
    expect(labels).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
    expect(labels.some((l) => l !== null && l.startsWith("-"))).toBe(false);

    mounted.store.setSelectedId(null);
    flush();
    expect(overlay!.querySelectorAll("line")).toHaveLength(0);
  });
});
