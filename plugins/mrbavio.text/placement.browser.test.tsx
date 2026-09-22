import {
  createTestKernel,
  mountPlugin,
  type AppStore,
  type MountPluginOptions,
  type MountedPlugin,
  createEmptyDocument,
  getCanvasItemNode,
  createTestRequestHandlers,
} from "@daydream/plugin-testing";
import { beforeEach, afterEach, expect, test, onTestFinished } from "vitest";
import { flush } from "solid-js";

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

afterEach(() => appStore.loadDocument(createEmptyDocument(), { slug: null }));

test("ingest wraps long text at 60ch before relative placement, keeping short text auto-width", async () => {
  const mounted = await mountShell({ document: createEmptyDocument() });
  const { store } = mounted;
  store.setZoom(1);
  const short = "0".repeat(60);
  const long = `${short}0`;
  const handlers = await createTestRequestHandlers(mounted);
  await handlers.ingest({
    dream: {
      version: 7,
      items: [{ kind: "mrbavio.text", payload: { text: short } }],
    },
  });
  const target = store.document.items[0]!;
  expect(target.frame).toBeUndefined();
  const targetNode = getCanvasItemNode(target.id)!;
  const targetRect = targetNode.getBoundingClientRect();
  // CSS ch is the font's zero advance, not the width of a shaped run of
  // 60 zero glyphs (kerning/letter spacing can make those differ).
  const capProbe = document.createElement("div");
  capProbe.style.font = getComputedStyle(targetNode).font;
  capProbe.style.width = "60ch";
  document.body.append(capProbe);
  const capWidth = capProbe.getBoundingClientRect().width;
  capProbe.remove();
  const version = store.documentVersion();
  await handlers.ingest({
    dream: {
      version: 7,
      items: [{ kind: "mrbavio.text", payload: { text: long } }],
    },
    placement: { relation: "above", target: { itemId: target.id } },
  });
  const added = store.document.items[1]!;
  const addedRect = getCanvasItemNode(added.id)!.getBoundingClientRect();
  expect(added.frame?.width).toBeCloseTo(capWidth, 2);
  expect(added.frame?.height).toBeUndefined();
  expect(addedRect.height).toBeGreaterThan(targetRect.height);
  expect(addedRect.bottom).toBeCloseTo(targetRect.top - 32, 2);
  expect(added.payload).toEqual({ text: long });
  expect(store.documentVersion() - version).toBe(1);
  store.undo();
  expect(store.document.items).toHaveLength(1);
});

test("ingest preserves explicit text frames and counts Unicode characters, not UTF-16 units", async () => {
  const mounted = await mountShell({ document: createEmptyDocument() });
  const { store } = mounted;
  await (
    await createTestRequestHandlers(mounted)
  ).ingest({
    dream: {
      version: 7,
      items: [
        { kind: "mrbavio.text", payload: { text: "🌎".repeat(60) } },
        {
          kind: "mrbavio.text",
          frame: { width: 200 },
          payload: { text: "Long text ".repeat(20) },
        },
      ],
    },
  });
  expect(store.document.items[0]!.frame).toBeUndefined();
  expect(store.document.items[1]!.frame).toEqual({ width: 200 });
});

test.each([undefined, { relation: "above", target: { itemId: "missing" } }])(
  "default placement stays to the right of live auto-width text (%j)",
  async (placement) => {
    const mounted = await mountShell({
      document: {
        version: 7,
        items: [
          {
            id: "long-label",
            kind: "mrbavio.text",
            position: { x: 0, y: 100 },
            payload: { text: "A long label ".repeat(20) },
          },
        ],
      },
    });
    const { store } = mounted;
    const existingWidth = getCanvasItemNode("long-label")!.offsetWidth;
    expect(existingWidth).toBeGreaterThan(1000);
    await (
      await createTestRequestHandlers(mounted)
    ).ingest({
      dream: {
        version: 7,
        items: [{ kind: "mrbavio.text", payload: { text: "Next" } }],
      },
      ...(placement === undefined ? {} : { placement }),
    });
    expect(store.document.items[1]!.position).toEqual({
      x: existingWidth + 48,
      y: 100,
    });
  },
);

test("auto-width text lands left-aligned above visible title chrome at the current zoom", async () => {
  const mounted = await mountShell({
    document: {
      version: 7,
      items: [
        {
          id: "target",
          kind: "example.box",
          payload: {},
          position: { x: 100, y: 200 },
          frame: { width: 300, height: 200 },
        },
      ],
    },
  });
  const { store } = mounted;
  store.setZoom(0.5);
  store.setItemSelection(["target"]);
  flush();
  const camera = { x: store.panX(), y: store.panY(), zoom: store.zoom() };
  const handlers = await createTestRequestHandlers(mounted);
  await handlers.ingest({
    dream: {
      version: 7,
      items: [{ kind: "mrbavio.text", payload: { text: "Hello\nworld" } }],
    },
    placement: { relation: "above", target: "selection" },
  });
  const landed = store.document.items[1]!;
  const targetRect = getCanvasItemNode("target")!.getBoundingClientRect();
  const textRect = getCanvasItemNode(landed.id)!.getBoundingClientRect();

  expect(textRect.left).toBeCloseTo(targetRect.left, 3);
  expect(textRect.bottom).toBeCloseTo(targetRect.top - 24 - 16, 3);
  expect(landed.frame).toBeUndefined();
  expect(store.selectedItemIds()).toEqual([landed.id]);
  expect({ x: store.panX(), y: store.panY(), zoom: store.zoom() }).toEqual(
    camera,
  );
});
