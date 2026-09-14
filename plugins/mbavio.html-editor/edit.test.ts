// The two working-copy edits: a subtree swapped for its re-parsed self
// (the root included), and one element removed from its parent.
import { describe, expect, test } from "vitest";

import { createElement, createViewportItem } from "@daydream/plugin-testing";

import { parentOf, removeElement, replaceSubtree, sameElement } from "./edit";

function payload() {
  const inner = createElement({ tag: "p", text: "x" });
  const box = createElement({ tag: "div", children: [inner] });
  const body = createElement({ tag: "body", children: [box] });
  const root = createElement({ tag: "html", children: [body] });
  return { payload: createViewportItem(root).payload, root, body, box, inner };
}

describe("parentOf", () => {
  test("walks the tree; the root and a stranger have none", () => {
    const { root, body, box, inner } = payload();
    expect(parentOf(root, inner.id)).toBe(box);
    expect(parentOf(root, box.id)).toBe(body);
    expect(parentOf(root, root.id)).toBeUndefined();
    expect(parentOf(root, "nobody")).toBeUndefined();
  });
});

describe("replaceSubtree", () => {
  test("swaps an inner subtree in place, keeping its siblings' order", () => {
    const { payload: vp, body, box } = payload();
    const before = createElement({ tag: "hr" });
    body.children.unshift(before);
    const next = createElement({ tag: "section" });
    expect(replaceSubtree(vp, box.id, next)).toBe(true);
    expect(body.children.map((c) => c.id)).toEqual([before.id, next.id]);
  });

  test("replaces the root itself, and reports an unknown id", () => {
    const { payload: vp, root } = payload();
    const next = createElement({ tag: "html" });
    expect(replaceSubtree(vp, root.id, next)).toBe(true);
    expect(vp.root).toBe(next);
    expect(replaceSubtree(vp, "nobody", next)).toBe(false);
  });
});

describe("removeElement", () => {
  test("removes an inner element and answers its parent's id", () => {
    const { payload: vp, box, inner } = payload();
    expect(removeElement(vp, inner.id)).toBe(box.id);
    expect(box.children).toEqual([]);
  });

  test("never removes the root, nor a stranger", () => {
    const { payload: vp, root } = payload();
    expect(removeElement(vp, root.id)).toBeUndefined();
    expect(removeElement(vp, "nobody")).toBeUndefined();
    expect(vp.root).toBe(root);
  });
});

describe("sameElement", () => {
  test("is deep equality over the element tree, absent and empty alike", () => {
    const a = createElement({
      tag: "p",
      text: "x",
      attrs: { href: "#a" },
      styles: { color: "red" },
      children: [createElement({ tag: "em", text: "y" })],
    });
    const b = structuredClone(a);
    expect(sameElement(a, b)).toBe(true);
    b.children[0]!.text = "z";
    expect(sameElement(a, b)).toBe(false);
    const c = structuredClone(a);
    c.conditionals = [];
    expect(sameElement(a, c)).toBe(true);
    c.conditionals = [{ condition: "@media (width >= 1px)", styles: {} }];
    expect(sameElement(a, c)).toBe(false);
    const d = structuredClone(a);
    d.attrs = { href: "#b" };
    expect(sameElement(a, d)).toBe(false);
  });
});
