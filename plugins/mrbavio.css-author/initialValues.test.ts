// Which declarations the explicit-initial-value rule weighs
// (initialValues.ts), in the node project, over a page's css text scanned
// into rules (pageCss.ts). Whether one is a finding is measured against
// the mounted page, the UA sheet included (matchLint.browser.test.ts,
// gates.browser.test.ts).
import { describe, expect, test } from "vitest";

import { pageRules, scanDeclarations } from "./pageCss";
import { restatesInitial, ruleInitialCandidates } from "./initialValues";

const restated = (style: string): string[] =>
  scanDeclarations(style)
    .filter(restatesInitial)
    .map((d) => d.property);

const candidates = (css: string): [number, string][] =>
  ruleInitialCandidates(pageRules(css)).map(({ rule, declaration }) => [
    rule.index,
    declaration.property,
  ]);

describe("restatesInitial", () => {
  test("every property of the table at its initial value, case and space aside", () => {
    expect(
      restated(
        "position:  Static ; float: NONE; clear: none; z-index: auto; inset: auto; flex-shrink: 1; flex-basis: auto; opacity: 1; transform: none; max-width: none; min-height: auto; overflow: visible; box-shadow: none",
      ),
    ).toEqual([
      "position",
      "float",
      "clear",
      "z-index",
      "inset",
      "flex-shrink",
      "flex-basis",
      "opacity",
      "transform",
      "max-width",
      "min-height",
      "overflow",
      "box-shadow",
    ]);
  });

  test("a non-initial value is not one", () => {
    expect(
      restated(
        "position: relative; flex-shrink: 0; flex-grow: 1; opacity: 0.5; max-width: 60ch; min-width: 0; overflow: hidden; z-index: 1",
      ),
    ).toEqual([]);
  });

  test("an inherited property is never in the table: a reset under an ancestor is real", () => {
    expect(
      restated("letter-spacing: normal; text-transform: none; visibility: visible"),
    ).toEqual([]);
  });

  test("outline-offset is deliberately not in the table", () => {
    expect(restated("outline-offset: 0")).toEqual([]);
  });

  test("an !important initial is there to win, and is not one", () => {
    expect(restated("position: static !important")).toEqual([]);
  });
});

describe("ruleInitialCandidates", () => {
  test("a top-level rule's restated initials, at the rule's index, whatever the selector", () => {
    expect(
      candidates(
        ".a { color: red } .card { position: static; overflow: visible } img.hero { overflow: visible }",
      ),
    ).toEqual([
      [1, "position"],
      [1, "overflow"],
      [2, "overflow"],
    ]);
  });

  test("a rule under a condition or a state pseudo-class resets under that condition or state — the override — and is never one", () => {
    expect(
      candidates(
        [
          "@media (width >= 600px) { .card { position: static; max-width: none; } }",
          "@supports (display: grid) { .card { position: static; } }",
          "@container (width > 400px) { .card { position: static; } }",
          "@starting-style { .card { opacity: 1; } }",
          ".card { @media (width >= 600px) { position: static; } }",
          ".card:hover { position: static; }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a rule applying wherever it matches is one — nested, layered or scoped — and the measure decides (an override it needs is no finding)", () => {
    expect(
      candidates(
        [
          ".card { position: absolute; &.open { position: static; } }",
          "@layer base { .card { overflow: visible; } }",
          "@scope (main) { .card { opacity: 1; } }",
        ].join("\n"),
      ),
    ).toEqual([
      [1, "position"],
      [2, "overflow"],
      [3, "opacity"],
    ]);
  });

  test("an !important initial is there to win, and is not one", () => {
    expect(candidates(".a { position: static !important; }")).toEqual([]);
  });
});
