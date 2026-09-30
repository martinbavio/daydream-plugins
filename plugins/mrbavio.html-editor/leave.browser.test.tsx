// What is typed in the HTML pane when the project goes — swapped for
// another (Open…, which loads the host's open project) or the plugin
// stopped — through the loader seam: it is saved into the page it was
// typed in, read from the editor itself, whatever has reached the pane: a
// keystroke not yet reported, a composition, a save waiting on its
// debounce. And what is held for one project never reaches another's
// page.
//
// Writing a page's file is not yet in the project model (decision #78):
// every save that passes the guards is refused as not yet, and nothing is
// written. So these tests read what the pane ASKED `dd.writePage` for,
// and in which load of a project (htmlSaves.test-support.ts), in place of
// what the outgoing project saved. A swap is `loadOpenProject()` over a
// host whose open project the test names (`projects()`); the swaps that
// drop a deferred save or a draft are `appStore.loadProject`, as a load
// that runs no leave hook. The test of an undo that takes back a save
// asked across a hidden dock returns when a page's file can be written;
// the undo here takes back a layout edit.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { cdp } from "vitest/browser";

import type { DaydreamApi, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  fixturePage,
  flush,
  type HostProject,
  loadOpenProject,
  type MountedPlugin,
  mountPlugin,
  overrideHostForTests,
  pageElementId,
  pageNode,
  testProject,
  type TestProject,
  viewportItems,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS } from "./HtmlPanel";
import {
  clearSaves,
  HTML_NOT_YET,
  lastAskedHtml,
  recorded,
  recordedApi,
  saves,
} from "./htmlSaves.test-support";
import activate from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;

/** The plugin mounted by the test running, or null. */
let mounted: MountedPlugin | null = null;

/** Dispose of what the test mounted, and forget its saves: each test
 * file's `afterEach`. */
function disposeMounted(): void {
  mounted?.dispose();
  mounted = null;
  clearSaves();
}

/** The page as its author wrote it: a doctype, indentation, a comment. */
const HTML = [
  "<!doctype html>",
  "<html>",
  "  <head>",
  "    <title>Page</title>",
  "  </head>",
  "  <body>",
  '    <h1 class="headline">Old headline</h1>',
  "    <!-- the copy -->",
  "    <p>Body copy</p>",
  "  </body>",
  "</html>",
].join("\n");

const CSS = ".headline { color: red; }\n";

/** `HTML` with `from` replaced by `to` — one occurrence. */
const edited = (from: string, to: string, html = HTML): string => {
  if (!html.includes(from)) throw new Error(`"${from}" is not in the page`);
  return html.replace(from, to);
};

/** The viewport of the page the test mounted first. */
let itemId = "";
/** The path of the page `itemId` shows. */
let pagePath = "";

/** A project of one page, `page.html`, shown by the viewport `page`. */
const onePage = (): TestProject =>
  testProject([
    createPageItem(
      { html: HTML, css: CSS },
      { id: "page", frame: { width: 960 } },
    ),
  ]);

/** Mount the plugin over a fresh one-page project (or `project`) and wait
 * for its first page to mount. `entry` stands in for the plugin's entry —
 * by default the entry with its saves recorded. */
async function mountPage(
  project: TestProject = onePage(),
  options: { entry?: typeof activate } = {},
): Promise<MountedPlugin> {
  const viewport = fixturePage(project);
  itemId = viewport.id;
  pagePath = viewport.payload.page;
  mounted = await mountPlugin({
    entry: options.entry ?? recorded,
    manifest,
    project,
  });
  await waitMounted(itemId, "h1");
  return mounted;
}

/** Wait for `selector` to be mounted in page `id`. */
async function waitMounted(id: string, selector: string): Promise<void> {
  await vi.waitFor(() => {
    expect(pageElementId(id, selector)).not.toBeNull();
  });
}

const panel = (): HTMLElement => mounted!.panel()!;

const content = (): HTMLElement => {
  const dom = panel().querySelector(".cm-content");
  if (dom === null) throw new Error("no editor content mounted");
  return dom as HTMLElement;
};

/** The EditorView behind the panel, reached through the DOM. */
function view(): EditorView {
  const found = EditorView.findFromDOM(content());
  if (found === null) throw new Error("no view for mounted content");
  return found;
}

const text = (): string => view().state.doc.toString();

/** A user edit replacing the whole text — an un-annotated transaction,
 * which the editor reports as typing. */
async function typeAll(next: string): Promise<void> {
  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
  // The microtask-deferred change notification has run by then.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Comfortably past the live-save debounce. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, APPLY_DEBOUNCE_MS + 100));
  flush();
}

