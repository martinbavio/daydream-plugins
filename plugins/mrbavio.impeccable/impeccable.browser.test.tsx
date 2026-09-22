// The browser part through the loader seam: the real shell, the plugin
// enabled by config. What a person does on the canvas — pick a verb on
// the selection, watch the caption, cancel, end — and what an agent does
// through the tab — take the pick — meet in the storage file the fake
// host holds; and adopting a variant folds it into its source as one undo
// step. Every viewport is a page (decision #76): an element is selected by
// the id its mount stamped, and a pick names it by selector.
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  DreamDocument,
  DreamPage,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  createPageItem,
  createTestRequestHandlers,
  fixturePage,
  flush,
  mountPlugin,
  pageElementId,
  pageFixtureDocument,
  pageNode,
  pageShadow,
  type Host,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import activate, { DONE_TOOL, HTML_TOOL, PICK_TOOL } from "./index";
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
  mounted!.overlay()!.querySelector(".impeccable-caption");

function select(id: string | null): void {
  mounted!.store.setSelectedId(id);
  flush();
}
const run = (id: string): boolean => mounted!.kernel.commands.runCommand(id);
const tool = (name: string) =>
  mounted!.kernel.registry.tools.entries().find((e) => e.value.name === name)!.value;
const pickTool = () => tool(PICK_TOOL);

/** The render-time id of the element `selector` names in a page, once the
 * page has mounted. */
async function mountedId(itemId: string, selector: string): Promise<string> {
  let id: string | null = null;
  await vi.waitFor(() => {
    id = pageElementId(itemId, selector);
    expect(id).not.toBeNull();
  });
  return id!;
}

/** A page with a background of its own, for telling pages apart. */
function page(background: string, meta?: DreamPage["payload"]["meta"]): DreamPage {
  const item = fixturePage(pageFixtureDocument());
  item.payload.css += `body { background: ${background}; }\n`;
  if (meta === undefined) delete item.payload.meta;
  else item.payload.meta = meta;
  return item;
}

/** A one-page document whose page is titled `title`. */
function sourceDocument(title = "Pricing"): { doc: DreamDocument; source: DreamPage } {
  const doc = pageFixtureDocument();
  const source = fixturePage(doc);
  source.payload.meta = { title };
  return { doc, source };
}

/** A variant of `source` for `verb`, `n` of `of`, as an agent lands it. */
function variantOf(source: DreamPage, verb: string, n: number, of: number): DreamPage {
  const v = page(`rgb(${n}, 0, 0)`, {
    title: `${source.payload.meta?.title ?? "Untitled"} · ${verb} ${n}/${of}`,
    notes: `${variantMarker({ verb, n, of, sourceId: source.id })}\n\nDirection ${n}.`,
  });
  v.position = { x: 1000 * n, y: 0 };
  return v;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
  flush();
}

const pickerEl = (): HTMLElement | null =>
  mounted!.host.querySelector('[role="dialog"][aria-label="Impeccable"]');
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

/** Pick `verb` from the picker on the current selection. */
async function pickVerb(verb: string): Promise<void> {
  run("mrbavio.impeccable.pick");
  await settle();
  pickerEl()!.querySelector<HTMLElement>(`[data-verb="${verb}"]`)!.click();
  await settle();
}

