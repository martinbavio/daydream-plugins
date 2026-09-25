// The kernel's scan as the lints read it (`dd.core.cssBlocks` walked by
// pageCss.ts): what the hand-written blocks of pageCss.test.ts stand for,
// held to the scan they stand in for, and what only the scan decides —
// where a declaration or a block ends in text a string, a comment, an
// escape or a bracket holds. It needs the kernel's code, so it runs from
// a Daydream checkout (`pnpm test:kernel`, README.md), under node.
import { describe, expect, test } from "vitest";

import type { CssBlock } from "@daydream/plugin-api";
import { coreApi } from "@daydream/plugin-testing";

import { pageRules, withoutRanges } from "./pageCss";
import { block } from "./testBlocks";

const core = coreApi();

/** Each rule as the lints judge it, ranges aside. */
const shape = (blocks: readonly CssBlock[]) =>
  pageRules(blocks).map((rule) => ({
    prelude: rule.prelude,
    parents: rule.parents,
    conditions: rule.conditions,
    selector: rule.selector,
    scopes: rule.scopes,
    declarations: rule.declarations.map((d) => `${d.property}: ${d.value}${d.important ? " !important" : ""}`),
  }));

const rules = (css: string) => shape(core.cssBlocks(css));

describe("pageRules over the kernel's scan", () => {
  test("a sheet written as text reads as the blocks pageCss.test.ts writes by hand", () => {
    expect(
      rules(`/* head */
.card {
  gap: 8px;
  &:hover { color: red }
  > .title, .x & { margin: 0 }
  @media (width < 600px) { gap: 4px; .icon { width: 1rem } }
  padding: 2px;
}
@scope (.card) to (.content) { :scope > img { margin: 0 } color: red; }`),
    ).toEqual(
      shape([
        block(".card", "gap: 8px; padding: 2px", [
          block("&:hover", "color: red"),
          block("> .title, .x &", "margin: 0"),
          block("@media (width < 600px)", "gap: 4px", [block(".icon", "width: 1rem")]),
        ]),
        block("@scope (.card) to (.content)", "color: red", [block(":scope > img", "margin: 0")]),
      ]),
    );
  });

  test("strings, comments, escapes and brackets never end a declaration or a block", () => {
    expect(
      rules(`.a\\{b { content: "}; {"; background: url(data:image/png;base64,AAAA); }
.c /* { */ { --x: 'a;b' /* ; } */; }
.d { --y: ( } ); color: red }
@supports (x: y{z}) { .e { color: blue } }`).map((r) => [r.prelude, r.conditions, r.declarations]),
    ).toEqual([
      [".a\\{b", [], ['content: "}; {"', "background: url(data:image/png;base64,AAAA)"]],
      [".c", [], ["--x: 'a;b'"]],
      [".d", [], ["--y: ( } )", "color: red"]],
      [".e", ["@supports (x: y{z})"], ["color: blue"]],
    ]);
  });

  test("a comment in a value is not part of it, and `!important` is not a unit", () => {
    expect(rules(".a { width: 100 /* px */ !important; height: /* 1 */ 2px }")[0]!.declarations).toEqual([
      "width: 100 !important",
      "height: 2px",
    ]);
  });

  test("a custom property keeps its case, any other property is lower-cased, and a name past ASCII is kept", () => {
    expect(rules(".a { --Brand: red; COLOR: var(--Brand); --größe: 1px }")[0]!.declarations).toEqual([
      "--Brand: red",
      "color: var(--Brand)",
      "--größe: 1px",
    ]);
  });

  test("the legacy markers `<!--` and `-->` between top-level rules are skipped, as the tokenizer skips them; inside a block they stay", () => {
    expect(
      rules(`<!--
.a { color: red }
--> <!-- .b { color: blue } -->
@media print { <!-- .c { color: green } }`).map((r) => r.prelude),
    ).toEqual([".a", ".b", "<!-- .c"]);
  });

  test("an unclosed block runs to the end, as in a browser, and never throws; a stray brace is the next rule's prelude", () => {
    expect(rules(".a { color: red; .b { margin: 0").map((r) => r.declarations)).toEqual([
      ["color: red"],
      ["margin: 0"],
    ]);
    // A selector the browser refuses, which matches nothing.
    expect(rules("} .a { color: red }").map((r) => r.prelude)).toEqual(["} .a"]);
  });

  test("a declaration's range cuts exactly it, and the rest still reads", () => {
    const css = ".a { color: red; /* keep */ margin: 0 }";
    const [rule] = pageRules(core.cssBlocks(css));
    const [color, margin] = rule!.declarations;
    expect(withoutRanges(css, [color!.range])).toBe(".a {  /* keep */ margin: 0 }");
    expect(withoutRanges(css, [margin!.range])).toBe(".a { color: red; /* keep */ }");
    expect(withoutRanges(css, [color!.range, margin!.range])).toBe(".a {  /* keep */ }");
  });
});
