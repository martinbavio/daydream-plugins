// The plugin through the loader seam (decision #48, testing
// decisions; docs/plugin-authoring.md, "Testing a plugin"): the real
// shell, the plugin enabled by config, assertions from the DOM and the
// API — what a person sees. The pane shows the page's html as its text
// and marks the selected element in it, and the caret selects the element
// it is in; typing saves live, verbatim, through the kernel's writePage,
// and quick saves join one undo step; typing over a page that changed
// elsewhere underneath is carried onto it; a save the kernel refuses, or
// one where the page changed underneath, is kept as the page's draft, and
// ⌘S saves the latter over the page; Delete on an inner element cuts it
// out of the text and never removes the viewport.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DreamDocument, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  flush,
  mountPlugin,
  pageElementId,
  pageNode,
  viewportItems,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS, CHANGED_UNDERNEATH, PAGE_BACK } from "./HtmlPanel";
import activate, {
  BLUR_COMMAND,
  DELETE_COMMAND,
  REDO_COMMAND,
  SAVE_OVER_COMMAND,
  UNDO_COMMAND,
} from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;

let mounted: MountedPlugin | null = null;

afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

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

let itemId = "";

/** Mount the plugin over a fresh one-page document (or `doc`) and wait for
 * the page to mount. */
async function mountPage(doc?: DreamDocument): Promise<MountedPlugin> {
  let document = doc;
  if (document === undefined) {
    const item = createPageItem(
      { html: HTML, css: CSS },
      { frame: { width: 960 } },
    );
    document = { version: 7, items: [item] };
  }
  itemId = document.items[0]!.id;
  mounted = await mountPlugin({ entry: activate, manifest, document });
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

/** Type and let the live save land. */
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

/** The stored markup of the page `id`. */
const stored = (id = itemId): string =>
  viewportItems(mounted!.store.document).find((item) => item.id === id)!.payload
    .html;

/** A change made from outside the pane — an agent, another plugin —
 * through a second API instance over the same app store. */
function outsideEdit(html: string, id = itemId): void {
  const kernel = createTestKernel();
  kernel.dd.updateItem(id, (item) => {
    (item.payload as { html: string }).html = html;
  });
  kernel.dispose();
  flush();
}

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

/** Longer than the kernel's edit burst (decision #20, 500ms): the next
 * write starts an undo step of its own. */
async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700));
}

