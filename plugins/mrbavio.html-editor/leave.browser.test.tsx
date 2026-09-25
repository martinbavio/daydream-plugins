// What is typed in the HTML pane when the document goes — swapped for
// another (a library pick, an agent's open_document) or the plugin stopped
// — through the loader seam: it is saved into the page it was typed in,
// read from the editor itself, whatever has reached the pane: a keystroke
// not yet reported, a composition, a save waiting on its debounce. And
// what is held for one document never reaches another's page.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { cdp } from "vitest/browser";

import type { DaydreamApi, DreamDocument, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  flush,
  type HostStorage,
  type MountedPlugin,
  mountPlugin,
  openSlug,
  overrideHostForTests,
  pageElementId,
  pageNode,
  viewportItems,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS } from "./HtmlPanel";
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

/** A library whose every document is one page, `next`, and the markup of
 * every save written to it, by slug. */
function library(): { slug: string; html: string }[] {
  const saved: { slug: string; html: string }[] = [];
  overrideHostForTests({
    storage: {
      save: async (slug: string, doc: DreamDocument) => {
        saved.push({ slug, html: viewportItems(doc)[0]!.payload.html });
      },
      load: async () => ({
        version: 7,
        items: [createPageItem({ html: HTML, css: CSS }, { id: "next", frame: { width: 960 } })],
      }),
    } as unknown as HostStorage,
  });
  onTestFinished(() => overrideHostForTests(null));
  return saved;
}

/** The last markup saved under `slug`. */
const lastSaved = (saved: { slug: string; html: string }[], slug: string): string | undefined =>
  saved.filter((save) => save.slug === slug).at(-1)?.html;

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
  (cdp() as unknown as { send: (method: string, params: object) => Promise<unknown> }).send(
    "Input.imeSetComposition",
    { text, selectionStart: text.length, selectionEnd: text.length },
  );

describe("mrbavio.html-editor: typing when the document goes", () => {
  test("a keystroke and the swap in the same task: it is saved into the outgoing document", async () => {
    const saved = library();
    await mountPage(undefined, { slug: "mine" });
    select(itemId);
    content().focus();
    keystroke(edited("Old headline", "Typed before the swap"));
    await expect(openSlug("other")).resolves.toEqual({ ok: true });
    expect(lastSaved(saved, "mine")).toBe(edited("Old headline", "Typed before the swap"));
    expect(mounted!.store.docSlug()).toBe("other");
  });

  test("a keystroke and a deactivation in the same task, before the edit reaches the pane: it is written before the pane goes", async () => {
    await mountPage();
    select(itemId);
    content().focus();
    keystroke(edited("Body copy", "Typed before the plugin stops"));
    mounted!.pluginHost.deactivate(manifest.id);
    flush();
    expect(stored()).toBe(edited("Body copy", "Typed before the plugin stops"));
  });

  test("a deactivation with a save waiting on its debounce writes it once, and the timer goes with the pane", async () => {
    const reported = vi.spyOn(window, "reportError");
    onTestFinished(() => reported.mockRestore());
    await mountPage();
    select(itemId);
    content().focus();
    // Reported: the save is on its debounce now.
    await typeAll(edited("Old headline", "Pending"));
    const before = mounted!.store.historyVersion();
    mounted!.pluginHost.deactivate(manifest.id);
    flush();
    expect(stored()).toBe(edited("Old headline", "Pending"));
    await pause();
    flush();
    expect(stored()).toBe(edited("Old headline", "Pending"));
    expect(mounted!.store.historyVersion()).toBe(before);
    expect(reported).not.toHaveBeenCalled();
  });

  test("what an input method is composing is saved as the editor holds it", async () => {
    const saved = library();
    await mountPage(undefined, { slug: "mine" });
    select(itemId);
    const v = view();
    v.focus();
    const at = v.state.doc.toString().indexOf("Old headline") + "Old".length;
    v.dispatch({ selection: { anchor: at } });
    await compose(" z");
    await compose(" zh");
    expect(v.composing).toBe(true);
    await expect(openSlug("other")).resolves.toEqual({ ok: true });
    expect(lastSaved(saved, "mine")).toBe(edited("Old headline", "Old zh headline"));
  });

  test("a write that throws through a swap is held as the page's draft with its reason, and the next swap is saved", async () => {
    const saved = library();
    const reported = vi.spyOn(window, "reportError");
    onTestFinished(() => reported.mockRestore());
    // Every write throws through the first swap, and none after it.
    let failing = true;
    const entry = (dd: DaydreamApi): void => {
      const api = Object.create(dd) as DaydreamApi;
      Object.defineProperty(api, "writePage", {
        value: (edit: Parameters<DaydreamApi["writePage"]>[0]) => {
          if (failing) throw new Error("the disk is full");
          return dd.writePage(edit);
        },
      });
      activate(api);
    };
    await mountPage(undefined, { entry, slug: "mine" });
    select(itemId);
    content().focus();
    keystroke(edited("Old headline", "Lost with the swap"));
    await expect(openSlug("other")).resolves.toEqual({ ok: true });
    failing = false;
    expect(saved.some((save) => save.html.includes("Lost with the swap"))).toBe(false);
    expect(mounted!.store.docSlug()).toBe("other");
    // Held as a save that throws is held, never thrown into the swap.
    expect(reported).not.toHaveBeenCalled();

    await waitMounted("next", "h1");
    select("next");
    content().focus();
    keystroke(edited("Body copy", "Saved with the next swap"));
    await expect(openSlug("mine")).resolves.toEqual({ ok: true });
    expect(lastSaved(saved, "other")).toBe(edited("Body copy", "Saved with the next swap"));
  });

  test("a save the hidden dock deferred is dropped when another document loads, or an undo runs, before it lands", async () => {
    const a = createPageItem({ html: HTML, css: CSS }, { id: "same", frame: { width: 600 } });
    const m = await mountPage({ version: 7, items: [a] });
    // The dock hidden is the shell's state: shown again whatever happens,
    // as the next test expects to find it.
    try {
      select("same");
      content().focus();
      await typeAll(edited("Old headline", "Typed before the load"));
      key(content(), { key: "\\", code: "Backslash", metaKey: true });
      expect(m.panel()).toBeNull();
      // Before the deferred save runs: the same document reopened — a page
      // of the same id, the same text.
      const b = createPageItem({ html: HTML, css: CSS }, { id: "same", frame: { width: 600 } });
      m.store.loadDocument({ version: 7, items: [b] }, { slug: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
      flush();
      expect(stored("same")).toBe(HTML);
      expect(m.store.canUndo()).toBe(false);

      // An undo before it runs: the typing belonged to the state undone.
      key(window, { key: "\\", code: "Backslash", metaKey: true });
      await waitMounted("same", "h1");
      select("same");
      content().focus();
      const saved = edited("Old headline", "Saved");
      await type(saved);
      expect(stored("same")).toBe(saved);
      await pause();
      await typeAll(edited("Body copy", "Pending", saved));
      key(content(), { key: "\\", code: "Backslash", metaKey: true });
      expect(m.panel()).toBeNull();
      m.kernel.commands.runCommand("core.undo");
      await new Promise((resolve) => setTimeout(resolve, 0));
      flush();
      expect(stored("same")).toBe(HTML);
    } finally {
      if (m.panel() === null) key(window, { key: "\\", code: "Backslash", metaKey: true });
    }
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
});
