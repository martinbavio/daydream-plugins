// The browser part through the loader seam: the real shell, the plugin
// enabled by config. What a person does on the canvas — pick a verb on
// the selection, watch the caption, cancel, end — and what an agent does
// through the tab — take the pick — meet in the storage file the fake
// host holds; and adopting a variant folds it into its source as one undo
// step.
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  DreamDocument,
  DreamViewport,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  fixtureDocument,
  fixtureRoot,
  flush,
  mountPlugin,
  type Host,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import activate, { DONE_TOOL, PICK_TOOL } from "./index";
import rawManifest from "./manifest.json";
import { SESSION_KEY } from "./session";
import { variantMarker } from "./variants";

const manifest = rawManifest as PluginManifest;

let mounted: MountedPlugin | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** A host whose storage knows plugin data alone, over an in-memory map —
 * what `.daydream/plugin-data/` is to the bridge. */
function fakeHost(files: Record<string, Record<string, unknown>> = {}) {
  const host = {
    storage: {
      loadPluginData: vi.fn(async (id: string) => files[id] ?? {}),
      savePluginData: vi.fn(async (id: string, data: unknown) => {
        files[id] = structuredClone(data) as Record<string, unknown>;
      }),
    },
  } as unknown as Host;
  return { host, files };
}

/** The session as the fake host holds it, once `seq` reaches `atLeast`
 * (a set from a command lands on its own schedule). */