describe("mrbavio.html-editor", () => {
  test("the manifest declares everything the entry registers", () => {
    expect(manifest.id).toBe("mrbavio.html-editor");
    expect(manifest.minCore).toBe("0.1.38");
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

  test("typing saves the text verbatim, live; the page remounts, and saves in quick succession are one undo step", async () => {
    const m = await mountPage();
    const store = m.store;
    select(idOf("h1"));
    content().focus();
    const first = edited("Old headline", "New head");
    await typeAll(first);
    // Nothing yet: the debounce.
    expect(stored()).toBe(HTML);
    await settled();
    expect(stored()).toBe(first);
    // Still focused, still the user's text, no rewrite under the caret.
    expect(document.activeElement).toBe(content());
    const second = edited(
      "    <p>Body copy</p>",
      "    <p>Body copy</p>\n    <p>More,  spaced   as typed</p>",
      edited("Old headline", "New headline"),
    );
    await type(second);
    blur();

    // Stored exactly as typed: the doctype, the comment, the spacing.
    expect(stored()).toBe(second);
    await vi.waitFor(() => {
      expect(pageNode(itemId, "h1")?.textContent).toBe("New headline");
    });
    expect(pageNode(itemId, "p:last-of-type")?.textContent).toBe(
      "More,  spaced   as typed",
    );
    // The selection was carried through the remount to the heading, and
    // the mark with it.
    expect(store.selectedId()).toBe(idOf("h1"));
    expect(text()).toBe(second);
    expect(message()).toBeNull();
    await marks();
    expect(marked()).toBe('<h1 class="headline">New headline</h1>');

    // The whole session — two saves, well inside the kernel's edit
    // burst of each other — is one undo step.
    expect(store.canUndo()).toBe(true);
    store.undo();
    flush();
    expect(stored()).toBe(HTML);
    expect(store.canUndo()).toBe(false);
    expect(text()).toBe(HTML);
  });

  test("a pause longer than the edit burst splits the typing into two undo steps", async () => {
    // Every save is its own writePage, and the kernel joins them by time
    // alone: nothing holds a typing session open across a pause.
    const m = await mountPage();
    const store = m.store;
    select(itemId);
    content().focus();
    const first = edited("Old headline", "First");
    await type(first);
    await pause();
    const second = edited("Body copy", "Second", first);
    await type(second);
    blur();
    expect(stored()).toBe(second);

    store.undo();
    flush();
    expect(stored()).toBe(first);
    expect(text()).toBe(first);
    store.undo();
    flush();
    expect(stored()).toBe(HTML);
    expect(store.canUndo()).toBe(false);
  });

  test("undoing a markup edit keeps the pane on its page, and the mark follows the next selection", async () => {
    const m = await mountPage();
    const store = m.store;
    select(idOf("p"));
    content().focus();
    await type(edited("Old headline", "New headline"));
    blur();
    // The save remounted the page: the selection was carried to the new
    // mount's paragraph, and the mark with it.
    expect(store.selectedId()).toBe(idOf("p"));
    await marks();
    expect(marked()).toBe("<p>Body copy</p>");

    store.undo();
    flush();
    expect(stored()).toBe(HTML);
    await waitMounted(itemId, "h1");
    await marks();
    // Whatever id the undo restored, the pane stays on the page it was
    // showing, re-synced to the text undone to.
    expect(text()).toBe(HTML);
    select(idOf("h1"));
    await marks();
    expect(marked()).toBe('<h1 class="headline">Old headline</h1>');
  });

  test("a save while typing leaves the caret where it was; a selection made on the canvas moves it", async () => {
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
    expect(stored()).toBe(edited("Body copy", "More Body copy"));
    expect(view().state.selection.main.head).toBe(at + 5);
    expect(document.activeElement).toBe(content());

    // Clicking the canvas takes the caret first; the new selection is
    // then shown where it was written.
    blur();
    select(idOf("p"));
    await marks();
    expect(marked()).toBe("<p>More Body copy</p>");
    expect(view().state.selection.main.head).toBe(stored().indexOf("<p>More"));
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

  test("⌘Z while typing undoes the typing and re-syncs the editor under the caret", async () => {
    const m = await mountPage();
    select(idOf("h1"));
    content().focus();
    await type(edited("Old headline", "Typed"));
    expect(stored()).toBe(edited("Old headline", "Typed"));
    // ⌘Z through the router while the editor holds the caret.
    key(content(), { key: "z", metaKey: true });
    expect(stored()).toBe(HTML);
    expect(text()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
    expect(document.activeElement).toBe(content());

    // Text still inside the debounce is saved first and undone with the
    // burst it joined: one ⌘Z, never the pending text lost and an older
    // step undone besides.
    await type(edited("Old headline", "Again"));
    await typeAll(edited("Old headline", "Again and more"));
    key(content(), { key: "z", metaKey: true });
    expect(stored()).toBe(HTML);
    expect(text()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
  });

  test("⇧⌘Z while typing saves what is pending first: a redo never drops typing", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    await type(edited("Old headline", "Undone"));
    key(content(), { key: "z", metaKey: true });
    expect(stored()).toBe(HTML);
    expect(m.store.canRedo()).toBe(true);

    // Typed, still inside the debounce, then ⇧⌘Z: the typing is saved,
    // a new edit, so there is nothing left to redo, and nothing is lost.
    const typed = edited("Body copy", "Pending copy");
    await typeAll(typed);
    key(content(), { key: "Z", metaKey: true, shiftKey: true });
    expect(stored()).toBe(typed);
    expect(text()).toBe(typed);
    expect(m.store.canRedo()).toBe(false);
  });

  test("a save the kernel refuses shows its sentence as you type and writes nothing", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    await type(edited("Body copy", "Hi <script>alert(1)</script>"));
    expect(message()).toContain("<script>");
    expect(message()).toContain("nothing was saved");
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

    // A good edit clears the message and saves.
    await type(edited("<p>", '<p class="lead">'));
    expect(message()).toBeNull();
    expect(stored()).toBe(edited("<p>", '<p class="lead">'));
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
    expect(stored()).toBe(HTML);

    await type(
      edited(
        "<p>Body copy</p>",
        '<svg><a href="#top"><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
      ),
    );
    expect(message()).toContain("<set>");
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
  });

  test("blur saves what the debounce had not yet; an untouched editor writes nothing back", async () => {
    const m = await mountPage();
    const store = m.store;
    select(itemId);
    content().focus();
    await typeAll(edited("Old headline", "Blurred"));
    blur();
    expect(stored()).toBe(edited("Old headline", "Blurred"));
    expect(store.canUndo()).toBe(true);

    // Focus, do nothing, blur: no write, no new history step.
    content().focus();
    blur();
    store.undo();
    flush();
    expect(stored()).toBe(HTML);
    expect(store.canUndo()).toBe(false);
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

  test("Delete on an inner element cuts it out of the text, selects its parent, and is one undo step", async () => {
    const m = await mountPage();
    const store = m.store;
    select(idOf("p"));
    const event = key(window, { key: "Delete" });
    expect(event.defaultPrevented).toBe(true);
    expect(store.document.items).toHaveLength(1);
    // Its span cut; every other character as the author wrote it.
    expect(stored()).toBe(edited("<p>Body copy</p>", ""));
    await vi.waitFor(() => {
      expect(pageNode(itemId, "p")).toBeNull();
    });
    expect(store.selectedId()).toBe(idOf("body"));
    expect(store.selectedItemIds()).toEqual([]);

    // One undo step brings it back.
    store.undo();
    flush();
    expect(stored()).toBe(HTML);
    expect(store.canUndo()).toBe(false);

    // Backspace is the same gesture.
    await waitMounted(itemId, "h1");
    select(idOf("h1"));
    key(window, { key: "Backspace" });
    expect(store.document.items).toHaveLength(1);
    expect(stored()).toBe(edited('<h1 class="headline">Old headline</h1>', ""));
  });

  test("Delete with the page selected stays core's: the item goes, not through this plugin", async () => {
    const m = await mountPage();
    select(itemId);
    expect(m.store.selectedItemIds()).toHaveLength(1);
    key(window, { key: "Delete" });
    expect(m.store.document.items).toHaveLength(0);
  });

  test("Delete while typing in the editor edits text, never the page", async () => {
    const m = await mountPage();
    const p = idOf("p");
    select(p);
    content().focus();
    // CodeMirror's own keymap takes the key (a character deletion); the
    // plugin's canvas-scope command never runs on an editable target.
    key(content(), { key: "Delete" });
    expect(stored()).toBe(HTML);
    expect(m.store.selectedId()).toBe(p);
  });

  test("Delete never removes the body: the page keeps its skeleton", async () => {
    const m = await mountPage();
    select(idOf("body"));
    const event = key(window, { key: "Delete" });
    expect(event.defaultPrevented).toBe(false);
    expect(m.store.document.items).toHaveLength(1);
    expect(stored()).toBe(HTML);
    expect(m.store.canUndo()).toBe(false);
  });

  test("text that changes nothing opens no history step; blank space is text", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    // An edit that leaves the text as the page holds it.
    await type(HTML);
    blur();
    expect(m.store.canUndo()).toBe(false);
    expect(stored()).toBe(HTML);
    // Blank space is text: a changed indent is saved as typed.
    content().focus();
    await type(edited("    <p>", "      <p>"));
    blur();
    expect(m.store.canUndo()).toBe(true);
    expect(stored()).toBe(edited("    <p>", "      <p>"));
  });

  test("hiding the dock mid-edit saves what is pending", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    await typeAll(edited("Old headline", "Kept"));
    key(content(), { key: "\\", code: "Backslash", metaKey: true });
    expect(m.panel()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flush();
    expect(stored()).toBe(edited("Old headline", "Kept"));
    expect(m.store.canUndo()).toBe(true);
    key(window, { key: "\\", code: "Backslash", metaKey: true });
    expect(m.panel()).not.toBeNull();
    expect(text()).toBe(edited("Old headline", "Kept"));
  });

  test("text typed over a page that changed elsewhere on the canvas is carried onto it and saved", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    await typeAll(edited("Old headline", "Mine"));
    // An agent writes another part of the page before the debounce saves.
    const theirs = edited("Body copy", "An agent's copy");
    outsideEdit(theirs);
    await settled();
    // Both: the typing carried onto the page as it is now.
    const both = edited("Old headline", "Mine", theirs);
    expect(stored()).toBe(both);
    expect(text()).toBe(both);
    expect(message()).toBeNull();
    expect(document.activeElement).toBe(content());
  });

  test("text typed where the page changed on the canvas is kept as its draft, with a note", async () => {
    const one = createPageItem(
      { html: HTML, css: CSS },
      { frame: { width: 600 } },
    );
    const other = "<!doctype html>\n<body>\n  <h1>Other</h1>\n</body>";
    const two = createPageItem(
      { html: other, css: "" },
      { frame: { width: 600 }, position: { x: 800, y: 0 } },
    );
    const m = await mountPage({ version: 7, items: [one, two] });
    await waitMounted(two.id, "h1");
    select(one.id);
    content().focus();
    const mine = edited("Old headline", "Mine");
    await typeAll(mine);
    // An agent writes the same headline before the debounce saves.
    const theirs = edited("Old headline", "Their headline");
    outsideEdit(theirs, one.id);
    // Uncontrolled while typing: the typed text is still there.
    expect(text()).toBe(mine);
    await settled();
    // Nothing written over theirs, and nothing typed thrown away.
    expect(stored(one.id)).toBe(theirs);
    expect(text()).toBe(mine);
    expect(message()).toBe(CHANGED_UNDERNEATH);

    // Held while the page is left: blur writes nothing, another page
    // shows clean, and the draft comes back with its note.
    blur();
    expect(stored(one.id)).toBe(theirs);
    expect(text()).toBe(mine);
    select(two.id);
    expect(text()).toBe(other);
    expect(message()).toBeNull();
    select(one.id);
    expect(text()).toBe(mine);
    expect(message()).toBe(CHANGED_UNDERNEATH);

    // More typing there is held too: nothing is written over theirs
    // without being asked.
    content().focus();
    const more = edited("Mine", "Mine, kept", mine);
    await type(more);
    expect(stored(one.id)).toBe(theirs);
    expect(text()).toBe(more);
    expect(message()).toBe(CHANGED_UNDERNEATH);

    // ⌘S in the editor saves it over the page, as the note says, and is
    // one undo step back to theirs.
    await pause();
    const event = key(content(), { key: "s", metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(stored(one.id)).toBe(more);
    expect(text()).toBe(more);
    expect(message()).toBeNull();
    m.store.undo();
    flush();
    expect(stored(one.id)).toBe(theirs);
  });

  test("a draft typed back to the page's text goes, and the typing after it saves", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    await typeAll(edited("Old headline", "Mine"));
    const theirs = edited("Old headline", "Their headline");
    outsideEdit(theirs);
    await settled();
    expect(message()).toBe(CHANGED_UNDERNEATH);

    // Typed until it is what the page holds: nothing to write, the draft
    // and its note go.
    await type(theirs);
    expect(stored()).toBe(theirs);
    expect(message()).toBeNull();

    // The next keystroke is typing over the page as it is now, and saves.
    const next = edited("Body copy", "More copy", theirs);
    await type(next);
    expect(message()).toBeNull();
    expect(stored()).toBe(next);
  });

  test("⌘S in the editor with nothing held saves what is pending and is the document's save", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Saved now");
    await typeAll(typed);
    const event = key(content(), { key: "s", metaKey: true });
    // Core's save took the key: the browser's save dialog never opens.
    expect(event.defaultPrevented).toBe(true);
    expect(stored()).toBe(typed);
    expect(message()).toBeNull();
  });

  test("⌘Z drops a draft the page never held and shows the page as it is", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    await typeAll(edited("Old headline", "Mine"));
    const theirs = edited("Old headline", "Their headline");
    outsideEdit(theirs);
    await settled();
    expect(message()).toBe(CHANGED_UNDERNEATH);

    key(content(), { key: "z", metaKey: true });
    // The agent's edit is not undone: only the typed text goes.
    expect(stored()).toBe(theirs);
    expect(text()).toBe(theirs);
    expect(message()).toBeNull();
  });

  test("a page changed on the canvas with nothing pending is shown as it is now", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    const theirs = edited("Body copy", "An agent's copy");
    outsideEdit(theirs);
    expect(text()).toBe(theirs);
    expect(document.activeElement).toBe(content());
  });

  test("a refused text is kept as its page's draft and comes back with the page", async () => {
    const one = createPageItem(
      { html: HTML, css: CSS },
      { frame: { width: 600 } },
    );
    const other = "<!doctype html>\n<body>\n  <h1>Other</h1>\n</body>";
    const two = createPageItem(
      { html: other, css: "" },
      { frame: { width: 600 }, position: { x: 800, y: 0 } },
    );
    await mountPage({ version: 7, items: [one, two] });
    await waitMounted(two.id, "h1");
    select(one.id);
    content().focus();
    const refused = edited("<p>", '<p onclick="x()">');
    await type(refused);
    blur();
    expect(text()).toBe(refused);
    expect(message()).toContain("p[onclick]");
    expect(stored(one.id)).toBe(HTML);

    // Away and back: the other page shows clean, this one's draft waits.
    select(two.id);
    expect(text()).toBe(other);
    expect(message()).toBeNull();
    select(one.id);
    expect(text()).toBe(refused);
    expect(message()).toContain("p[onclick]");

    // Corrected: saved, and the draft is gone.
    content().focus();
    await type(edited("<p>", '<p class="x">'));
    blur();
    expect(stored(one.id)).toBe(edited("<p>", '<p class="x">'));
    expect(message()).toBeNull();
    select(two.id);
    select(one.id);
    expect(text()).toBe(edited("<p>", '<p class="x">'));
  });

  test("a draft stays with its document: another document's page of the same id shows as it is", async () => {
    const a = createPageItem(
      { html: HTML, css: CSS },
      { id: "same", frame: { width: 600 } },
    );
    const m = await mountPage({ version: 7, items: [a] });
    select("same");
    content().focus();
    const refused = edited("<p>", '<p onclick="x()">');
    await type(refused);
    blur();
    expect(message()).toContain("p[onclick]");

    // Another document, whose page has the same id.
    const theirs = "<!doctype html>\n<body>\n  <h1>Document B</h1>\n</body>";
    const b = createPageItem(
      { html: theirs, css: "" },
      { id: "same", frame: { width: 600 } },
    );
    m.store.loadDocument({ version: 7, items: [b] }, { slug: null });
    flush();
    await vi.waitFor(() => {
      expect(pageNode("same", "h1")?.textContent).toBe("Document B");
    });
    select("same");
    expect(text()).toBe(theirs);
    expect(message()).toBeNull();

    // Typing there saves over B's page, never A's markup.
    content().focus();
    const mine = edited("Document B", "Document B, edited", theirs);
    await type(mine);
    expect(message()).toBeNull();
    expect(stored("same")).toBe(mine);
  });

  test("the page removed from outside while the pane is dirty: the pane empties without a write", async () => {
    const m = await mountPage();
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
    expect(m.store.document.items).toHaveLength(0);
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

    // ⌘S saves it over the page, as the note says.
    content().focus();
    key(content(), { key: "s", metaKey: true });
    expect(stored()).toBe(typed);
    expect(message()).toBeNull();
  });
});
