// The browser half of parsing: DOMParser's nodes through parse.ts, at the
// three pane levels the skeleton synthesis makes different.
import { describe, expect, test } from "vitest";

import { coreApi } from "@daydream/plugin-testing";

import { parseHtml } from "./htmlDom";
import type { ParsedElement } from "./parse";

const rules = coreApi();

function parsed(text: string, level: "root" | "body" | "fragment") {
  const result = parseHtml(text, level, rules);
  if (!result.ok) throw new Error(result.problem);
  return result.element;
}

describe("parseHtml", () => {
  test("a fragment is the body's children: one element, entities decoded, tags folded", () => {
    expect(parsed("<H1>Tom &amp; Jerry &lt;3</H1>", "fragment")).toEqual({
      tag: "h1",
      text: "Tom & Jerry <3",
      children: [],
    });
  });

  test("the browser's recovery is the pane's: an unclosed inline tag closes", () => {
    const tree = parsed("<p>Hello <strong>world</p>", "fragment");
    expect(tree.children.map((c) => [c.tag, c.text])).toEqual([
      ["span", "Hello "],
      ["strong", "world"],
    ]);
  });

  test("the root level is the document element without its head; the body level is the body", () => {
    const root = parsed(
      "<html>\n  <body>\n    <p>x</p>\n  </body>\n</html>",
      "root",
    );
    expect(root.tag).toBe("html");
    expect(root.children.map((c) => c.tag)).toEqual(["body"]);
    expect(root.children[0]!.children).toEqual([
      { tag: "p", text: "x", children: [] },
    ]);

    const body = parsed("<body><p>y</p></body>", "body");
    expect(body.tag).toBe("body");
    expect(body.children[0]!.text).toBe("y");
  });

  test("attributes on the root go through the kernel's rule like any other: a class is kept, a handler is refused", () => {
    const classed = parsed('<html class="page"><body></body></html>', "root");
    expect(classed.attrs).toEqual({ class: "page" });
    const result = parseHtml(
      '<html onload="x()"><body></body></html>',
      "root",
      rules,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain("onload");
  });

  test("head content at the root level is refused, never dropped", () => {
    const titled = parseHtml(
      "<html><head><title>x</title></head><body></body></html>",
      "root",
      rules,
    );
    expect(titled.ok).toBe(false);
    if (!titled.ok) expect(titled.problem).toContain('"title"');
    const scripted = parseHtml(
      "<script>x</script><body></body>",
      "root",
      rules,
    );
    expect(scripted.ok).toBe(false);
    if (!scripted.ok) expect(scripted.problem).toContain('"script"');
  });

  test("two fragments, a script, a handler: refused with a sentence; a class and an id are attributes (decisions.md #71)", () => {
    const two = parseHtml("<h1>a</h1><p>b</p>", "fragment", rules);
    expect(two.ok).toBe(false);
    const script = parseHtml(
      "<div><script>x</script></div>",
      "fragment",
      rules,
    );
    expect(script.ok).toBe(false);
    if (!script.ok) expect(script.problem).toContain('"script"');
    const handler = parseHtml('<div onclick="a()"></div>', "fragment", rules);
    expect(handler.ok).toBe(false);
    if (!handler.ok) expect(handler.problem).toContain('"onclick"');
    expect(parsed('<div class="a b" id="c"></div>', "fragment")).toEqual({
      tag: "div",
      attrs: { class: "a b", id: "c" },
      children: [],
    });
  });

  test("a void element with attributes; children of a void never exist", () => {
    const tree: ParsedElement = parsed(
      '<figure><img src="https://x.test/a.png" alt="A"><figcaption>c</figcaption></figure>',
      "fragment",
    );
    expect(tree.children[0]).toEqual({
      tag: "img",
      attrs: { src: "https://x.test/a.png", alt: "A" },
      children: [],
    });
  });
});
