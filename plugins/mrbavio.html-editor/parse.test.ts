// The pure half of parsing, over hand-built nodes shaped like the DOM's
// (NodeLike): the model's grain — one text per element, spans for mixed
// runs, indentation dropped — and the kernel's refusals, through the
// same rules `dd.core` carries.
import { describe, expect, test } from "vitest";

import { coreApi } from "@daydream/plugin-testing";

import {
  stripIndentation,
  treeFromNodes,
  type NodeLike,
  type ParsedElement,
} from "./parse";

const rules = coreApi();

/** An element node, the DOM's way: upper-case nodeName, attribute
 * accessors, children in order. */
function el(
  tag: string,
  attrs: Record<string, string>,
  ...children: NodeLike[]
): NodeLike {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    nodeValue: null,
    childNodes: children,
    getAttributeNames: () => Object.keys(attrs),
    getAttribute: (name) => attrs[name] ?? null,
  };
}
const text = (value: string): NodeLike => ({
  nodeType: 3,
  nodeName: "#text",
  nodeValue: value,
  childNodes: [],
});
const comment = (value: string): NodeLike => ({
  nodeType: 8,
  nodeName: "#comment",
  nodeValue: value,
  childNodes: [],
});

function parsed(...nodes: NodeLike[]): ParsedElement {
  const result = treeFromNodes(nodes, rules);
  if (!result.ok) throw new Error(result.problem);
  return result.element;
}
function refused(...nodes: NodeLike[]): string {
  const result = treeFromNodes(nodes, rules);
  if (result.ok) throw new Error("expected a refusal");
  return result.problem;
}

describe("treeFromNodes", () => {
  test("a text-only element keeps its text; tags are folded to lower case", () => {
    expect(parsed(el("H1", {}, text("Title")))).toEqual({
      tag: "h1",
      text: "Title",
      children: [],
    });
  });

  test("the serializer's indentation is dropped around text and between children", () => {
    const tree = parsed(
      text("\n"),
      el(
        "section",
        {},
        text("\n  "),
        el("h2", {}, text("\n    Title\n  ")),
        text("\n  "),
        el("p", {}, text("Body")),
        text("\n"),
      ),
      text("\n"),
    );
    expect(tree).toEqual({
      tag: "section",
      children: [
        { tag: "h2", text: "Title", children: [] },
        { tag: "p", text: "Body", children: [] },
      ],
    });
  });

  test("text beside element children becomes span children, in place", () => {
    const tree = parsed(
      el("p", {}, text("Hello "), el("strong", {}, text("world")), text("!")),
    );
    expect(tree).toEqual({
      tag: "p",
      children: [
        { tag: "span", text: "Hello ", children: [] },
        { tag: "strong", text: "world", children: [] },
        { tag: "span", text: "!", children: [] },
      ],
    });
  });

  test("a same-line space between inline children is content; a newline gap is not", () => {
    const tree = parsed(
      el(
        "p",
        {},
        el("b", {}, text("a")),
        text(" "),
        el("i", {}, text("b")),
        text("\n  "),
        el("em", {}, text("c")),
      ),
    );
    expect(tree.children.map((c) => c.tag)).toEqual(["b", "span", "i", "em"]);
    expect(tree.children[1]!.text).toBe(" ");
  });

  test("pre keeps every character, under it too: code inside pre, gaps included", () => {
    expect(parsed(el("pre", {}, text("\n  code\n"))).text).toBe("\n  code\n");
    const tree = parsed(
      el(
        "pre",
        {},
        el("code", {}, text("  if (x) {\n    y\n  }")),
        text("\n"),
        el("code", {}, text(" tail ")),
      ),
    );
    expect(tree.children.map((c) => [c.tag, c.text])).toEqual([
      ["code", "  if (x) {\n    y\n  }"],
      ["span", "\n"],
      ["code", " tail "],
    ]);
  });

  test("blank runs around the skeleton are never content", () => {
    const tree = parsed(el("html", {}, text(" "), el("body", {}), text(" ")));
    expect(tree.children.map((c) => c.tag)).toEqual(["body"]);
  });

  test("attributes are kept; comments are dropped; an empty element has no text key", () => {
    const tree = parsed(
      el(
        "figure",
        {},
        comment(" note "),
        el("img", { src: "https://x.test/a.png", alt: "A" }),
        el("figcaption", {}),
      ),
    );
    expect(tree).toEqual({
      tag: "figure",
      children: [
        {
          tag: "img",
          attrs: { src: "https://x.test/a.png", alt: "A" },
          children: [],
        },
        { tag: "figcaption", children: [] },
      ],
    });
  });

  test("a tag outside the allowlist is refused with the kernel's sentence", () => {
    expect(refused(el("div", {}, el("script", {}, text("x"))))).toBe(
      rules.tagProblem("script"),
    );
    expect(refused(el("iframe", {}))).toContain('"iframe"');
  });

  test("an attribute the kernel rejects is refused, naming the element", () => {
    expect(refused(el("div", { onclick: "x()" }))).toBe(
      `<div onclick>: ${rules.attrProblem("onclick", "x()")}`,
    );
    // An author's class and id are attributes (decision #71).
    expect(parsed(el("div", { class: "hero", id: "top" })).attrs).toEqual({
      class: "hero",
      id: "top",
    });
    expect(refused(el("div", { style: "color: red" }))).toContain("style");
    expect(refused(el("a", { href: "javascript:alert(1)" }))).toContain("href");
    expect(refused(el("img", { src: "http://x.test/a.png" }))).toContain("src");
  });

  test("the top level is one element: none, two, or loose text is refused", () => {
    expect(refused(text("  \n"))).toContain("Write one element");
    expect(refused(el("h1", {}), el("p", {}))).toContain("found 2 (h1, p)");
    expect(refused(text("stray"), el("p", {}))).toContain('"stray"');
    // Whitespace and comments around the one element are fine.
    expect(parsed(text("\n"), comment("x"), el("p", {}), text("\n")).tag).toBe(
      "p",
    );
  });
});

describe("stripIndentation", () => {
  test("drops layout, keeps content", () => {
    expect(stripIndentation("\n    Hello \n  ")).toBe("Hello ");
    expect(stripIndentation("  Hello  ")).toBe("  Hello  ");
    expect(stripIndentation("a\nb")).toBe("a\nb");
    expect(stripIndentation("\n\n  x\n\n")).toBe("x");
  });
});
