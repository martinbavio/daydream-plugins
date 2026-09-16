// The stylesheet walker's pure pieces, in the node project: the CSSOM walk
// over rules that merely LOOK like CSSOM rules (plain objects here, the
// browser's own in stylesheet.browser.test.ts), the nesting desugaring
// and the source tokenizer that counts what `replaceSync` dropped without
// a word. Stand-ins for the kernel's grammars are enough here; the
// browser tests hold the real `dd.core` faces against real sheets.
import { describe, expect, test } from "vitest";

import {
  countSource,
  flattenSelector,
  walkStyleSheet,
  type RuleLike,
  type SheetRules,
} from "./stylesheet";

/** The kernel's grammars, roughly: enough to tell a refusal from an
 * acceptance in each of the four seams the walker asks. */
const rules: SheetRules = {
  selectorProblem: (selector) =>
    selector.trim() === ""
      ? "selector must not be empty"
      : /&/.test(selector)
        ? "carries &"
        : /:host|:visited/.test(selector)
          ? "excluded by name"
          : null,
  conditionKind: (prelude) =>
    prelude.startsWith("&:")
      ? "state"
      : prelude.startsWith("@media")
        ? "media"
        : prelude.startsWith("@container")
          ? "container"
          : prelude.startsWith("@supports")
            ? "supports"
            : null,
  conditionPreludeProblem: (prelude) =>
    prelude.startsWith("@supports")
      ? "@supports conditions are not storable yet"
      : /^@(media|container) \S/.test(prelude)
        ? null
        : "not a condition",
  isPropertyName: (name) => /^(--[\w-]+|[a-z-]+)$/.test(name),
  isSafeValue: (value) => !/[{};]|\/\*|!\s*important/i.test(value),
  attrProblem: (name, value) =>
    name === "src" && !value.startsWith("https://") ? "not https" : null,
  familyNames: (value) =>
    value
      .split(",")
      .map((name) => name.trim().replace(/^["']|["']$/g, ""))
      .filter((name) => name !== ""),
};

/** A CSSOM rule as the walker sees it, from its serialized parts. */
function style(
  selectorText: string,
  cssText: string,
  children: RuleLike[] = [],
): RuleLike {
  return {
    selectorText,
    style: { cssText },
    cssRules: children,
    cssText: `${selectorText} { ${cssText} }`,
  };
}
function group(prelude: string, children: RuleLike[]): RuleLike {
  const [keyword, ...rest] = prelude.split(" ");
  return {
    cssText: `${prelude} { }`,
    conditionText: rest.join(" "),
    cssRules: children,
    ...(keyword === "@media" ? { media: { mediaText: rest.join(" ") } } : {}),
  };
}
function declarations(cssText: string): RuleLike {
  return { style: { cssText }, cssText };
}
function atRule(cssText: string): RuleLike {
  return { cssText };
}
function fontFace(cssText: string): RuleLike {
  return { style: { cssText }, cssText: `@font-face { ${cssText} }` };
}

const walk = (list: RuleLike[], source = "") =>
  walkStyleSheet(list, source, rules);

describe("walkStyleSheet", () => {
  test("a style rule is one stored rule: the selector as spelled, the declarations verbatim, !important stripped and counted, a refused declaration stripped by name", () => {
    const out = walk([
      style(".card, .Card", "padding: 16px; margin: 0px 0px 8px;"),
      style("h1", "color: red !important; wid th: 1px; --x: a"),
    ]);
    expect(out.rules).toEqual([
      {
        selector: ".card, .Card",
        styles: { padding: "16px", margin: "0px 0px 8px" },
      },
      { selector: "h1", styles: { color: "red", "--x": "a" } },
    ]);
    expect(out.important).toBe(1);
    expect(out.stripped).toEqual({ "style (wid th)": 1 });
    expect(out.dropped).toEqual({});
    expect(out.fonts).toEqual([]);
  });

  test("a rule with nothing to store — an empty block, or a parent of nested rules only — stores nothing and counts nothing", () => {
    const out = walk([
      style(".a", ""),
      style(".b", "", [style("& .c", "gap: 1px")]),
    ]);
    expect(out.rules).toEqual([{ selector: ".b .c", styles: { gap: "1px" } }]);
    expect(out.dropped).toEqual({});
  });

  test("a refused selector drops the rule under `rule`; a nested rule under it is judged on its own flattened selector", () => {
    const out = walk([
      style(":host", "color: red", [style("& .x", "color: blue")]),
      style(".ok", "color: green"),
    ]);
    expect(out.rules).toEqual([
      { selector: ".ok", styles: { color: "green" } },
    ]);
    expect(out.dropped).toEqual({ rule: 2 });
  });

  test("nesting is flattened as the entry says, nested rules after their parent, nested declarations with the parent's selector", () => {
    const out = walk([
      style(".x", "color: red", [
        style("& .y", "color: blue"),
        style("& .z, .w &", "color: green"),
        group("@media (min-width: 1px)", [declarations("color: purple")]),
        style("&:hover", "color: pink", [style("& > b", "font-weight: 700")]),
      ]),
      style(".a, #b", "", [style("& .c", "margin: 0px")]),
    ]);
    expect(out.rules).toEqual([
      { selector: ".x", styles: { color: "red" } },
      { selector: ".x .y", styles: { color: "blue" } },
      { selector: ".x .z, .w :is(.x)", styles: { color: "green" } },
      {
        selector: ".x",
        conditions: ["@media (min-width: 1px)"],
        styles: { color: "purple" },
      },
      { selector: ".x:hover", styles: { color: "pink" } },
      { selector: ".x:hover > b", styles: { "font-weight": "700" } },
      { selector: ":is(.a, #b) .c", styles: { margin: "0px" } },
    ]);
  });

  test("at-rule ancestry becomes conditions, outermost first, on every rule inside — @supports too, judged lexically until dd.core.ruleProblem; a refused prelude drops each rule under its keyword", () => {
    const out = walk([
      group("@media screen and (min-width: 600px)", [
        style(".btn", "padding: 8px"),
        group("@container card (min-width: 100px)", [style(".q", "gap: 1px")]),
      ]),
      group("@supports (display: grid)", [
        style(".g", "display: grid"),
        style(".h", "display: grid"),
      ]),
      group("@media", [style(".bare", "color: red")]),
      group("@supports (display: grid", [style(".open", "color: red")]),
      group("@supports", [style(".empty", "color: red")]),
      group("@supports (x: y) { }", [style(".brace", "color: red")]),
      style(".n", "", [
        group("@container (min-width: 1px)", [style("& .m", "color: red")]),
      ]),
    ]);
    expect(out.rules).toEqual([
      {
        selector: ".btn",
        conditions: ["@media screen and (min-width: 600px)"],
        styles: { padding: "8px" },
      },
      {
        selector: ".q",
        conditions: [
          "@media screen and (min-width: 600px)",
          "@container card (min-width: 100px)",
        ],
        styles: { gap: "1px" },
      },
      {
        selector: ".g",
        conditions: ["@supports (display: grid)"],
        styles: { display: "grid" },
      },
      {
        selector: ".h",
        conditions: ["@supports (display: grid)"],
        styles: { display: "grid" },
      },
      {
        selector: ".n .m",
        conditions: ["@container (min-width: 1px)"],
        styles: { color: "red" },
      },
    ]);
    expect(out.dropped).toEqual({ "@media": 1, "@supports": 3 });
  });

  test("a @font-face lifts into fonts as a descriptor map; a face with a non-https url, no source or no family is dropped and counted; an unknown descriptor is stripped by name", () => {
    const out = walk([
      fontFace(
        'font-family: Inter; src: url("https://x.test/inter.woff2") format("woff2"); font-weight: 100 900; font-display: swap; font-named-instance: "Bold"',
      ),
      fontFace('font-family: Local; src: local("Local Sans")'),
      fontFace('font-family: Bad; src: url("http://x.test/bad.woff2")'),
      fontFace('font-family: Relative; src: url("bad.woff2")'),
      fontFace("font-family: None"),
      fontFace('src: url("https://x.test/anon.woff2")'),
    ]);
    expect(out.fonts).toEqual([
      {
        "font-family": "Inter",
        src: 'url("https://x.test/inter.woff2") format("woff2")',
        "font-weight": "100 900",
        "font-display": "swap",
      },
      { "font-family": "Local", src: 'local("Local Sans")' },
    ]);
    expect(out.rules).toEqual([]);
    expect(out.dropped).toEqual({ "@font-face": 4 });
    expect(out.stripped).toEqual({ "@font-face (font-named-instance)": 1 });
  });

  test("every other at-rule is counted by its keyword and never descended: a @layer block's rules are lost with it", () => {
    const out = walk([
      {
        cssText: "@layer base {\n  .l { color: red; }\n}",
        cssRules: [style(".l", "color: red")],
      },
      atRule("@keyframes spin { 0% { } 100% { } }"),
      atRule(
        '@property --p { syntax: "<length>"; inherits: false; initial-value: 0px; }',
      ),
      atRule('@namespace svg url("http://www.w3.org/2000/svg");'),
      atRule("@page { margin: 1in; }"),
      atRule("@layer a, b;"),
      style(
        ".spin",
        "animation: 1s linear 0s infinite normal none running spin",
      ),
    ]);
    expect(out.rules).toEqual([
      {
        selector: ".spin",
        styles: { animation: "1s linear 0s infinite normal none running spin" },
      },
    ]);
    expect(out.dropped).toEqual({
      "@layer": 2,
      "@keyframes": 1,
      "@property": 1,
      "@namespace": 1,
      "@page": 1,
    });
  });

  test("what replaceSync dropped silently is reported by diffing the source: a refused selector under `rule`, an @import and an unknown at-rule by keyword", () => {
    const source = `
      @import url(https://evil.example/x.css);
      @charset "utf-8";
      .ok, :foo { color: red }
      @foo { .z {} }
      body { display: none }
      @media (min-width: 1px) { .a { color: red } }
    `;
    const out = walk(
      [
        style("body", "display: none"),
        group("@media (min-width: 1px)", [style(".a", "color: red")]),
      ],
      source,
    );
    expect(out.rules.map((rule) => rule.selector)).toEqual(["body", ".a"]);
    expect(out.dropped).toEqual({
      "@import": 1,
      "@charset": 1,
      rule: 1,
      "@foo": 1,
    });
  });
});

describe("flattenSelector", () => {
  test("a leading & under a single parent is the parent written out; a list parent or a & elsewhere needs :is()", () => {
    expect(flattenSelector(".a .b", "& .c")).toBe(".a .b .c");
    expect(flattenSelector(".a", "&.x, & > .y, &:hover")).toBe(
      ".a.x, .a > .y, .a:hover",
    );
    expect(flattenSelector(".a", ".w &")).toBe(".w :is(.a)");
    expect(flattenSelector(".a", "& &")).toBe(":is(.a) :is(.a)");
    expect(flattenSelector(".a, #b", "& .c")).toBe(":is(.a, #b) .c");
    expect(flattenSelector(".a", ":not(&) .c")).toBe(":not(:is(.a)) .c");
    // A flattened parent that holds its list inside :is() is single again.
    expect(flattenSelector(":is(.a, #b) .c", "& .d")).toBe(":is(.a, #b) .c .d");
  });

  test("a relative selector with no & is a descendant of the parent; an & inside a string is text", () => {
    expect(flattenSelector(".a", "> .c")).toBe(".a > .c");
    expect(flattenSelector(".a", ".c")).toBe(".a .c");
    expect(flattenSelector(".a", '&[title="a&b"]')).toBe('.a[title="a&b"]');
    expect(flattenSelector(".a, .b", '[title="x,y"] &')).toBe(
      '[title="x,y"] :is(.a, .b)',
    );
  });
});

describe("countSource", () => {
  test("top-level blocks not starting with @ are rules; at-rules by keyword, statements and blocks alike; comments and strings hide their braces", () => {
    expect(
      countSource(`
        @import url("a;b.css");
        @layer a, b;
        /* .x { } */
        .a { color: red; content: "}"; }
        .b, .c { .d { } }
        @media (min-width: 1px) { .e { } }
        @MEDIA print { }
        @font-face { src: url(x) }
        @keyframes k { from { } to { } }
        .f { background: url("data:image/png;base64,}") }
        .g { color: "{" }
      `),
    ).toEqual({
      rules: 4,
      atRules: {
        "@import": 1,
        "@layer": 1,
        "@media": 2,
        "@font-face": 1,
        "@keyframes": 1,
      },
    });
  });

  test("an unterminated block or a prelude that never opens one is not a rule; an empty sheet counts nothing", () => {
    expect(countSource("")).toEqual({ rules: 0, atRules: {} });
    expect(countSource(".a")).toEqual({ rules: 0, atRules: {} });
    expect(countSource(".a { color: red")).toEqual({ rules: 1, atRules: {} });
    expect(countSource("; ; .a {}")).toEqual({ rules: 1, atRules: {} });
  });
});
