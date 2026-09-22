// The page a paste builds (decision #76): what is stored as the html and
// the css, and what the report says — the kernel's cleaning (`dd.cleanPage`)
// through a real activation, since the paste stores what it answers. A
// test kernel has no host that fetches, so every linked stylesheet is
// removed and reported. How the landed page renders is
// paste.browser.test.ts's.
import { afterEach, describe, expect, test } from "vitest";

import type { DaydreamApi, PluginManifest } from "@daydream/plugin-api";
import { createEmptyDocument, mountPlugin } from "@daydream/plugin-testing";

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
  pageFromPaste,
  parseHtml,
  withStoredImages,
  type PastedPage,
} from "./page";

const at = { x: 10, y: 20 };

const manifest: PluginManifest = {
  id: "test.paste-page",
  name: "Paste page",
  version: "0.0.0",
  minCore: "0.1.0",
};

/** A live activation's `dd`, one per test: the kernel's own cleaning. */
let live: Promise<DaydreamApi> | null = null;
afterEach(() => {
  live = null;
});
function kernel(): Promise<DaydreamApi> {
  live ??= (async () => {
    let dd: DaydreamApi | null = null;
    await mountPlugin({
      entry: (api) => {
        dd = api;
      },
      manifest,
      document: createEmptyDocument(),
    });
    return dd!;
  })();
  return live;
}

