import {
  createTestKernel,
  mountPlugin,
  type AppStore,
  type MountPluginOptions,
  type MountedPlugin,
  createEmptyDocument,
  documentFrom,
} from "@daydream/plugin-testing";
import {
  beforeEach,
  afterEach,
  expect,
  test,
  vi,
  onTestFinished,
} from "vitest";
import { flush, snapshot } from "solid-js";
import { userEvent } from "vitest/browser";
import activate from "./index";
import manifest from "./manifest.json";
import type { DreamItem } from "@daydream/plugin-api";
import { measureNaturalTextItem } from "./measurement";

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

afterEach(() => appStore.loadDocument(createEmptyDocument(), { slug: null }));

test.each([undefined, { width: 240 }])(
  "auto-height text shrinks with the font, including below the old 16px floor (%j)",
  async (frame) => {
    const { host } = await mountShell({
      document: {
        version: 5,
        items: [{ ...textItem(frame), payload: { text: "Hello" } }],
      },
    });
    appStore.setItemSelection(["text"]);
    flush();
    const node = host.querySelector<HTMLElement>("[data-text-item]")!;
    const originalHeight = node.getBoundingClientRect().height;
    chord("-");
    expect(node.getBoundingClientRect().height / originalHeight).toBeCloseTo(
      22 / 24,
      2,
    );
    for (let step = 0; step < 6; step++) chord("-");
    expect(getComputedStyle(node).fontSize).toBe("10px");
    expect(node.getBoundingClientRect().height / originalHeight).toBeCloseTo(
      10 / 24,
      2,
    );
    expect(appStore.document.items[0]!.frame?.height).toBeUndefined();
    if (frame === undefined)
      expect(appStore.document.items[0]!.frame).toBeUndefined();
  },
);

function chord(
  key: string,
  target: EventTarget = document.body,
  shiftKey = false,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  flush();
  return event;
}

function textItem(frame?: { width: number; height?: number }): DreamItem {
  return {
    id: "text",
    kind: "mrbavio.text",
    position: { x: 40, y: 60 },
    payload: { text: "Same characters on each line. ".repeat(5) },
    ...(frame === undefined ? {} : { frame }),
  };
}

test("plus/minus adjust white text and proportional width, preserving lines, position and explicit height with undo", async () => {
  const { host } = await mountShell({
    document: { version: 5, items: [textItem({ width: 300, height: 100 })] },
  });
  appStore.setItemSelection(["text"]);
  flush();
  const node = host.querySelector<HTMLElement>("[data-text-item]")!;
  const originalHeight = node.firstElementChild!.getBoundingClientRect().height;
  expect(getComputedStyle(node).color).toBe("rgb(255, 255, 255)");
  expect(getComputedStyle(node).fontFamily).toBe(
    'Georgia, "Times New Roman", serif',
  );
  expect(parseFloat(getComputedStyle(node).lineHeight)).toBeCloseTo(24 * 1.4);
  expect(chord("+", document.body, true).defaultPrevented).toBe(true);
  const item = appStore.document.items[0]!;
  expect(item.payload).toMatchObject({ fontSize: 26 });
  expect(item.frame).toEqual({ width: 325, height: 100 });
  expect(item.position).toEqual({ x: 40, y: 60 });
  expect(getComputedStyle(node).fontSize).toBe("26px");
  expect(
    node.firstElementChild!.getBoundingClientRect().height / originalHeight,
  ).toBeCloseTo(26 / 24, 2);
  expect(chord("-").defaultPrevented).toBe(true);
  expect(item.frame!.width).toBeCloseTo(300, 8);
  expect(getComputedStyle(node).fontSize).toBe("24px");
  appStore.undo();
  expect(appStore.document.items[0]!.frame!.width).toBe(325);
  appStore.undo();
  expect(appStore.document.items[0]!.payload).not.toHaveProperty("fontSize");
});

