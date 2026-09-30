// The browser part through the loader seam: the real shell, the plugin
// enabled by config. What a person does on the canvas — pick a verb on
// the selection, watch the caption, cancel, end — and what an agent does
// through the tab — take the pick, end the round, export a page — meet in
// the storage file the fake host holds. Every viewport shows a page of the
// project (decision #78): an element is selected by the id its mount
// stamped, and a pick names it by selector. A page's text changes only
// when the project is read again, so an edit here is a project load with
// the page's file changed.
import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest";

import type { DaydreamApi, DreamItem, DreamPage, DreamViewport, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestRequestHandlers,
  fixturePage,
  flush,
  mountPlugin,
  pageElementId,
  pageFixtureProject,
  pageNode,
  pageShadow,
  testProject,
  type Host,
  type MountedPlugin,
  type TestProject,
} from "@daydream/plugin-testing";

import activate, { DONE_TOOL, HTML_TOOL, PICK_TOOL } from "./index";
import rawManifest from "./manifest.json";
import { SESSION_KEY } from "./session";

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

/** The page fixture's project, its viewport and the page it shows. */
function sourceProject(): { project: TestProject; source: DreamViewport; page: DreamPage } {
  const project = pageFixtureProject();
  const source = fixturePage(project);
  return { project, source, page: project.pages.find((p) => p.path === source.payload.page)! };
}

/** A project of one viewport, 640 wide, showing a page of `html` (and
 * `css`, its linked sheet). */
function oneViewport(html: string, css = ""): { project: TestProject; item: DreamViewport } {
  const made = createPageItem({ html, css }, { frame: { width: 640 } });
  return { project: testProject([made]), item: made.item };
}

/** The project read again with the text of the page at `path` changed —
 * the page's file edited, and the project loaded (decision #78). */
