import { describe, expect, test } from "vitest";

import { absoluteCssUrls, absoluteSrcset, withoutProbes } from "./pageExport";

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

  test("only a real url token or an image-set() string is rewritten: text in an ordinary string or a comment is the page's own", () => {
    // Generated text the page shows, and a family name, stay as written.
    const text = `a::before { content: "url(/logo.svg)"; font-family: 'url(/x) Sans', "image-set(\\"/y.png\\" 1x)"; }`;
    expect(absoluteCssUrls(text, O)).toBe(text);
    expect(absoluteCssUrls('a { content: "a\\"url(/x)"; }', O)).toBe('a { content: "a\\"url(/x)"; }');
    expect(absoluteCssUrls("/* background: url(/old.png); */ a { b: 1 }", O)).toBe("/* background: url(/old.png); */ a { b: 1 }");
    // The same text beside a real url: that one is.
    expect(absoluteCssUrls('a::before { content: "url(/logo.svg)"; background: url( "/logo.svg" ); }', O)).toBe(
      `a::before { content: "url(/logo.svg)"; background: url( "${O}/logo.svg" ); }`,
    );
    // A url is a url whatever its case; a function whose name ends in
    // "url" is not one.
    expect(absoluteCssUrls("a { b: URL(/a.png); c: myurl(/b.png); }", O)).toBe(`a { b: URL(${O}/a.png); c: myurl(/b.png); }`);
    // The origin goes where the url starts, past any leading space.
    expect(absoluteCssUrls('a { b: url(" /a.png"); }', O)).toBe(`a { b: url(" ${O}/a.png"); }`);
    // A url() inside another function (a var() fallback) is still one.
    expect(absoluteCssUrls("a { b: var(--x, url(/a.png)); }", O)).toBe(`a { b: var(--x, url(${O}/a.png)); }`);
  });
});

describe("the export holds the page's own css", () => {
  // As the kernel's mount probes a page's css (src/measure/livePage.ts
  // withContainerProbes): a reach copy under `@media all` before each
  // `@container`, the probe leading each block under it, and one
  // `@property` per probe at the end.
  const REGISTER = (n: number) =>
    `@property --dream-container-${n} { syntax: "<integer>"; inherits: false; initial-value: 0; }`;

  test("the container probes come out, and the page's css is left as written", () => {
    const css = 'main { x: 1; }\n@container (width > 100px) { .t { color: red; } }\n';
    const probed =
      'main { x: 1; }\n@media all {  .t { --dream-container-0: 1; } } @container (width > 100px) { .t { --dream-container-0: 2;  color: red; } }\n' +
      `\n${REGISTER(0)}\n`;
    expect(withoutProbes(probed)).toBe(css);
    // Nested in a style rule: the reach copy carries the probe on its own
    // block, and the rule's block leads with it.
    const nested = ".a { @container x { color: red; } }";
    expect(
      withoutProbes(
        `.a { @media all { --dream-container-0: 1; } @container x { --dream-container-0: 2;  color: red; } }\n${REGISTER(0)}\n`,
      ),
    ).toBe(nested);
    // A css with no probe is not touched; a brace or an `@media all` in a
    // string, or the author's own `@media all`, is the page's.
    const own = '.t::before { content: "{ @media all { }"; } @media all { .t { color: red; } } ';
    expect(withoutProbes(own)).toBe(own);
    expect(
      withoutProbes(
        `${own}@media all {  .u { --dream-container-0: 1; } } @container y { .u { --dream-container-0: 2;  top: 0; } }\n${REGISTER(0)}\n`,
      ),
    ).toBe(`${own}@container y { .u { top: 0; } }`);
  });
});