/** Type and let the live save be asked for. */
async function type(next: string): Promise<void> {
  await typeAll(next);
  await settled();
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  flush();
  return event;
}

/** Leave the editor: blur saves what is pending. */
function blur(): void {
  content().blur();
  flush();
}

const message = (): string | null =>
  panel().querySelector('[role="status"]')?.textContent ?? null;

/** The stored markup of the page viewport `id` shows. */
function stored(id = itemId): string {
  const viewport = viewportItems(mounted!.store.document).find(
    (item) => item.id === id,
  )!;
  return mounted!.store.pages[viewport.payload.page]!.html;
}

/** The items on the shown canvas. */
const items = () => mounted!.store.document.canvases[0]!.items;

function select(id: string | null): void {
  mounted!.store.setSelectedId(id);
  flush();
}

/** The not-yet refusal of the last save, as the pane shows it: the
 * kernel's own sentence, once, its one period. */
function refusedAsNotYet(): void {
  expect(message()).toBe(saves.at(-1)!.answer);
  expect(message()).toMatch(HTML_NOT_YET);
  expect(message()).not.toMatch(/\.\.$/);
}

/** Longer than the kernel's edit burst (decision #20, 500ms). */
async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700));
}

afterEach(disposeMounted);

const MINE = { root: "/test/mine", name: "mine" };
const OTHER = { root: "/test/other", name: "other" };

/** One page, `page.html`, shown by the viewport `page`, in `project`. */
const pageIn = (project: TestProject["project"]): TestProject =>
  testProject(
    [
      createPageItem(
        { html: HTML, css: CSS },
        { id: "page", frame: { width: 960 } },
      ),
    ],
    { project },
  );

/** A host whose open project is `open.current` — each read a fresh copy
 * of the one-page project under it — so `loadOpenProject()` swaps the
 * project as Open… does. Put in after the mount, so the shell's own
 * start reads nothing from it. */
function projects(): { current: TestProject["project"] } {
  const open = { current: OTHER as TestProject["project"] };
  const project: HostProject = {
    read: async () => pageIn(open.current),
    open: async () => ({ cancelled: true }),
    saveManifest: async () => {},
  };
  overrideHostForTests({ project });
  onTestFinished(() => overrideHostForTests(null));
  return open;
}

/** A keystroke: the whole text replaced by an un-annotated transaction,
 * whose report reaches the pane a microtask later — not awaited. */
function keystroke(next: string): void {
  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
}

/** Chrome's own input method (its DevTools protocol), composing `text`,
 * not committed. The session is Playwright's; its type comes with the
 * provider, which this plugin's package does not declare. */
