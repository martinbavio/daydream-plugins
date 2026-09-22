import {
  createTestKernel,
  mountPlugin,
  type AppStore,
  type MountPluginOptions,
  type MountedPlugin,
  createEmptyDocument,
} from "@daydream/plugin-testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  onTestFinished,
} from "vitest";
import { flush } from "solid-js";

import activate from "./index";
import manifest from "./manifest.json";
import type { DreamDocument } from "@daydream/plugin-api";

let appStore: AppStore;
beforeEach(() => {
  const kernel = createTestKernel({ document: createEmptyDocument() });
  appStore = kernel.store;
  onTestFinished(() => kernel.dispose());
});

function mountShell(
  options: Omit<MountPluginOptions, "entry" | "manifest"> = {},
): Promise<MountedPlugin> {
  return mountPlugin({ ...options, entry: activate, manifest });
}

beforeEach(() => window.getSelection()?.removeAllRanges());

afterEach(() => {
  appStore.loadDocument(createEmptyDocument(), { slug: null });
});

const textDocument = (): DreamDocument => ({
  version: 7,
  items: [
    {
      id: "text-1",
      kind: "mrbavio.text",
      position: { x: 24, y: 32 },
      payload: { text: "Hello\nworld 🌎" },
    },
  ],
});

const twoItemDocument = (): DreamDocument => ({
  version: 7,
  items: [
    ...textDocument().items,
    {
      id: "text-2",
      kind: "mrbavio.text",
      position: { x: 80, y: 96 },
      payload: { text: "Second" },
    },
  ],
});

function copy(target: EventTarget): {
  event: ClipboardEvent;
  data: DataTransfer;
} {
  const data = new DataTransfer();
  const event = new ClipboardEvent("copy", {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  });
  target.dispatchEvent(event);
  return { event, data };
}

describe("copying a canvas text item", () => {
  test("one selected text item copies its complete plain text", async () => {
    await mountShell({ document: textDocument() });
    appStore.setItemSelection(["text-1"]);
    flush();

    const result = copy(document.body);

    expect(result.event.defaultPrevented).toBe(true);
    expect(result.data.getData("text/plain")).toBe("Hello\nworld 🌎");
    expect(result.data.getData("text/html")).toBe("");
  });

  test("an active editor retains native copy behavior", async () => {
    const { host } = await mountShell({ document: textDocument() });
    appStore.setItemSelection(["text-1"]);
    flush();
    const editor = document.createElement("textarea");
    editor.value = "native selection";
    host.appendChild(editor);
    editor.focus();
    editor.select();

    const result = copy(editor);

    expect(result.event.defaultPrevented).toBe(false);
    expect(result.data.getData("text/plain")).toBe("");
  });

  test("a multi-item selection is left for a future structured clipboard", async () => {
    await mountShell({ document: twoItemDocument() });
    appStore.setItemSelection(["text-1", "text-2"]);
    flush();

    const result = copy(document.body);

    expect(result.event.defaultPrevented).toBe(false);
    expect(result.data.getData("text/plain")).toBe("");
  });

  test("copy inside a plugin editor keeps its native clipboard behavior", async () => {
    const { host } = await mountShell({ document: textDocument() });
    appStore.setItemSelection(["text-1"]);
    flush();
    const editor = document.createElement("div");
    editor.dataset.ddEditable = "";
    const control = document.createElement("button");
    control.textContent = "Editor control";
    editor.appendChild(control);
    host.appendChild(editor);
    control.focus();

    const result = copy(control);

    expect(result.event.defaultPrevented).toBe(false);
    expect(result.data.getData("text/plain")).toBe("");
  });

  test("copy adds no undo step and stops intercepting after the shell unmounts", async () => {
    const mounted = await mountShell({ document: textDocument() });
    appStore.setItemSelection(["text-1"]);
    flush();
    copy(document.body);
    expect(appStore.canUndo()).toBe(false);

    mounted.dispose();
    const result = copy(document.body);
    expect(result.event.defaultPrevented).toBe(false);
  });
});
