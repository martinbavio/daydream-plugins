// The walker over the browser's own CSSOM (decision #71): what
// `CSSStyleSheet.replaceSync` normalises, what it drops without a word,
// and the kernel's real faces judging the result. The pure walk over
// hand-built rules is stylesheet.test.ts; this is the same walk over
// what Chromium builds, with `dd.core` as the shell hands it.
import { describe, expect, test } from "vitest";

import { coreApi } from "@daydream/plugin-testing";

import { sheetFromStyleText } from "./stylesheet";

const sheet = (text: string) => sheetFromStyleText(text, coreApi());

describe("sheetFromStyleText", () => {
  test("the CSSOM's spelling is what is stored: lowercased types, ::before with two colons, quoted attribute values, the shorthand kept whole; !important stripped and counted", () => {
    const out = sheet(
      `DIV.Card > P:before , .a:Hover{ Color : RED !IMPORTANT ; margin:0 0 8px }
       [data-x = "a"] , input[type=text i] { color: red }`,
    );
    expect(out.rules).toEqual([
      {
        selector: "div.Card > p::before, .a:hover",
        styles: { color: "red", margin: "0px 0px 8px" },
      },
      {
        selector: '[data-x="a"], input[type="text" i]',
        styles: { color: "red" },
      },
    ]);
    expect(out.important).toBe(1);
    expect(out.dropped).toEqual({});
  });

  test("what the parser drops silently is reported by diff: one invalid selector kills the whole rule, an unknown at-rule and an @import vanish; a forgiving list keeps its rule", () => {
    const out = sheet(
      `@import url(https://evil.example/x.css);
       .ok, :foo { color: red }
       @foo { .z { color: red } }
       .ok, :is(:foo, .ok) { color: blue }
       .u { color: red; color: notacolor; width: 10px }`,
    );
    expect(out.rules).toEqual([
      { selector: ".ok, :is(.ok)", styles: { color: "blue" } },
      { selector: ".u", styles: { color: "red", width: "10px" } },
    ]);
    expect(out.dropped).toEqual({ "@import": 1, rule: 1, "@foo": 1 });
  });

  test("the kernel's grammar refuses what the browser would take — a shadow-tree selector, :visited — under `rule`; a @supports condition is stored, as a rule's is", () => {
    const out = sheet(
      `:host .x { color: red !important }
       a:visited { color: purple }
       @supports (display: grid) { .g { display: grid } }
       @media (min-width: 600px) { @supports (gap: 1px) { .h { gap: 1px } } }
       .fine { color: red }`,
    );
    expect(out.rules).toEqual([
      {
        selector: ".g",
        conditions: ["@supports (display: grid)"],
        styles: { display: "grid" },
      },
      {
        selector: ".h",
        conditions: ["@media (min-width: 600px)", "@supports (gap: 1px)"],
        styles: { gap: "1px" },
      },
      { selector: ".fine", styles: { color: "red" } },
    ]);
    expect(out.dropped).toEqual({ rule: 2 });
    expect(out.important).toBe(0);
  });

  test("nesting the CSSOM absolutizes (the implied & inserted) flattens to the entry's forms; a nested @container becomes a condition on the flattened rule", () => {
    const out = sheet(
      `.x { color: red; .y { color: blue } & .z, .w & { color: green }
            @container card (min-width: 100px) { color: purple } }`,
    );
    expect(out.rules).toEqual([
      { selector: ".x", styles: { color: "red" } },
      { selector: ".x .y", styles: { color: "blue" } },
      { selector: ".x .z, .w :is(.x)", styles: { color: "green" } },
      {
        selector: ".x",
        conditions: ["@container card (min-width: 100px)"],
        styles: { color: "purple" },
      },
    ]);
    // Every stored rule is one the format's own validator would admit.
    for (const rule of out.rules) {
      expect(coreApi().selectorProblem(rule.selector)).toBeNull();
      for (const prelude of rule.conditions ?? [])
        expect(coreApi().conditionPreludeProblem(prelude)).toBeNull();
    }
  });

  test("a @font-face is the kernel's descriptor grain, its url re-quoted by the CSSOM; a face with an http url is dropped and counted", () => {
    const out = sheet(
      `@font-face { font-family: "Inter"; src: url(https://x.test/inter.woff2) format("woff2"); font-weight: 100 900 }
       @font-face { font-family: Bad; src: url(http://x.test/bad.woff2) }`,
    );
    expect(out.fonts).toEqual([
      {
        "font-family": "Inter",
        src: 'url("https://x.test/inter.woff2") format("woff2")',
        "font-weight": "100 900",
      },
    ]);
    expect(out.dropped).toEqual({ "@font-face": 1 });
  });
});
