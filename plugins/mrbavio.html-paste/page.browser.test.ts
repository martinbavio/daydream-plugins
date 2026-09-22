// The page a paste builds (decision #76): what is stored as the html and
// the css, and what the report says was lost. Pure over a parsed
// document — the browser project only because DOMParser is the browser's.
// How the landed page renders is paste.browser.test.ts's.
import { describe, expect, test } from "vitest";

import atRules from "./fixtures/at-rules.html?raw";
import chromeFragment from "./fixtures/chrome-fragment.html?raw";
import classGrid from "./fixtures/class-grid.html?raw";
import customProperties from "./fixtures/custom-properties.html?raw";
import wholeDocument from "./fixtures/document.html?raw";
import fontFace from "./fixtures/font-face.html?raw";
import hero from "./fixtures/hero.html?raw";
import hostile from "./fixtures/hostile.html?raw";
import idHero from "./fixtures/id-hero.html?raw";
import mediaInterleaved from "./fixtures/media-interleaved.html?raw";
import nested from "./fixtures/nested.html?raw";
import ornaments from "./fixtures/ornaments.html?raw";
import styleBlock from "./fixtures/style-block.html?raw";
import {
  dataImages,
  describePaste,
  fileFromDataUrl,
  hasElements,
  pageAssetSrc,
  pageFromPaste,
  parseHtml,
  type PastedPage,
} from "./page";

const at = { x: 10, y: 20 };

function paste(source: string, edited = false): PastedPage {
  return pageFromPaste(source, parseHtml(source), {
    id: "pasted",
    position: at,
    edited,
    lost: [],
  });
}

/** The text of every `<style>` in the source, in document order. */
function styleTexts(source: string): string[] {
  return Array.from(
    parseHtml(source).querySelectorAll("style"),
    (style) => style.textContent ?? "",
  );
}

const LINK_LOST = (href: string) =>
  `the stylesheet <link href="${href}"> could not be fetched (a paste fetches nothing) — removed, and its rules are not in the css; put them there to keep them`;

describe("the envelope", () => {
  test("a pasted fragment is one daydream.viewport page at a 960 frame with no height, at the position given", () => {
    const { item, elements, lost } = paste(hero);
    expect(item).toEqual({
      id: "pasted",
      kind: "daydream.viewport",
      position: at,
      frame: { width: 960 },
      payload: { html: hero, css: "" },
    });
    // html, body, and the section's four.
    expect(elements).toBe(6);
    expect(lost).toEqual([]);
  });

  test("a whole document's title is the page's meta title, and stays in its markup", () => {
    const { item } = paste(wholeDocument);
    expect(item.payload.meta).toEqual({ title: "Pricing page" });
    expect(item.payload.html).toContain("<title>Pricing page</title>");
  });
});

describe("the html", () => {
  test("with nothing to gather, the pasted text is stored byte for byte: a Chrome copy's packaging, class and id, an inline !important", () => {
    for (const source of [hero, chromeFragment, classGrid]) {
      expect(paste(source).item.payload.html).toBe(source);
    }
    expect(paste(hero).item.payload.html).toContain(
      "font-weight: 600 !important",
    );
  });

  test("with a style block gathered out, the markup is the parser's serialization, without it", () => {
    const { item } = paste(styleBlock);
    expect(item.payload.html).not.toContain("<style");
    expect(item.payload.html).toBe(
      (() => {
        const doc = parseHtml(styleBlock);
        doc.querySelector("style")!.remove();
        return doc.documentElement.outerHTML;
      })(),
    );
  });

  test("a whole document keeps its doctype, its html element's attributes and its head; an icon link stays", () => {
    const source = wholeDocument.replace(
      "<title>",
      '<link rel="icon" href="https://example.com/favicon.ico"><title>',
    );
    const { item } = paste(source);
    const html = item.payload.html;
    expect(html.startsWith("<!DOCTYPE html><html")).toBe(true);
    expect(html).toContain('lang="en"');
    expect(html).toContain('style="background: #111; color: #eee"');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<link rel="icon"');
    expect(html).not.toContain('rel="stylesheet"');
  });

  test("an edited tree is written out even with nothing to gather: a vendored image's new src lands", () => {
    const source =
      '<figure><img src="data:image/png;base64,AAAA" alt="a"></figure>';
    const doc = parseHtml(source);
    doc.querySelector("img")!.setAttribute("src", "assets/a.png");
    const { item } = pageFromPaste(source, doc, {
      id: "pasted",
      position: at,
      edited: true,
      lost: [],
    });
    expect(item.payload.html).toContain('src="assets/a.png"');
    expect(item.payload.html).not.toContain("data:");
  });

  test("hasElements tells markup from text that starts with <", () => {
    expect(hasElements(parseHtml("<3 you"))).toBe(false);
    expect(hasElements(parseHtml("<b>3</b> you"))).toBe(true);
    expect(hasElements(parseHtml("plain words"))).toBe(false);
    // A lone stylesheet is hoisted to the head: nothing for the body.
    expect(hasElements(parseHtml("<style>p{}</style>"))).toBe(false);
  });
});