function reloadWith(project: TestProject, path: string, edit: (html: string) => string): void {
  const page = project.pages.find((p) => p.path === path)!;
  page.html = edit(page.html);
  mounted!.store.loadProject(structuredClone(project));
  flush();
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
    // No `adopt`: a variant is accepted or discarded by the kernel's own
    // words in its title bar (Phase 9), and the plugin adds none beside them.
    expect(manifest.contributes?.itemActions).toBeUndefined();
    expect(manifest.contributes?.tools).toContain(PICK_TOOL);
    expect(manifest.unstable).toBeUndefined();
  });

  test("⌘P on a page element opens the picker beside it; a verb chosen writes the pick by selector and captions the element; the agent takes it and ends the round", async () => {
    const { project, source } = sourceProject();
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
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
    // No round id: a finalized variant carries nothing of the plugin's to
    // read one back from (the caption counts the round's variants instead).
    expect(waiting["pick"]).not.toHaveProperty("round");
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

    // A page of the project landing meanwhile is no variant of the
    // source's page, so it is not the round's (variants.browser.test.tsx
    // counts those); the round stopped short ends at the agent's word.
    mounted.store.landItems([createPageItem({ html: "<!doctype html><html><body></body></html>" }, { position: { x: 1200, y: 0 } }).item]);
    await settle();
    expect(caption()!.textContent).toBe("bolder · building");
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });
    await settle();
    expect(caption()).toBeNull();
    // And the plugin puts no word of its own on any title bar.
    expect(mounted.host.querySelectorAll('[data-item-action^="mrbavio.impeccable"]').length).toBe(0);
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
    // page's file keeps: unique on the mount, not in the text an agent
    // resolves the selector against.
    const shared = createPageItem({
      html:
        '<!doctype html><html><head></head><body><script id="hero" type="text/plain">x</script>' +
        '<section id="hero"><p>a</p></section></body></html>',
      css: "",
    }, { position: { x: 800, y: 0 }, frame: { width: 640 } });
    mounted = await mountPlugin({ entry: activate, manifest, project: testProject([tricky, shared]), host: fakeHost().host });
    const handlers = await createTestRequestHandlers(mounted);
    await mountedId(tricky.item.id, "#side");
    await mountedId(shared.item.id, "section");
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
    expect(pageNode(tricky.item.id, "body")!.querySelectorAll("*").length).toBe(paths.length);
    const cases = [
      ...paths.map((path) => ({ page: tricky, path })),
      { page: shared, path: "section" },
    ];
    for (const { page, path } of cases) {
      select(pageElementId(page.item.id, path));
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
      const stored = new DOMParser().parseFromString(page.page.html, "text/html");
      expect(stored.querySelectorAll(expected!).length).toBe(1);
      await tool(DONE_TOOL).run({});
    }
    // The script's id is not the section's name, though the mount has one
    // #hero.
    expect(pageShadow(shared.item.id)!.querySelectorAll("#hero").length).toBe(1);
    select(pageElementId(shared.item.id, "section"));
    await pickVerb("bolder");
    expect(((await pickTool().run({})) as { pick: { element: string } }).pick.element).not.toBe("#hero");
  });

  test("a round is building until impeccable_done: a move of its source and a new text of its page are not its end; a report verb reviews", async () => {
    const { project, source } = sourceProject();
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    await mountedId(source.id, ".grid");

    select(source.id);
    await pickVerb("polish");
    await pickTool().run({});
    await settle();
    expect(caption()!.textContent).toBe("polish · building");

    // A move of the source is not the rework, and neither is its page's
    // file read again changed: the agent writes the rework to the files,
    // where the canvas cannot tell it from any other change.
    mounted.store.setDocument((d) => {
      d.canvases[0]!.items[0]!.position = { x: 40, y: 40 };
    });
    await settle();
    expect(caption()!.textContent).toBe("polish · building");
    reloadWith(project, source.payload.page, (html) => html.replace("<body>", "<body><p>Reworked</p>"));
    await settle();
    expect(caption()!.textContent).toBe("polish · building");
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });
    await settle();
    expect(caption()).toBeNull();
    // impeccable_done with nothing building changes nothing.
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });

    // The load cleared the selection.
    select(source.id);
    await pickVerb("critique");
    await pickTool().run({});
    await settle();
    expect(caption()!.textContent).toBe("critique · reviewing");
    await tool(DONE_TOOL).run({});
    await settle();
    expect(caption()).toBeNull();
  });

  test("a caption finds its element again by selector after a remount; one the selector no longer names alone moves to the page's corner", async () => {
    const { project, source } = sourceProject();
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
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
    // A new text of the page remounts it: the element's id is gone, the
    // pick keeps its selector, and the caption finds the element by it.
    reloadWith(project, source.payload.page, (html) => html.replace("<body>", "<body><p>Intro</p>"));
    await vi.waitFor(() => expect(pageElementId(source.id, ".header")).not.toBe(before));
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    expect(onElement()).toBe(true);
    // Taken, and a second div.header written while it builds: the
    // selector names neither alone, and the caption goes inside the
    // page's top-left corner. (A waiting pick would be dropped there.)
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: { verb: "typeset", element: "div.header" } });
    reloadWith(project, source.payload.page, (html) => html.replace("</body>", '<div class="header"></div></body>'));
    await settle();
    expect(caption()!.textContent).toBe("typeset · building");
    expect(onElement(".grid > .header")).toBe(false);
  });

  test("a waiting pick holds its element through edits of the page; once its selector names another element, the pick is dropped with a note", async () => {
    const { project, item } = oneViewport("<!doctype html><html><head></head><body><main><p>a</p><p>b</p></main></body></html>");
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    select(await mountedId(item.id, "main > p:nth-of-type(2)"));
    await pickVerb("typeset");
    const selector = ((await stored(files, 1))["pick"] as { element: string }).element;
    const edit = (from: string, to: string): void => {
      reloadWith(project, item.payload.page, (html) => html.replace(from, to));
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // After it, and inside it: the selector still names it.
      edit("</main>", "<p>c</p></main>");
      await settle();
      edit("<p>b</p>", '<p class="x">bb</p>');
      await settle();
      await vi.waitFor(() => expect(pageNode(item.id, "p.x")).not.toBeNull());
      expect(caption()!.textContent).toBe("typeset · waiting for an agent");
      expect(info).not.toHaveBeenCalled();
      expect(pageNode(item.id, selector)!.className).toBe("x");
      // A paragraph before both: the selector names "a" now.
      edit("<main>", "<main><p>new</p>");
      await settle();
      expect(pageNode(item.id, selector)!.textContent).toBe("a");
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/^\[mrbavio\.impeccable\] the waiting pick's element .* names another element since the page was edited/),
      );
      expect(await stored(files, 2)).toMatchObject({ pick: null, exit: false });
      expect((await pickTool().run({})) as unknown).toMatchObject({ pick: null });
    } finally {
      info.mockRestore();
    }
  });

  test("a pick restored from storage holds the element its selector named at the reload", async () => {
    const { project, item } = oneViewport("<!doctype html><html><head></head><body><main><p>a</p><p>b</p></main></body></html>");
    const { host, files } = fakeHost({
      [manifest.id]: {
        [SESSION_KEY]: { seq: 4, exit: false, pick: { verb: "typeset", viewportId: item.id, element: "main > p:nth-of-type(2)", at: 1 } },
      },
    });
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    await mountedId(item.id, "main > p:nth-of-type(2)");
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      reloadWith(project, item.payload.page, (html) => html.replace("<main>", "<main><p>new</p>"));
      await settle();
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/names another element since the page was edited/));
      expect(await stored(files, 5)).toMatchObject({ pick: null });
    } finally {
      info.mockRestore();
    }
  });

  test("a waiting pick whose selector names no element, or several, since an edit is dropped with a note, and no lookup runs for it after", async () => {
    const { project, item } = oneViewport('<!doctype html><html><head></head><body><main><p id="b">b</p><p class="k">k</p></main></body></html>');
    const { host, files } = fakeHost();
    let api = null as DaydreamApi | null;
    mounted = await mountPlugin({
      entry: (dd) => {
        api = dd;
        return activate(dd);
      },
      manifest,
      project,
      host,
    });
    const edit = (from: string, to: string): void => {
      reloadWith(project, item.payload.page, (html) => html.replace(from, to));
    };
    const find = vi.spyOn(api!, "pageFind");
    /** Whether anything looks the pick's element up while the canvas
     * pans, once the pick is settled. */
    const looksUp = async (): Promise<boolean> => {
      find.mockClear();
      for (let i = 0; i < 3; i++) {
        api!.geometry.invalidate();
        await settle();
      }
      return find.mock.calls.length > 0;
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // Held and unedited: nothing to look up.
      select(await mountedId(item.id, "#b"));
      await pickVerb("typeset");
      expect(((await stored(files, 1))["pick"] as { element: string }).element).toMatch(/#b/);
      expect(await looksUp()).toBe(false);

      // The id rewritten: the selector names nothing now.
      edit('id="b"', 'id="z"');
      await settle();
      await vi.waitFor(() => expect(pageNode(item.id, "#z")).not.toBeNull());
      await settle();
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/^\[mrbavio\.impeccable\] the waiting pick's element .* names no element since the page was edited, so the pick was dropped/),
      );
      expect(await stored(files, 2)).toMatchObject({ pick: null, exit: false });
      expect(await looksUp()).toBe(false);

      // A second p.k: the selector names two.
      info.mockClear();
      select(await mountedId(item.id, "p.k"));
      await pickVerb("typeset");
      expect(((await stored(files, 3))["pick"] as { element: string }).element).toMatch(/\.k/);
      edit("</main>", '<p class="k">k2</p></main>');
      await settle();
      await vi.waitFor(() => expect(pageShadow(item.id)!.querySelectorAll("p.k").length).toBe(2));
      await settle();
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/names 2 elements since the page was edited, so the pick was dropped/));
      expect(await stored(files, 4)).toMatchObject({ pick: null, exit: false });
      expect(await looksUp()).toBe(false);
      expect((await pickTool().run({})) as unknown).toMatchObject({ pick: null });
    } finally {
      info.mockRestore();
    }
  });

  test("a restored pick whose selector names several elements is dropped with a note", async () => {
    const { project, item } = oneViewport("<!doctype html><html><head></head><body><main><p>a</p><p>b</p></main></body></html>");
    const { host, files } = fakeHost({
      [manifest.id]: {
        [SESSION_KEY]: { seq: 4, exit: false, pick: { verb: "typeset", viewportId: item.id, element: "main > p", at: 1 } },
      },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      mounted = await mountPlugin({ entry: activate, manifest, project, host });
      await mountedId(item.id, "main > p:nth-of-type(2)");
      await settle();
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/`main > p` names 2 elements/));
      expect(await stored(files, 5)).toMatchObject({ pick: null });
    } finally {
      info.mockRestore();
    }
  });

  test("a restored pick whose page is edited before its element could be found is dropped with a note", async () => {
    const { project, item } = oneViewport("<!doctype html><html><head></head><body><main><p>a</p><p>b</p></main></body></html>");
    const { host, files } = fakeHost({
      [manifest.id]: {
        [SESSION_KEY]: { seq: 4, exit: false, pick: { verb: "typeset", viewportId: item.id, element: "main > p:nth-of-type(2)", at: 1 } },
      },
    });
    let find = null as MockInstance<DaydreamApi["pageFind"]> | null;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // The page still mounting: nothing the selector names can be found.
      mounted = await mountPlugin({
        entry: (dd) => {
          find = vi.spyOn(dd, "pageFind").mockReturnValue(null);
          return activate(dd);
        },
        manifest,
        project,
        host,
      });
      await settle();
      expect(caption()!.textContent).toBe("typeset · waiting for an agent");
      reloadWith(project, item.payload.page, (html) => html.replace("<main>", "<main><p>new</p>"));
      await settle();
      expect(caption()).toBeNull();
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/its page was edited before the element could be found in it, so the pick was dropped/));
      expect(await stored(files, 5)).toMatchObject({ pick: null });
    } finally {
      find?.mockRestore();
      info.mockRestore();
    }
  });

  test("the whole page is the target when the viewport item is selected; Escape closes the picker, then cancels a waiting pick; end session from the picker writes exit", async () => {
    const { project, source } = sourceProject();
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
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

  test("impeccable_pick with nothing waiting is a no-op: nothing is written, and the round being built stays building", async () => {
    const { project, source } = sourceProject();
    const { host, files } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    await mountedId(source.id, ".grid");

    // Nothing ever picked: nothing to write.
    expect((await pickTool().run({})) as unknown).toEqual({ pick: null, exit: false });
    await settle();
    expect(files[manifest.id]).toBeUndefined();

    select(source.id);
    await pickVerb("polish");
    await pickTool().run({});
    expect(await stored(files, 2)).toMatchObject({ pick: null });
    const saves = vi.mocked(host.storage!.savePluginData).mock.calls.length;
    // A second call mid-round — an agent checking again — takes nothing.
    expect((await pickTool().run({})) as unknown).toEqual({ pick: null, exit: false });
    await settle();
    expect(vi.mocked(host.storage!.savePluginData).mock.calls.length).toBe(saves);
    expect((files[manifest.id]![SESSION_KEY] as { seq: number }).seq).toBe(2);
    expect(caption()!.textContent).toBe("polish · building");
  });

  test("a pick the storage file refuses is said, and not left waiting for an agent who cannot see it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { project, source } = sourceProject();
      const { host } = fakeHost();
      vi.mocked(host.storage!.savePluginData).mockRejectedValue(new Error("disk full"));
      mounted = await mountPlugin({ entry: activate, manifest, project, host });
      await mountedId(source.id, ".grid");

      select(source.id);
      await pickVerb("polish");
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          expect.stringMatching(/^\[mrbavio\.impeccable\] the polish pick could not be saved.*: disk full$/),
        ),
      );
      await settle();
      expect(caption()).toBeNull();
      // Nor does an agent's call take it: there is no pick.
      expect((await pickTool().run({})) as unknown).toEqual({ pick: null, exit: false });
    } finally {
      error.mockRestore();
    }
  });

  test("a waiting pick survives a reload, captioned above its element, found by selector; exit does not", async () => {
    const { project, source } = sourceProject();
    const { host } = fakeHost({
      [manifest.id]: {
        [SESSION_KEY]: { seq: 7, exit: true, pick: { verb: "typeset", viewportId: source.id, element: ".header", at: 1 } },
      },
    });
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    await mountedId(source.id, ".header");
    await settle();
    expect(caption()!.textContent).toBe("typeset · waiting for an agent");
    const header = pageNode(source.id, ".header")!.getBoundingClientRect();
    const box = caption()!.getBoundingClientRect();
    expect(Math.abs(box.left - header.left)).toBeLessThan(1);
    expect(box.bottom).toBeLessThanOrEqual(header.top + 1);
    expect((await pickTool().run({})) as unknown).toMatchObject({ pick: { verb: "typeset", element: ".header" }, exit: false });
  });

  test("impeccable_html renders the page as one standalone file, a selector's element marked in it, and the page without it on request", async () => {
    const { project, source, page: fixture } = sourceProject();
    // A page-relative image and background: the mount points them at
    // where this host serves the project's files, and the export makes
    // that absolute.
    fixture.html = fixture.html.replace(
      '<div class="footer"></div>',
      '<div class="footer"><img src="assets/logo.png" srcset="assets/logo.png 1x, https://cdn.test/w_200,h_100/logo.png 2x" alt=""></div>',
    );
    const sheet = fixture.sheets[0]!;
    sheet.text += ".aside { background-image: url(assets/bg.png); }\n";
    // Text the page shows, which spells a url: not one.
    sheet.text += '.aside::before { content: "url(/logo.svg)"; }\n';
    const { host } = fakeHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    const reply = (await tool(HTML_TOOL).run({ viewport: source.id })) as { viewportId: string; page: string; html: string; bytes: number };
    expect(reply.viewportId).toBe(source.id);
    // The file the export was made from.
    expect(reply.page).toBe(source.payload.page);
    expect(reply.html.startsWith("<!doctype html>")).toBe(true);
    expect(reply.html).toContain("<style>");
    expect(reply.html).toContain("</body></html>");
    expect(reply.bytes).toBe(reply.html.length);
    const origin = window.location.origin;
    expect(reply.html).toMatch(new RegExp(`src="${origin}/[^"]*logo\\.png"`));
    expect(reply.html).toMatch(new RegExp(`url\\(["']?${origin}/[^)]*bg\\.png`));
    expect(reply.html).toContain('content: "url(/logo.svg)"');
    // Each srcset candidate; a url holding a comma is one url, kept whole.
    const srcset = new DOMParser().parseFromString(reply.html, "text/html").querySelector("img")!.getAttribute("srcset")!;
    expect(srcset).toMatch(new RegExp(`^${origin}/\\S*logo\\.png 1x, https://cdn\\.test/w_200,h_100/logo\\.png 2x$`));
    expect(reply.html).not.toMatch(/(src|href)="\/(?!\/)/);
    // The mount is gone once read: no live iframe left behind.
    await settle();
    expect(document.querySelectorAll("iframe").length).toBe(0);
    await expect(tool(HTML_TOOL).run({ viewport: "nope" })).rejects.toThrow(/no viewport/);
    // With an element: the page whole — nothing cut from it — and the
    // target's subtree marked.
    const marked = (await tool(HTML_TOOL).run({ viewport: source.id, element: ".grid" })) as {
      html: string;
      target?: { selector: string; kept: number };
      baseline?: string;
    };
    expect(marked.target).toEqual({ selector: ".grid", kept: 5 }); // the grid, three boxes, the image
    expect(marked.baseline).toBeUndefined();
    const page = new DOMParser().parseFromString(marked.html, "text/html");
    const whole = new DOMParser().parseFromString(reply.html, "text/html");
    expect(page.querySelector("style")).not.toBeNull();
    expect(page.body.querySelectorAll("*").length).toBe(whole.body.querySelectorAll("*").length);
    expect(page.querySelectorAll("[data-impeccable-target]").length).toBe(5);
    expect(page.querySelector(".grid")!.hasAttribute("data-impeccable-target")).toBe(true);
    expect(page.body.hasAttribute("data-impeccable-target")).toBe(false);
    // With baseline, the page without the target as well, for the
    // detector's second scan: a bare element of its tag in its place, so
    // every other element keeps its own.
    const header = (await tool(HTML_TOOL).run({ viewport: source.id, element: ".grid > .header", baseline: true })) as {
      html: string;
      target: { selector: string; kept: number };
      baseline: string;
    };
    expect(header.target).toEqual({ selector: ".grid > .header", kept: 1 });
    expect(new DOMParser().parseFromString(header.html, "text/html").querySelector(".header[data-impeccable-target]")).not.toBeNull();
    const without = new DOMParser().parseFromString(header.baseline, "text/html");
    const grid = without.querySelector(".grid")!;
    expect(Array.from(grid.children, (c) => `${c.localName}.${c.className}`)).toEqual(["div.", "div.aside", "div.footer"]);
    expect(grid.children[0]!.outerHTML).toBe("<div></div>");
    expect(without.querySelector("[data-impeccable-target]")).toBeNull();
    expect(without.querySelector("style")!.textContent).toBe(new DOMParser().parseFromString(header.html, "text/html").querySelector("style")!.textContent);
    // A selector matching none, several, or nothing the browser takes.
    await expect(tool(HTML_TOOL).run({ viewport: source.id, element: ".nope" })).rejects.toThrow(/no element matches "\.nope"/);
    await expect(tool(HTML_TOOL).run({ viewport: source.id, element: ".grid > div" })).rejects.toThrow(/matches 3 elements/);
    await expect(tool(HTML_TOOL).run({ viewport: source.id, element: "!!" })).rejects.toThrow(/refused/);
  });

  test("impeccable_html exports every sheet that applies, each its own <style> in cascade order, and refuses a page the project does not hold", async () => {
    const html =
      '<!doctype html><html><head><style>p { color: rgb(1, 2, 3); }</style><link rel="stylesheet" href="t.css">' +
      '<link rel="stylesheet" href="off.css" disabled></head><body><main><p class="t">b</p></main></body></html>';
    const made = createPageItem({ html }, { frame: { width: 640 }, path: "page.html" });
    made.page.sheets = [
      { source: { style: 0 }, text: "p { color: rgb(1, 2, 3); }", readOnly: false },
      { source: { file: "t.css" }, text: ".t { font-size: 31px; }\n", readOnly: false },
      { source: { file: "off.css" }, text: ".t { color: red; }\n", readOnly: false },
    ];
    // A viewport of a page the project does not hold.
    const orphan: DreamItem = { id: "orphan", kind: "daydream.viewport", position: { x: 800, y: 0 }, frame: { width: 320 }, payload: { page: "gone.html" } };
    mounted = await mountPlugin({ entry: activate, manifest, project: testProject([made, orphan]), host: fakeHost().host });
    const reply = (await tool(HTML_TOOL).run({ viewport: made.item.id })) as { html: string };
    const exported = new DOMParser().parseFromString(reply.html, "text/html");
    // The block, then the linked file; the disabled link applies nothing,
    // and no <link> is left to fetch anything.
    expect(Array.from(exported.querySelectorAll("style"), (s) => s.textContent)).toEqual([
      "p { color: rgb(1, 2, 3); }",
      ".t { font-size: 31px; }\n",
    ]);
    expect(exported.querySelector("link")).toBeNull();
    await expect(tool(HTML_TOOL).run({ viewport: "orphan" })).rejects.toThrow(/shows the page "gone\.html", which the project does not hold/);
  });

  test("impeccable_html answers the page's own markup and css: nothing the mount put in for its reads — no motion pin, no container probes, no measuring ids", async () => {
    const css = [
      "main { container-type: inline-size; transition: color 200ms; }",
      '.t::before { content: "{ @media all { }"; }',
      "@container (width > 100px) { .t { color: rgb(1, 2, 3); } @media (width > 1px) { .t { font-size: 31px; } } }",
      ".lead { & .x { @container (width > 5px) { color: red; } } }",
      "",
    ].join("\n");
    const { project, item } = oneViewport(
      '<!doctype html><html><head></head><body><main><p class="lead">a</p><p class="t">b</p></main></body></html>',
      css,
    );
    mounted = await mountPlugin({ entry: activate, manifest, project, host: fakeHost().host });
    const reply = (await tool(HTML_TOOL).run({ viewport: item.id, element: ".t", baseline: true })) as {
      html: string;
      baseline: string;
    };
    for (const html of [reply.html, reply.baseline]) {
      expect(html).not.toContain("--dream-container");
      expect(html).not.toContain("data-dream-");
      expect(html).not.toContain("!important");
      const page = new DOMParser().parseFromString(html, "text/html");
      expect(Array.from(page.querySelectorAll("style"), (s) => s.textContent)).toEqual([css]);
    }
  });

  test("impeccable_html keeps the target as the page styles it: a rule that reaches it through a sibling still does", async () => {
    const { project, item } = oneViewport(
      '<!doctype html><html><head></head><body><main><p class="lead">a</p><p class="t">b</p><p>c</p></main></body></html>',
      ".lead + .t { color: rgb(1, 2, 3); }\nmain > :nth-child(2) { font-size: 31px; }\n",
    );
    mounted = await mountPlugin({ entry: activate, manifest, project, host: fakeHost().host });
    const reply = (await tool(HTML_TOOL).run({ viewport: item.id, element: ".t" })) as { html: string };
    // The file as a browser opens it.
    const frame = document.createElement("iframe");
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = reply.html;
    document.body.append(frame);
    try {
      await loaded;
      const t = frame.contentDocument!.querySelector(".t")!;
      const style = frame.contentWindow!.getComputedStyle(t);
      expect(style.color).toBe("rgb(1, 2, 3)");
      expect(style.fontSize).toBe("31px");
    } finally {
      frame.remove();
    }
  });
});
