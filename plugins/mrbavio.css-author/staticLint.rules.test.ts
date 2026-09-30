// The static lint's rule-level checks, over a page's rules (pageCss.ts)
// read from blocks written by hand (testBlocks.ts) — no page parsed:
// unit-less lengths read a rule's declarations exactly like an element's
// own (staticLint.ts), and a stray `;` is judged from the preludes the
// kernel's scan hands over (where the scan puts one is
// staticLint.kernel.test.ts's). A comment in a value is the kernel's scan's to take
// out (pageCss.kernel.test.ts). The full staticLint() over a page — the
// markup parsed by the browser, the font faces, the classes — is
// staticLint.browser.test.ts's, run from a Daydream checkout (README.md).
import { describe, expect, test } from "vitest";

import type { CssBlock, Finding } from "@daydream/plugin-api";

import { pageRules } from "./pageCss";
import {
  classNamer,
  lintStrayDelimiters,
  lintUnitlessLengthsOnRules,
  referencedClasses,
} from "./staticLint";
import { block, statement } from "./testBlocks";

function unitless(blocks: CssBlock[]): Finding[] {
  const out: Finding[] = [];
  lintUnitlessLengthsOnRules(pageRules(blocks), "v1", out);
  return out;
}

describe("lintUnitlessLengthsOnRules", () => {
  test("a bare number on a rule's length property is a finding addressed at the rule's index", () => {
    expect(unitless([block(".card", "width: 100")])).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "width",
        message:
          "width: 100 in rule `.card` of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      },
    ]);
  });

  test("a valued length on a rule passes", () => {
    expect(unitless([block(".card", "width: 100%")])).toEqual([]);
  });

  test("no rules is a clean pass", () => {
    expect(unitless([])).toEqual([]);
  });

  test("every rule is judged, a nested one and one under a condition too, each at its own index and named as written", () => {
    const out = unitless([
      block(".a", "color: red"),
      block(".card", "gap: 8px", [block("& .title", "margin: 4")]),
      block("@media (width < 600px)", "", [block(".card", "padding: 12")]),
    ]);
    expect(out.map((f) => [f.rule, f.property, f.message])).toEqual([
      [
        2,
        "margin",
        "margin: 4 in rule `.card › & .title` of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      ],
      [
        3,
        "padding",
        "padding: 12 in rule `.card` in `@media (width < 600px)` of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      ],
    ]);
  });

  test("!important is not a unit", () => {
    expect(unitless([block(".a", "width: 100 !important")])).toHaveLength(1);
    expect(unitless([block(".a", "width: 100px !important")])).toEqual([]);
  });
});

describe("the classes a page's selectors name (rule 4)", () => {
  test("referencedClasses reads every .class compound, nested or escaped, and [class=] values", () => {
    expect(
      [
        ...referencedClasses([
          ".card .title, nav:is(.a, .b) > *:not(.c)",
          ".x\\:y",
          '[class~="pill"] , [class="one two"]',
          "&.open",
        ]),
      ].sort(),
    ).toEqual(["a", "b", "c", "card", "one", "open", "pill", "title", "two", "x:y"]);
  });

  test("prefix, suffix and substring [class…=] forms name every token that satisfies them; [class=] and [class~=] name their tokens", () => {
    const names = classNamer([
      '[class*="i-"]',
      "[class^=btn]",
      "[class$='-lg']",
      '[class~="pill"]',
    ]);
    expect(names("i-home")).toBe(true);
    expect(names("btn-primary")).toBe(true);
    expect(names("xbtn")).toBe(false);
    expect(names("card-lg")).toBe(true);
    expect(names("pill")).toBe(true);
    expect(names("pills")).toBe(false);
    expect([...referencedClasses(['[class*="i-"]'])]).toEqual([]);
  });
});

/** Rule 5's sentences over hand-written blocks, whose ranges point
 * nowhere: every `;` is on line 1. */