describe("the css", () => {
  test("every style block's text is the css, verbatim and in document order, head or body; the markup no longer carries it", () => {
    const source = `${styleBlock}<style>.late { color: red }</style>`;
    const { item, lost } = paste(source);
    expect(item.payload.css).toBe(styleTexts(source).join("\n"));
    expect(item.payload.css.endsWith(".late { color: red }")).toBe(true);
    expect(item.payload.html).not.toContain("<style");
    expect(lost).toEqual([]);
    // A style block inside the fragment, where the parser leaves it, too.
    expect(paste(idHero).item.payload.css).toBe(styleTexts(idHero)[0]);
  });

  test("an empty style block adds nothing, not a blank line", () => {
    expect(
      paste("<style></style><div>a</div><style>.b{}</style>").item.payload.css,
    ).toBe(".b{}");
  });

  test("what the tree's sheet could not hold is stored as written: @import, @layer, @keyframes, @property, nesting, :root properties, pseudo-elements, @font-face, @media", () => {
    const css = (source: string) => paste(source).item.payload.css;
    expect(css(atRules)).toBe(styleTexts(atRules)[0]);
    for (const kept of [
      "@import url(https://fonts.example/inter.css);",
      "@layer base { .spinner { color: red; } }",
      "@keyframes spin",
      '@property --p { syntax: "<length>"',
    ])
      expect(css(atRules)).toContain(kept);
    expect(css(nested)).toContain("a { color: inherit; &:hover {");
    expect(css(customProperties)).toContain(":root { --brand: #0a66c2;");
    expect(css(ornaments)).toContain('.tag::before { content: "★ ";');
    expect(css(ornaments)).toContain("h2:first-letter");
    expect(css(fontFace)).toContain('@font-face { font-family: "Local Sans"');
    expect(css(mediaInterleaved)).toContain(
      "@media (min-width: 600px) { .btn { padding: 12px 24px; } }",
    );
  });
});

describe("what a page loses", () => {
  test("a linked stylesheet is a fetch a paste cannot make: removed, and said in the landing's words", () => {
    const { item, lost } = paste(wholeDocument);
    expect(item.payload.html).not.toContain("site.css");
    expect(lost).toEqual([LINK_LOST("site.css")]);
  });

  test("a hostile fragment: its style block is gathered like any other, its link is removed and said", () => {
    const { item, lost } = paste(hostile);
    expect(item.payload.css).toBe(
      "@import url(https://evil.example/x.css); body { display: none }",
    );
    expect(lost).toEqual([LINK_LOST("https://evil.example/site.css")]);
    // What could run is the canvas's to remove at every mount until the
    // plugin API lands a page through the kernel's cleaning
    // (paste.browser.test.ts renders it).
  });

  test("describePaste is one line: what landed, then what was lost", () => {
    expect(describePaste(1, [])).toBe("landed 1 element, nothing lost");
    expect(describePaste(12, ["a", "b"])).toBe("landed 12 elements; a; b");
  });
});

describe("data: images", () => {
  test("dataImages finds each img whose src is a data: url, decoded when it is an image", () => {
    const doc = parseHtml(
      '<img src="https://x/a.png"><img src=" data:image/png;base64,iVBORw0KGgo="><img src="data:text/html,hi"><img alt="no src">',
    );
    const found = dataImages(doc);
    expect(found.map(({ img }) => img.getAttribute("src")?.trim())).toEqual([
      "data:image/png;base64,iVBORw0KGgo=",
      "data:text/html,hi",
    ]);
    expect(found.map(({ file }) => file?.type ?? null)).toEqual([
      "image/png",
      null,
    ]);
  });

  test("fileFromDataUrl: base64 and percent-encoded images decode, anything else is null", () => {
    const svg = fileFromDataUrl(
      "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
    );
    expect(svg?.type).toBe("image/svg+xml");
    expect(svg?.name).toBe("pasted-image.svg");
    expect(fileFromDataUrl("data:image/jpeg;base64,/9j/4AAQ")?.name).toBe(
      "pasted-image.jpg",
    );
    expect(fileFromDataUrl("data:text/plain;base64,aGk=")).toBeNull();
    expect(fileFromDataUrl("data:image/png;base64,***")).toBeNull();
    expect(fileFromDataUrl("data:image/png;base64,")).toBeNull();
    expect(fileFromDataUrl("https://example.com/a.png")).toBeNull();
  });

  test("pageAssetSrc: the host's /assets/<file> is the page's assets/<file>; anything else is null", () => {
    expect(pageAssetSrc("/assets/abc123.png")).toBe("assets/abc123.png");
    expect(pageAssetSrc("/assets/img/logo.png")).toBe("assets/img/logo.png");
    expect(pageAssetSrc("/assets/")).toBeNull();
    expect(pageAssetSrc("https://example.com/assets/a.png")).toBeNull();
    expect(pageAssetSrc("/elsewhere/a.png")).toBeNull();
  });
});
