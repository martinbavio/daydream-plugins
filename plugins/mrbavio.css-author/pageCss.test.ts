// The rules the lints read a page's css as (pageCss.ts): which rules are
// the page's, what a nested or scoped rule's selector resolves to, and
// the walks over them — all this plugin's own reading of the kernel's
// scan, so proved here under node over blocks written by hand
// (testBlocks.ts). The scan itself, as the lints read it, is
// pageCss.kernel.test.ts's; Chromium's say on a face is
// pageCss.browser.test.ts's.
import { describe, expect, test } from "vitest";

import type { CssBlock } from "@daydream/plugin-api";

import {
  declarationMap,
  fontFaceBlocks,
  hasScopePseudo,
  mediaPreludes,
  pageRules,
  replaceScopePseudo,
  resolveNested,
  ruleName,
  selectorForMatching,
  selectorPreludes,
  splitTopLevelCommas,
  trailingPseudoElement,
  withoutRanges,
} from "./pageCss";
import { block, decls, statement } from "./testBlocks";

const shape = (blocks: readonly CssBlock[]) =>
  pageRules(blocks).map((rule) => ({
    index: rule.index,
    prelude: rule.prelude,
    parents: rule.parents,
    conditions: rule.conditions,
    selector: rule.selector,
    declarations: rule.declarations.map((d) => `${d.property}: ${d.value}${d.important ? " !important" : ""}`),
  }));

describe("pageRules", () => {
  test("style rules in source order, each with its own declarations as written", () => {
    expect(
      shape([
        block(".card", "padding: 16px; margin: 0 auto"),
        block("nav a, .link:hover", "color: inherit !important"),
      ]),
    ).toEqual([
      {
        index: 0,
        prelude: ".card",
        parents: [],
        conditions: [],
        selector: ".card",
        declarations: ["padding: 16px", "margin: 0 auto"],
      },
      {
        index: 1,
        prelude: "nav a, .link:hover",
        parents: [],
        conditions: [],
        selector: "nav a, .link:hover",
        declarations: ["color: inherit !important"],
      },
    ]);
  });

  test("at-rules: group rules hold rules with their conditions; everything else is not a rule of the page", () => {
    expect(
      shape([
        statement("@import url(x.css)"),
        statement("@layer base, theme"),
        block("@font-face", "font-family: X; src: url(a.woff2)"),
        block("@keyframes spin", "", [block("from", "rotate: 0deg"), block("to", "rotate: 360deg")]),
        block("@media (width >= 600px)", "", [
          block("@supports (display: grid)", "", [block(".a", "display: grid")]),
        ]),
        block("@layer base", "", [block(".b", "color: red")]),
        block("@page", "margin: 1cm"),
      ]).map((r) => [r.prelude, r.conditions, r.declarations]),
    ).toEqual([
      [".a", ["@media (width >= 600px)", "@supports (display: grid)"], ["display: grid"]],
      [".b", ["@layer base"], ["color: red"]],
    ]);
  });

  test("nesting: a nested rule resolves against its parent; an at-rule's declarations inside a style rule are that rule's, under the condition", () => {
    expect(
      shape([
        block(".card", "gap: 8px; padding: 2px", [
          block("&:hover", "color: red"),
          block("> .title, .x &", "margin: 0"),
          block("@media (width < 600px)", "gap: 4px", [block(".icon", "width: 1rem")]),
        ]),
      ]),
    ).toEqual([
      {
        index: 0,
        prelude: ".card",
        parents: [],
        conditions: [],
        selector: ".card",
        declarations: ["gap: 8px", "padding: 2px"],
      },
      {
        index: 1,
        prelude: "&:hover",
        parents: [".card"],
        conditions: [],
        selector: ":is(.card):hover",
        declarations: ["color: red"],
      },
      {
        index: 2,
        prelude: "> .title, .x &",
        parents: [".card"],
        conditions: [],
        selector: ":is(.card) > .title, .x :is(.card)",
        declarations: ["margin: 0"],
      },
      {
        index: 3,
        prelude: ".card",
        parents: [],
        conditions: ["@media (width < 600px)"],
        selector: ".card",
        declarations: ["gap: 4px"],
      },
      {
        index: 4,
        prelude: ".icon",
        parents: [".card"],
        conditions: ["@media (width < 600px)"],
        selector: ":is(.card) .icon",
        declarations: ["width: 1rem"],
      },
    ]);
  });

  test("@scope: a rule's selector is relative to the root — a member naming neither `:scope` nor `&` its descendant — and each scope's start and end are resolved as a rule is", () => {
    expect(
      pageRules([
        block("@scope (.card) to (.content)", "color: red", [
          block(":scope > img, p, > span, & a", "margin: 0"),
        ]),
        block(".card", "", [block("@scope (& > .x)", "padding: 0", [block(":scope", "gap: 0")])]),
        block("@scope (.a)", "", [block("@scope (.b) to (:scope > i)", "", [block("i", "top: 0")])]),
        block("@scope", "", [block("b", "left: 0")]),
        block("@scope nope", "", [block("u", "right: 0")]),
      ]).map((rule) => [
        rule.prelude,
        rule.selector,
        rule.scopes,
      ]),
    ).toEqual([
      [":scope", ":where(:scope)", [{ start: ".card", end: ":where(:scope) .content" }]],
      [
        ":scope > img, p, > span, & a",
        ":scope > img, :where(:scope) p, :where(:scope) > span, :where(:scope) a",
        [{ start: ".card", end: ":where(:scope) .content" }],
      ],
      [".card", ".card", []],
      [":scope", ":where(:scope)", [{ start: ":is(.card) > .x", end: null }]],
      [":scope", ":scope", [{ start: ":is(.card) > .x", end: null }]],
      [
        "i",
        ":where(:scope) i",
        [
          { start: ".a", end: null },
          { start: ":where(:scope) .b", end: ":scope > i" },
        ],
      ],
      ["b", ":where(:scope) b", [{ start: null, end: null }]],
      ["u", ":where(:scope) u", [{ start: ":not(*)", end: null }]],
    ]);
  });

});

