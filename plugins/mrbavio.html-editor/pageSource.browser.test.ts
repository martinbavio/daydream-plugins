// From a page's elements to its text: where each element was written, as
// the browser's parse pairs it with its tag; which stored element a
// mounted one is, past what the safety walk removed; and a removal cut out
// of the author's text.
import { describe, expect, test, vi } from "vitest";

import { createPageItem, mountShell, pageNode } from "@daydream/plugin-testing";

import {
  pageSource,
  parsePage,
  serializePage,
  storedElement,
  withoutElement,
} from "./pageSource";

/** The text an element of `html`'s parse was written as. */
function written(html: string, selector: string): string | null {
  const source = pageSource(html);
  const el = source.parsed.querySelector(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  const range = source.rangeOf(el);
  return range === null ? null : html.slice(range.start, range.end);
}

describe("pageSource", () => {
  test("an element's range is its start tag to its end tag, children and all", () => {
    const html =
      '<!doctype html>\n<html>\n<body>\n  <div class="a">\n    <div class="b">x</div>\n    <p>y</p>\n  </div>\n</body>\n</html>';
    expect(written(html, ".b")).toBe('<div class="b">x</div>');
    expect(written(html, ".a")).toBe(
      '<div class="a">\n    <div class="b">x</div>\n    <p>y</p>\n  </div>',
    );
    expect(written(html, "p")).toBe("<p>y</p>");
    expect(written(html, "body")).toMatch(/^<body>[\s\S]*<\/body>$/);
  });

  test("an element the parser supplied has no range; its children do", () => {
    const html = "<table><tr><td>1</td></tr></table><p>after</p>";
    expect(written(html, "body")).toBeNull();
    expect(written(html, "tbody")).toBeNull();
    expect(written(html, "tr")).toBe("<tr><td>1</td></tr>");
    expect(written(html, "table")).toBe("<table><tr><td>1</td></tr></table>");
  });

  test("an element written without its end tag ends where the next begins", () => {
    const html = "<ul>\n  <li>one\n  <li>two\n</ul>";
    expect(written(html, "li:first-child")).toBe("<li>one");
    expect(written(html, "li:last-child")).toBe("<li>two");
    expect(written(html, "ul")).toBe(html);
  });

  test("a tag's marks never reach the parse's attributes a reader sees", () => {
    const source = pageSource('<p class="x">a</p>');
    const p = source.parsed.querySelector("p")!;
    expect(p.getAttribute("class")).toBe("x");
    expect(source.rangeOf(p)).toEqual({ start: 0, openEnd: 13, end: 18 });
  });
});

describe("storedElement", () => {
  test("a mounted element is found in the stored text past what the safety walk removed", async () => {
    const html = [
      "<!doctype html>",
      "<html>",
      "<body>",
      '  <link rel="stylesheet" href="https://x.test/a.css">',
      "  <style>p { color: red }</style>",
      '  <p class="one">One</p>',
      '  <p class="two">Two</p>',
      "</body>",
      "</html>",
    ].join("\n");
    const item = createPageItem({ html, css: "" }, { frame: { width: 600 } });
    await mountShell({ document: { version: 7, items: [item] } });
    let two: HTMLElement | null = null;
    await vi.waitFor(() => {
      two = pageNode(item.id, ".two");
      expect(two).not.toBeNull();
    });
    // The walk took the link and the style out of the mount.
    expect(pageNode(item.id, "style")).toBeNull();
    const source = pageSource(html);
    const stored = storedElement(source.parsed, two!);
    expect(stored?.getAttribute("class")).toBe("two");
    const range = source.rangeOf(stored!);
    expect(html.slice(range!.start, range!.end)).toBe('<p class="two">Two</p>');
  });

  test("a node outside any page, or one the text no longer holds, is not found", () => {
    const parsed = parsePage("<p>a</p>");
    expect(storedElement(parsed, document.createElement("p"))).toBeNull();
  });
});

describe("withoutElement", () => {
  const remove = (html: string, selector: string): string => {
    const source = pageSource(html);
    return withoutElement(source, source.parsed.querySelector(selector)!);
  };

  test("the element is cut out with its line, every other character kept", () => {
    const html =
      "<!doctype html>\n<body>\n  <h1>Head</h1>\n  <!-- copy -->\n  <p>Copy</p>\n</body>";
    expect(remove(html, "h1")).toBe(
      "<!doctype html>\n<body>\n  <!-- copy -->\n  <p>Copy</p>\n</body>",
    );
    expect(remove(html, "p")).toBe(
      "<!doctype html>\n<body>\n  <h1>Head</h1>\n  <!-- copy -->\n</body>",
    );
  });

  test("an element sharing its line is cut alone", () => {
    expect(remove("<p>a <b>b</b> c</p>", "b")).toBe("<p>a  c</p>");
  });

  test("an element with no tag of its own is removed on the parse and serialized", () => {
    const html = "<table><tr><td>1</td></tr></table>";
    const out = remove(html, "tbody");
    expect(out).toBe(serializePage(parsePage("<table></table>")));
    expect(out).not.toContain("data-mrbavio");
  });
});
