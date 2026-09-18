import {
  createEmptyDocument,
  flush,
  mountPlugin,
} from "@daydream/plugin-testing";
import { expect, test } from "vitest";

import activate from "./index";
import manifest from "./manifest.json";

function elementWithClass(host: HTMLElement, prefix: string): HTMLElement {
  const element = Array.from(host.querySelectorAll<HTMLElement>("div")).find(
    (node) =>
      Array.from(node.classList).some((name) =>
        new RegExp(`^_?${prefix}_`).test(name),
      ),
  );
  if (element === undefined) throw new Error(`Missing ${prefix} element`);
  return element;
}

test.each([false, true])(
  "startup centers the activated text renderer, not its temporary placeholder (width-only frame: %s)",
  async (framed) => {
    const doc = createEmptyDocument();
    doc.items.push({
      id: "annotation",
      kind: "mrbavio.text",
      position: { x: 125, y: 450 },
      ...(framed ? { frame: { width: 340 } } : {}),
      payload: { text: "A short annotation", fontSize: 28 },
    });
    const mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: doc,
    });
    const canvas = elementWithClass(
      mounted.host,
      "canvas",
    ).getBoundingClientRect();
    const item = mounted.host
      .querySelector<HTMLElement>("[data-text-item]")!
      .getBoundingClientRect();
    // Initial framing reads integer offset sizes, so allow subpixel glyph
    // rounding. A placeholder-based center is tens of pixels away.
    expect(item.left + item.width / 2).toBeCloseTo(
      canvas.left + canvas.width / 2,
      0,
    );
    expect(item.top + item.height / 2).toBeCloseTo(
      canvas.top + canvas.height / 2,
      0,
    );
  },
);

test.each([null, { text: 17 }, { text: "Dormant", fontSize: "huge" }])(
  "malformed dormant text stays an inert placeholder after activation: %j",
  async (payload) => {
    const doc = createEmptyDocument();
    doc.items.push({
      id: "dormant",
      kind: "mrbavio.text",
      position: { x: 0, y: 0 },
      payload,
    });
    const mounted = await mountPlugin({
      entry: activate,
      manifest,
      document: doc,
    });
    const { host, store } = mounted;
    store.setSelectedId("dormant");
    flush();
    const before = JSON.stringify(store.document);
    expect(host.querySelector("[data-text-item]")).toBeNull();
    expect(
      host.querySelector('[data-item-kind="mrbavio.text"]'),
    ).not.toBeNull();
    const titleBar = elementWithClass(host, "bar");
    expect(titleBar.textContent).toContain("mrbavio.text");
    expect(titleBar.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(host.querySelectorAll("[data-item-resize]")).toHaveLength(4);
    for (const key of ["+", "-", "Enter"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        metaKey: key !== "Enter",
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const copy = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    window.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
    expect(host.querySelector("[data-text-editor]")).toBeNull();
    expect(JSON.stringify(store.document)).toBe(before);
    expect(store.canUndo()).toBe(false);
  },
);

test("disabling text keeps its data, removes interactions and styles, and re-enabling restores it", async () => {
  const doc = createEmptyDocument();
  doc.items.push({
    id: "annotation",
    kind: "mrbavio.text",
    position: { x: 12, y: 24 },
    frame: { width: 340 },
    payload: { text: "Keep this annotation", fontSize: 28 },
  });
  const mounted = await mountPlugin({
    entry: activate,
    manifest,
    document: doc,
  });
  const { host, store, pluginHost } = mounted;
  store.setSelectedId("annotation");
  flush();
  const item = host.querySelector<HTMLElement>("[data-text-item]")!;
  expect(getComputedStyle(item).fontFamily).toContain("Georgia");
  expect(getComputedStyle(item).color).toBe("rgb(255, 255, 255)");
  expect(getComputedStyle(item).lineHeight).toBe("39.2px");
  const before = JSON.stringify(store.document);

  pluginHost.deactivate("mrbavio.text");
  flush();
  expect(host.querySelector("[data-text-item]")).toBeNull();
  expect(
    host.querySelector('[data-item-kind="mrbavio.text"]')?.textContent,
  ).toContain("mrbavio.text");
  // The kind's CSS lived in the item root the kernel mounted (decision
  // #71); with the plugin gone, so is every sheet of its.
  expect(document.querySelector('[data-plugin-item="mrbavio.text"]')).toBeNull();
  expect(JSON.stringify(store.document)).toBe(before);

  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", "Must not paste while disabled");
  const paste = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });
  window.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(false);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "+",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(host.querySelector("[data-text-editor]")).toBeNull();
  expect(JSON.stringify(store.document)).toBe(before);

  await pluginHost.activate();
  flush();
  expect(host.querySelector("[data-text-item]")?.textContent).toBe(
    "Keep this annotation",
  );
  expect(JSON.stringify(store.document)).toBe(before);
  const sheet = host.querySelector<HTMLStyleElement>(
    '[data-plugin-item="mrbavio.text"] > style',
  );
  expect(sheet?.textContent).toMatch(/^@layer dream-plugin \{/);
  expect(sheet?.textContent).toContain(".daydream-text-item");
});

test("unloading during an editor session cancels its draft without losing the committed text", async () => {
  const doc = createEmptyDocument();
  doc.items.push({
    id: "annotation",
    kind: "mrbavio.text",
    position: { x: 0, y: 0 },
    payload: { text: "Committed" },
  });
  const mounted = await mountPlugin({
    entry: activate,
    manifest,
    document: doc,
  });
  mounted.host
    .querySelector("[data-text-item]")!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await Promise.resolve();
  flush();
  const editor = mounted.host.querySelector<HTMLElement>("[data-text-editor]")!;
  editor.textContent = "Uncommitted";
  editor.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText" }),
  );
  flush();
  expect(mounted.store.document.items[0]!.payload).toEqual({
    text: "Uncommitted",
  });
  mounted.pluginHost.deactivate("mrbavio.text");
  flush();
  expect(mounted.store.document.items[0]!.payload).toEqual({
    text: "Committed",
  });
  expect(mounted.host.querySelector("[data-text-editor]")).toBeNull();
  expect(mounted.store.canUndo()).toBe(false);
});
