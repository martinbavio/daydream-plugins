import {
  createTestKernel,
  mountPlugin,
  type AppStore,
  type MountPluginOptions,
  type MountedPlugin,
  createEmptyDocument,
  isDragActive,
  screenToWorld,
} from "@daydream/plugin-testing";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  test,
  vi,
  onTestFinished,
} from "vitest";
import { DEV, flush } from "solid-js";

import activate from "./index";
import manifest from "./manifest.json";
import { measureNaturalTextItem } from "./measurement";

let appStore: AppStore;
beforeEach(() => {
  const stacks: string[] = [];
  const stop = DEV?.diagnostics.subscribe((event) => {
    if (event.code === "STRICT_READ_UNTRACKED" && stacks.length === 0)
      stacks.push(new Error("diagnostic origin").stack ?? "no stack");
  });
  onTestFinished(() => {
    stop?.();
    expect(stacks).toEqual([]);
  });
  const kernel = createTestKernel({ document: createEmptyDocument() });
  appStore = kernel.store;
  onTestFinished(() => kernel.dispose());
});

function mountShell(
  options: Omit<MountPluginOptions, "entry" | "manifest"> = {},
): Promise<MountedPlugin> {
  return mountPlugin({ ...options, entry: activate, manifest });
}

afterEach(() => {
  appStore.loadDocument(createEmptyDocument(), { slug: null });
});

function canvasEl(host: HTMLElement): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>("div")).find(
    (el) => Array.from(el.classList).some((name) => /^_?canvas_/.test(name)),
  );
  if (found === undefined) throw new Error("no canvas element");
  return found;
}

function inputText(editor: HTMLElement, text: string): void {
  editor.textContent = text;
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: false,
      inputType: "insertText",
      data: text,
    }),
  );
  flush();
}

