// The HTML pane's DRAFTS, through the loader seam: typing a save could
// not write is never lost. A save the kernel refuses, or one that throws,
// is kept as the page's draft with its sentence; typing over a page that
// changed elsewhere on the canvas is carried onto it, and where the two
// meet it is held, with a note, until ⌘S saves it over the page; ⌘Z drops
// a draft and ⇧⌘Z straight after brings it back; and a draft comes back
// with its page — after another was selected, or an undo brought the
// page back.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DreamDocument, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  flush,
  type MountedPlugin,
  mountPlugin,
  pageElementId,
  viewportItems,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS, CHANGED_UNDERNEATH, PAGE_BACK } from "./HtmlPanel";
import activate from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;

/** The plugin mounted by the test running, or null. */
let mounted: MountedPlugin | null = null;

/** Dispose of what the test mounted: each test file's `afterEach`. */
function disposeMounted(): void {
  mounted?.dispose();
  mounted = null;
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

/** The id of the first page of the document the test mounted. */
let itemId = "";

/** Mount the plugin over a fresh one-page document (or `doc`) and wait for
 * the page to mount. `entry` stands in for the plugin's entry — its API
 * wrapped — and `slug` names the document as saved in a library. */
async function mountPage(
  doc?: DreamDocument,
  options: { entry?: typeof activate; slug?: string } = {},
): Promise<MountedPlugin> {
  let document = doc;
  if (document === undefined) {
    const item = createPageItem(
      { html: HTML, css: CSS },
      { frame: { width: 960 } },
    );
    document = { version: 7, items: [item] };
  }
  itemId = document.items[0]!.id;
  mounted = await mountPlugin({
    entry: options.entry ?? activate,
    manifest,
    document,
    ...(options.slug === undefined ? {} : { slug: options.slug }),
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

/** Longer than the kernel's edit burst (decision #20, 500ms): the next
 * write starts an undo step of its own. */
async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700));
}



afterEach(disposeMounted);

describe("mrbavio.html-editor: drafts", () => {
  test("a write that throws keeps the typing, as a draft with the reason, and the next save carries it", async () => {
    let failing = true;
    // The plugin's API with a writePage that throws while `failing`.
    const entry: typeof activate = (dd) => {
      const api = Object.create(dd) as typeof dd;
      Object.defineProperty(api, "writePage", {
        value: (edit: Parameters<typeof dd.writePage>[0]) => {
          if (failing) throw new Error("the disk is full");
          return dd.writePage(edit);
        },
      });
      activate(api);
    };
    await mountPage(undefined, { entry });
    select(itemId);
    content().focus();
    const typed = edited("Old headline", "Not lost");
    await type(typed);
    expect(text()).toBe(typed);
    expect(stored()).toBe(HTML);
    expect(message()).toContain("the disk is full");

    failing = false;
    const more = edited("Old headline", "Not lost, saved");
    await type(more);
    expect(message()).toBeNull();
    expect(stored()).toBe(more);
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
    // ⇧⌘Z saves it as it always does.
    key(content(), { key: "z", metaKey: true });
    const typed = edited("Body copy", "After the drop");
    await typeAll(typed);
    key(content(), { key: "Z", metaKey: true, shiftKey: true });
    expect(stored()).toBe(typed);
    expect(text()).toBe(typed);
    expect(message()).toBeNull();
  });


  test("a held draft whose page is back as the typing found it says so, and ⌘S saves it", async () => {
    const m = await mountPage();
    select(itemId);
    content().focus();
    const mine = edited("Old headline", "Mine");
    await typeAll(mine);
    outsideEdit(edited("Old headline", "Their headline"));
    await settled();
    expect(message()).toBe(CHANGED_UNDERNEATH);

    // Their change undone: the page is as the typing started from it.
    m.store.undo();
    flush();
    expect(stored()).toBe(HTML);
    expect(text()).toBe(mine);
    expect(message()).toBe(PAGE_BACK);

    content().focus();
    key(content(), { key: "s", metaKey: true });
    expect(stored()).toBe(mine);
    expect(message()).toBeNull();
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
