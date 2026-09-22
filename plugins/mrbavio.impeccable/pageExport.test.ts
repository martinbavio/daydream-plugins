import { describe, expect, test } from "vitest";

import { absoluteCssUrls, absoluteSrcset } from "./pageExport";

const O = "http://host.test";

describe("the export's urls stand alone", () => {
  test("a srcset's root-relative candidates are made absolute, every other character kept", () => {
    expect(absoluteSrcset("/a.png 1x, /b.png 2x", O)).toBe(`${O}/a.png 1x, ${O}/b.png 2x`);
    expect(absoluteSrcset("/a.png", O)).toBe(`${O}/a.png`);
    expect(absoluteSrcset("  /a.png  480w ,\n/b.png 800w", O)).toBe(`  ${O}/a.png  480w ,\n${O}/b.png 800w`);
    // Not root-relative: left alone.
    expect(absoluteSrcset("https://cdn.test/a.png 1x, //cdn.test/b.png 2x, c.png 3x", O)).toBe(
      "https://cdn.test/a.png 1x, //cdn.test/b.png 2x, c.png 3x",
    );
  });

  test("a url holding a comma stays one url", () => {
    expect(absoluteSrcset("/img/a,b.png 1x, /img/c,d.png 2x", O)).toBe(`${O}/img/a,b.png 1x, ${O}/img/c,d.png 2x`);
    // A url runs to whitespace, so one written against the next is one
    // url, as the browser reads it; trailing commas end a candidate with
    // no descriptor.
    expect(absoluteSrcset("/a.png,/b.png 2x", O)).toBe(`${O}/a.png,/b.png 2x`);
    expect(absoluteSrcset("/a.png,, /b.png", O)).toBe(`${O}/a.png,, ${O}/b.png`);
    // A comma inside a descriptor's parentheses does not end it.
    expect(absoluteSrcset("/a.png foo(1,2), /b.png 2x", O)).toBe(`${O}/a.png foo(1,2), ${O}/b.png 2x`);
  });

  test("url() and image-set() strings in css are made absolute", () => {
    expect(absoluteCssUrls('a { background: url(/a.png), url("/b.png"), url(\'/c.png\'); }', O)).toBe(
      `a { background: url(${O}/a.png), url("${O}/b.png"), url('${O}/c.png'); }`,
    );
    expect(absoluteCssUrls('a { background-image: image-set("/a.png" 1x, \'/b.png\' 2x); }', O)).toBe(
      `a { background-image: image-set("${O}/a.png" 1x, '${O}/b.png' 2x); }`,
    );
    expect(absoluteCssUrls('a { background-image: -webkit-image-set("/a.png" 1x, url(/b.png) 2x); }', O)).toBe(
      `a { background-image: -webkit-image-set("${O}/a.png" 1x, url(${O}/b.png) 2x); }`,
    );
    // A type() string, an absolute url and a string outside image-set are
    // not urls to rewrite; a parenthesis in a string does not end the set.
    expect(
      absoluteCssUrls('a { b: image-set("x).png" type("image/avif"), "//cdn.test/c.png" 2x, "/d.png" 3x); content: "/e"; }', O),
    ).toBe(`a { b: image-set("x).png" type("image/avif"), "//cdn.test/c.png" 2x, "${O}/d.png" 3x); content: "/e"; }`);
  });
});
