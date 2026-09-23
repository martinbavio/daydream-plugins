// The scanner the lints read a page's css through (pageCss.ts), proved
// under node: where each rule and declaration is, what a nested rule's
// selector resolves to, and what the measurer's probes leave behind.
import { describe, expect, test } from "vitest";

import {
  closesItsOwnBlocks,
  declarationMap,
  fontFaces,
  hasScopePseudo,
  mediaPreludes,
  pageRules,
  replaceScopePseudo,
  resolveNested,
  ruleName,
  scanCss,
  scanDeclarations,
  selectorForMatching,
  selectorPreludes,
  trailingPseudoElement,
  withoutRanges,
  type CssBlock,
} from "./pageCss";

const shape = (css: string) =>
  pageRules(css).map((rule) => ({
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
      shape(`/* head */
.card { padding: 16px; margin: 0 auto }
nav a, .link:hover { color: inherit !important; }
`),
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
      shape(`@import url(x.css);
@layer base, theme;
@font-face { font-family: X; src: url(a.woff2); }
@keyframes spin { from { rotate: 0deg } to { rotate: 360deg } }
@media (width >= 600px) { @supports (display: grid) { .a { display: grid } } }
@layer base { .b { color: red } }
@page { margin: 1cm }
`).map((r) => [r.prelude, r.conditions, r.declarations]),
    ).toEqual([
      [".a", ["@media (width >= 600px)", "@supports (display: grid)"], ["display: grid"]],
      [".b", ["@layer base"], ["color: red"]],
    ]);
  });

  test("nesting: a nested rule resolves against its parent; an at-rule's declarations inside a style rule are that rule's, under the condition", () => {
    expect(
      shape(`.card {
  gap: 8px;
  &:hover { color: red }
  > .title, .x & { margin: 0 }
  @media (width < 600px) { gap: 4px; .icon { width: 1rem } }
  padding: 2px;
}`),
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
      pageRules(`@scope (.card) to (.content) { :scope > img, p, > span, & a { margin: 0 } color: red; }
.card { @scope (& > .x) { :scope { gap: 0 } padding: 0; } }
@scope (.a) { @scope (.b) to (:scope > i) { i { top: 0 } } }
@scope { b { left: 0 } }
@scope nope { u { right: 0 } }`).map((rule) => [
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

  test("strings, comments, escapes and parentheses never end a declaration or a block", () => {
    expect(
      shape(`.a\\{b { content: "}; {"; background: url(data:image/png;base64,AAAA); }
.c /* { */ { --x: 'a;b' /* ; } */; }`).map((r) => [r.prelude, r.declarations]),
    ).toEqual([
      [".a\\{b", ['content: "}; {"', "background: url(data:image/png;base64,AAAA)"]],
      [".c", ["--x: 'a;b'"]],
    ]);
  });

  test("the legacy markers `<!--` and `-->` between top-level rules are skipped, as the tokenizer skips them; inside a block they stay", () => {
    expect(
      shape(`<!--
.a { color: red }
--> <!-- .b { color: blue } -->
@media print { <!-- .c { color: green } }`).map((r) => r.prelude),
    ).toEqual([".a", ".b", "<!-- .c"]);
  });

  test("a custom property keeps its case; every other property is lower-cased", () => {
    expect(shape(".a { --Brand: red; COLOR: var(--Brand) }")[0]!.declarations).toEqual([
      "--Brand: red",
      "color: var(--Brand)",
    ]);
  });

  test("an unclosed block runs to the end, as in a browser, and never throws", () => {
    expect(shape(".a { color: red; .b { margin: 0").map((r) => r.declarations)).toEqual([
      ["color: red"],
      ["margin: 0"],
    ]);
    expect(shape("} .a { color: red }").map((r) => r.prelude)).toEqual([".a"]);
  });

  test("the measurer's container probes are not the page's: its declarations and reach copies are left out", () => {
    // The mounted copy's css for `.card { gap: 1px } @container (w > 1px) { .card { color: red } }`,
    // as src/measure/livePage.ts writes it.
    const probed = `.card { gap: 1px }
@media all {  .card {  --dream-container-0: 1;} } @container (width > 1px) { .card {  --dream-container-0: 2;  color: red } }
@property --dream-container-0 { syntax: "<integer>"; inherits: false; initial-value: 0; }
`;
    expect(shape(probed).map((r) => [r.index, r.conditions, r.declarations])).toEqual([
      [0, [], ["gap: 1px"]],
      [1, ["@container (width > 1px)"], ["color: red"]],
    ]);
    // An author's own `@media all` stays.
    expect(shape("@media all { .a { color: red } } @container (w > 1px) { .a { color: blue } }")).toHaveLength(2);
  });

  test("ranges cut exactly the declaration, and the rest still reads", () => {
    const css = ".a { color: red; /* keep */ margin: 0 }";
    const [rule] = pageRules(css);
    const [color, margin] = rule!.declarations;
    expect(withoutRanges(css, [color!.range])).toBe(".a {  /* keep */ margin: 0 }");
    expect(withoutRanges(css, [margin!.range])).toBe(".a { color: red; /* keep */ }");
    expect(withoutRanges(css, [color!.range, margin!.range])).toBe(".a {  /* keep */ }");
  });
});

describe("closesItsOwnBlocks, the kernel's guard", () => {
  // Its answer decides whether a folded <style> goes in as written
  // (pageDom.ts withMedia), so it must be the kernel's to the letter
  // (src/render/cssRanges.ts reachProblem).
  test("a sheet that closes what it opens, brackets in comments, strings, urls and escapes not counted", () => {
    for (const css of [
      "",
      "a { color: red }\n@media print { b { c: d } }",
      'a::before { content: "}" } /* } */',
      "a { background: url(x}y.png) }",
      'a { background: url("}") }',
      "a\\} { color: red }",
      "a { width: calc((1px + 2px) * 3) } [data-x] {}",
      'a { content: "multi\\\nline }" }',
      "@url(x) {}",
    ]) {
      expect(closesItsOwnBlocks(css), css).toBe(true);
    }
  });

  test("a stray closer, an unclosed block, comment, string or url, a string a newline ends, and a url in a name", () => {
    for (const css of [
      "a {} } b { color: red }",
      "a { color: red",
      "a {} /* never closed",
      'a { content: "never closed',
      'a { content: "a newline ends it\n} b {}',
      "a { background: url(x.png }",
      "a { width: calc(1px } b {}",
      'a { background: url(a"}) } b {}\n)',
      'a { background: \\75rl(a"}) } b {}\n)',
      'a { color: #url(a"b) }',
      "a { color: red ) }",
    ]) {
      expect(closesItsOwnBlocks(css), css).toBe(false);
    }
  });
});

describe("deeply nested css", () => {
  // Adversarial text: a scan must never exhaust the stack, however deep
  // the blocks nest.
  const DEPTH = 50_000;

  test("50,000 nested blocks scan as 50,000 blocks, each the parent of the next", () => {
    const css = `${".a {".repeat(DEPTH)}color: red${"}".repeat(DEPTH)} .b { gap: 0 }`;
    const blocks = scanCss(css);
    expect(blocks.map((b) => b.prelude)).toEqual([".a", ".b"]);
    let depth = 0;
    let innermost = blocks[0]!;
    for (let b: CssBlock | undefined = blocks[0]; b !== undefined; b = b.children[0]) {
      depth++;
      innermost = b;
    }
    expect(depth).toBe(DEPTH);
    expect(innermost.declarations.map((d) => d.value)).toEqual(["red"]);
    expect(blocks[0]!.range).toEqual([0, css.indexOf(" .b")]);
  });

  test("50,000 unclosed blocks, and 50,000 unclosed at-rules around a rule, are read without a stack overflow", () => {
    expect(scanCss("{".repeat(DEPTH))).toHaveLength(1);
    expect(scanDeclarations(`color: red; ${"{".repeat(DEPTH)}`)).toHaveLength(1);
    const css = `${"@media all {".repeat(DEPTH)}.a { color: red }`;
    expect(mediaPreludes(css)).toHaveLength(DEPTH);
    expect(selectorPreludes(css)).toEqual([".a"]);
    expect(fontFaces(css)).toEqual([]);
    const rules = pageRules(css);
    expect(rules.map((rule) => [rule.selector, rule.conditions.length])).toEqual([
      [".a", DEPTH],
    ]);
  });
});

describe("helpers", () => {
  test("scanDeclarations reads a style attribute", () => {
    expect(
      scanDeclarations("color: red; width:100px;;  --x : a b ").map((d) => [
        d.property,
        d.value,
      ]),
    ).toEqual([
      ["color", "red"],
      ["width", "100px"],
      ["--x", "a b"],
    ]);
    expect(scanDeclarations("")).toEqual([]);
  });

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
      pageRules('@scope (.card) { [data-value=":scope"] { color: red } }')[0]!
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

  test("fontFaces, mediaPreludes and selectorPreludes find what they name, nested ones too", () => {
    const css = `@font-face { font-family: A; }
@supports (x: y) { @font-face { font-family: B; } }
@media (width >= 600px) { .a { @media (width < 900px) { color: red } } }
@scope (.card) { .title { color: red } }
@keyframes k { from { color: red } }`;
    expect(fontFaces(css).map((f) => f.declarations[0]!.value)).toEqual(["A", "B"]);
    expect(mediaPreludes(css)).toEqual(["@media (width >= 600px)", "@media (width < 900px)"]);
    expect(selectorPreludes(css)).toEqual([".a", "@scope (.card)", ".title"]);
  });

  test("declarationMap: later wins, !important kept in the value", () => {
    const [rule] = pageRules(".a { height: 100vh; height: 100dvh; color: red !important }");
    expect(declarationMap(rule!.declarations)).toEqual({
      height: "100dvh",
      color: "red !important",
    });
  });
});
