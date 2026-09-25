// The one test of "a rule that is certain" (certain.ts), over a page's
// css text read into rules (pageCss.ts, through the kernel's scan, so run
// from a Daydream checkout): every
// group at-rule a rule can sit under, nesting, and the state
// pseudo-classes — in the selector, a parent's or an `@scope`'s.
import { describe, expect, test } from "vitest";

import { coreApi } from "@daydream/plugin-testing";

import { isCertain } from "./certain";
import { pageRules } from "./pageCss";

/** Each rule of the css as `[its selector as written, certain]`. */
const judged = (css: string): [string, boolean][] =>
  pageRules(coreApi(), css).map((rule) => [rule.prelude, isCertain(rule)]);

describe("isCertain", () => {
  test("a top-level rule with no state pseudo-class is certain", () => {
    expect(judged(".card { color: red } .card > img { width: 100% }")).toEqual([
      [".card", true],
      [".card > img", true],
    ]);
  });

  test("@layer and @scope gate nothing: a rule under either is certain, nested ones included", () => {
    expect(
      judged(
        [
          "@layer base { .a { color: red } }",
          "@layer base { @layer inner { .b { color: red } } }",
          "@scope (.page) to (.aside) { .c { color: red } }",
          "@layer base { @scope (.page) { .d { color: red } } }",
          "@scope (.page) { :scope { color: red } }",
        ].join("\n"),
      ),
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
      judged(
        [
          "@media (width >= 600px) { .a { color: red } }",
          "@supports (display: grid) { .b { color: red } }",
          "@container (width > 400px) { .c { color: red } }",
          "@starting-style { .d { opacity: 0 } }",
          "@layer base { @media print { .e { color: red } } }",
          "@scope (.page) { @supports (display: grid) { .f { color: red } } }",
        ].join("\n"),
      ),
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
      judged(
        [
          ".card { color: red; & .title { color: blue } > img { width: 100% } }",
          ".card:hover { & .title { color: blue } }",
          ".card { @media (width >= 600px) { & .title { color: blue } } }",
          ".card { @layer base { & .title { color: blue } } }",
        ].join("\n"),
      ),
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
      judged(
        [
          ".a:focus-visible { outline: none }",
          "@scope (.menu:hover) { .item { color: red } }",
          "@scope (.menu) to (.item:focus-within) { .label { color: red } }",
        ].join("\n"),
      ),
    ).toEqual([
      [".a:focus-visible", false],
      [".item", false],
      [".label", false],
    ]);
  });
});
