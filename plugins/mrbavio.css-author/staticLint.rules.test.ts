// The static lint's rule-level checks, over a page's rules (pageCss.ts)
// read from blocks written by hand (testBlocks.ts) — no page parsed:
// unit-less lengths read a rule's declarations exactly like an element's
// own (staticLint.ts). A comment in a value is the kernel's scan's to take
// out (pageCss.kernel.test.ts). The full staticLint() over a page — the
// markup parsed by the browser, the font faces, the classes — is
// staticLint.browser.test.ts's, run from a Daydream checkout (README.md).
import { describe, expect, test } from "vitest";

import type { CssBlock, Finding } from "@daydream/plugin-api";

import { pageRules } from "./pageCss";
import {
  classNamer,
  lintUnitlessLengthsOnRules,
  referencedClasses,
} from "./staticLint";
import { block } from "./testBlocks";

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