function strays(blocks: CssBlock[]): string[] {
  const out: Finding[] = [];
  lintStrayDelimiters("", blocks, "v1", out);
  for (const finding of out) {
    expect(finding).toEqual({ tier: "static", severity: "blocking", message: finding.message });
  }
  return out.map((finding) => finding.message);
}

describe("lintStrayDelimiters (rule 5)", () => {
  test("a stray `;` before a rule is one blocking finding naming the rule it drops", () => {
    expect(strays([block(".a", "color: red"), block("; .b", "color: blue")])).toEqual([
      "the stray `;` before `.b` of viewport v1 (line 1 of its css) makes the browser drop the rule `.b`; remove it",
    ]);
  });

  test("inside a group rule, the finding says which; in a keyframes block, it drops a keyframe", () => {
    expect(
      strays([
        block("@media (width < 600px)", "", [block("; .b", "color: blue")]),
        block("@keyframes k", "", [block("; from", "top: 0"), block("to", "top: 1px")]),
      ]),
    ).toEqual([
      "the stray `;` before `.b` in `@media (width < 600px)` of viewport v1 (line 1 of its css) makes the browser drop the rule `.b`; remove it",
      "the stray `;` before `from` in `@keyframes k` of viewport v1 (line 1 of its css) makes the browser drop the keyframe `from`; remove it",
    ]);
  });

  test("a statement after the `;` is dropped with the rule, and the sentence says so; a run of `;` is one finding", () => {
    expect(
      strays([block("; @layer q; .c", "color: green"), block(";; @import url(x.css); @layer r; .d")]),
    ).toEqual([
      "the stray `;` before `@layer q; .c` of viewport v1 (line 1 of its css) makes the browser drop `@layer q` and the rule `.c`; remove it",
      "the stray `;;` before `@import url(x.css); @layer r; .d` of viewport v1 (line 1 of its css) makes the browser drop `@import url(x.css)`, `@layer r` and the rule `.d`; remove it",
    ]);
  });

  test("text before the `;` is read into the refused rule's selector", () => {
    expect(strays([block("@layer a", "", [block(".a;b", "color: red")])])).toEqual([
      "the stray `;` after `.a` in `@layer a` of viewport v1 (line 1 of its css) makes the browser drop the rule `.a;b` whole; remove the `;`, and `.a` too if it is a leftover",
    ]);
  });

  test("a group rule the `;` drops is one finding, and a stray `;` inside it another, said to be inside it as written", () => {
    expect(
      strays([block("; @media all", "", [block(".c", "color: red"), block("; .d", "color: red")])]),
    ).toEqual([
      "the stray `;` before `@media all` of viewport v1 (line 1 of its css) makes the browser drop the rule `@media all`; remove it",
      "the stray `;` before `.d` in `@media all` of viewport v1 (line 1 of its css) makes the browser drop the rule `.d`; remove it",
    ]);
  });

  test("a `;` inside a string, an attribute selector, a bracket or after an escape is no stray, nor is a statement's own text", () => {
    expect(
      strays([
        block('[data-x=";"]', "color: red"),
        block("[data-x=a\\;b]", "color: red"),
        block("a[title=';'] > .b", "color: red"),
        block(".a\\;b", "color: red"),
        block(':is(.a, [data-y=";"])', "color: red"),
        block('@supports (content: ";")', "", [block(".c", "color: red")]),
        statement("@layer a, b"),
      ]),
    ).toEqual([]);
  });

  test("the line is the `;`'s in the css text", () => {
    const css = ".a { color: red }\n\n/* ; */ .x;\n.b { color: blue }";
    const out: Finding[] = [];
    lintStrayDelimiters(
      css,
      [
        { ...block(".a", "color: red"), range: [0, 17] },
        { ...block(".x;\n.b", "color: blue"), range: [27, css.length] },
      ],
      "v1",
      out,
    );
    expect(out.map((f) => f.message)).toEqual([
      "the stray `;` after `.x` of viewport v1 (line 3 of its css) makes the browser drop the rule `.x; .b` whole; remove the `;`, and `.x` too if it is a leftover",
    ]);
  });
});