test("equals shortcut handles mixed selections but leaves other editors and non-text items alone", async () => {
  const { host } = await mountShell({
    document: {
      version: 5,
      items: [
        textItem(),
        {
          id: "other",
          kind: "example.box",
          position: { x: 0, y: 0 },
          payload: {},
        },
      ],
    },
  });
  appStore.setItemSelection(["text", "other"]);
  flush();
  expect(chord("=").defaultPrevented).toBe(true);
  expect(appStore.document.items[0]!.frame).toBeUndefined();
  expect(appStore.document.items[1]!.payload).toEqual({});
  const node = host.querySelector<HTMLElement>("[data-text-item]")!;
  const measured = measureNaturalTextItem(
    (appStore.document.items[0]!.payload as { text: string }).text,
    undefined,
    26,
  )!;
  expect(node.getBoundingClientRect().width / appStore.zoom()).toBeCloseTo(
    measured.width,
    2,
  );
  const input = document.createElement("textarea");
  host.append(input);
  input.focus();
  expect(chord("+", input).defaultPrevented).toBe(false);
  input.remove();
  appStore.setItemSelection(["other"]);
  flush();
  expect(chord("-").defaultPrevented).toBe(false);
});

test("font sizing during native editing keeps the caret, persists through typing, and commits as one session", async () => {
  const { host } = await mountShell({
    document: {
      version: 5,
      items: [
        {
          ...textItem({ width: 240 }),
          payload: { text: "Hello", fontSize: 24 },
        },
      ],
    },
  });
  appStore.setItemSelection(["text"]);
  flush();
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  const editor = host.querySelector<HTMLElement>("[data-text-editor]")!;
  expect(getComputedStyle(editor).fontFamily).toBe(
    'Georgia, "Times New Roman", serif',
  );
  expect(parseFloat(getComputedStyle(editor).lineHeight)).toBeCloseTo(24 * 1.4);
  await userEvent.keyboard(" world");
  expect(chord("+", editor).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(editor);
  expect(host.querySelector("[data-text-editor]")).toBe(editor);
  await userEvent.keyboard("!");
  expect(appStore.document.items[0]!.payload).toEqual({
    text: "Hello world!",
    fontSize: 26,
  });
  expect(appStore.document.items[0]!.frame!.width).toBe(260);
  await userEvent.keyboard("{Escape}");
  expect(appStore.document.items[0]!.payload).toEqual({
    text: "Hello world!",
    fontSize: 26,
  });
  expect(appStore.document.items[0]!.frame!.width).toBe(260);
  appStore.undo();
  flush();
  expect(appStore.document.items[0]!.payload).toEqual({
    text: "Hello",
    fontSize: 24,
  });
  expect(appStore.document.items[0]!.frame!.width).toBe(240);
  expect(appStore.canUndo()).toBe(false);
});

test("empty draft sizing takes effect before the first character, without creating a blank item", async () => {
  const { host } = await mountShell({ document: createEmptyDocument() });
  const canvas = Array.from(host.querySelectorAll<HTMLElement>("div")).find(
    (node) =>
      Array.from(node.classList).some((name) => /^_?canvas_/.test(name)),
  )!;
  canvas.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, button: 0 }),
  );
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  const editor = host.querySelector<HTMLElement>("[data-text-editor]")!;
  chord("+", editor);
  expect(appStore.document.items).toHaveLength(0);
  await userEvent.keyboard("Hi");
  expect(appStore.document.items[0]!.payload).toEqual({
    text: "Hi",
    fontSize: 26,
  });
  expect(
    getComputedStyle(host.querySelector<HTMLElement>("[data-text-item]")!)
      .fontSize,
  ).toBe("26px");
  chord("Enter", editor);
  appStore.undo();
  expect(appStore.document.items).toHaveLength(0);
});

test("adjusted size survives duplication and document serialization, and never decreases below 2px", async () => {
  await mountShell({ document: { version: 5, items: [textItem()] } });
  appStore.setItemSelection(["text"]);
  flush();
  chord("+");
  chord("d");
  const saved = JSON.parse(
    JSON.stringify(snapshot(appStore.document)),
  ) as unknown;
  const parsed = documentFrom(saved);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  appStore.loadDocument(parsed.doc, { slug: "saved-text" });
  expect(appStore.document.items).toHaveLength(2);
  expect(appStore.document.items.map((item) => item.payload)).toEqual([
    expect.objectContaining({ fontSize: 26 }),
    expect.objectContaining({ fontSize: 26 }),
  ]);
  appStore.setItemSelection(["text"]);
  flush();
  for (let index = 0; index < 20; index++) chord("-");
  expect(appStore.document.items[0]!.payload).toMatchObject({ fontSize: 2 });
});
