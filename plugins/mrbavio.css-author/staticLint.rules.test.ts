// The static lint's rule-level checks, in the node project, over plain
// `StyleRule`/`DreamViewport` literals — no `dd.core` needed for either
// (docs/agent-css-knowledge-prd.md, "Testing Decisions"): unit-less
// lengths and restated initials read a rule's `styles` map exactly like
// an element's, and the `img`/`hr` overflow exception is approximated
// from the selector text alone (staticLint.ts). The full staticLint()
// integration — including the font-face-on-rules extension, which does
// need `dd.core.familyNames` — is staticLint.test.ts's, run from a
// Daydream checkout like the rest of that file (README.md).
import { describe, expect, test } from "vitest";

import type { DreamViewport, StyleRule } from "@daydream/plugin-api";

import {
  lintRestatedInitialsOnRules,
  lintUnitlessLengthsOnRules,
  lintUnreferencedClasses,
  referencedClasses,
} from "./staticLint";

function viewport(sheet: StyleRule[]): DreamViewport {
  return {
    id: "v1",
    kind: "daydream.viewport",
    position: { x: 0, y: 0 },
    payload: {
      root: { id: "root", tag: "html", styles: {}, children: [] },
      sheet,
    },
  } as unknown as DreamViewport;
}

describe("lintUnitlessLengthsOnRules", () => {
  test("a bare number on a rule's length property is a finding at sheet[i]", () => {
    const vp = viewport([{ selector: ".card", styles: { width: "100" } }]);
    const out: Parameters<typeof lintUnitlessLengthsOnRules>[1] = [];
    lintUnitlessLengthsOnRules(vp, out);
    expect(out).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "width",
        message:
          "width: 100 in rule .card (sheet[0]) of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      },
    ]);
  });

  test("a valued length on a rule passes", () => {
    const vp = viewport([{ selector: ".card", styles: { width: "100%" } }]);
    const out: Parameters<typeof lintUnitlessLengthsOnRules>[1] = [];
    lintUnitlessLengthsOnRules(vp, out);
    expect(out).toEqual([]);
  });

  test("no sheet is a clean pass", () => {
    const vp = viewport([]);
    const out: Parameters<typeof lintUnitlessLengthsOnRules>[1] = [];
    lintUnitlessLengthsOnRules(vp, out);
    expect(out).toEqual([]);
  });
});

describe("lintRestatedInitialsOnRules", () => {
  test("a restated initial on a rule with no type selector is a finding — the img/hr exception does not apply to properties outside the overflow table", () => {
    const vp = viewport([{ selector: ".card", styles: { position: "static" } }]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "position",
        message:
          "position: static in rule .card (sheet[0]) of viewport v1 restates the initial value",
      },
    ]);
  });

  test("overflow: visible on a rule with no type selector is excused — the compound could reach img or hr", () => {
    const vp = viewport([{ selector: ".card", styles: { overflow: "visible" } }]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toEqual([]);
  });

  test("overflow: visible on a rule typed to img or hr is excused, case-insensitively", () => {
    for (const selector of ["img", "IMG.thumb", "hr.rule", "* .x img"]) {
      const vp = viewport([{ selector, styles: { overflow: "visible" } }]);
      const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
      lintRestatedInitialsOnRules(vp, out);
      expect(out, selector).toEqual([]);
    }
  });

  test("overflow: visible on a rule typed to a different tag is a finding: it can never reach img or hr", () => {
    const vp = viewport([{ selector: "div.card", styles: { overflow: "visible" } }]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toHaveLength(1);
  });

  test("a selector list is excused if ANY member could reach img or hr", () => {
    const vp = viewport([
      { selector: "div.card, img.thumb", styles: { overflow: "visible" } },
    ]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toEqual([]);
  });

  test("an explicit universal selector is excused, same as no type", () => {
    const vp = viewport([{ selector: "*.card", styles: { overflow: "visible" } }]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toEqual([]);
  });

  test("a non-initial value is never a finding", () => {
    const vp = viewport([{ selector: ".card", styles: { position: "relative" } }]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toEqual([]);
  });

  test("a rule under a combinator is judged by its rightmost compound", () => {
    // `.list > img` can reach an img at its rightmost compound even though
    // the list itself is a div.
    const vp = viewport([
      { selector: ".list > img", styles: { overflow: "visible" } },
    ]);
    const out: Parameters<typeof lintRestatedInitialsOnRules>[1] = [];
    lintRestatedInitialsOnRules(vp, out);
    expect(out).toEqual([]);
  });
});

describe("lintUnreferencedClasses (rule 5)", () => {
  function tree(classes: string[]): DreamViewport["payload"]["root"] {
    return {
      id: "root",
      tag: "html",
      styles: {},
      children: classes.map((value, i) => ({
        id: `e${i}`,
        tag: "div",
        label: `Box ${i}`,
        styles: {},
        attrs: { class: value },
        children: [],
      })),
    } as unknown as DreamViewport["payload"]["root"];
  }
  function viewportWith(sheet: StyleRule[], classes: string[]): DreamViewport {
    const vp = viewport(sheet);
    (vp.payload as { root: unknown }).root = tree(classes);
    return vp;
  }

  test("referencedClasses reads every .class compound, nested or escaped, and [class=] values", () => {
    expect(
      [...referencedClasses([
        { selector: ".card .title, nav:is(.a, .b) > *:not(.c)" },
        { selector: ".x\\:y" },
        { selector: "[class~=\"pill\"] , [class=\"one two\"]" },
      ])].sort(),
    ).toEqual(["a", "b", "c", "card", "one", "pill", "title", "two", "x:y"]);
  });

  test("a class no rule names is a finding on its element; a named one, and an empty class, are not", () => {
    const vp = viewportWith(
      [{ selector: ".card", styles: { padding: "16px" } }],
      ["card", "card featured", ""],
    );
    const out: Parameters<typeof lintUnreferencedClasses>[1] = [];
    lintUnreferencedClasses(vp, out);
    expect(out).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "e1",
        message: 'class "featured" on Box 1 in viewport v1 is named by no rule; drop it, or write the rule that uses it',
      },
    ]);
  });

  test("with no sheet at all every class is unreferenced", () => {
    const vp = viewportWith([], ["a", "b c"]);
    const out: Parameters<typeof lintUnreferencedClasses>[1] = [];
    lintUnreferencedClasses(vp, out);
    expect(out.map((f) => f.elementId)).toEqual(["e0", "e1", "e1"]);
  });
});
