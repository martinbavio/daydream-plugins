// The plugin through the loader seam (decision #48, testing
// decisions; docs/plugin-authoring.md, "Testing a plugin"): the real
// shell, the plugin enabled by config, a page of the project on the
// canvas, assertions from the DOM and the API — what a person sees. The
// pane shows the page's html as its text and marks the selected element
// in it, and the caret selects the element it is in; typing is saved
// live, verbatim, through the kernel's writePage; a save the kernel
// refuses says why as you type; Delete on an inner element asks to cut it
// out of the text and never removes the viewport. What a save cannot
// write is kept as a draft (drafts.browser.test.tsx), and what is typed
// when the project goes is saved into it first (leave.browser.test.tsx).
//
// Writing a page's file is not yet in the project model (decision #78):
// every save that passes the guards is refused, and nothing is written.
// So these tests read what the pane ASKS `dd.writePage` for, and its
// answer (htmlSaves.test-support.ts), and that the page is as it was, the
// typing held as its draft. The tests of saves that write — their undo
// steps, the remount after one, a page changed on the canvas shown as it
// is now — return when a page's file can be written.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";

import type { PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  fixturePage,
  flush,
  type MountedPlugin,
  mountPlugin,
  pageElementId,
  testProject,
  type TestProject,
  viewportItems,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS } from "./HtmlPanel";
import {
  askedHtml,
  askedRemove,
  clearSaves,
  HTML_NOT_YET,
  lastAskedHtml,
  recorded,
  REMOVE_NOT_YET,
  saves,
} from "./htmlSaves.test-support";
import activate, {
  BLUR_COMMAND,
  DELETE_COMMAND,
  REDO_COMMAND,
  SAVE_OVER_COMMAND,
  UNDO_COMMAND,
} from "./index";
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

/** The runtime id of the element `selector` names in the page, now. */
const idOf = (selector: string, page = itemId): string => {
  const id = pageElementId(page, selector);
  if (id === null) throw new Error(`nothing mounted matches ${selector}`);
  return id;
};

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

/** The text the selected element's mark covers, line breaks and all. */
function marked(): string {
  const lines: string[] = [];
  for (const line of Array.from(content().querySelectorAll(".cm-line"))) {
    const spans = Array.from(
      line.querySelectorAll(".cm-dd-selected-element"),
    ).filter(
      (span) => span.parentElement?.closest(".cm-dd-selected-element") === null,
    );
    if (spans.length > 0) lines.push(spans.map((s) => s.textContent).join(""));
  }
  return lines.join("\n");
}

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

/** Let a selection's mark land (it is set after the render). */
async function marks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
}

/** The person puts the caret at `offset` — a click, as CodeMirror
 * reports one — and the frame it is reported on passes. */
async function caret(offset: number): Promise<void> {
  view().dispatch({
    selection: { anchor: offset },
    userEvent: "select.pointer",
  });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await marks();
}

/** The not-yet refusal of the last save, as the pane shows it: the
 * kernel's own sentence, once, its one period. */
function refusedAsNotYet(): void {
  expect(message()).toBe(saves.at(-1)!.answer);
  expect(message()).toMatch(HTML_NOT_YET);
  expect(message()).not.toMatch(/\.\.$/);
}

afterEach(disposeMounted);

