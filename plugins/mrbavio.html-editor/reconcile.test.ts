// Identity across an edit (decision #58): matched by tag and
// position, depth first; a survivor keeps id, styles, layers and label;
// a newcomer gets a fresh id and nothing else. Each case below is one
// edit a person makes in the pane.
import { describe, expect, test } from "vitest";

import type { DreamElement } from "@daydream/plugin-api";
import { createElement } from "@daydream/plugin-testing";

import type { ParsedElement } from "./parse";
import { reconcile } from "./reconcile";

/** A parsed node, tersely. */
function p(
  tag: string,
  textOrChildren: string | ParsedElement[] = [],
  attrs?: Record<string, string>,
): ParsedElement {
  const node: ParsedElement = { tag, children: [] };
  if (typeof textOrChildren === "string") node.text = textOrChildren;
  else node.children = textOrChildren;
  if (attrs !== undefined) node.attrs = attrs;
  return node;
}

/** Fresh ids the tests can recognise: `new-1`, `new-2`, … */
function ids(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

/** The stored element re-parsed with new children under its own tag. */
const under = (stored: DreamElement, children: ParsedElement[]) =>
  reconcile(stored, p(stored.tag, children), ids());

const idsOf = (el: DreamElement): string[] => el.children.map((c) => c.id);
const tagsOf = (el: DreamElement): string[] => el.children.map((c) => c.tag);

describe("reconcile", () => {
  test("a text edit keeps the element's id, styles, layers and label", () => {
    const h1 = createElement({
      tag: "h1",
      text: "Old",
      label: "Headline",
      styles: { color: "red" },
    });
    h1.conditionals = [
      { condition: "@media (width >= 600px)", styles: { color: "blue" } },
    ];
    const { element, kept } = reconcile(h1, p("h1", "New"), ids());
    expect(element).toEqual({
      id: h1.id,
      tag: "h1",
      text: "New",
      label: "Headline",
      styles: { color: "red" },
      conditionals: [
        { condition: "@media (width >= 600px)", styles: { color: "blue" } },
      ],
      children: [],
    });
    expect(kept).toEqual(new Set([h1.id]));
    // Copies, never the stored objects.
    expect(element.styles).not.toBe(h1.styles);
    expect(element.conditionals![0]).not.toBe(h1.conditionals[0]);
  });

  test("renaming the pane's own element keeps its id", () => {
    const div = createElement({ tag: "div", styles: { padding: "8px" } });
    const { element } = reconcile(div, p("section"), ids());
    expect(element.id).toBe(div.id);
    expect(element.tag).toBe("section");
    expect(element.styles).toEqual({ padding: "8px" });
  });

  test("wrapping the pane's own element keeps it inside a fresh wrapper", () => {
    const h1 = createElement({
      tag: "h1",
      text: "T",
      styles: { color: "red" },
    });
    const { element, kept } = reconcile(h1, p("header", [p("h1", "T")]), ids());
    expect(element.id).toBe("new-1");
    expect(element.styles).toEqual({});
    expect(element.children[0]!.id).toBe(h1.id);
    expect(element.children[0]!.styles).toEqual({ color: "red" });
    expect(kept).toEqual(new Set([h1.id]));
  });

  test("a rename keeps its kind: a deleted image and an added paragraph are not the same element", () => {
    const img = createElement({
      tag: "img",
      attrs: { src: "https://x.test/a.png" },
      styles: { "object-fit": "cover" },
    });
    const para = createElement({ tag: "p", text: "x" });
    const box = createElement({ tag: "div", children: [img, para] });
    const { element, kept } = under(box, [p("p", "x"), p("p", "added")]);
    expect(idsOf(element)).toEqual([para.id, "new-1"]);
    expect(element.children[1]!.styles).toEqual({});
    expect(kept.has(img.id)).toBe(false);
  });

  test("a rename beside an insertion in the same gap pairs by kind", () => {
    const h1 = createElement({ tag: "h1", styles: { color: "red" } });
    const para = createElement({ tag: "p" });
    const box = createElement({ tag: "div", children: [h1, para] });
    const { element } = under(box, [
      p("img", [], { src: "https://x.test/a.png" }),
      p("h2", "x"),
      p("p"),
    ]);
    expect(idsOf(element)).toEqual(["new-1", h1.id, para.id]);
  });

  test("a wrap beside an insertion never hands one id to two elements", () => {
    const inner = createElement({
      tag: "p",
      text: "b",
      styles: { margin: "0" },
    });
    const section = createElement({ tag: "section", children: [inner] });
    const box = createElement({ tag: "div", children: [section] });
    const { element } = under(box, [
      p("article", [p("section", [p("p", "b")])]),
      p("p", "added"),
    ]);
    const all: string[] = [];
    const walk = (el: DreamElement): void => {
      all.push(el.id);
      el.children.forEach(walk);
    };
    walk(element);
    expect(new Set(all).size).toBe(all.length);
    const article = element.children[0]!;
    expect(article.children[0]!.id).toBe(section.id);
    expect(article.children[0]!.children[0]!.id).toBe(inner.id);
    expect(element.children[1]!.id).toMatch(/^new-/);
    expect(element.children[1]!.styles).toEqual({});
  });

  test("renaming a child's tag keeps its id when the old tag is gone and the new one is new", () => {
    const h1 = createElement({ tag: "h1", styles: { "font-size": "2rem" } });
    const para = createElement({ tag: "p" });
    const box = createElement({ tag: "div", children: [h1, para] });
    const { element } = under(box, [p("h2", "x"), p("p")]);
    expect(idsOf(element)).toEqual([h1.id, para.id]);
    expect(element.children[0]!.styles).toEqual({ "font-size": "2rem" });
  });

  test("inserting a sibling in the middle keeps every neighbour", () => {
    const [a, b, c] = ["h1", "p", "p"].map((tag) => createElement({ tag }));
    const box = createElement({ tag: "div", children: [a!, b!, c!] });
    const { element } = under(box, [
      p("h1"),
      p("img", [], { src: "https://x.test/a.png" }),
      p("p"),
      p("p"),
    ]);
    expect(idsOf(element)).toEqual([a!.id, "new-1", b!.id, c!.id]);
    expect(element.children[1]!.styles).toEqual({});
    expect(element.children[1]!.attrs).toEqual({ src: "https://x.test/a.png" });
  });

  test("deleting the first child keeps the rest — by tag, not by index", () => {
    const [a, b, c] = ["h1", "p", "ul"].map((tag) => createElement({ tag }));
    const box = createElement({ tag: "div", children: [a!, b!, c!] });
    const { element, kept } = under(box, [p("p"), p("ul")]);
    expect(idsOf(element)).toEqual([b!.id, c!.id]);
    expect(kept.has(a!.id)).toBe(false);
  });

  test("reordering children of different tags keeps all their ids", () => {
    const [h1, para, list] = ["h1", "p", "ul"].map((tag) =>
      createElement({ tag, styles: { order: tag } }),
    );
    const box = createElement({ tag: "div", children: [h1!, para!, list!] });
    const { element } = under(box, [p("ul"), p("h1"), p("p")]);
    expect(idsOf(element)).toEqual([list!.id, h1!.id, para!.id]);
    expect(element.children.map((c) => c.styles["order"])).toEqual([
      "ul",
      "h1",
      "p",
    ]);
  });

  test("same-tag siblings with the same content keep their ids through a reorder", () => {
    const items = ["one", "two", "three"].map((text) =>
      createElement({ tag: "li", text, styles: { order: text } }),
    );
    const list = createElement({ tag: "ul", children: items });
    const { element } = under(list, [
      p("li", "three"),
      p("li", "one"),
      p("li", "two"),
    ]);
    expect(idsOf(element)).toEqual([items[2]!.id, items[0]!.id, items[1]!.id]);
    expect(element.children.map((c) => c.styles["order"])).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  test("deleting the first of three same-tag siblings keeps the other two by content", () => {
    const columns = ["1", "2", "3"].map((n) =>
      createElement({
        tag: "div",
        text: `col ${n}`,
        styles: { "grid-column": n },
      }),
    );
    const grid = createElement({ tag: "div", children: columns });
    const { element } = under(grid, [p("div", "col 2"), p("div", "col 3")]);
    expect(idsOf(element)).toEqual([columns[1]!.id, columns[2]!.id]);
    expect(element.children.map((c) => c.styles["grid-column"])).toEqual([
      "2",
      "3",
    ]);
  });

  test("same-tag siblings that all changed follow their position: the rule of last resort", () => {
    const items = ["one", "two", "three"].map((text) =>
      createElement({ tag: "li", text }),
    );
    const list = createElement({ tag: "ul", children: items });
    const { element } = under(list, [p("li", "uno"), p("li", "dos")]);
    expect(idsOf(element)).toEqual([items[0]!.id, items[1]!.id]);
  });

  test("wrapping keeps the wrapped elements; the wrapper is new", () => {
    const h1 = createElement({ tag: "h1", styles: { margin: "0" } });
    const para = createElement({ tag: "p", styles: { color: "gray" } });
    const box = createElement({ tag: "section", children: [h1, para] });
    const { element } = under(box, [p("div", [p("h1"), p("p")])]);
    expect(tagsOf(element)).toEqual(["div"]);
    const wrapper = element.children[0]!;
    expect(wrapper.id).toBe("new-1");
    expect(wrapper.styles).toEqual({});
    expect(idsOf(wrapper)).toEqual([h1.id, para.id]);
    expect(wrapper.children.map((c) => c.styles)).toEqual([
      { margin: "0" },
      { color: "gray" },
    ]);
  });

  test("unwrapping keeps the freed elements; the wrapper is gone", () => {
    const h1 = createElement({ tag: "h1", styles: { margin: "0" } });
    const para = createElement({ tag: "p" });
    const wrapper = createElement({ tag: "div", children: [h1, para] });
    const box = createElement({ tag: "section", children: [wrapper] });
    const { element, kept } = under(box, [p("h1"), p("p")]);
    expect(idsOf(element)).toEqual([h1.id, para.id]);
    expect(element.children[0]!.styles).toEqual({ margin: "0" });
    expect(kept.has(wrapper.id)).toBe(false);
  });

  test("a moved element keeps its id across levels, depth first", () => {
    const aside = createElement({ tag: "aside", styles: { width: "200px" } });
    const main = createElement({ tag: "main", children: [aside] });
    const box = createElement({ tag: "div", children: [main] });
    const { element } = under(box, [p("main"), p("aside")]);
    expect(idsOf(element)).toEqual([main.id, aside.id]);
    expect(element.children[1]!.styles).toEqual({ width: "200px" });
  });

  test("a rename is not guessed when the tag still exists elsewhere: wrapping in a new tag", () => {
    // [h1, p] → [header[h1], p]: the header is new, h1 is the same h1 —
    // never "h1 renamed to header, a fresh h1 inside".
    const h1 = createElement({ tag: "h1", styles: { color: "red" } });
    const para = createElement({ tag: "p" });
    const box = createElement({ tag: "div", children: [h1, para] });
    const { element } = under(box, [p("header", [p("h1")]), p("p")]);
    expect(element.children[0]!.id).toBe("new-1");
    expect(element.children[0]!.children[0]!.id).toBe(h1.id);
    expect(element.children[1]!.id).toBe(para.id);
  });

  test("newcomers get fresh ids, each used once, and no survivor's id is re-minted", () => {
    const stored = createElement({
      tag: "div",
      children: [createElement({ tag: "p" })],
    });
    const { element } = under(stored, [
      p("p"),
      p("p"),
      p("ul", [p("li"), p("li")]),
    ]);
    const all: string[] = [];
    const walk = (el: DreamElement): void => {
      all.push(el.id);
      el.children.forEach(walk);
    };
    walk(element);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((id) => id.startsWith("new-"))).toHaveLength(4);
    expect(all).toContain(stored.id);
    expect(all).toContain(stored.children[0]!.id);
  });

  test("attributes and text come from the parse: a dropped attribute is gone, an empty text is absent", () => {
    const img = createElement({
      tag: "img",
      attrs: { src: "https://x.test/a.png", alt: "A" },
    });
    const box = createElement({ tag: "div", text: "hello", children: [img] });
    const { element } = under(box, [
      p("img", [], { src: "https://x.test/b.png" }),
    ]);
    expect(element.text).toBeUndefined();
    expect(element.children[0]!.id).toBe(img.id);
    expect(element.children[0]!.attrs).toEqual({ src: "https://x.test/b.png" });
  });
});
