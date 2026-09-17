// The rule-against-rule redundancy, proved under node from ranked-match
// literals (ruleRedundancy.ts: the browser's matching is matchLint.ts's
// seam; this is the judgment over its answer).
import { describe, expect, test } from "vitest";

import type { StyleRule } from "@daydream/plugin-api";

import { ruleRestatements, type RankedMatch } from "./ruleRedundancy";

const hasState = (selector: string): boolean => /:hover|:focus|:active/.test(selector);

/** `lists`: element id → its winner-first rule indices (a pseudo match is
 * written `"3::before"`). */
function matches(lists: Record<string, (number | string)[]>): Map<string, RankedMatch[]> {
  const out = new Map<string, RankedMatch[]>();
  for (const [id, list] of Object.entries(lists)) {
    out.set(
      id,
      list.map((entry) =>
        typeof entry === "number"
          ? { index: entry }
          : { index: Number(entry.split("::")[0]), pseudo: entry.split("::")[1] },
      ),
    );
  }
  return out;
}

describe("ruleRestatements", () => {
  test("a rule's declaration restating the rule beneath it, everywhere it reaches, is a finding naming that rule", () => {
    const sheet: StyleRule[] = [
      { selector: ".card", styles: { color: "#333", padding: "16px" } },
      { selector: ".card.featured", styles: { color: "#333", border: "1px solid" } },
    ];
    // Two featured cards: .card.featured (1) wins, .card (0) beneath.
    const out = ruleRestatements(sheet, matches({ a: [1, 0], b: [1, 0] }), hasState);
    expect(out).toEqual([{ rule: 1, property: "color", value: "#333", restates: [0] }]);
  });

  test("not redundant when the rule reaches an element the rule beneath does not", () => {
    const sheet: StyleRule[] = [
      { selector: ".card", styles: { color: "#333" } },
      { selector: ".title", styles: { color: "#333" } },
    ];
    // One element matches both (.title above .card by index), another only .title.
    const out = ruleRestatements(sheet, matches({ a: [1, 0], b: [1] }), hasState);
    expect(out).toEqual([]);
  });

  test("a differing value beneath, or no declarer beneath, is never a finding", () => {
    const sheet: StyleRule[] = [
      { selector: ".card", styles: { color: "#111" } },
      { selector: ".card.featured", styles: { color: "#333", margin: "0" } },
    ];
    expect(ruleRestatements(sheet, matches({ a: [1, 0] }), hasState)).toEqual([]);
  });

  test("a conditional or state rule anywhere in the pair leaves the declaration alone", () => {
    const sheet: StyleRule[] = [
      { selector: ".card", styles: { color: "#333" }, conditions: ["@media (width < 600px)"] },
      { selector: ".card.featured", styles: { color: "#333" } },
      { selector: ".card:hover", styles: { color: "#333" } },
      { selector: ".card.featured.on", styles: { color: "#333" } },
    ];
    // 1 beneath is conditional (0): uncertain. 3 above 2 (state): uncertain.
    expect(
      ruleRestatements(sheet, matches({ a: [1, 0], b: [3, 2] }), hasState),
    ).toEqual([]);
    // The rule itself conditional or state: never judged.
    const own: StyleRule[] = [
      { selector: ".card", styles: { color: "#333" } },
      { selector: ".card:hover", styles: { color: "#333" } },
      { selector: ".card", styles: { color: "#333" }, conditions: ["@media (width < 600px)"] },
    ];
    expect(ruleRestatements(own, matches({ a: [2, 1, 0] }), hasState)).toEqual([]);
  });

  test("the first declarer beneath decides: an intermediate rule without the property is walked past", () => {
    const sheet: StyleRule[] = [
      { selector: "div", styles: { color: "#333" } },
      { selector: ".card", styles: { padding: "8px" } },
      { selector: ".card.featured", styles: { color: "#333" } },
    ];
    expect(ruleRestatements(sheet, matches({ a: [2, 1, 0] }), hasState)).toEqual([
      { rule: 2, property: "color", value: "#333", restates: [0] },
    ]);
  });

  test("different rules beneath for different elements are all named, ascending", () => {
    const sheet: StyleRule[] = [
      { selector: "article", styles: { color: "#333" } },
      { selector: "aside", styles: { color: "#333" } },
      { selector: ".card", styles: { color: "#333" } },
    ];
    expect(
      ruleRestatements(sheet, matches({ a: [2, 1], b: [2, 0] }), hasState),
    ).toEqual([{ rule: 2, property: "color", value: "#333", restates: [0, 1] }]);
  });

  test("a rule reaching nothing is the dead-rule finding's; one reaching a box through a pseudo-element is left alone", () => {
    const sheet: StyleRule[] = [
      { selector: ".card", styles: { color: "#333" } },
      { selector: ".card::before", styles: { color: "#333" } },
      { selector: ".gone", styles: { color: "#333" } },
    ];
    expect(
      ruleRestatements(sheet, matches({ a: ["1::before", 0] }), hasState),
    ).toEqual([]);
  });
});
