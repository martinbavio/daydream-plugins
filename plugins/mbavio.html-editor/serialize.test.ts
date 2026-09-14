// The pane's face: structure only, indented two spaces, void elements
// without end tags, text escaped — and nothing of the styling or the
// labels (decisions.md #58).
import { describe, expect, test } from "vitest";

import { createElement } from "@daydream/plugin-testing";

import { serializeElement } from "./serialize";

describe("serializeElement", () => {
  test("a text-only element sits on one line, with its text escaped", () => {
    const h1 = createElement({ tag: "h1", text: "Tom & Jerry <3" });
    expect(serializeElement(h1)).toBe("<h1>Tom &amp; Jerry &lt;3</h1>");
  });

  test("children are indented two spaces per depth; an empty element closes on its line", () => {
    const tree = createElement({
      tag: "section",
      children: [
        createElement({ tag: "h2", text: "Title" }),
        createElement({
          tag: "ul",
          children: [
            createElement({ tag: "li", text: "one" }),
            createElement({ tag: "li" }),
          ],
        }),
      ],
    });
    expect(serializeElement(tree)).toBe(
      [
        "<section>",
        "  <h2>Title</h2>",
        "  <ul>",
        "    <li>one</li>",
        "    <li></li>",
        "  </ul>",
        "</section>",
      ].join("\n"),
    );
  });

  test("styles, conditionals and labels never appear: the pane is structure", () => {
    const box = createElement({
      tag: "div",
      label: "Hero",
      styles: { display: "grid", color: "red" },
      children: [
        createElement({ tag: "p", text: "x", styles: { margin: "0" } }),
      ],
    });
    box.conditionals = [
      { condition: "@media (width >= 600px)", styles: { gap: "8px" } },
    ];
    const html = serializeElement(box);
    expect(html).toBe("<div>\n  <p>x</p>\n</div>");
    expect(html).not.toMatch(/style|class|id=|Hero|grid|@media/);
  });

  test("attributes are written in stored order and quoted; void elements have no end tag", () => {
    const img = createElement({
      tag: "img",
      attrs: { src: "https://x.test/a.png", alt: 'a "quoted" alt' },
    });
    expect(serializeElement(img)).toBe(
      '<img src="https://x.test/a.png" alt="a &quot;quoted&quot; alt">',
    );
    expect(serializeElement(createElement({ tag: "br" }))).toBe("<br>");
    const a = createElement({
      tag: "a",
      attrs: { href: "#top" },
      text: "up",
    });
    expect(serializeElement(a)).toBe('<a href="#top">up</a>');
  });

  test("a pre subtree is one line, nothing of the pane's layout inside it", () => {
    const pre = createElement({
      tag: "pre",
      children: [
        createElement({ tag: "code", text: "  if (x) {\n    y\n  }" }),
        createElement({ tag: "span", text: "\n" }),
        createElement({ tag: "code", text: " tail " }),
      ],
    });
    const box = createElement({ tag: "div", children: [pre] });
    expect(serializeElement(box)).toBe(
      "<div>\n  <pre><code>  if (x) {\n    y\n  }</code><span>\n</span><code> tail </code></pre>\n</div>",
    );
  });

  test("text beside children goes on its own line before them", () => {
    const p = createElement({
      tag: "p",
      text: "Hello ",
      children: [createElement({ tag: "strong", text: "world" })],
    });
    expect(serializeElement(p)).toBe(
      "<p>\n  Hello \n  <strong>world</strong>\n</p>",
    );
  });

  test("the model's inline runs — span siblings — read as the HTML they are", () => {
    const p = createElement({
      tag: "p",
      children: [
        createElement({ tag: "span", text: "Hello " }),
        createElement({ tag: "strong", text: "world" }),
      ],
    });
    expect(serializeElement(p)).toBe(
      "<p>\n  <span>Hello </span>\n  <strong>world</strong>\n</p>",
    );
  });
});