describe("canvas text plugin", () => {
  test("command-driven editor switching commits the previous session without duplicate editors", async () => {
    const { host, kernel } = await mountShell({
      document: {
        version: 5,
        items: [
          {
            id: "first",
            kind: "mbavio.text",
            position: { x: 0, y: 0 },
            payload: { text: "First" },
          },
          {
            id: "second",
            kind: "mbavio.text",
            position: { x: 0, y: 80 },
            payload: { text: "Second" },
          },
        ],
      },
    });
    appStore.setSelectedId("first");
    flush();
    kernel.commands.runCommand("mbavio.text.edit");
    flush();
    await Promise.resolve();
    const first = host.querySelector<HTMLElement>(
      '[data-text-item="first"] [data-text-editor]',
    )!;
    inputText(first, "First changed");
    appStore.setSelectedId("second");
    flush();
    kernel.commands.runCommand("mbavio.text.edit");
    flush();
    await Promise.resolve();
    expect(host.querySelectorAll("[data-text-editor]")).toHaveLength(1);
    const second = host.querySelector<HTMLElement>(
      '[data-text-item="second"] [data-text-editor]',
    )!;
    inputText(second, "Second changed");
    second.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    appStore.undo();
    expect(appStore.document.items.map((item) => item.payload)).toEqual([
      { text: "First changed" },
      { text: "Second" },
    ]);
    appStore.undo();
    expect(appStore.document.items.map((item) => item.payload)).toEqual([
      { text: "First" },
      { text: "Second" },
    ]);
  });

  test.each([false, true])(
    "a moved second click cannot become an empty-canvas text double-click (frame flushed: %s)",
    async (flushFrame) => {
      const { host } = await mountShell();
      const canvas = canvasEl(host);
      const rect = canvas.getBoundingClientRect();
      const pointer = (
        type: "pointerdown" | "pointermove" | "pointerup",
        x: number,
        buttons: number,
      ): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 71,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons,
            clientX: rect.left + x,
            clientY: rect.top + 100,
          }),
        );
      };

      pointer("pointerdown", 100, 1);
      pointer("pointerup", 100, 0);
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
      pointer("pointerdown", 100, 1);
      pointer("pointermove", 300, 1);
      if (flushFrame) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      pointer("pointerup", 300, 0);
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
      canvas.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          clientX: rect.left + 300,
          clientY: rect.top + 100,
        }),
      );
      flush();
      expect(host.querySelector("[data-text-editor]")).toBeNull();
      expect(appStore.document.items).toHaveLength(0);

      // A subsequent non-moving press clears the one-shot suppression.
      pointer("pointerdown", 180, 1);
      pointer("pointerup", 180, 0);
      canvas.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          clientX: rect.left + 180,
          clientY: rect.top + 120,
        }),
      );
      flush();
      expect(host.querySelector("[data-text-editor]")).not.toBeNull();
    },
  );

  test("double-clicking empty canvas creates, edits, commits, selects and undoes one text item", async () => {
    const { host } = await mountShell();
    const canvas = canvasEl(host);
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + 180;
    const clientY = rect.top + 140;
    const expected = screenToWorld(
      {
        panX: appStore.panX(),
        panY: appStore.panY(),
        zoom: appStore.zoom(),
      },
      clientX - rect.left,
      clientY - rect.top,
    );

    canvas.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      }),
    );
    flush();

    let editor: HTMLElement | null = null;
    await vi.waitFor(() => {
      editor = host.querySelector<HTMLElement>("[data-text-editor]");
      expect(editor).not.toBeNull();
      expect(document.activeElement).toBe(editor);
    });
    expect(appStore.document.items).toHaveLength(0);

    inputText(editor!, "Hello");
    expect(appStore.document.items).toHaveLength(1);
    // Longer than history's ordinary 500ms typing burst: the editor owns a
    // transaction, so this is still one canvas undo when committed.
    await new Promise((resolve) => setTimeout(resolve, 550));
    inputText(editor!, "Hello  world\n🌎");
    const item = appStore.document.items[0]!;
    expect(item.kind).toBe("mbavio.text");
    expect(item.payload).toEqual({ text: "Hello  world\n🌎" });
    expect(item.position.x).toBeCloseTo(expected.x, 4);
    expect(item.position.y).toBeCloseTo(expected.y, 4);

    const box = host.querySelector<HTMLElement>("[data-text-item]")!;
    const style = getComputedStyle(box);
    expect(style.fontSize).toBe("24px");
    expect(style.fontWeight).toBe("400");
    expect(style.lineHeight).toBe("33.6px");

    editor!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    expect(host.querySelector("[data-text-editor]")).toBeNull();
    expect(appStore.selectedItemIds()).toEqual([item.id]);

    appStore.undo();
    flush();
    expect(appStore.document.items).toHaveLength(0);
    expect(appStore.canUndo()).toBe(false);
  });

  test("Enter edits the sole selected text at the end and Escape commits it as one undo step", async () => {
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "text-1",
            kind: "mbavio.text",
            position: { x: 40, y: 50 },
            payload: { text: "Original" },
          },
        ],
      },
      { slug: null },
    );
    const { host } = await mountShell();
    const box = host.querySelector<HTMLElement>("[data-text-item]");
    expect(box).not.toBeNull();
    box!.click();
    flush();
    expect(appStore.selectedItemIds()).toEqual(["text-1"]);

    box!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    let editor: HTMLElement | null = null;
    await vi.waitFor(() => {
      editor = host.querySelector<HTMLElement>("[data-text-editor]");
      expect(document.activeElement).toBe(editor);
    });
    const selection = window.getSelection();
    expect(
      (selection?.focusNode === editor &&
        selection.focusOffset === editor!.childNodes.length) ||
        (selection?.focusNode?.nodeType === Node.TEXT_NODE &&
          selection.focusOffset === "Original".length),
    ).toBe(true);

    inputText(editor!, "Changed");
    await new Promise((resolve) => setTimeout(resolve, 550));
    inputText(editor!, "Changed after a pause");
    editor!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    expect(host.querySelector("[data-text-editor]")).toBeNull();
    expect(appStore.document.items[0]!.payload).toEqual({
      text: "Changed after a pause",
    });
    expect(appStore.selectedItemIds()).toEqual(["text-1"]);

    appStore.undo();
    flush();
    expect(appStore.document.items[0]!.payload).toEqual({ text: "Original" });
    expect(appStore.canUndo()).toBe(false);
  });

  test("text uses ordinary resize handles, clamps to 1rem, hides handles while editing, and double-click resets natural sizing", async () => {
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "text-1",
            kind: "mbavio.text",
            position: { x: 40, y: 50 },
            frame: { width: 120, height: 40 },
            payload: { text: "A long line that wraps in a narrow frame" },
          },
        ],
      },
      { slug: null },
    );
    const { host } = await mountShell();
    const box = host.querySelector<HTMLElement>("[data-text-item]")!;
    box.click();
    flush();
    expect(host.querySelectorAll("[data-item-resize]")).toHaveLength(4);

    const right = host.querySelector<HTMLElement>(
      '[data-item-resize="edgeRight"]',
    )!;
    const r = right.getBoundingClientRect();
    right.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 5,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: r.left + 2,
        clientY: r.top + 4,
      }),
    );
    right.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 5,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: r.left - 200,
        clientY: r.top + 4,
      }),
    );
    flush();
    expect(appStore.document.items[0]!.frame?.width).toBe(16);

    const grownRight = host.querySelector<HTMLElement>(
      '[data-item-resize="edgeRight"]',
    )!;
    const grownRect = grownRight.getBoundingClientRect();
    grownRight.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 6,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: grownRect.left + 2,
        clientY: grownRect.top + 4,
      }),
    );
    grownRight.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 6,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: grownRect.left + 7_000 * appStore.zoom(),
        clientY: grownRect.top + 4,
      }),
    );
    flush();
    expect(appStore.document.items[0]!.frame?.width).toBeGreaterThan(6_000);

    box.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        button: 0,
        clientX: box.getBoundingClientRect().left + 4,
        clientY: box.getBoundingClientRect().top + 4,
      }),
    );
    flush();
    expect(host.querySelector("[data-text-editor]")).not.toBeNull();
    expect(host.querySelectorAll("[data-item-resize]")).toHaveLength(0);

    host.querySelector<HTMLElement>("[data-text-editor]")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    const reset = host.querySelector<HTMLElement>(
      '[data-item-resize="edgeRight"]',
    )!;
    reset.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    flush();
    expect(appStore.document.items[0]!.frame).toBeUndefined();
  });

  test("long clipboard text wraps at 60ch and stays centered with all content intact", async () => {
    const { host } = await mountShell();
    const canvas = canvasEl(host);
    const text = "0".repeat(122);
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    const item = appStore.document.items[0]!;
    const natural = measureNaturalTextItem("0".repeat(60))!;
    expect(item.frame?.width).toBeLessThanOrEqual(natural.width);
    expect(item.frame?.height).toBeUndefined();
    expect(item.payload).toEqual({ text });
    const rect = host
      .querySelector<HTMLElement>("[data-text-item]")!
      .getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    expect(rect.height / appStore.zoom()).toBeGreaterThan(natural.height);
    expect(rect.left + rect.width / 2).toBeCloseTo(
      canvasRect.left + canvasRect.width / 2,
      2,
    );
    expect(rect.top + rect.height / 2).toBeCloseTo(
      canvasRect.top + canvasRect.height / 2,
      2,
    );
    appStore.undo();
    expect(appStore.document.items).toHaveLength(0);
  });

  test("plain-text paste outside editors centers auto-width items, cascades repeats, resets after canvas interaction, and undoes one paste at a time", async () => {
    const { host } = await mountShell();
    const canvas = canvasEl(host);
    const canvasRect = canvas.getBoundingClientRect();

    const paste = (text: string): ClipboardEvent => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", text);
      const event = new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      flush();
      return event;
    };

    const firstPaste = paste("first  line\n第二行");
    expect(firstPaste.defaultPrevented).toBe(true);
    expect(appStore.document.items).toHaveLength(1);
    expect(appStore.document.items[0]!.frame).toBeUndefined();
    expect(appStore.document.items[0]!.payload).toEqual({
      text: "first  line\n第二行",
    });
    expect(appStore.selectedItemIds()).toEqual([
      appStore.document.items[0]!.id,
    ]);
    expect(host.querySelector("[data-text-editor]")).toBeNull();
    const first = host
      .querySelectorAll<HTMLElement>("[data-text-item]")[0]!
      .getBoundingClientRect();
    expect(first.left + first.width / 2).toBeCloseTo(
      canvasRect.left + canvasRect.width / 2,
      1,
    );
    expect(first.top + first.height / 2).toBeCloseTo(
      canvasRect.top + canvasRect.height / 2,
      1,
    );

    paste("second");
    const second = host
      .querySelectorAll<HTMLElement>("[data-text-item]")[1]!
      .getBoundingClientRect();
    expect(second.left + second.width / 2).toBeCloseTo(
      canvasRect.left + canvasRect.width / 2 + 16 * appStore.zoom(),
      1,
    );
    expect(second.top + second.height / 2).toBeCloseTo(
      canvasRect.top + canvasRect.height / 2 + 16 * appStore.zoom(),
      1,
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 9,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: canvasRect.left + 4,
        clientY: canvasRect.top + 4,
      }),
    );
    paste("third");
    const third = host
      .querySelectorAll<HTMLElement>("[data-text-item]")[2]!
      .getBoundingClientRect();
    expect(
      Math.abs(
        third.left + third.width / 2 - (canvasRect.left + canvasRect.width / 2),
      ),
    ).toBeLessThan(0.2);

    appStore.undo();
    flush();
    expect(appStore.document.items).toHaveLength(2);
    appStore.undo();
    flush();
    expect(appStore.document.items).toHaveLength(1);

    paste("after undo");
    const afterUndo = host
      .querySelectorAll<HTMLElement>("[data-text-item]")[1]!
      .getBoundingClientRect();
    expect(afterUndo.left + afterUndo.width / 2).toBeCloseTo(
      canvasRect.left + canvasRect.width / 2,
      1,
    );
    expect(afterUndo.top + afterUndo.height / 2).toBeCloseTo(
      canvasRect.top + canvasRect.height / 2,
      1,
    );

    appStore.loadDocument(createEmptyDocument(), { slug: "loaded" });
    flush();
    paste("after load");
    const afterLoad = host
      .querySelector<HTMLElement>("[data-text-item]")!
      .getBoundingClientRect();
    expect(afterLoad.left + afterLoad.width / 2).toBeCloseTo(
      canvasRect.left + canvasRect.width / 2,
      1,
    );
    expect(afterLoad.top + afterLoad.height / 2).toBeCloseTo(
      canvasRect.top + canvasRect.height / 2,
      1,
    );

    const emptyClipboard = new DataTransfer();
    emptyClipboard.setData("text/plain", "  \n");
    const empty = new ClipboardEvent("paste", {
      clipboardData: emptyClipboard,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(empty);
    flush();
    expect(empty.defaultPrevented).toBe(false);
    expect(appStore.document.items).toHaveLength(1);

    const pluginEditor = document.createElement("div");
    pluginEditor.dataset["ddEditable"] = "";
    pluginEditor.contentEditable = "true";
    host.append(pluginEditor);
    pluginEditor.focus();
    const nativeClipboard = new DataTransfer();
    nativeClipboard.setData("text/plain", "belongs in the editor");
    const nativePaste = new ClipboardEvent("paste", {
      clipboardData: nativeClipboard,
      bubbles: true,
      cancelable: true,
    });
    pluginEditor.dispatchEvent(nativePaste);
    flush();
    expect(nativePaste.defaultPrevented).toBe(false);
    expect(appStore.document.items).toHaveLength(1);

    pluginEditor.blur();
    const alreadyHandled = new ClipboardEvent("paste", {
      clipboardData: nativeClipboard,
      bubbles: true,
      cancelable: true,
    });
    alreadyHandled.preventDefault();
    window.dispatchEvent(alreadyHandled);
    flush();
    expect(appStore.document.items).toHaveLength(1);
  });

  test("an unrelated document mutation finalizes editing first and remains a separate undo step", async () => {
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "text-1",
            kind: "mbavio.text",
            position: { x: 40, y: 50 },
            payload: { text: "Original" },
          },
        ],
      },
      { slug: null },
    );
    const { host } = await mountShell();
    const box = host.querySelector<HTMLElement>("[data-text-item]")!;
    box.click();
    flush();
    expect(appStore.selectedItemIds()).toEqual(["text-1"]);
    box.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    let editor: HTMLElement | null = null;
    await vi.waitFor(() => {
      editor = host.querySelector<HTMLElement>("[data-text-editor]");
      expect(editor).not.toBeNull();
    });
    inputText(editor!, "Edited");

    // This is the same public write path an ingest/agent landing uses.
    appStore.setDocument((doc) => {
      doc.items.push({
        id: "agent-item",
        kind: "example.agent",
        position: { x: 300, y: 200 },
        payload: { from: "agent" },
      });
    });
    flush();
    expect(host.querySelector("[data-text-editor]")).toBeNull();
    expect(appStore.document.items.map((item) => item.id)).toEqual([
      "text-1",
      "agent-item",
    ]);

    appStore.undo();
    flush();
    expect(appStore.document.items.map((item) => item.id)).toEqual(["text-1"]);
    expect(appStore.document.items[0]!.payload).toEqual({ text: "Edited" });
    appStore.undo();
    flush();
    expect(appStore.document.items[0]!.payload).toEqual({ text: "Original" });
  });

  test("loading another document invalidates an edit session, and later edits commit against that session's fresh value", async () => {
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "text-1",
            kind: "mbavio.text",
            position: { x: 0, y: 0 },
            payload: { text: "First" },
          },
        ],
      },
      { slug: "first" },
    );
    const { host } = await mountShell();
    const begin = async (): Promise<HTMLElement> => {
      const box = host.querySelector<HTMLElement>("[data-text-item]")!;
      box.click();
      flush();
      expect(appStore.selectedItemIds()).toEqual([box.dataset["textItem"]]);
      box.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      flush();
      let editor: HTMLElement | null = null;
      await vi.waitFor(() => {
        editor = host.querySelector<HTMLElement>("[data-text-editor]");
        expect(editor).not.toBeNull();
      });
      return editor!;
    };

    const firstEditor = await begin();
    inputText(firstEditor, "Uncommitted");
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "text-2",
            kind: "mbavio.text",
            position: { x: 10, y: 10 },
            payload: { text: "Loaded" },
          },
        ],
      },
      { slug: "second" },
    );
    flush();
    expect(host.querySelector("[data-text-editor]")).toBeNull();
    expect(appStore.document.items[0]!.id).toBe("text-2");
    expect(appStore.canUndo()).toBe(false);

    const secondEditor = await begin();
    inputText(secondEditor, "Committed once");
    secondEditor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    const thirdEditor = await begin();
    inputText(thirdEditor, "Escaped, not discarded");
    thirdEditor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    flush();
    expect(appStore.document.items[0]!.payload).toEqual({
      text: "Escaped, not discarded",
    });
  });

  test("the pre-landing measurement seam matches the mounted natural text box", async () => {
    const text = "Measured  text\n🌎";
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "text-1",
            kind: "mbavio.text",
            position: { x: 0, y: 0 },
            payload: { text },
          },
        ],
      },
      { slug: null },
    );
    const { host } = await mountShell();
    const measured = measureNaturalTextItem(text);
    expect(measured).not.toBeNull();
    const box = host.querySelector<HTMLElement>("[data-text-item]")!;
    expect(box.offsetWidth).toBe(Math.round(measured!.width));
    expect(box.offsetHeight).toBe(Math.round(measured!.height));
  });

  test("unmounting a text item disposes its active drag without mutating the loaded document", async () => {
    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "old-text",
            kind: "mbavio.text",
            position: { x: 40, y: 50 },
            payload: { text: "Old" },
          },
        ],
      },
      { slug: "old" },
    );
    const { host } = await mountShell();
    const box = host.querySelector<HTMLElement>("[data-text-item]")!;
    box.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 33,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: box.getBoundingClientRect().left + 3,
        clientY: box.getBoundingClientRect().top + 3,
      }),
    );
    expect(isDragActive()).toBe(true);

    appStore.loadDocument(
      {
        version: 5,
        items: [
          {
            id: "new-text",
            kind: "mbavio.text",
            position: { x: 700, y: 800 },
            payload: { text: "New" },
          },
        ],
      },
      { slug: "new" },
    );
    flush();
    expect(isDragActive()).toBe(false);
    expect(appStore.document.items[0]!.id).toBe("new-text");
    expect(appStore.document.items[0]!.position).toEqual({ x: 700, y: 800 });
    expect(appStore.canUndo()).toBe(false);
  });
});
