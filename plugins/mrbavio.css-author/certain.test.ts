// The one test of "a rule that is certain" (certain.ts), over a page's
// rules (pageCss.ts) read from blocks written by hand (testBlocks.ts):
// every group at-rule a rule can sit under, nesting, and the state
// pseudo-classes — in the selector, a parent's or an `@scope`'s.
import { describe, expect, test } from "vitest";

import type { CssBlock } from "@daydream/plugin-api";

import { isCertain } from "./certain";
import { pageRules } from "./pageCss";
import { block } from "./testBlocks";

/** Each rule of the blocks as `[its selector as written, certain]`. */
const judged = (blocks: CssBlock[]): [string, boolean][] =>
  pageRules(blocks).map((rule) => [rule.prelude, isCertain(rule)]);

/** `rule` inside each at-rule prelude, outermost first. */
const under = (preludes: string[], rule: CssBlock): CssBlock =>
  preludes.reduceRight((inner, prelude) => block(prelude, "", [inner]), rule);

describe("isCertain", () => {
  test("a top-level rule with no state pseudo-class is certain", () => {
    expect(judged([block(".card", "color: red"), block(".card > img", "width: 100%")])).toEqual([
      [".card", true],
      [".card > img", true],
    ]);
  });

  test("@layer and @scope gate nothing: a rule under either is certain, nested ones included", () => {
    expect(
      judged([
        under(["@layer base"], block(".a", "color: red")),
        under(["@layer base", "@layer inner"], block(".b", "color: red")),
        under(["@scope (.page) to (.aside)"], block(".c", "color: red")),
        under(["@layer base", "@scope (.page)"], block(".d", "color: red")),
        under(["@scope (.page)"], block(":scope", "color: red")),
      ]),
    ).toEqual([
      [".a", true],
      [".b", true],
      [".c", true],
      [".d", true],
      [":scope", true],
    ]);
  });

  test("@media, @supports, @container and @starting-style gate a rule: under any of them, alone or inside a layer or a scope, it is not certain", () => {
    expect(
      judged([
        under(["@media (width >= 600px)"], block(".a", "color: red")),
        under(["@supports (display: grid)"], block(".b", "color: red")),
        under(["@container (width > 400px)"], block(".c", "color: red")),
        under(["@starting-style"], block(".d", "opacity: 0")),
        under(["@layer base", "@media print"], block(".e", "color: red")),
        under(["@scope (.page)", "@supports (display: grid)"], block(".f", "color: red")),
      ]),
    ).toEqual([
      [".a", false],
      [".b", false],
      [".c", false],
      [".d", false],
      [".e", false],
      [".f", false],
    ]);
  });

  test("a nested rule is as certain as its resolved selector and the at-rules around it", () => {
    expect(
      judged([
        block(".card", "color: red", [block("& .title", "color: blue"), block("> img", "width: 100%")]),
        block(".card:hover", "", [block("& .title", "color: blue")]),
        block(".card", "", [under(["@media (width >= 600px)"], block("& .title", "color: blue"))]),
        block(".card", "", [under(["@layer base"], block("& .title", "color: blue"))]),
      ]),
    ).toEqual([
      [".card", true],
      ["& .title", true],
      ["> img", true],
      [".card:hover", false],
      ["& .title", false],
      [".card", true],
      ["& .title", false],
      [".card", true],
      ["& .title", true],
    ]);
  });

  test("a state pseudo-class in the selector, or in an @scope's roots or limits, makes a rule uncertain", () => {
    expect(
      judged([
        block(".a:focus-visible", "outline: none"),
        under(["@scope (.menu:hover)"], block(".item", "color: red")),
        under(["@scope (.menu) to (.item:focus-within)"], block(".label", "color: red")),
      ]),
    ).toEqual([
      [".a:focus-visible", false],
      [".item", false],
      [".label", false],
    ]);
  });
});