describe("mrbavio.html-editor", () => {
  test("the manifest declares everything the entry registers", () => {
    expect(manifest.id).toBe("mrbavio.html-editor");
    expect(manifest.minCore).toBe("0.1.44");
    expect(manifest.contributes?.panels).toEqual(["html-editor"]);
    expect(manifest.contributes?.commands).toEqual([
      BLUR_COMMAND,
      UNDO_COMMAND,
      REDO_COMMAND,
      DELETE_COMMAND,
      SAVE_OVER_COMMAND,
    ]);
    expect(manifest.contributes?.shortcuts).toEqual({
      Escape: BLUR_COMMAND,
      "Mod+Z": UNDO_COMMAND,
      "Shift+Mod+Z": REDO_COMMAND,
      "Mod+S": SAVE_OVER_COMMAND,
      Delete: DELETE_COMMAND,
      Backspace: DELETE_COMMAND,
    });
    expect(manifest.unstable).toBeUndefined();
  });

  test("the pane shows the page's html as written, and marks the selected element in it", async () => {
    await mountPage();
    expect(panel().getAttribute("aria-label")).toBe("HTML editor");
    expect(panel().textContent).toContain(
      "Select a page, or an element in one, to edit its HTML.",
    );
    expect(panel().querySelector(".cm-content")).toBeNull();

    // The page itself: its whole text, verbatim, nothing marked.
    select(itemId);
    await marks();
    expect(text()).toBe(HTML);
    expect(marked()).toBe("");

    // An element inside it: the same text, the element's span marked,
    // and the caret put at its start (the editor is not being typed in).
    select(idOf("h1"));
    await marks();
    expect(text()).toBe(HTML);
    expect(marked()).toBe('<h1 class="headline">Old headline</h1>');
    expect(view().state.selection.main.head).toBe(HTML.indexOf("<h1"));

    select(idOf("body"));
    await marks();
    expect(marked()).toBe(
      HTML.slice(HTML.indexOf("<body>"), HTML.indexOf("</body>") + 7),
    );

    // The panel's one <style> is the kernel's, from `styles`, in the
    // plugin layer (decision #71).
    const styles = panel().querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);
  });

  test("typing is asked for live and verbatim, as the page's file; refused as not yet, it is kept as the draft and nothing is written", async () => {
    const m = await mountPage();
    select(idOf("h1"));
    content().focus();
    const first = edited("Old headline", "New head");
    await typeAll(first);
    // Nothing yet: the debounce.
    expect(saves).toHaveLength(0);
    await settled();
    // The page's path, its html as shown, the text as typed.
    lastAskedHtml(pagePath, HTML, first);
    refusedAsNotYet();
    expect(stored()).toBe(HTML);
    // Still focused, still the user's text, no rewrite under the caret.
    expect(document.activeElement).toBe(content());
    expect(text()).toBe(first);

    // More typing is asked for from the page as it still is: the doctype,
    // the comment, the spacing, as typed.
    const second = edited(
      "    <p>Body copy</p>",
      "    <p>Body copy</p>\n    <p>More,  spaced   as typed</p>",
      edited("Old headline", "New headline"),
    );
    await type(second);
    blur();
    lastAskedHtml(pagePath, HTML, second);
    expect(askedHtml()).toHaveLength(2);
    expect(stored()).toBe(HTML);
    expect(text()).toBe(second);
    refusedAsNotYet();
    expect(m.store.canUndo()).toBe(false);
  });

  test("a save asked for while typing leaves the caret where it was", async () => {
    await mountPage();
    select(idOf("h1"));
    await marks();
    content().focus();
    const at = HTML.indexOf("Body copy");
    // Typed as a keystroke is: the text in, the caret after it.
    view().dispatch({
      changes: { from: at, insert: "More " },
      selection: { anchor: at + 5 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled();
    lastAskedHtml(pagePath, HTML, edited("Body copy", "More Body copy"));
    expect(view().state.selection.main.head).toBe(at + 5);
    expect(document.activeElement).toBe(content());
  });

  test("the caret selects the element it is in on the canvas, and the mark never moves it", async () => {
    const m = await mountPage();
    const store = m.store;
    select(itemId);
    await marks();
    content().focus();
    const inCopy = HTML.indexOf("Body copy") + 3;
    await caret(inCopy);
    expect(store.selectedId()).toBe(idOf("p"));
    expect(store.selectedItemIds()).toEqual([]);
    expect(marked()).toBe("<p>Body copy</p>");
    // The mark followed; the caret stayed where the person put it.
    expect(view().state.selection.main.head).toBe(inCopy);

    const inHeadline = HTML.indexOf("Old headline");
    await caret(inHeadline);
    expect(store.selectedId()).toBe(idOf("h1"));
    expect(marked()).toBe('<h1 class="headline">Old headline</h1>');
    expect(view().state.selection.main.head).toBe(inHeadline);

    // Between two elements, the innermost one holding the place.
    await caret(HTML.indexOf("<!-- the copy -->"));
    expect(store.selectedId()).toBe(idOf("body"));

    // A place in no element — the doctype — leaves the selection be.
    await caret(3);
    expect(store.selectedId()).toBe(idOf("body"));
  });

  test("the caret selects nothing while typed text is not the page's yet", async () => {
    const m = await mountPage();
    const store = m.store;
    const h1 = idOf("h1");
    select(h1);
    content().focus();
    await typeAll(edited("Old headline", "Typing"));
    // The offsets are the typed text's, not the stored page's.
    await caret(text().indexOf("Body copy"));
    expect(store.selectedId()).toBe(h1);
  });

  test("⌘Z while typing asks for what is pending first, then drops the refused draft and shows the page", async () => {
    const m = await mountPage();
    select(idOf("h1"));
    content().focus();
    const typed = edited("Old headline", "Typed");
    await type(typed);
    refusedAsNotYet();
    // ⌘Z through the router while the editor holds the caret: the draft
    // the page never held is dropped, and the key goes no further.
    const event = key(content(), { key: "z", metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(text()).toBe(HTML);
    expect(message()).toBeNull();
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
    expect(document.activeElement).toBe(content());

    // Text still inside the debounce is asked for first, then dropped
    // with the draft its refusal leaves: never lost unasked.
    const pending = edited("Old headline", "Again and more");
    await typeAll(pending);
    key(content(), { key: "z", metaKey: true });
    lastAskedHtml(pagePath, HTML, pending);
    expect(text()).toBe(HTML);
    expect(message()).toBeNull();
    expect(m.store.canUndo()).toBe(false);
  });

  test("⇧⌘Z while typing asks for what is pending first, and keeps it as the draft: a redo never drops typing", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    // Typed, still inside the debounce, then ⇧⌘Z: the typing is asked
    // for, refused, and kept; core's redo finds nothing to redo.
    const typed = edited("Body copy", "Pending copy");
    await typeAll(typed);
    key(content(), { key: "Z", metaKey: true, shiftKey: true });
    lastAskedHtml(pagePath, HTML, typed);
    expect(text()).toBe(typed);
    refusedAsNotYet();
    expect(stored()).toBe(HTML);
    expect(m.store.canRedo()).toBe(false);
  });

  test("a save the guards refuse shows their sentence as you type, never the not-yet one", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    await type(edited("Body copy", "Hi <script>alert(1)</script>"));
    expect(message()).toContain("<script>");
    expect(message()).toContain("nothing was saved");
    expect(message()).toMatch(/^The edit brings in .*\.$/);
    expect(message()).not.toMatch(HTML_NOT_YET);
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);

    await type(edited("<p>", '<p onclick="x()">'));
    expect(message()).toContain("p[onclick]");
    await type(edited("<p>", '<p><a href="javascript:x()">x</a>'));
    expect(message()).toContain("a[href]");
    // A stylesheet's rules belong in the page's css.
    await type(edited("<title>", "<style>p { color: red }</style><title>"));
    expect(message()).toContain("<style>");
    expect(stored()).toBe(HTML);

    // An edit the guards pass is refused as not yet, in its own
    // sentence.
    const lead = edited("<p>", '<p class="lead">');
    await type(lead);
    lastAskedHtml(pagePath, HTML, lead);
    refusedAsNotYet();
    expect(stored()).toBe(HTML);
  });

  test("a javascript: url set through SVG's xlink:href or an animation is refused", async () => {
    // The review's two misses in the plugin's own guard: the kernel's
    // walk reads `xlink:href` by its local name, and removes an animation
    // whose target is a url-bearing attribute.
    const m = await mountPage();
    select(itemId);
    content().focus();
    await type(
      edited(
        "<p>Body copy</p>",
        '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      ),
    );
    expect(message()).toContain("xlink:href");
    expect(message()).not.toMatch(HTML_NOT_YET);
    expect(stored()).toBe(HTML);

    await type(
      edited(
        "<p>Body copy</p>",
        '<svg><a href="#top"><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
      ),
    );
    expect(message()).toContain("<set>");
    expect(message()).not.toMatch(HTML_NOT_YET);
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
  });

  test("blur asks for what the debounce had not yet; an untouched editor asks for nothing", async () => {
    const m = await mountPage();
    select(itemId);
    // Focus, do nothing, blur: nothing asked.
    content().focus();
    blur();
    expect(saves).toHaveLength(0);

    content().focus();
    const typed = edited("Old headline", "Blurred");
    await typeAll(typed);
    blur();
    lastAskedHtml(pagePath, HTML, typed);
    expect(text()).toBe(typed);
    refusedAsNotYet();
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);

    // Focused and left again with nothing typed: the draft is not asked
    // again.
    content().focus();
    blur();
    expect(saves).toHaveLength(1);
  });

  test("Escape in the focused editor blurs it through the router and keeps the selection", async () => {
    const m = await mountPage();
    const h1 = idOf("h1");
    select(h1);
    content().focus();
    expect(document.activeElement).toBe(content());
    const event = key(content(), { key: "Escape" });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(content());
    expect(m.store.selectedId()).toBe(h1);
  });

  test("Delete on an inner element asks to cut it out; refused as not yet, the selection is put back and the refusal said on the console", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => said.mockRestore());
    const m = await mountPage();
    const store = m.store;
    const p = idOf("p");
    select(p);
    key(window, { key: "Delete" });
    expect(askedRemove()).toEqual([{ kind: "remove", elementId: p }]);
    expect(saves.at(-1)!.answer).toMatch(REMOVE_NOT_YET);
    expect(said).toHaveBeenCalledTimes(1);
    expect(String(said.mock.calls[0]![0])).toMatch(
      /^\[mrbavio\.html-editor\] delete refused: Removing an element is not yet in the project model/,
    );
    expect(items()).toHaveLength(1);
    expect(stored()).toBe(HTML);
    expect(idOf("p")).toBe(p);
    expect(store.selectedId()).toBe(p);
    expect(store.selectedItemIds()).toEqual([]);
    expect(store.canUndo()).toBe(false);

    // Backspace is the same gesture.
    const h1 = idOf("h1");
    select(h1);
    key(window, { key: "Backspace" });
    expect(askedRemove().at(-1)).toEqual({ kind: "remove", elementId: h1 });
    expect(said).toHaveBeenCalledTimes(2);
    expect(items()).toHaveLength(1);
    expect(stored()).toBe(HTML);
    expect(store.selectedId()).toBe(h1);
  });

  test("Delete with the page selected stays core's: the item goes, not through this plugin", async () => {
    const m = await mountPage();
    select(itemId);
    expect(m.store.selectedItemIds()).toHaveLength(1);
    key(window, { key: "Delete" });
    expect(items()).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  test("Delete while typing in the editor edits text, never the page", async () => {
    const m = await mountPage();
    const p = idOf("p");
    select(p);
    content().focus();
    // CodeMirror's own keymap takes the key (a character deletion); the
    // plugin's canvas-scope command never runs on an editable target.
    key(content(), { key: "Delete" });
    expect(askedRemove()).toEqual([]);
    expect(stored()).toBe(HTML);
    expect(m.store.selectedId()).toBe(p);
  });

  test("Delete never removes the body: the page keeps its skeleton", async () => {
    const m = await mountPage();
    select(idOf("body"));
    const event = key(window, { key: "Delete" });
    expect(event.defaultPrevented).toBe(false);
    expect(askedRemove()).toEqual([]);
    expect(items()).toHaveLength(1);
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
  });

  test("text that changes nothing is asked for never; blank space is text", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    // An edit that leaves the text as the page holds it.
    await type(HTML);
    blur();
    expect(saves).toHaveLength(0);
    expect(message()).toBeNull();
    // Blank space is text: a changed indent is asked for as typed.
    content().focus();
    const indented = edited("    <p>", "      <p>");
    await type(indented);
    blur();
    lastAskedHtml(pagePath, HTML, indented);
  });

  test("hiding the dock mid-edit asks for what is pending, and the draft comes back with the dock", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Kept");
    await typeAll(typed);
    key(content(), { key: "\\", code: "Backslash", metaKey: true });
    expect(m.panel()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flush();
    lastAskedHtml(pagePath, HTML, typed);
    expect(stored()).toBe(HTML);
    key(window, { key: "\\", code: "Backslash", metaKey: true });
    expect(m.panel()).not.toBeNull();
    expect(text()).toBe(typed);
    refusedAsNotYet();
  });
});
