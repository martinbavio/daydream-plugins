// The static lint's rule-level checks, in the node project, over a page's
// css text scanned into rules (pageCss.ts) — no DOM, no `dd.core`:
// unit-less lengths and restated initials read a rule's declarations
// exactly like an element's own, and the `img`/`hr` overflow exception is
// approximated from the selector text alone (staticLint.ts). The full
// staticLint() over a page — the markup parsed by the browser, the font
// faces, the classes — is staticLint.browser.test.ts's, run from a
// Daydream checkout (README.md).
import { describe, expect, test } from "vitest";

import type { Finding } from "@daydream/plugin-api";

import { pageRules } from "./pageCss";
import {
  classNamer,
  lintRestatedInitialsOnRules,
  lintUnitlessLengthsOnRules,
  referencedClasses,
} from "./staticLint";

function unitless(css: string): Finding[] {
  const out: Finding[] = [];
  lintUnitlessLengthsOnRules(pageRules(css), "v1", out);
  return out;
}

function restated(css: string): Finding[] {
  const out: Finding[] = [];
  lintRestatedInitialsOnRules(pageRules(css), "v1", out);
  return out;
}

describe("lintUnitlessLengthsOnRules", () => {
  test("a bare number on a rule's length property is a finding addressed at the rule's index", () => {
    expect(unitless(".card { width: 100; }")).toEqual([
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
    expect(unitless(".card { width: 100%; }")).toEqual([]);
  });

  test("no rules is a clean pass", () => {
    expect(unitless("")).toEqual([]);
  });

  test("every rule is judged, a nested one and one under a condition too, each at its own index and named as written", () => {
    const out = unitless(
      ".a { color: red; } .card { gap: 8px; & .title { margin: 4 } } @media (width < 600px) { .card { padding: 12 } }",
    );
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

  test("a comment in the value is not part of it, and !important is not a unit", () => {
    expect(unitless(".a { width: 100 /* px */ !important; }")).toHaveLength(1);
    expect(unitless(".a { width: /* 100 */ 100px; }")).toEqual([]);
  });
});

describe("lintRestatedInitialsOnRules", () => {
  test("a restated initial on a rule with no type selector is a finding — the img/hr exception does not apply to properties outside the overflow table", () => {
    expect(restated(".card { position: static; }")).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "position",
        message:
          "position: static in rule `.card` of viewport v1 restates the initial value",
      },
    ]);
  });

  test("overflow: visible on a rule with no type selector is excused — the compound could reach img or hr", () => {
    expect(restated(".card { overflow: visible; }")).toEqual([]);
  });

  test("overflow: visible on a rule typed to img or hr is excused, case-insensitively", () => {
    for (const selector of ["img", "IMG.thumb", "hr.rule", "* .x img"]) {
      expect(restated(`${selector} { overflow: visible; }`), selector).toEqual([]);
    }
  });

  test("overflow: visible on a rule typed to a different tag is a finding: it can never reach img or hr", () => {
    expect(restated("div.card { overflow: visible; }")).toHaveLength(1);
  });

  test("a selector list is excused if ANY member could reach img or hr", () => {
    expect(restated("div.card, img.thumb { overflow: visible; }")).toEqual([]);
  });

  test("an explicit universal selector is excused, same as no type", () => {
    expect(restated("*.card { overflow: visible; }")).toEqual([]);
  });

  test("a non-initial value is never a finding", () => {
    expect(restated(".card { position: relative; }")).toEqual([]);
  });

  test("a rule under a combinator is judged by its rightmost compound", () => {
    // `.list > img` can reach an img at its rightmost compound even though
    // the list itself is a div.
    expect(restated(".list > img { overflow: visible; }")).toEqual([]);
  });

  test("value comparison ignores case", () => {
    expect(restated(".a { position: Static; float: NONE; }")).toHaveLength(2);
  });

  test("a rule under a condition, or nested in another, resets under that condition — the override a conditional layer was — and is never a finding", () => {
    expect(
      restated(
        "@media (width >= 600px) { .card { position: static; max-width: none; } }",
      ),
    ).toEqual([]);
    expect(
      restated(".card { position: absolute; &.open { position: static; } }"),
    ).toEqual([]);
    expect(
      restated(".card { position: absolute; @media (width >= 600px) { position: static; } }"),
    ).toEqual([]);
  });

  test("an !important initial is there to win, and is not judged", () => {
    expect(restated(".a { position: static !important; }")).toEqual([]);
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
