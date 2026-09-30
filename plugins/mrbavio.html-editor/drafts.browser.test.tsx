// The HTML pane's DRAFTS, through the loader seam: typing a save could
// not write is never lost. A save the kernel refuses, or one that throws,
// is kept as the page's draft with its sentence; ⌘Z drops a draft and
// ⇧⌘Z straight after brings it back; a draft comes back with its page —
// after another was selected, or an undo brought the page back — and is
// the viewport's it was typed in, not every viewport's of that page.
//
// Writing a page's file is not yet in the project model (decision #78):
// every save that passes the guards is refused as not yet, and nothing is
// written (htmlSaves.test-support.ts records what the pane asked). So
// every draft here ends refused, and no page changes underneath the
// typing. The tests of typing carried onto a page changed elsewhere, of a
// draft held where the two meet (its note, ⌘S saving it over, ⌘Z
// dropping it, the page back as the typing found it after an undo of the
// other change), and of a corrected draft saved return when a page's file
// can be written.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DaydreamApi, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  fixturePage,
  flush,
  type MountedPlugin,
  mountPlugin,
  pageElementId,
  testProject,
  type TestProject,
  viewportItems,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS, PAGE_BACK } from "./HtmlPanel";
import {
  askedHtml,
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

afterEach(disposeMounted);

/** Two viewports, `one` and `two`, each of a page of its own. */
function twoPages(): { project: TestProject; other: string } {
  const other = "<!doctype html>\n<body>\n  <h1>Other</h1>\n</body>";
  const one = createPageItem(
    { html: HTML, css: CSS },
    { id: "one", frame: { width: 600 } },
  );
  const two = createPageItem(
    { html: other, css: "" },
    { id: "two", frame: { width: 600 }, position: { x: 800, y: 0 } },
  );
  return { project: testProject([one, two]), other };
}

describe("mrbavio.html-editor: drafts", () => {
  test("a write that throws keeps the typing, as a draft with the reason, and the next save asks for it", async () => {
    let failing = true;
    // The plugin's API with a writePage that throws while `failing`.
    const entry = (dd: DaydreamApi): void =>
      activate(recordedApi(dd, () => failing));
    await mountPage(undefined, { entry });
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Not lost");
    await type(typed);
    expect(text()).toBe(typed);
    expect(stored()).toBe(HTML);
    expect(message()).toBe("The page could not be saved: the disk is full.");
    expect(saves).toHaveLength(0);

    failing = false;
    const more = edited("Old headline", "Not lost, asked");
    await type(more);
    lastAskedHtml(pagePath, HTML, more);
    refusedAsNotYet();
    expect(text()).toBe(more);
    expect(stored()).toBe(HTML);
  });

  test("a draft typed back to the page's text goes, and the typing after it is asked for", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    await type(edited("<p>", '<p onclick="x()">'));
    expect(message()).toContain("p[onclick]");
    expect(saves).toHaveLength(1);

    // Typed until it is what the page holds: nothing to ask, the draft
    // and its sentence go.
    await type(HTML);
    expect(saves).toHaveLength(1);
    expect(message()).toBeNull();

    // The next keystroke is typing over the page as it is, and is asked
    // for.
    const next = edited("Body copy", "More copy");
    await type(next);
    lastAskedHtml(pagePath, HTML, next);
    refusedAsNotYet();
  });

  test("⌘S in the editor asks for what is pending and is the project's save", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Saved now");
    await typeAll(typed);
    const event = key(content(), { key: "s", metaKey: true });
    // Core's save took the key: the browser's save dialog never opens.
    expect(event.defaultPrevented).toBe(true);
    lastAskedHtml(pagePath, HTML, typed);
    expect(askedHtml()).toHaveLength(1);
    expect(text()).toBe(typed);
    refusedAsNotYet();
    expect(stored()).toBe(HTML);
  });

  test("⌘Z drops a refused draft, all of it, and ⇧⌘Z straight after brings it back", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    const refused = edited("<p>", '<p onclick="x()">');
    await type(refused);
    expect(message()).toContain("p[onclick]");

    key(content(), { key: "z", metaKey: true });
    expect(text()).toBe(HTML);
    expect(message()).toBeNull();

    // The editor keeps no history of its own: ⇧⌘Z is the one way back.
    const back = key(content(), { key: "Z", metaKey: true, shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(text()).toBe(refused);
    expect(message()).toContain("p[onclick]");
    expect(stored()).toBe(HTML);

    // Typing after a drop is a new edit: nothing to bring back, and
    // ⇧⌘Z asks for it as it always does.
    key(content(), { key: "z", metaKey: true });
    const typed = edited("Body copy", "After the drop");
    await typeAll(typed);
    key(content(), { key: "Z", metaKey: true, shiftKey: true });
    lastAskedHtml(pagePath, HTML, typed);
    expect(text()).toBe(typed);
    refusedAsNotYet();
  });

  test("a refused text is kept as its page's draft and comes back with the page", async () => {
    const { project, other } = twoPages();
    await mountPage(project);
    await waitMounted("two", "h1");
    select("one");
    content().focus();
    const refused = edited("<p>", '<p onclick="x()">');
    await type(refused);
    blur();
    expect(text()).toBe(refused);
    expect(message()).toContain("p[onclick]");
    expect(stored("one")).toBe(HTML);

    // Away and back: the other page shows clean, this one's draft waits.
    select("two");
    expect(text()).toBe(other);
    expect(message()).toBeNull();
    select("one");
    expect(text()).toBe(refused);
    expect(message()).toContain("p[onclick]");

    // Corrected: asked for, refused as not yet, and the draft is the
    // corrected text, with the not-yet sentence, away and back.
    content().focus();
    const corrected = edited("<p>", '<p class="x">');
    await type(corrected);
    blur();
    lastAskedHtml("one.html", HTML, corrected);
    refusedAsNotYet();
    select("two");
    select("one");
    expect(text()).toBe(corrected);
    refusedAsNotYet();
    expect(stored("one")).toBe(HTML);
  });

  test("a draft is the viewport's it was typed in: another viewport of the same page shows the file as it is", async () => {
    const one = createPageItem(
      { html: HTML, css: CSS },
      { id: "one", frame: { width: 600 } },
    );
    const twin = { ...one.item, id: "twin", position: { x: 800, y: 0 } };
    await mountPage(testProject([one, twin]));
    await waitMounted("twin", "h1");
    select("one");
    content().focus();
    const refused = edited("<p>", '<p onclick="x()">');
    await type(refused);
    blur();
    expect(message()).toContain("p[onclick]");

    select("twin");
    expect(text()).toBe(HTML);
    expect(message()).toBeNull();
    select("one");
    expect(text()).toBe(refused);
    expect(message()).toContain("p[onclick]");
  });

  test("the page removed from outside while the pane is dirty: the pane empties without a write", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    await typeAll(edited("Old headline", "Typing"));
    const kernel = createTestKernel();
    kernel.dd.mutateItems((items) => {
      items.splice(0, 1);
    });
    kernel.dispose();
    flush();
    expect(panel().querySelector(".cm-content")).toBeNull();
    expect(panel().textContent).toContain("Select a page");
    expect(items()).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  test("text held because its page left the canvas is told apart once an undo brings the page back", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Typing");
    await typeAll(typed);
    const kernel = createTestKernel();
    kernel.dd.mutateItems((items) => {
      items.splice(0, 1);
    });
    kernel.dispose();
    flush();
    expect(panel().querySelector(".cm-content")).toBeNull();

    // The page is back: the typing with it, and a note that says so —
    // not that the page is gone.
    m.store.undo();
    flush();
    await waitMounted(itemId, "h1");
    select(itemId);
    expect(stored()).toBe(HTML);
    expect(text()).toBe(typed);
    expect(message()).toBe(PAGE_BACK);
    expect(saves).toHaveLength(0);

    // ⌘S asks to save it over the page, as the note says: refused as
    // not yet, it is kept, now a refused draft.
    content().focus();
    key(content(), { key: "s", metaKey: true });
    lastAskedHtml(pagePath, HTML, typed);
    expect(text()).toBe(typed);
    refusedAsNotYet();
    expect(stored()).toBe(HTML);
  });
});
