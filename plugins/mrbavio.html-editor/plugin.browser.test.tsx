// The plugin through the loader seam (decisions.md #48, testing
// decisions; docs/plugin-authoring.md, "Testing a plugin"): the real
// shell, the plugin enabled by config, assertions from the DOM and the
// API — what a person sees. The pane shows structure; typing applies live
// and the session is one undo step that keeps the element's identity and
// styles; Delete on an inner element removes that element and never the
// viewport.
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test } from "vitest";

import type {
  DreamDocument,
  DreamElement,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  createElement,
  createTestKernel,
  createViewportItem,
  flush,
  mountPlugin,
  viewportItems,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import { APPLY_DEBOUNCE_MS, CHANGED_UNDERNEATH } from "./HtmlPanel";
import activate, { BLUR_COMMAND, DELETE_COMMAND, UNDO_COMMAND } from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;

let mounted: MountedPlugin | null = null;

afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** A page with a styled heading and a paragraph: html › body › [h1, p]. */
function pageDocument() {
  const h1 = createElement({
    tag: "h1",
    text: "Old headline",
    label: "Headline",
    styles: { color: "red", "font-size": "2rem" },
  });
  h1.conditionals = [
    { condition: "@media (width >= 600px)", styles: { color: "blue" } },
  ];
  const para = createElement({ tag: "p", text: "Body copy" });
  const body = createElement({ tag: "body", children: [h1, para] });
  const root = createElement({ tag: "html", children: [body] });
  const doc: DreamDocument = {
    version: 5,
    items: [createViewportItem(root, { frame: { width: 960 } })],
  };
  return { doc, root, body, h1, para };
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

/** A user edit replacing the whole text — an un-annotated transaction,
 * which the editor reports as typing. */
async function typeAll(text: string): Promise<void> {
  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
  // The microtask-deferred change notification has run by then.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Comfortably past the live-apply debounce. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, APPLY_DEBOUNCE_MS + 100));
  flush();
}

/** Type and let the live apply land. */
async function type(text: string): Promise<void> {
  await typeAll(text);
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

/** Leave the editor: blur commits the typing session. */
function blur(): void {
  content().blur();
  flush();
}

const message = (): string | null =>
  panel().querySelector('[role="status"]')?.textContent ?? null;

/** A store value as plain data, for deep equality. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The live root of the sole viewport. */
const root = () => viewportItems(mounted!.store.document)[0]!.payload.root;

/** A change made from outside the pane — an agent, another plugin —
 * through a second API instance over the same app store. */
function outsideEdit(mutate: (root: DreamElement) => void): void {
  const kernel = createTestKernel();
  const itemId = viewportItems(mounted!.store.document)[0]!.id;
  kernel.dd.updateItem(itemId, (item) => {
    mutate((item.payload as { root: DreamElement }).root);
  });
  kernel.dispose();
  flush();
}

function select(id: string | null): void {
  mounted!.store.setSelectedId(id);
  flush();
}

describe("mrbavio.html-editor", () => {
  test("the manifest declares everything the entry registers", () => {
    expect(manifest.id).toBe("mrbavio.html-editor");
    expect(manifest.contributes?.panels).toEqual(["html-editor"]);
    expect(manifest.contributes?.commands).toEqual([
      BLUR_COMMAND,
      UNDO_COMMAND,
      DELETE_COMMAND,
    ]);
    expect(manifest.contributes?.shortcuts).toEqual({
      Escape: BLUR_COMMAND,
      "Mod+Z": UNDO_COMMAND,
      Delete: DELETE_COMMAND,
      Backspace: DELETE_COMMAND,
    });
    expect(manifest.unstable).toBeUndefined();
  });

  test("the panel is in the dock and shows the selection's subtree as structure", async () => {
    const { doc, h1, root: html } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    expect(panel().getAttribute("aria-label")).toBe("HTML editor");
    expect(panel().textContent).toContain(
      "Select an element to edit its HTML.",
    );
    expect(panel().querySelector(".cm-content")).toBeNull();

    select(h1.id);
    expect(view().state.doc.toString()).toBe("<h1>Old headline</h1>");

    // The viewport root: the whole page, structure only — no style, no
    // class, no id, no label.
    select(html.id);
    const text = view().state.doc.toString();
    expect(text).toBe(
      [
        "<html>",
        "  <body>",
        "    <h1>Old headline</h1>",
        "    <p>Body copy</p>",
        "  </body>",
        "</html>",
      ].join("\n"),
    );
    expect(text).not.toMatch(/style|class|id=|Headline|red/);
    // The panel's one <style> is the kernel's, from `styles`, in the
    // plugin layer (decisions.md #71).
    const styles = panel().querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@layer dream-plugin \{/);
  });

  test("editing a heading's text applies live, keeps its styles and selection, and the session is one undo step", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const store = mounted.store;
    select(h1.id);
    content().focus();
    await typeAll("<h1>New head</h1>");
    // Nothing yet: the debounce.
    expect(root().children[0]!.children[0]!.text).toBe("Old headline");
    await settled();
    expect(root().children[0]!.children[0]!.text).toBe("New head");
    // Still focused, still the user's text, no rewrite under the caret.
    expect(document.activeElement).toBe(content());
    await type("<h1>New headline</h1>");
    blur();

    const after = root().children[0]!.children[0]!;
    expect(after.id).toBe(h1.id);
    expect(after.text).toBe("New headline");
    expect(plain(after.styles)).toEqual({ color: "red", "font-size": "2rem" });
    expect(plain(after.conditionals)).toEqual(h1.conditionals);
    expect(after.label).toBe("Headline");
    expect(store.selectedId()).toBe(h1.id);
    // The canvas renders the new text.
    expect(
      mounted.host.querySelector(`[data-dream-id="${h1.id}"]`)?.textContent,
    ).toBe("New headline");
    // The editor shows the applied face and nothing is pending.
    expect(view().state.doc.toString()).toBe("<h1>New headline</h1>");
    expect(message()).toBeNull();

    // The whole session — two applies — is one undo step.
    expect(store.canUndo()).toBe(true);
    store.undo();
    flush();
    expect(root().children[0]!.children[0]!.text).toBe("Old headline");
    expect(store.canUndo()).toBe(false);
    expect(view().state.doc.toString()).toBe("<h1>Old headline</h1>");
  });

  test("undo mid-session restores and re-syncs the editor under the caret", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const store = mounted.store;
    select(h1.id);
    content().focus();
    await type("<h1>Typed</h1>");
    expect(root().children[0]!.children[0]!.text).toBe("Typed");
    // ⌘Z through the router while the editor holds the caret.
    key(content(), { key: "z", metaKey: true });
    expect(root().children[0]!.children[0]!.text).toBe("Old headline");
    expect(view().state.doc.toString()).toBe("<h1>Old headline</h1>");
    expect(store.canUndo()).toBe(false);
    // Typing again starts a fresh session.
    await type("<h1>Again</h1>");
    blur();
    expect(root().children[0]!.children[0]!.text).toBe("Again");
    expect(store.canUndo()).toBe(true);
  });

  test("a structural edit keeps identities by tag and position: insert, wrap, mixed content", async () => {
    const { doc, body, h1, para } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(body.id);
    content().focus();
    await typeAll(
      [
        "<body>",
        "  <header>",
        '    <h1>Wrapped <a href="#top">link</a></h1>',
        "  </header>",
        "  <hr>",
        "  <p>Body copy</p>",
        "</body>",
      ].join("\n"),
    );
    await settled();
    blur();

    const after = root().children[0]!;
    expect(after.id).toBe(body.id);
    expect(after.children.map((c) => c.tag)).toEqual(["header", "hr", "p"]);
    const header = after.children[0]!;
    const heading = header.children[0]!;
    // The heading survived the wrap: same id, same styles.
    expect(heading.id).toBe(h1.id);
    expect(plain(heading.styles)).toEqual({
      color: "red",
      "font-size": "2rem",
    });
    // Mixed content became span + a: the model's grain.
    expect(heading.children.map((c) => [c.tag, c.text])).toEqual([
      ["span", "Wrapped "],
      ["a", "link"],
    ]);
    expect(plain(heading.children[1]!.attrs)).toEqual({ href: "#top" });
    // Newcomers: fresh ids, no styles.
    expect(plain(header.styles)).toEqual({});
    expect(header.id).not.toBe(h1.id);
    expect(after.children[1]!.tag).toBe("hr");
    expect(after.children[2]!.id).toBe(para.id);
    // The editor now shows the canonical face.
    expect(view().state.doc.toString()).toContain("<span>Wrapped </span>");
    expect(mounted.store.selectedId()).toBe(body.id);
  });

  test("a refused edit shows its sentence as you type and changes nothing", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await type("<h1>Hi <script>alert(1)</script></h1>");
    expect(message()).toContain('"script"');
    expect(root().children[0]!.children[0]!.text).toBe("Old headline");
    expect(mounted.store.canUndo()).toBe(false);

    await type('<h1 class="big">Hi</h1>');
    expect(message()).toContain('"class"');
    await type("<h1>a</h1><p>b</p>");
    expect(message()).toContain("found 2");
    expect(root().children[0]!.children).toHaveLength(2);

    // A good edit clears the message.
    await type("<h1>Hi</h1>");
    expect(message()).toBeNull();
    expect(root().children[0]!.children[0]!.text).toBe("Hi");
  });

  test("blur applies what the debounce had not yet; an untouched editor writes nothing back", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const store = mounted.store;
    select(h1.id);
    content().focus();
    await typeAll("<h1>Blurred</h1>");
    blur();
    expect(root().children[0]!.children[0]!.text).toBe("Blurred");
    expect(store.canUndo()).toBe(true);

    // Focus, do nothing, blur: no write, no new history step.
    content().focus();
    blur();
    store.undo();
    flush();
    expect(root().children[0]!.children[0]!.text).toBe("Old headline");
    expect(store.canUndo()).toBe(false);
  });

  test("Escape in the focused editor blurs it through the router and keeps the selection", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    expect(document.activeElement).toBe(content());
    const event = key(content(), { key: "Escape" });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(content());
    expect(mounted.store.selectedId()).toBe(h1.id);
  });

  test("Delete on an inner element removes that element alone, selects its parent, and never the viewport", async () => {
    const { doc, body, h1, para } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    const store = mounted.store;
    select(para.id);
    const event = key(window, { key: "Delete" });
    expect(event.defaultPrevented).toBe(true);
    expect(store.document.items).toHaveLength(1);
    expect(root().children[0]!.children.map((c) => c.id)).toEqual([h1.id]);
    expect(store.selectedId()).toBe(body.id);
    expect(store.selectedItemIds()).toEqual([]);

    // One undo step brings it back.
    store.undo();
    flush();
    expect(root().children[0]!.children.map((c) => c.id)).toEqual([
      h1.id,
      para.id,
    ]);
    expect(store.canUndo()).toBe(false);

    // Backspace is the same gesture.
    select(h1.id);
    key(window, { key: "Backspace" });
    expect(store.document.items).toHaveLength(1);
    expect(root().children[0]!.children.map((c) => c.id)).toEqual([para.id]);
  });

  test("Delete with a viewport selected stays core's: the item goes, not through this plugin", async () => {
    const { doc, root: html } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(html.id);
    expect(mounted.store.selectedItemIds()).toHaveLength(1);
    key(window, { key: "Delete" });
    expect(mounted.store.document.items).toHaveLength(0);
  });

  test("Delete while typing in the editor edits text, never the tree", async () => {
    const { doc, para } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(para.id);
    content().focus();
    // CodeMirror's own keymap takes the key (a character deletion); the
    // plugin's canvas-scope command never runs on an editable target.
    key(content(), { key: "Delete" });
    expect(root().children[0]!.children.map((c) => c.tag)).toEqual(["h1", "p"]);
    expect(mounted.store.selectedId()).toBe(para.id);
  });

  test("wrapping the selected element keeps it inside a fresh wrapper; the pane follows the wrapper", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await type("<header><h1>Old headline</h1></header>");
    blur();
    const header = root().children[0]!.children[0]!;
    expect(header.tag).toBe("header");
    expect(header.id).not.toBe(h1.id);
    expect(plain(header.styles)).toEqual({});
    expect(header.children[0]!.id).toBe(h1.id);
    expect(plain(header.children[0]!.styles)).toEqual({
      color: "red",
      "font-size": "2rem",
    });
    // The pane's root is the header now: the selection follows what the
    // text shows, and the editor shows the header's face.
    expect(mounted.store.selectedId()).toBe(header.id);
    expect(view().state.doc.toString()).toBe(
      "<header>\n  <h1>Old headline</h1>\n</header>",
    );
  });

  test("a refused blur keeps the text and its sentence; the draft comes back with the element", async () => {
    const { doc, h1, para } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await type('<h1 class="big">Nope</h1>');
    blur();
    expect(view().state.doc.toString()).toBe('<h1 class="big">Nope</h1>');
    expect(message()).toContain('"class"');
    expect(root().children[0]!.children[0]!.text).toBe("Old headline");

    // Away and back: the paragraph shows clean, the heading's draft waits.
    select(para.id);
    expect(view().state.doc.toString()).toBe("<p>Body copy</p>");
    expect(message()).toBeNull();
    select(h1.id);
    expect(view().state.doc.toString()).toBe('<h1 class="big">Nope</h1>');
    expect(message()).toContain('"class"');

    // Corrected: the draft is gone.
    content().focus();
    await type("<h1>Fixed</h1>");
    blur();
    expect(root().children[0]!.children[0]!.text).toBe("Fixed");
    expect(message()).toBeNull();
    select(para.id);
    select(h1.id);
    expect(view().state.doc.toString()).toBe("<h1>Fixed</h1>");
  });

  test("Delete never removes the body: the page keeps its skeleton", async () => {
    const { doc, body } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(body.id);
    const event = key(window, { key: "Delete" });
    expect(event.defaultPrevented).toBe(false);
    expect(mounted.store.document.items).toHaveLength(1);
    expect(root().children[0]!.id).toBe(body.id);
    expect(mounted.store.canUndo()).toBe(false);
  });

  test("text that changes nothing opens no history step", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await type("<h1>Old headline</h1>");
    blur();
    expect(mounted.store.canUndo()).toBe(false);
    content().focus();
    await type("<h1>\n  Old headline\n</h1>");
    blur();
    expect(mounted.store.canUndo()).toBe(false);
    expect(view().state.doc.toString()).toBe("<h1>Old headline</h1>");
  });

  test("hiding the dock mid-session applies what is pending and commits", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await typeAll("<h1>Kept</h1>");
    key(content(), { key: "\\", code: "Backslash", metaKey: true });
    expect(mounted.panel()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flush();
    expect(root().children[0]!.children[0]!.text).toBe("Kept");
    expect(mounted.store.canUndo()).toBe(true);
    key(window, { key: "\\", code: "Backslash", metaKey: true });
    expect(mounted.panel()).not.toBeNull();
    expect(view().state.doc.toString()).toBe("<h1>Kept</h1>");
  });

  test("an element changed on the canvas mid-edit is refused once, then overwritten on purpose", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await type("<h1>Mine</h1>");
    expect(root().children[0]!.children[0]!.text).toBe("Mine");
    outsideEdit((r) => {
      r.children[0]!.children[0]!.text = "An agent's";
    });
    // Uncontrolled while focused: the typed text is still there.
    expect(view().state.doc.toString()).toBe("<h1>Mine</h1>");
    await type("<h1>Mine!</h1>");
    expect(message()).toBe(CHANGED_UNDERNEATH);
    expect(root().children[0]!.children[0]!.text).toBe("An agent's");
    await type("<h1>Mine!!</h1>");
    expect(message()).toBeNull();
    expect(root().children[0]!.children[0]!.text).toBe("Mine!!");
  });

  test("replacing the element with another kind follows the replacement", async () => {
    const { doc, h1 } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(h1.id);
    content().focus();
    await type('<img src="https://x.test/a.png" alt="A">');
    const img = root().children[0]!.children[0]!;
    expect(img.tag).toBe("img");
    expect(img.id).not.toBe(h1.id);
    expect(mounted.store.selectedId()).toBe(img.id);
    expect(view().state.doc.toString()).toBe(
      '<img src="https://x.test/a.png" alt="A">',
    );
  });

  test("the selected element removed from outside while the pane is dirty: the pane empties without a write", async () => {
    const { doc, para } = pageDocument();
    mounted = await mountPlugin({ entry: activate, manifest, document: doc });
    select(para.id);
    content().focus();
    await typeAll("<p>Typing</p>");
    outsideEdit((r) => {
      r.children[0]!.children.splice(1, 1);
    });
    expect(panel().querySelector(".cm-content")).toBeNull();
    expect(panel().textContent).toContain("Select an element");
    expect(root().children[0]!.children.map((c) => c.tag)).toEqual(["h1"]);
  });
});