async function paste(source: string): Promise<PastedPage> {
  return pageFromPaste(await kernel(), source, {
    id: "pasted",
    position: at,
    said: [],
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
  `paste.html: the stylesheet <link href="${href}"> could not be fetched (no host here fetches stylesheets) — removed, and its rules are not in the css; put them there to keep them`;

const RESERIALIZED =
  "paste.html was re-serialized by the browser's parser after those removals: its source could not be edited in place, so its formatting changed";

const FOLDED = (blocks: string) =>
  `paste.css: folded ${blocks} into the css, after the page's own rules and in document order — the markup no longer carries them`;

describe("the envelope", () => {
  test("a pasted fragment is one daydream.viewport page at a 960 frame with no height, at the position given", async () => {
    const { item, elements, said } = await paste(hero);
    expect(item).toEqual({
      id: "pasted",
      kind: "daydream.viewport",
      position: at,
      frame: { width: 960 },
      payload: { html: hero, css: "" },
    });
    // html, body, and the section's four.
    expect(elements).toBe(6);
    expect(said).toEqual([]);
  });

  test("a whole document's title is the page's meta title, and stays in its markup", async () => {
    const { item } = await paste(wholeDocument);
    expect(item.payload.meta).toEqual({ title: "Pricing page" });
    expect(item.payload.html).toContain("<title>Pricing page</title>");
  });

  test("what the paste said comes first, then the cleaning's findings", async () => {
    const { said } = await pageFromPaste(await kernel(), idHero, {
      id: "pasted",
      position: at,
      said: ["the paste's own"],
    });
    expect(said).toEqual(["the paste's own", FOLDED("1 <style> block")]);
  });
});

describe("the html", () => {
  test("with nothing to take out, the pasted text is stored byte for byte: a Chrome copy's packaging, class and id, an inline !important", async () => {
    for (const source of [hero, chromeFragment, classGrid]) {
      expect((await paste(source)).item.payload.html).toBe(source);
    }
    expect((await paste(hero)).item.payload.html).toContain(
      "font-weight: 600 !important",
    );
  });

  test("a folded style block is cut where it was written: every other character is the author's", async () => {
    const { item } = await paste(idHero);
    expect(item.payload.html).toBe(
      idHero.replace(/<style>[\s\S]*?<\/style>/, ""),
    );
  });

  test("a style block that opens a fragment sits in the parser's head, so the cut cannot be checked: the markup is the browser's serialization, and that is said", async () => {
    const { item, said } = await paste(styleBlock);
    expect(item.payload.html).not.toContain("<style");
    expect(item.payload.html).toContain('<div class="card">');
    expect(said).toEqual([RESERIALIZED, FOLDED("1 <style> block")]);
  });

  test("a whole document keeps its doctype as written, its html element's attributes and its head; an icon link stays", async () => {
    const source = wholeDocument.replace(
      "<title>",
      '<link rel="icon" href="https://example.com/favicon.ico"><title>',
    );
    const { item } = await paste(source);
    const html = item.payload.html;
    expect(html.startsWith("<!doctype html>\n<html")).toBe(true);
    expect(html).toContain('lang="en"');
    expect(html).toContain('style="background: #111; color: #eee"');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<link rel="icon"');
    expect(html).not.toContain('rel="stylesheet"');
    expect(html).not.toContain("<script");
  });

  test("withStoredImages writes each stored copy's name where its data: url was, and moves nothing else", () => {
    const url = "data:image/png;base64,AAAA";
    const source = `<figure>\n  <img src="${url}" alt="a">\n  <img alt="b" src='${url}'>\n</figure>`;
    expect(withStoredImages(source, new Map([[url, "assets/a.png"]]))).toBe(
      `<figure>\n  <img src="assets/a.png" alt="a">\n  <img alt="b" src='assets/a.png'>\n</figure>`,
    );
    expect(withStoredImages(source, new Map())).toBe(source);
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
  test("every style block's text is the css, verbatim and in document order, head or body; the markup no longer carries it", async () => {
    const source = `${styleBlock}<style>.late { color: red }</style>`;
    const { item, said } = await paste(source);
    expect(item.payload.css).toBe(styleTexts(source).join("\n"));
    expect(item.payload.css.endsWith(".late { color: red }")).toBe(true);
    expect(item.payload.html).not.toContain("<style");
    expect(said).toEqual([RESERIALIZED, FOLDED("2 <style> blocks")]);
    // A style block inside the fragment, where the parser leaves it, too.
    expect((await paste(idHero)).item.payload.css).toBe(styleTexts(idHero)[0]);
  });

  test("an empty style block adds nothing, not a blank line", async () => {
    expect(
      (await paste("<style></style><div>a</div><style>.b{}</style>")).item
        .payload.css,
    ).toBe(".b{}");
  });

  test("what the tree's sheet could not hold is stored as written: @import, @layer, @keyframes, @property, nesting, :root properties, pseudo-elements, @font-face, @media", async () => {
    const css = async (source: string) =>
      (await paste(source)).item.payload.css;
    expect(await css(atRules)).toBe(styleTexts(atRules)[0]);
    for (const kept of [
      "@import url(https://fonts.example/inter.css);",
      "@layer base { .spinner { color: red; } }",
      "@keyframes spin",
      '@property --p { syntax: "<length>"',
    ])
      expect(await css(atRules)).toContain(kept);
    expect(await css(nested)).toContain("a { color: inherit; &:hover {");
    expect(await css(customProperties)).toContain(":root { --brand: #0a66c2;");
    expect(await css(ornaments)).toContain('.tag::before { content: "★ ";');
    expect(await css(ornaments)).toContain("h2:first-letter");
    expect(await css(fontFace)).toContain(
      '@font-face { font-family: "Local Sans"',
    );
    expect(await css(mediaInterleaved)).toContain(
      "@media (min-width: 600px) { .btn { padding: 12px 24px; } }",
    );
  });
});

describe("what the cleaning takes out, and says", () => {
  test("a linked stylesheet a paste has no host to fetch: removed, and said in the landing's words", async () => {
    const { item, said } = await paste(wholeDocument);
    expect(item.payload.html).not.toContain("site.css");
    expect(said).toContain(LINK_LOST("site.css"));
  });

  test("a hostile fragment: nothing that could run is stored, its style block is folded like any other, its link is removed, and each is said", async () => {
    const { item, said } = await paste(hostile);
    // A `<template>`'s content is inert, and the pinned kernel's walk
    // does not enter it yet (the kernel's next commit does): what it
    // holds is not judged here.
    const html = item.payload.html.replace(
      /<template>[\s\S]*?<\/template>/,
      "",
    );
    expect(item.payload.css).toBe(
      "@import url(https://evil.example/x.css); body { display: none }",
    );
    for (const gone of [
      "<script",
      "<object",
      "<embed",
      "<base",
      "<style",
      "<link",
      "onclick",
      "onerror",
      "onload",
      "srcdoc",
    ])
      expect(html, gone).not.toContain(gone);
    expect(html).not.toMatch(/javascript:/i);
    // What stays is the author's text: the fourth link as written.
    expect(html).toContain('<a href="#top">four</a>');
    expect(said[0]).toMatch(/^paste\.html: removed .*<script>/);
    expect(said).toContain(FOLDED("1 <style> block"));
    expect(said).toContain(LINK_LOST("https://evil.example/site.css"));
  });

  test("describePaste is one line: what landed, then what was said", () => {
    expect(describePaste(1, [])).toBe("landed 1 element, nothing lost");
    expect(describePaste(12, ["a", "b"])).toBe("landed 12 elements; a; b");
  });
});

describe("data: images", () => {
  test("dataImages finds each distinct data: url an img names, decoded when it is an image", () => {
    const doc = parseHtml(
      '<img src="https://x/a.png"><img src=" data:image/png;base64,iVBORw0KGgo="><img src="data:text/html,hi"><img alt="no src"><img src=" data:image/png;base64,iVBORw0KGgo=">',
    );
    const found = dataImages(doc);
    expect(found.map(({ url }) => url)).toEqual([
      " data:image/png;base64,iVBORw0KGgo=",
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
});