describe("deeply nested css", () => {
  // Adversarial text: a walk must never exhaust the stack, however deep
  // the blocks nest.
  const DEPTH = 50_000;

  test("50,000 at-rules around a rule are walked without a stack overflow", () => {
    let blocks = [block(".a", "color: red")];
    for (let i = 0; i < DEPTH; i++) blocks = [block("@media all", "", blocks)];
    expect(mediaPreludes(blocks)).toHaveLength(DEPTH);
    expect(selectorPreludes(blocks)).toEqual([".a"]);
    expect(fontFaceBlocks(blocks)).toEqual([]);
    const rules = pageRules(blocks);
    expect(rules.map((rule) => [rule.selector, rule.conditions.length])).toEqual([
      [".a", DEPTH],
    ]);
  });
});

describe("helpers", () => {
  test("resolveNested desugars `&` to :is(parent), and a member without one is a descendant", () => {
    expect(resolveNested("&.open", ".card")).toBe(":is(.card).open");
    expect(resolveNested("& + &", "li")).toBe(":is(li) + :is(li)");
    expect(resolveNested("h2, > p", ".a, .b")).toBe(":is(.a, .b) h2, :is(.a, .b) > p");
    expect(resolveNested('[data-x="&"]', ".a")).toBe(':is(.a) [data-x="&"]');
  });

  test("replaceScopePseudo replaces the pseudo-class alone: never inside a string, an attribute selector or after an escape", () => {
    expect(replaceScopePseudo(":scope > p, :SCOPE.a", ":root")).toBe(
      ":root > p, :root.a",
    );
    for (const literal of [
      '[data-value=":scope"]',
      "[data-value=':scope']",
      "[data-value=\\:scope]",
      ".a\\:scope",
      ":scoped",
      ":scope-x",
    ]) {
      expect(replaceScopePseudo(literal, ":root"), literal).toBe(literal);
      expect(hasScopePseudo(literal), literal).toBe(false);
    }
    expect(replaceScopePseudo('[title="]"]:scope', ":root")).toBe(
      '[title="]"]:root',
    );
    // Inside an @scope, a member naming `:scope` only in an attribute is
    // still the root's descendant.
    expect(
      pageRules([block("@scope (.card)", "", [block('[data-value=":scope"]', "color: red")])])[0]!
        .selector,
    ).toBe(':where(:scope) [data-value=":scope"]');
  });

  test("trailing pseudo-elements, both spellings, stripped for matching", () => {
    expect(trailingPseudoElement(".a::before")).toEqual({ base: ".a", pseudo: "::before" });
    expect(trailingPseudoElement(".a:after")).toEqual({ base: ".a", pseudo: "::after" });
    expect(trailingPseudoElement("::selection")).toEqual({ base: "*", pseudo: "::selection" });
    expect(trailingPseudoElement(".a:hover")).toBeNull();
    expect(selectorForMatching(".a::before, .b, li::marker")).toBe(".a, .b, li");
  });

  test("ruleName reads like the CSS editor's label, the at-rules after", () => {
    expect(ruleName({ prelude: "&:hover", parents: [".card"], conditions: [] })).toBe(
      "`.card › &:hover`",
    );
    expect(
      ruleName({ prelude: ".a", parents: [], conditions: ["@media print", "@layer x"] }),
    ).toBe("`.a` in `@media print › @layer x`");
  });

  test("fontFaceBlocks, mediaPreludes and selectorPreludes find what they name, nested ones too; a face in a style rule is none", () => {
    const blocks = [
      block("@font-face", "font-family: A"),
      block("@supports (x: y)", "", [block("@font-face", "font-family: B")]),
      block("@media (width >= 600px)", "", [
        block(".a", "", [block("@media (width < 900px)", "color: red"), block("@font-face", "font-family: C")]),
      ]),
      block("@scope (.card)", "", [block(".title", "color: red")]),
      block("@keyframes k", "", [block("from", "color: red")]),
    ];
    expect(
      fontFaceBlocks(blocks).map(({ block, within }) => [block.declarations[0]!.value, within]),
    ).toEqual([
      ["A", []],
      ["B", ["@supports (x: y)"]],
    ]);
    expect(mediaPreludes(blocks)).toEqual(["@media (width >= 600px)", "@media (width < 900px)"]);
    expect(selectorPreludes(blocks)).toEqual([".a", "@scope (.card)", ".title"]);
  });

  test("a string is read as the tokenizer reads one: a newline not escaped ends it, and what follows is the selector's again", () => {
    expect(splitTopLevelCommas('[title="a, b"], .c')).toEqual(['[title="a, b"]', " .c"]);
    expect(splitTopLevelCommas('[title="a\n], .c')).toEqual(['[title="a\n]', " .c"]);
    expect(splitTopLevelCommas('[title="a\\\n, b"], .c')).toEqual(['[title="a\\\n, b"]', " .c"]);
    expect(resolveNested('[x="a\n] &', ".p")).toBe('[x="a\n] :is(.p)');
    expect(replaceScopePseudo('[x="a\n]:scope', ":root")).toBe('[x="a\n]:root');
    // An `@scope`'s groups are read the same way.
    expect(
      pageRules([block('@scope ([title="a\n]) to (.b)', "", [block("p", "margin: 0")])])[0]!.scopes,
    ).toEqual([{ start: '[title="a\n]', end: ":where(:scope) .b" }]);
  });

  test("declarationMap: later wins, !important kept in the value", () => {
    expect(declarationMap(decls("height: 100vh; height: 100dvh; color: red !important"))).toEqual({
      height: "100dvh",
      color: "red !important",
    });
  });
});

describe("withoutRanges", () => {
  test("cuts every range, in any order, and leaves the rest as it was", () => {
    const css = ".a { color: red; margin: 0 }";
    expect(withoutRanges(css, [[17, 27], [5, 16]])).toBe(".a {  }");
    expect(withoutRanges(css, [])).toBe(css);
  });
});