describe("mrbavio.impeccable in the shell", () => {
  test("the manifest declares what the entry registers", () => {
    expect(manifest.id).toBe("mrbavio.impeccable");
    expect(manifest.contributes?.overlays).toEqual(["caption", "picker"]);
    expect(manifest.contributes?.commands).toEqual(["mrbavio.impeccable.pick", "mrbavio.impeccable.cancel", "mrbavio.impeccable.end-session"]);
    expect(manifest.contributes?.shortcuts).toEqual({ "Mod+P": "mrbavio.impeccable.pick", Escape: "mrbavio.impeccable.cancel" });
    expect(manifest.contributes?.itemActions).toEqual(["adopt"]);
    expect(manifest.contributes?.tools).toContain(PICK_TOOL);
    expect(manifest.unstable).toBeUndefined();
  });

  test("⌘P on a page element opens the picker beside it; a verb chosen writes the pick by selector and captions the element; the agent takes it; a landing ends it", async () => {
    const { doc, source } = sourceDocument();
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    const grid = await mountedId(source.id, ".grid");

    // Nothing selected: the picker declines.
    expect(run("mrbavio.impeccable.pick")).toBe(false);
    expect(pickerEl()).toBeNull();

    select(grid);
    key(document.body, { key: "p", metaKey: true });
    await settle();
    expect(pickerEl()).not.toBeNull();
    expect(pickerEl()!.closest("[data-plugin-overlay-slot]")!.getAttribute("data-plugin-overlay-slot")).toBe("overlay.interactive");
    expect(verbs()).toEqual([
      "bolder", "quieter", "typeset", "layout", "colorize", "delight",
      "distill", "polish", "clarify", "animate", "adapt", "critique", "audit", "end session",
    ]);
    expect(document.activeElement).toBe(pickerEl()!.querySelector("input"));
    // Beside the element, not the viewport: to the right of the grid's box.
    const gridBox = pageNode(source.id, ".grid")!.getBoundingClientRect();
    const pickerBox = pickerEl()!.getBoundingClientRect();
    expect(pickerBox.left).toBeGreaterThanOrEqual(gridBox.right);
    expect(Math.abs(pickerBox.top - gridBox.top)).toBeLessThan(2);

    type("bold");
    expect(verbs()).toEqual(["bolder"]);
    // Tab completes the word to the highlighted verb, caret after a space.
    key(pickerEl()!.querySelector("input")!, { key: "Tab" });
    expect(pickerEl()!.querySelector("input")!.value).toBe("bolder ");
    expect(verbs()).toEqual(["bolder"]);
    // Tab with a brief already typed keeps it; on a fresh field with
    // nothing matched it does nothing.
    type("qui but keep the photo");
    key(pickerEl()!.querySelector("input")!, { key: "Tab" });
    expect(pickerEl()!.querySelector("input")!.value).toBe("quieter but keep the photo");
    type("zzz");
    key(pickerEl()!.querySelector("input")!, { key: "Tab" });
    expect(pickerEl()!.querySelector("input")!.value).toBe("zzz");
    // The rest of the line is the brief; the list stays pinned to the
    // verb, and nothing echoes the field.
    type("bolder keep the photo, louder CTA");
    expect(verbs()).toEqual(["bolder"]);
    expect(pickerEl()!.querySelector(".impeccable-picker-brief")).toBeNull();
    key(pickerEl()!.querySelector("input")!, { key: "Enter" });
    await settle();
    expect(pickerEl()).toBeNull();

    // The pick names the element by its selector in the page — what
    // get_viewport and the draft tools take — never by the mount's id.
    const waiting = await stored(files, 1);
    expect(waiting).toMatchObject({
      seq: 1,
      exit: false,
      pick: { verb: "bolder", viewportId: source.id, element: "div.grid", brief: "keep the photo, louder CTA" },
    });
    expect(JSON.stringify(waiting)).not.toContain(grid);
    await settle();
    expect(caption()!.textContent).toBe("bolder · waiting for an agent");
    expect(caption()!.dataset["phase"]).toBe("waiting");
    // Above the element.
    expect(caption()!.getBoundingClientRect().bottom).toBeLessThanOrEqual(gridBox.top + 1);

    // The agent takes it: the pick is answered once and cleared.
    const taken = (await pickTool().run({})) as { pick: unknown; exit: boolean };
    expect(taken).toMatchObject({ pick: { verb: "bolder", element: "div.grid", brief: "keep the photo, louder CTA" }, exit: false });
    expect(await stored(files, 2)).toMatchObject({ pick: null, exit: false });
    await settle();
    expect(caption()!.textContent).toBe("bolder · building");
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: null, exit: false });

    // A variants round: an unrelated landing changes nothing; each variant
    // that lands counts against the marker's `of`; the third ends it.
    mounted.store.landItems([page("white")]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · building");
    mounted.store.landItems([variantOf(source, "bolder", 1, 3)]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · 1 of 3");
    mounted.store.landItems([variantOf(source, "bolder", 2, 3)]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · 2 of 3");
    mounted.store.landItems([variantOf(source, "bolder", 3, 3)]);
    await settle();
    expect(caption()).toBeNull();
  });

  test("the pick names an element by the same selector canvas_state answers for it, unique in the STORED markup", async () => {
    const tricky = createPageItem({
      html:
        '<!doctype html><html><head></head><body><main><section class="card"><p>a</p><p>b</p></section>' +
        '<section class="card"><p>c</p><p id="dup">d</p><p id="dup">e</p></section>' +
        '<aside id="side"><p class="note">f</p></aside></main></body></html>',
      css: "p { margin: 0; }\n",
    }, { frame: { width: 640 } });
    // An id shared with a <script>, which the mount leaves out and the
    // stored markup keeps: unique on the mount, not in the text an agent
    // resolves the selector against. (Stored as written: a landing would
    // cut the script, so it is set here past the landing.)
    const shared = createPageItem({
      html:
        '<!doctype html><html><head></head><body><script id="hero" type="text/plain">x</script>' +
        '<section id="hero"><p>a</p></section></body></html>',
      css: "",
    }, { position: { x: 800, y: 0 }, frame: { width: 640 } });
    mounted = await mountPlugin({ entry: activate, manifest, document: { version: 7, items: [tricky, shared] }, host: fakeHost().host });
    const handlers = await createTestRequestHandlers(mounted);
    await mountedId(tricky.id, "#side");
    await mountedId(shared.id, "section");
    // Every element of the body, each found by a position-based path.
    const paths = [
      "main",
      "main > section:nth-of-type(1)",
      "main > section:nth-of-type(1) > p:nth-of-type(1)",
      "main > section:nth-of-type(1) > p:nth-of-type(2)",
      "main > section:nth-of-type(2)",
      "main > section:nth-of-type(2) > p:nth-of-type(1)",
      "main > section:nth-of-type(2) > p:nth-of-type(2)",
      "main > section:nth-of-type(2) > p:nth-of-type(3)",
      "main > aside",
      "main > aside > p",
    ];
    expect(pageNode(tricky.id, "body")!.querySelectorAll("*").length).toBe(paths.length);
    const cases = [
      ...paths.map((path) => ({ page: tricky, path })),
      { page: shared, path: "section" },
    ];
    for (const { page, path } of cases) {
      select(pageElementId(page.id, path));
      // canvas_state, as the bridge asks the tab for it.
      const state = (await handlers.state(undefined)) as {
        selection: { selector?: string } | null;
      };
      const expected = state.selection?.selector;
      expect(expected).toBeDefined();
      await pickVerb("bolder");
      const taken = (await pickTool().run({})) as { pick: { element: string } };
      expect(taken.pick.element).toBe(expected);
      // …and it names that element alone in the stored markup.
      const stored = new DOMParser().parseFromString(page.payload.html, "text/html");
      expect(stored.querySelectorAll(expected!).length).toBe(1);
      await tool(DONE_TOOL).run({});
    }
    // The script's id is not the section's name, though the mount has one
    // #hero.
    expect(pageShadow(shared.id)!.querySelectorAll("#hero").length).toBe(1);
    select(pageElementId(shared.id, "section"));
    await pickVerb("bolder");
    expect(((await pickTool().run({})) as { pick: { element: string } }).pick.element).not.toBe("#hero");
  });

  test("an in-place round stays building through unrelated edits and ends when the source's page changes; impeccable_done ends any round", async () => {
    const { doc, source } = sourceDocument();
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    await mountedId(source.id, ".grid");

    select(source.id);
    await pickVerb("polish");
    await pickTool().run({});
    await settle();
    expect(caption()!.textContent).toBe("polish · building");

    // A move of the source, a meta edit and a landing elsewhere are not
    // the rework.
    mounted.store.setDocument((d) => {
      d.items[0]!.position = { x: 40, y: 40 };
      (d.items[0] as DreamPage).payload.meta = { title: "Pricing, renamed" };
    });
    mounted.store.landItems([page("white")]);
    await settle();
    expect(caption()!.textContent).toBe("polish · building");
    // The source's page changing is — a css write here.
    mounted.store.setDocument((d) => {
      (d.items[0] as DreamPage).payload.css += "body { background: papayawhip; }\n";
    });
    await settle();
    expect(caption()).toBeNull();

    // impeccable_done: the agent's word ends a round the canvas cannot see the
    // end of (a round that stopped short).
    await pickVerb("bolder");
    await pickTool().run({});
    mounted.store.landItems([variantOf(source, "bolder", 1, 3)]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · 1 of 3");
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });
    await settle();
    expect(caption()).toBeNull();
  });

  test("a caption finds its element again by selector after a remount; one the selector no longer names alone moves to the page's corner", async () => {
    const { doc, source } = sourceDocument();
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    const before = await mountedId(source.id, ".header");
    select(before);
    await pickVerb("typeset");
    // On the element: flush with its left edge, above it. In the corner:
    // 8px in from the page's own left edge, which the body's 24px padding
    // puts well left of the header.
    const onElement = (selector = ".header") => {
      const header = pageNode(source.id, selector)!.getBoundingClientRect();
      const box = caption()!.getBoundingClientRect();
      return Math.abs(box.left - header.left) < 1 && box.bottom <= header.top + 1;
    };
    expect(onElement()).toBe(true);
    // A css write restyles in place: same nodes, same ids.
    mounted.store.setDocument((d) => {
      (d.items[0] as DreamPage).payload.css += ".header { min-height: 80px; }\n";
    });
    await settle();
    expect(onElement()).toBe(true);
    // A markup write remounts: the element's id is gone, the pick keeps
    // its selector, and the caption finds the element by it.
    mounted.store.setDocument((d) => {
      const p = d.items[0] as DreamPage;
      p.payload.html = p.payload.html.replace("<body>", '<body><p>Intro</p>');
    });
    await vi.waitFor(() => expect(pageElementId(source.id, ".header")).not.toBe(before));
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    expect(onElement()).toBe(true);
    // A second div.header: the selector names neither alone, and the
    // caption goes inside the page's top-left corner.
    mounted.store.setDocument((d) => {
      const p = d.items[0] as DreamPage;
      p.payload.html = p.payload.html.replace("</body>", '<div class="header"></div></body>');
    });
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    expect(onElement(".grid > .header")).toBe(false);
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: { verb: "typeset", element: "div.header" } });
  });

  test("the whole page is the target when the viewport item is selected; Escape closes the picker, then cancels a waiting pick; end session from the picker writes exit", async () => {
    const { doc, source } = sourceDocument();
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    await mountedId(source.id, ".grid");

    select(source.id);
    expect(run("mrbavio.impeccable.pick")).toBe(true);
    await settle();
    // Escape in the field closes the picker and picks nothing.
    key(pickerEl()!.querySelector("input")!, { key: "Escape" });
    await settle();
    expect(pickerEl()).toBeNull();
    expect(files[manifest.id]).toBeUndefined();

    await pickVerb("polish");
    const polished = await stored(files, 1);
    expect(polished).toMatchObject({ pick: { verb: "polish", viewportId: source.id, element: null } });
    expect((polished["pick"] as { brief?: string }).brief).toBeUndefined();
    expect(caption()!.textContent).toBe("polish · waiting for an agent");

    expect(run("mrbavio.impeccable.cancel")).toBe(true);
    expect(await stored(files, 2)).toMatchObject({ pick: null, exit: false });
    await settle();
    expect(caption()).toBeNull();
    expect(run("mrbavio.impeccable.cancel")).toBe(false); // nothing to cancel

    await pickVerb("end session");
    expect(await stored(files, 3)).toMatchObject({ pick: null, exit: true });
    expect((await pickTool().run({})) as unknown).toEqual({ pick: null, exit: true });
    expect(await stored(files, 4)).toMatchObject({ exit: false });
  });

  test("a waiting pick survives a reload, captioned above its element, found by selector; exit does not", async () => {
    const { doc, source } = sourceDocument();
    const { host } = fakeHost({
      [manifest.id]: {
        [SESSION_KEY]: { seq: 7, exit: true, pick: { verb: "typeset", viewportId: source.id, element: ".header", at: 1 } },
      },
    });
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    await mountedId(source.id, ".header");
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    const header = pageNode(source.id, ".header")!.getBoundingClientRect();
    const box = caption()!.getBoundingClientRect();
    expect(Math.abs(box.left - header.left)).toBeLessThan(1);
    expect(box.bottom).toBeLessThanOrEqual(header.top + 1);
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: { verb: "typeset", element: ".header" }, exit: false });
  });

  test("a pick saved before pages, naming its element by id, is dropped with a console note and cleared from the file", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { doc, source } = sourceDocument();
      const { host, files } = fakeHost({
        [manifest.id]: {
          [SESSION_KEY]: { seq: 3, exit: false, pick: { verb: "typeset", viewportId: source.id, elementId: "el_4", at: 1 } },
        },
      });
      mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
      await settle();
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/^\[mrbavio\.impeccable\] a waiting pick saved before pages/));
      expect(await stored(files, 4)).toMatchObject({ pick: null, exit: false });
      expect((await pickTool().run({})) as unknown).toMatchObject({ pick: null });
    } finally {
      info.mockRestore();
    }
  });

  test("a variant is titled from its marker and the source's title, whatever the agent called it", async () => {
    const { doc, source } = sourceDocument("Pricing");
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host: fakeHost().host });
    await settle();
    // The agent gave a stale base title.
    const v = variantOf(source, "bolder", 2, 3);
    v.payload.meta!.title = "Pricing · delight 1/3 · bolder 2/3";
    mounted.store.landItems([v]);
    await settle();
    const landed = mounted.store.document.items.find((i) => i.id === v.id) as DreamPage;
    expect(landed.payload.meta?.title).toBe("Pricing · bolder 2/3");
    expect(landed.payload.meta?.notes).toBe(v.payload.meta!.notes); // the marker stays
    expect(landed.payload.html).toBe(v.payload.html); // the page is not touched
    const bars = Array.from(mounted.host.querySelectorAll("[class*='bar'] span")).map((s) => s.textContent);
    expect(bars).toContain("Pricing · bolder 2/3");
    // A variant of a variant chains from its own source's title.
    const ok = variantOf(landed, "layout", 1, 1);
    mounted.store.landItems([ok]);
    await settle();
    expect((mounted.store.document.items.find((i) => i.id === ok.id) as DreamPage).payload.meta?.title).toBe(
      "Pricing · bolder 2/3 · layout 1/1",
    );
  });

  test("impeccable_html renders the page as one standalone file, pruned to a selector's element; a report verb captions as reviewing", async () => {
    const { doc, source } = sourceDocument();
    // A bundle-relative image and background: the mount points them at
    // this host's route, and the export makes that absolute.
    source.payload.html = source.payload.html.replace(
      '<div class="footer"></div>',
      '<div class="footer"><img src="assets/logo.png" srcset="assets/logo.png 1x, https://cdn.test/w_200,h_100/logo.png 2x" alt=""></div>',
    );
    source.payload.css += ".aside { background-image: url(assets/bg.png); }\n";
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host });
    const reply = (await tool(HTML_TOOL).run({ viewport: source.id })) as { viewportId: string; html: string; bytes: number };
    expect(reply.viewportId).toBe(source.id);
    expect(reply.html.startsWith("<!doctype html>")).toBe(true);
    expect(reply.html).toContain("<style>");
    expect(reply.html).toContain("</body></html>");
    expect(reply.bytes).toBe(reply.html.length);
    const origin = window.location.origin;
    expect(reply.html).toMatch(new RegExp(`src="${origin}/[^"]*logo\\.png"`));
    expect(reply.html).toMatch(new RegExp(`url\\(["']?${origin}/[^)]*bg\\.png`));
    // Each srcset candidate; a url holding a comma is one url, kept whole.
    const srcset = new DOMParser().parseFromString(reply.html, "text/html").querySelector("img")!.getAttribute("srcset")!;
    expect(srcset).toMatch(new RegExp(`^${origin}/\\S*logo\\.png 1x, https://cdn\\.test/w_200,h_100/logo\\.png 2x$`));
    expect(reply.html).not.toMatch(/(src|href)="\/(?!\/)/);
    // The mount is gone once read: no live iframe left behind.
    await settle();
    expect(document.querySelectorAll("iframe").length).toBe(0);
    await expect(tool(HTML_TOOL).run({ viewport: "nope" })).rejects.toThrow(/no viewport/);
    // With an element: the page is pruned to it — its subtree, its
    // ancestors, the style block — and the subtree is marked.
    const pruned = (await tool(HTML_TOOL).run({ viewport: source.id, element: ".grid" })) as {
      html: string;
      target?: { selector: string; kept: number; pruned: number };
    };
    expect(pruned.target).toMatchObject({ selector: ".grid", kept: 5 }); // the grid, three boxes, the image
    const page = new DOMParser().parseFromString(pruned.html, "text/html");
    expect(page.querySelector("style")).not.toBeNull();
    expect(page.querySelectorAll("[data-impeccable-target]").length).toBe(5);
    const gridNode = page.querySelector(".grid")!;
    expect(gridNode.hasAttribute("data-impeccable-target")).toBe(true);
    // Every element left is an ancestor of the target or inside it.
    for (const el of page.body.querySelectorAll("*")) {
      expect(el.contains(gridNode) || gridNode.contains(el)).toBe(true);
    }
    expect(page.body.hasAttribute("data-impeccable-target")).toBe(false);
    // A deeper target prunes its siblings: the header alone of the grid.
    const header = (await tool(HTML_TOOL).run({ viewport: source.id, element: ".grid > .header" })) as {
      html: string;
      target: { kept: number; pruned: number };
    };
    expect(header.target).toMatchObject({ kept: 1, pruned: 2 });
    expect(new DOMParser().parseFromString(header.html, "text/html").querySelector(".aside")).toBeNull();
    // A selector matching none, several, or nothing the browser takes.
    await expect(tool(HTML_TOOL).run({ viewport: source.id, element: ".nope" })).rejects.toThrow(/no element matches "\.nope"/);
    await expect(tool(HTML_TOOL).run({ viewport: source.id, element: ".grid > div" })).rejects.toThrow(/matches 3 elements/);
    await expect(tool(HTML_TOOL).run({ viewport: source.id, element: "!!" })).rejects.toThrow(/refused/);

    select(source.id);
    await pickVerb("audit");
    expect(caption()!.textContent).toBe("audit · waiting for an agent");
    await pickTool().run({});
    await settle();
    expect(caption()!.textContent).toBe("audit · reviewing");
    await tool(DONE_TOOL).run({});
    await settle();
    expect(caption()).toBeNull();
  });

  test("adopt sits in a variant's title bar: its page replaces the source's, the source keeps its meta, the round is removed, one undo step", async () => {
    const { doc, source } = sourceDocument("Pricing");
    const variants = [1, 2, 3].map((n) => variantOf(source, "bolder", n, 3));
    doc.items.push(...variants);
    mounted = await mountPlugin({ entry: activate, manifest, document: doc, host: fakeHost().host });
    await settle();

    const buttons = Array.from(mounted.host.querySelectorAll<HTMLElement>('[data-item-action="mrbavio.impeccable:adopt"]'));
    expect(buttons.length).toBe(3); // the source carries none
    expect(buttons.map((b) => b.textContent)).toEqual(["adopt", "adopt", "adopt"]);
    // The second variant's bar: the bars come in item order.
    buttons[1]!.click();
    flush();

    const items = mounted.store.document.items;
    expect(items.map((i) => i.id)).toEqual([source.id]);
    const adopted = items[0] as DreamPage;
    expect(adopted.payload).toEqual({
      html: variants[1]!.payload.html,
      css: variants[1]!.payload.css,
      meta: { title: "Pricing" },
    });
    expect(adopted.payload.css).toContain("rgb(2, 0, 0)");
    // The source is selected whole; its page renders the variant's.
    expect(mounted.store.selectedId()).toBe(source.id);
    await vi.waitFor(() =>
      expect(getComputedStyle(pageNode(source.id, "body")!).backgroundColor).toBe("rgb(2, 0, 0)"),
    );

    // One undo step brings the fan back.
    mounted.kernel.commands.runCommand("core.undo");
    flush();
    expect(mounted.store.document.items.length).toBe(4);
  });
});