const compose = (text: string): Promise<unknown> =>
  (
    cdp() as unknown as {
      send: (method: string, params: object) => Promise<unknown>;
    }
  ).send("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });

describe("mrbavio.html-editor: typing when the project goes", () => {
  test("a keystroke and the swap in the same task: it is asked for in the outgoing project", async () => {
    await mountPage(pageIn(MINE));
    const load = mounted!.store.loadVersion();
    projects();
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Typed before the swap");
    keystroke(typed);
    await expect(loadOpenProject()).resolves.toEqual({ ok: true });
    lastAskedHtml(pagePath, HTML, typed);
    expect(saves.at(-1)!.load).toBe(load);
    expect(mounted!.store.project()).toEqual(OTHER);
  });

  test("a keystroke and a deactivation in the same task, before the edit reaches the pane: it is asked for before the pane goes", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    const typed = edited("Body copy", "Typed before the plugin stops");
    keystroke(typed);
    mounted!.pluginHost.deactivate(manifest.id);
    flush();
    lastAskedHtml(pagePath, HTML, typed);
    expect(stored()).toBe(HTML);
  });

  test("a deactivation with a save waiting on its debounce asks for it once, and the timer goes with the pane", async () => {
    const reported = vi.spyOn(window, "reportError");
    onTestFinished(() => reported.mockRestore());
    await mountPage();
    select(itemId);
    content().focus();
    // Reported: the save is on its debounce now.
    const typed = edited("Old headline", "Pending");
    await typeAll(typed);
    const before = mounted!.store.historyVersion();
    mounted!.pluginHost.deactivate(manifest.id);
    flush();
    lastAskedHtml(pagePath, HTML, typed);
    await pause();
    flush();
    expect(saves).toHaveLength(1);
    expect(stored()).toBe(HTML);
    expect(mounted!.store.historyVersion()).toBe(before);
    expect(reported).not.toHaveBeenCalled();
  });

  test("what an input method is composing is asked for as the editor holds it", async () => {
    await mountPage(pageIn(MINE));
    const load = mounted!.store.loadVersion();
    projects();
    select(itemId);
    const v = view();
    v.focus();
    const at = v.state.doc.toString().indexOf("Old headline") + "Old".length;
    v.dispatch({ selection: { anchor: at } });
    await compose(" z");
    await compose(" zh");
    expect(v.composing).toBe(true);
    await expect(loadOpenProject()).resolves.toEqual({ ok: true });
    const mine = saves.filter((save) => save.load === load);
    expect(mine.at(-1)!.edit).toEqual({
      kind: "html",
      path: pagePath,
      expected: HTML,
      html: edited("Old headline", "Old zh headline"),
    });
  });

  test("a write that throws through a swap is held as the page's draft with its reason, never thrown into the swap, and the next swap is asked", async () => {
    const reported = vi.spyOn(window, "reportError");
    onTestFinished(() => reported.mockRestore());
    // Every write throws through the first swap, and none after it.
    let failing = true;
    const entry = (dd: DaydreamApi): void =>
      activate(recordedApi(dd, () => failing));
    await mountPage(pageIn(MINE), { entry });
    const open = projects();
    select(itemId);
    content().focus();
    keystroke(edited("Old headline", "Lost with the swap"));
    await expect(loadOpenProject()).resolves.toEqual({ ok: true });
    failing = false;
    expect(saves).toHaveLength(0);
    expect(mounted!.store.project()).toEqual(OTHER);
    // Held as a save that throws is held, never thrown into the swap.
    expect(reported).not.toHaveBeenCalled();

    await waitMounted("page", "h1");
    select("page");
    content().focus();
    const load = mounted!.store.loadVersion();
    const typed = edited("Body copy", "Asked with the next swap");
    keystroke(typed);
    open.current = MINE;
    await expect(loadOpenProject()).resolves.toEqual({ ok: true });
    lastAskedHtml("page.html", HTML, typed);
    expect(saves.at(-1)!.load).toBe(load);
    expect(mounted!.store.project()).toEqual(MINE);
  });

  test("a save the hidden dock deferred is dropped when another project loads, or an undo runs, before it is asked", async () => {
    const m = await mountPage();
    // The dock hidden is the shell's state: shown again whatever happens,
    // as the next test expects to find it.
    try {
      select(itemId);
      content().focus();
      await typeAll(edited("Old headline", "Typed before the load"));
      key(content(), { key: "\\", code: "Backslash", metaKey: true });
      expect(m.panel()).toBeNull();
      // Before the deferred save runs: the same project loaded again — a
      // viewport of the same id, a page of the same path and text.
      m.store.loadProject(onePage());
      await new Promise((resolve) => setTimeout(resolve, 0));
      flush();
      expect(saves).toHaveLength(0);

      // An undo before it runs: the typing belonged to the state undone.
      // The step undone is a move of the viewport — a layout edit, which
      // the canvas writes.
      key(window, { key: "\\", code: "Backslash", metaKey: true });
      await waitMounted(itemId, "h1");
      const kernel = createTestKernel();
      kernel.dd.updateItem(itemId, (item) => {
        item.position = { x: 40, y: 0 };
      });
      kernel.dispose();
      flush();
      expect(m.store.canUndo()).toBe(true);
      select(itemId);
      content().focus();
      await typeAll(edited("Body copy", "Pending"));
      key(content(), { key: "\\", code: "Backslash", metaKey: true });
      expect(m.panel()).toBeNull();
      m.kernel.commands.runCommand("core.undo");
      await new Promise((resolve) => setTimeout(resolve, 0));
      flush();
      expect(saves).toHaveLength(0);
      expect(items()[0]!.position).toEqual({ x: 0, y: 0 });
    } finally {
      if (m.panel() === null) {
        key(window, { key: "\\", code: "Backslash", metaKey: true });
      }
    }
  });

  test("a draft stays with its project: another project's page of the same path shows as it is", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    const refused = edited("<p>", '<p onclick="x()">');
    await type(refused);
    blur();
    expect(message()).toContain("p[onclick]");

    // Another project, whose viewport and page have the same id and path.
    const theirs = "<!doctype html>\n<body>\n  <h1>Project B</h1>\n</body>";
    m.store.loadProject(
      testProject([
        createPageItem(
          { html: theirs, css: "" },
          { id: "page", frame: { width: 960 } },
        ),
      ]),
    );
    flush();
    await vi.waitFor(() => {
      expect(pageNode("page", "h1")?.textContent).toBe("Project B");
    });
    select("page");
    expect(text()).toBe(theirs);
    expect(message()).toBeNull();

    // Typing there is asked for over B's page, never A's markup.
    content().focus();
    const mine = edited("Project B", "Project B, edited", theirs);
    await type(mine);
    lastAskedHtml("page.html", theirs, mine);
    refusedAsNotYet();
  });
});