async function stored(
  files: Record<string, Record<string, unknown>>,
  atLeast: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2000;
  const seq = () => (files[manifest.id]?.[SESSION_KEY] as { seq?: number } | undefined)?.seq ?? 0;
  while (seq() < atLeast && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return files[manifest.id]![SESSION_KEY] as Record<string, unknown>;
}

const caption = (): HTMLElement | null =>
  mounted!.overlay()!.querySelector(".glaser-caption");

function select(id: string | null): void {
  mounted!.store.setSelectedId(id);
  flush();
}
const run = (id: string): boolean => mounted!.kernel.commands.runCommand(id);
const tool = (name: string) =>
  mounted!.kernel.registry.tools.entries().find((e) => e.value.name === name)!.value;
const pickTool = () => tool(PICK_TOOL);

/** A variant of `source` for `verb`, `n` of `of`, as an agent lands it. */
function variantOf(source: DreamViewport, verb: string, n: number, of: number): DreamViewport {
  const v = fixtureDocument().items[0] as DreamViewport;
  v.position = { x: 1000 * n, y: 0 };
  v.payload.meta = {
    title: `${source.payload.meta?.title ?? "Untitled"} · ${verb} ${n}/${of}`,
    notes: `${variantMarker({ verb, n, of, sourceId: source.id })}\n\nDirection ${n}.`,
  };
  v.payload.root.children[0]!.styles["background"] = `rgb(${n}, 0, 0)`;
  return v;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
  flush();
}

const pickerEl = (): HTMLElement | null =>
  mounted!.host.querySelector('[role="dialog"][aria-label="Glaser"]');
const verbs = (): string[] =>
  Array.from(pickerEl()!.querySelectorAll<HTMLElement>("[data-verb]"), (li) => li.dataset["verb"]!);

function type(text: string): void {
  const input = pickerEl()!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}
function key(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  flush();
}

describe("mrbavio.glaser in the shell", () => {
  test("the manifest declares what the entry registers", () => {
    expect(manifest.id).toBe("mrbavio.glaser");
    expect(manifest.contributes?.overlays).toEqual(["caption", "picker"]);
    expect(manifest.contributes?.commands).toEqual(["mrbavio.glaser.pick", "mrbavio.glaser.cancel", "mrbavio.glaser.end-session"]);
    expect(manifest.contributes?.shortcuts).toEqual({ "Mod+P": "mrbavio.glaser.pick", Escape: "mrbavio.glaser.cancel" });
    expect(manifest.contributes?.itemActions).toEqual(["adopt"]);
    expect(manifest.contributes?.tools).toContain(PICK_TOOL);
    expect(manifest.unstable).toBeUndefined();
  });

  test("⌘P on a selection opens the picker beside it; a verb chosen writes the pick and captions the target; the agent takes it; a landing ends it", async () => {
    const doc = fixtureDocument();
    const viewport = doc.items[0] as DreamViewport;
    const grid = fixtureRoot(doc).children[0]!.children[0]!.id;
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });

    // Nothing selected: the picker declines.
    expect(run("mrbavio.glaser.pick")).toBe(false);
    expect(pickerEl()).toBeNull();

    select(grid);
    key(document.body, { key: "p", metaKey: true });
    await settle();
    expect(pickerEl()).not.toBeNull();
    expect(pickerEl()!.closest("[data-plugin-overlay-slot]")!.getAttribute("data-plugin-overlay-slot")).toBe("overlay.interactive");
    expect(verbs()).toEqual([
      "bolder", "quieter", "typeset", "layout", "colorize", "delight",
      "distill", "polish", "clarify", "animate", "adapt", "end session",
    ]);
    expect(document.activeElement).toBe(pickerEl()!.querySelector("input"));

    type("bold");
    expect(verbs()).toEqual(["bolder"]);
    key(pickerEl()!.querySelector("input")!, { key: "Enter" });
    await settle();
    expect(pickerEl()).toBeNull();

    const waiting = await stored(files, 1);
    expect(waiting).toMatchObject({
      seq: 1,
      exit: false,
      pick: { verb: "bolder", viewportId: viewport.id, elementId: grid },
    });
    await settle();
    expect(caption()!.textContent).toBe("bolder · waiting for an agent");
    expect(caption()!.dataset["phase"]).toBe("waiting");

    // The agent takes it: the pick is answered once and cleared.
    const taken = (await pickTool().run({})) as { pick: unknown; exit: boolean };
    expect(taken).toMatchObject({ pick: { verb: "bolder", elementId: grid }, exit: false });
    expect(await stored(files, 2)).toMatchObject({ pick: null, exit: false });
    await settle();
    expect(caption()!.textContent).toBe("bolder · building");
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: null, exit: false });

    // A variants round: an unrelated landing changes nothing; each variant
    // that lands counts against the marker's `of`; the third ends it.
    mounted.store.landItems([fixtureDocument().items[0]!]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · building");
    mounted.store.landItems([variantOf(viewport, "bolder", 1, 3)]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · 1 of 3");
    mounted.store.landItems([variantOf(viewport, "bolder", 2, 3)]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · 2 of 3");
    mounted.store.landItems([variantOf(viewport, "bolder", 3, 3)]);
    await settle();
    expect(caption()).toBeNull();
  });

  test("an in-place round stays building through unrelated edits and ends when the source's page changes; glaser_done ends any round", async () => {
    const doc = fixtureDocument();
    const viewport = doc.items[0] as DreamViewport;
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });

    select(viewport.payload.root.id);
    run("mrbavio.glaser.pick");
    await settle();
    pickerEl()!.querySelector<HTMLElement>('[data-verb="polish"]')!.click();
    await settle();
    await pickTool().run({});
    await settle();
    expect(caption()!.textContent).toBe("polish · building");

    // A move of the source and a landing elsewhere are not the rework.
    mounted.store.setDocument((d) => {
      d.items[0]!.position = { x: 40, y: 40 };
    });
    mounted.store.landItems([fixtureDocument().items[0]!]);
    await settle();
    expect(caption()!.textContent).toBe("polish · building");
    // The source's page changing is.
    mounted.store.setDocument((d) => {
      (d.items[0] as DreamViewport).payload.root.children[0]!.styles["background"] = "papayawhip";
    });
    await settle();
    expect(caption()).toBeNull();

    // glaser_done: the agent's word ends a round the canvas cannot see the
    // end of (a round that stopped short).
    run("mrbavio.glaser.pick");
    await settle();
    pickerEl()!.querySelector<HTMLElement>('[data-verb="bolder"]')!.click();
    await settle();
    await pickTool().run({});
    mounted.store.landItems([variantOf(viewport, "bolder", 1, 3)]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · 1 of 3");
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });
    await settle();
    expect(caption()).toBeNull();
  });

  test("the whole page is the target when the viewport item is selected; Escape closes the picker, then cancels a waiting pick; end session from the picker writes exit", async () => {
    const doc = fixtureDocument();
    const viewport = doc.items[0] as DreamViewport;
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });

    select(viewport.payload.root.id);
    expect(run("mrbavio.glaser.pick")).toBe(true);
    await settle();
    // Escape in the field closes the picker and picks nothing.
    key(pickerEl()!.querySelector("input")!, { key: "Escape" });
    await settle();
    expect(pickerEl()).toBeNull();
    expect(files[manifest.id]).toBeUndefined();

    run("mrbavio.glaser.pick");
    await settle();
    pickerEl()!.querySelector<HTMLElement>('[data-verb="polish"]')!.click();
    await settle();
    expect(await stored(files, 1)).toMatchObject({ pick: { verb: "polish", viewportId: viewport.id, elementId: null } });
    expect(caption()!.textContent).toBe("polish · waiting for an agent");

    expect(run("mrbavio.glaser.cancel")).toBe(true);
    expect(await stored(files, 2)).toMatchObject({ pick: null, exit: false });
    await settle();
    expect(caption()).toBeNull();
    expect(run("mrbavio.glaser.cancel")).toBe(false); // nothing to cancel

    run("mrbavio.glaser.pick");
    await settle();
    pickerEl()!.querySelector<HTMLElement>('[data-verb="end session"]')!.click();
    expect(await stored(files, 3)).toMatchObject({ pick: null, exit: true });
    expect((await pickTool().run({})) as unknown).toEqual({ pick: null, exit: true });
    expect(await stored(files, 4)).toMatchObject({ exit: false });
  });

  test("a waiting pick survives a reload; exit does not", async () => {
    const doc = fixtureDocument();
    const viewport = doc.items[0] as DreamViewport;
    const grid = fixtureRoot(doc).children[0]!.children[0]!.id;
    const { host } = fakeHost({
      [manifest.id]: {
        [SESSION_KEY]: { seq: 7, exit: true, pick: { verb: "typeset", viewportId: viewport.id, elementId: grid, at: 1 } },
      },
    });
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: { verb: "typeset" }, exit: false });
  });

  test("a variant is titled from its marker and the source's shown name, whatever the agent called it", async () => {
    const doc = fixtureDocument();
    const source = doc.items[0] as DreamViewport;
    source.payload.root.label = "Pricing";
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host: fakeHost().host });
    await settle();
    // The agent copied the root, label included, and gave a stale base title.
    const v = variantOf(source, "bolder", 2, 3);
    v.payload.root.label = "Pricing";
    v.payload.meta!.title = "Pricing · delight 1/3 · bolder 2/3";
    mounted.store.landItems([v]);
    await settle();
    const landed = mounted.store.document.items.find((i) => i.id === v.id) as DreamViewport;
    expect(landed.payload.root.label).toBe("Pricing · bolder 2/3");
    expect(landed.payload.meta?.title).toBe("Pricing · bolder 2/3");
    expect(landed.payload.meta?.notes).toBe(v.payload.meta!.notes); // the marker stays
    const bars = Array.from(mounted.host.querySelectorAll("[class*='bar'] span")).map((s) => s.textContent);
    expect(bars).toContain("Pricing · bolder 2/3");
    // A variant of a variant chains from its own source's shown name.
    const ok = variantOf(landed, "layout", 1, 1);
    mounted.store.landItems([ok]);
    await settle();
    expect((mounted.store.document.items.find((i) => i.id === ok.id) as DreamViewport).payload.root.label).toBe("Pricing · bolder 2/3 · layout 1/1");
  });

  test("adopt sits in a variant's title bar: its page replaces the source, the round is removed, one undo step", async () => {
    const doc: DreamDocument = fixtureDocument();
    const source = doc.items[0] as DreamViewport;
    source.payload.meta = { title: "Pricing" };
    const variants = [1, 2, 3].map((n) => variantOf(source, "bolder", n, 3));
    doc.items.push(...variants);
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host: fakeHost().host });
    await settle();

    const buttons = Array.from(mounted.host.querySelectorAll<HTMLElement>('[data-item-action="mrbavio.glaser:adopt"]'));
    expect(buttons.length).toBe(3); // the source carries none
    expect(buttons.map((b) => b.textContent)).toEqual(["adopt", "adopt", "adopt"]);
    // The second variant's bar: the bars come in item order.
    buttons[1]!.click();
    flush();

    const items = mounted.store.document.items;
    expect(items.map((i) => i.id)).toEqual([source.id]);
    const adopted = items[0] as DreamViewport;
    expect(adopted.payload.meta).toEqual({ title: "Pricing" });
    expect(adopted.payload.root.children[0]!.styles["background"]).toBe("rgb(2, 0, 0)");
    expect(adopted.payload.root.id).toBe(variants[1]!.payload.root.id);
    expect(mounted.store.selectedId()).toBe(adopted.payload.root.id);

    // One undo step brings the fan back.
    mounted.kernel.commands.runCommand("core.undo");
    flush();
    expect(mounted.store.document.items.length).toBe(4);
  });
});
