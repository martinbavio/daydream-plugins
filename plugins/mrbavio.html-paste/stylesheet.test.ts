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

const selectorProblem = (selector: string): string | null =>
  selector.trim() === ""
    ? "selector must not be empty"
    : /&/.test(selector)
      ? "carries &"
      : /:host|:visited/.test(selector)
        ? "excluded by name"
        : null;

/** The `@supports` lexical checks the kernel's rule grammar applies —
 * inlined here only for this stand-in, so its own edge cases (an empty
 * condition, unbalanced parens, embedded sheet punctuation) still refuse
 * the way the real `dd.core.ruleProblem` does. */
function supportsConditionProblem(prelude: string): string | null {
  const trimmed = prelude.trim();
  if (/[{};"']|\/\*|\*\//.test(prelude)) {
    return `A condition cannot contain sheet punctuation: "${trimmed}"`;
  }
  const condition = trimmed.slice("@supports".length).trim();
  if (condition === "") return "@supports needs a condition";
  let depth = 0;
  for (const ch of condition) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) break;
  }
  return depth === 0 ? null : "@supports condition has unbalanced parentheses";
}

/** The kernel's grammars, roughly: enough to tell a refusal from an
 * acceptance in each of the seams the walker asks. `ruleProblem` judges
 * the whole candidate rule `conditionRefused` builds (selector, one
 * condition, empty styles) — a state prelude refused, `@supports` judged
 * lexically, `@media`/`@container` needing a real condition after the
 * keyword. */
const rules: SheetRules = {
  selectorProblem,
  ruleProblem: (rule) => {
    const candidate = rule as {
      selector: string;
      conditions?: string[];
      styles: Record<string, string>;
    };
    const badSelector = selectorProblem(candidate.selector);
    if (badSelector !== null) return badSelector;
    for (const prelude of candidate.conditions ?? []) {
      if (prelude.startsWith("&:")) {
        return "a state prelude belongs to the selector";
      }
      if (prelude.startsWith("@supports")) {
        const problem = supportsConditionProblem(prelude);
        if (problem !== null) return problem;
        continue;
      }
      if (!/^@(media|container) \S/.test(prelude)) return "not a condition";
    }
    return null;
  },
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

  test("a refused selector drops the rule under `rule`, its declarations uncounted; a nested rule under it is judged on its own flattened selector", () => {
    const out = walk([
      style(":host", "color: red !important; wid th: 1px", [
        style("& .x", "color: blue"),
      ]),
      style(".ok", "color: green"),
    ]);
    expect(out.rules).toEqual([
      { selector: ".ok", styles: { color: "green" } },
    ]);
    expect(out.dropped).toEqual({ rule: 2 });
    expect(out.important).toBe(0);
    expect(out.stripped).toEqual({});
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

  test("at-rule ancestry becomes conditions, outermost first, on every rule inside — @supports too, judged through dd.core.ruleProblem; a refused prelude drops each rule under its keyword", () => {
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
    // A @charset is packaging, never a loss.
    expect(out.dropped).toEqual({ "@import": 1, rule: 1, "@foo": 1 });
  });

  test("the diff reaches inside @media, @container and @supports, where a Bootstrap-like sheet keeps most of its rules", () => {
    const source = `
      @media (min-width: 576px) {
        .btn { padding: 8px }
        .ok, :foo { color: red }
        @supports (gap: 1px) { .g { gap: 1px } @bar { } }
      }
      .x { @media (min-width: 1px) { .inside-a-rule, :foo { color: red } } }
    `;
    const out = walk(
      [
        group("@media (min-width: 576px)", [
          style(".btn", "padding: 8px"),
          group("@supports (gap: 1px)", [style(".g", "gap: 1px")]),
        ]),
        style(".x", "", [group("@media (min-width: 1px)", [])]),
      ],
      source,
    );
    expect(out.rules.map((rule) => rule.selector)).toEqual([".btn", ".g"]);
    // The rule lost inside a style rule's block is not seen: the
    // tokenizer skips a style rule's block whole, as the walk skips
    // nothing there that the CSSOM did not keep.
    expect(out.dropped).toEqual({ rule: 1, "@bar": 1 });
  });
});

describe("walkStyleSheet under outer conditions", () => {
  test("the conditions a sheet sits under head every rule's, judged like the rest", () => {
    const list = [
      style(".a", "color: red"),
      group("@media (min-width: 1px)", [style(".b", "color: blue")]),
    ];
    expect(walkStyleSheet(list, "", rules, ["@media print"]).rules).toEqual([
      {
        selector: ".a",
        conditions: ["@media print"],
        styles: { color: "red" },
      },
      {
        selector: ".b",
        conditions: ["@media print", "@media (min-width: 1px)"],
        styles: { color: "blue" },
      },
    ]);
    const refused = walkStyleSheet(list, "", rules, ["@media"]);
    expect(refused.rules).toEqual([]);
    expect(refused.dropped).toEqual({ "@media": 2 });
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
  test("blocks not starting with @ are rules, inside a conditional group too; at-rules by keyword, statements and blocks alike, a @charset never; a style rule's and any other at-rule's block is skipped whole; comments and strings hide their braces", () => {
    expect(
      countSource(`
        @charset "utf-8";
        @import url("a;b.css");
        @layer a, b;
        /* .x { } */
        .a { color: red; content: "}"; }
        .b, .c { .d { } }
        @media (min-width: 1px) { .e { } @container c (width > 1px) { .e2 {} } }
        @MEDIA print { }
        @font-face { src: url(x) }
        @keyframes k { from { } to { } }
        .f { background: url("data:image/png;base64,}") }
        .g { color: "{" }
      `),
    ).toEqual({
      rules: 6,
      atRules: {
        "@import": 1,
        "@layer": 1,
        "@media": 2,
        "@container": 1,
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
    expect(countSource("@media print { .a { color: red")).toEqual({
      rules: 1,
      atRules: { "@media": 1 },
    });
    expect(countSource("@media print { } } .b {}")).toEqual({
      rules: 1,
      atRules: { "@media": 1 },
    });
  });
});
