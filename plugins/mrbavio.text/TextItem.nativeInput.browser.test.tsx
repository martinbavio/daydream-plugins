import {
  createTestKernel,
  mountPlugin,
  type AppStore,
  type MountPluginOptions,
  type MountedPlugin,
  createEmptyDocument,
} from "@daydream/plugin-testing";
import {
  beforeEach,
  afterEach,
  expect,
  test,
  vi,
  onTestFinished,
} from "vitest";
import { userEvent } from "vitest/browser";

import activate from "./index";
import manifest from "./manifest.json";

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

afterEach(() => {
  appStore.loadDocument(createEmptyDocument(), { slug: null });
});

test("native text undo edits content without invoking canvas undo", async () => {
  const { host } = await mountShell({ document: createEmptyDocument() });
  await userEvent.dblClick(canvasEl(host));
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  await userEvent.keyboard("Hello{Enter}world");
  const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
  expect(host.querySelector("[data-text-editor]")).not.toBeNull();
  expect(appStore.document.items).toHaveLength(1);
  expect(appStore.document.items[0]!.payload).not.toEqual({
    text: "Hello\nworld",
  });
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
  expect(host.querySelector("[data-text-editor]")).toBeNull();
});

test("committing a trailing line break retains the empty line and natural height", async () => {
  const { host } = await mountShell({ document: createEmptyDocument() });
  await userEvent.dblClick(canvasEl(host));
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  await userEvent.keyboard("Hello{Enter}");
  expect(appStore.document.items[0]!.payload).toEqual({ text: "Hello\n" });
  const editingHeight =
    host.querySelector<HTMLElement>("[data-text-item]")!.offsetHeight;
  const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
  const committed = host.querySelector<HTMLElement>("[data-text-item]")!;
  expect(committed.offsetHeight).toBe(editingHeight);
  expect(committed.offsetHeight).toBe(67);
});

test("deleting back to a trailing line break does not persist the browser sentinel", async () => {
  const { host } = await mountShell({ document: createEmptyDocument() });
  await userEvent.dblClick(canvasEl(host));
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  await userEvent.keyboard(
    "Hello{Enter}world{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}",
  );
  expect(appStore.document.items[0]!.payload).toEqual({ text: "Hello\n" });
});

test("reopening trailing-newline text restores its empty line and edits at the logical end", async () => {
  const doc = createEmptyDocument();
  doc.items.push({
    id: "text-1",
    kind: "mbavio.text",
    position: { x: 40, y: 50 },
    payload: { text: "Hello\n" },
  });
  const { host } = await mountShell({ document: doc });
  const box = host.querySelector<HTMLElement>("[data-text-item]")!;
  await userEvent.click(box);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  expect(
    host.querySelector<HTMLElement>("[data-text-item]")!.offsetHeight,
  ).toBe(67);

  await userEvent.keyboard("x");
  expect(appStore.document.items[0]!.payload).toEqual({ text: "Hello\nx" });
});

function canvasEl(host: HTMLElement): HTMLElement {
  const canvas = Array.from(host.querySelectorAll<HTMLElement>("div")).find(
    (el) => Array.from(el.classList).some((name) => /^_?canvas_/.test(name)),
  );
  if (canvas === undefined) throw new Error("no canvas");
  return canvas;
}

test("native typing preserves lines and clicking empty canvas commits", async () => {
  const { host } = await mountShell({ document: createEmptyDocument() });
  const canvas = canvasEl(host);
  await userEvent.dblClick(canvas);
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  const editor = host.querySelector<HTMLElement>("[data-text-editor]")!;
  await userEvent.keyboard("Hello{Enter}world");
  expect(appStore.document.items[0]!.payload).toEqual({ text: "Hello\nworld" });
  expect(host.querySelector("[data-text-editor]")).toBe(editor);

  // Click the top-left of the actual canvas, away from the centered draft.
  await userEvent.click(canvas, { position: { x: 8, y: 8 } });
  expect(host.querySelector("[data-text-editor]")).toBeNull();
  expect(appStore.selectedItemIds()).toEqual([appStore.document.items[0]!.id]);
  appStore.undo();
  expect(appStore.document.items).toHaveLength(0);
});

test("a temporarily blank existing editor keeps valid document data until blank commit deletes it", async () => {
  const doc = createEmptyDocument();
  doc.items.push({
    id: "text-1",
    kind: "mbavio.text",
    position: { x: 40, y: 50 },
    payload: { text: "Keep this valid" },
  });
  const { host } = await mountShell({ document: doc });
  await userEvent.dblClick(
    host.querySelector<HTMLElement>("[data-text-item]")!,
  );
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}{Backspace}`);
  expect(
    host.querySelector<HTMLElement>("[data-text-editor]")!.innerText.trim(),
  ).toBe("");
  expect(appStore.document.items[0]!.payload).toEqual({
    text: "Keep this valid",
  });

  await userEvent.click(canvasEl(host), { position: { x: 8, y: 8 } });
  expect(appStore.document.items).toHaveLength(0);
  appStore.undo();
  expect(appStore.document.items[0]!.payload).toEqual({
    text: "Keep this valid",
  });
});

test("outside press commits the actively edited item when multiple text items are mounted", async () => {
  const doc = createEmptyDocument();
  doc.items.push(
    {
      id: "text-1",
      kind: "mbavio.text",
      position: { x: 40, y: 50 },
      payload: { text: "First" },
    },
    {
      id: "text-2",
      kind: "mbavio.text",
      position: { x: 240, y: 50 },
      payload: { text: "Second" },
    },
  );
  const { host } = await mountShell({ document: doc });
  const first = host.querySelector<HTMLElement>('[data-text-item="text-1"]')!;
  await userEvent.dblClick(first);
  await vi.waitFor(() =>
    expect(host.querySelector("[data-text-editor]")).not.toBeNull(),
  );
  const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}Changed`);
  await userEvent.click(canvasEl(host), { position: { x: 8, y: 8 } });

  expect(host.querySelector("[data-text-editor]")).toBeNull();
  expect(appStore.document.items[0]!.payload).toEqual({ text: "Changed" });
  expect(appStore.document.items[1]!.payload).toEqual({ text: "Second" });
  expect(appStore.selectedItemIds()).toEqual(["text-1"]);
});
