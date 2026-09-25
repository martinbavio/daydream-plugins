// The rule-against-rule redundancy, proved under node from ranked-match
// literals (ruleRedundancy.ts: the browser's matching is matchLint.ts's
// seam; this is the judgment over its answer).
import { describe, expect, test } from "vitest";

import {
  relatedProperties,
  ruleRestatements,
  type RankedMatch,
  type RedundancyRule,
} from "./ruleRedundancy";

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
    const sheet: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#333", padding: "16px" } },
      { selector: ".card.featured", styles: { color: "#333", border: "1px solid" } },
    ];
    // Two featured cards: .card.featured (1) wins, .card (0) beneath.
    const out = ruleRestatements(sheet, matches({ a: [1, 0], b: [1, 0] }));
    expect(out).toEqual([{ rule: 1, property: "color", value: "#333", restates: [0] }]);
  });

  test("not redundant when the rule reaches an element the rule beneath does not", () => {
    const sheet: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#333" } },
      { selector: ".title", styles: { color: "#333" } },
    ];
    // One element matches both (.title above .card by index), another only .title.
    const out = ruleRestatements(sheet, matches({ a: [1, 0], b: [1] }));
    expect(out).toEqual([]);
  });

  test("a differing value beneath, or no declarer beneath, is never a finding", () => {
    const sheet: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#111" } },
      { selector: ".card.featured", styles: { color: "#333", margin: "0" } },
    ];
    expect(ruleRestatements(sheet, matches({ a: [1, 0] }))).toEqual([]);
  });

  test("a conditional or state rule anywhere in the pair leaves the declaration alone", () => {
    const sheet: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#333" }, conditions: ["@media (width < 600px)"] },
      { selector: ".card.featured", styles: { color: "#333" } },
      { selector: ".card:hover", styles: { color: "#333" } },
      { selector: ".card.featured.on", styles: { color: "#333" } },
    ];
    // 1 beneath is conditional (0): uncertain. 3 above 2 (state): uncertain.
    expect(
      ruleRestatements(sheet, matches({ a: [1, 0], b: [3, 2] })),
    ).toEqual([]);
    // The rule itself conditional or state: never judged.
    const own: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#333" } },
      { selector: ".card:hover", styles: { color: "#333" } },
      { selector: ".card", styles: { color: "#333" }, conditions: ["@media (width < 600px)"] },
    ];
    expect(ruleRestatements(own, matches({ a: [2, 1, 0] }))).toEqual([]);
  });

  test("a layered or scoped rule is as certain as a plain one: beneath it restates, and it is judged itself", () => {
    const sheet: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#333" }, conditions: ["@layer base"] },
      {
        selector: ":where(:scope) .card.featured",
        styles: { color: "#333" },
        conditions: ["@scope (main)"],
        scopes: [{ start: "main", end: null }],
      },
    ];
    expect(ruleRestatements(sheet, matches({ a: [1, 0] }))).toEqual([
      { rule: 1, property: "color", value: "#333", restates: [0] },
    ]);
  });

  test("a related longhand or shorthand between the two, or beside the one beneath, keeps the line load-bearing", () => {
    const between: RedundancyRule[] = [
      { selector: "div", styles: { margin: "0" } },
      { selector: ".card", styles: { "margin-top": "4px" } },
      { selector: ".card.featured", styles: { margin: "0" } },
    ];
    expect(ruleRestatements(between, matches({ a: [2, 1, 0] }))).toEqual([]);
    const beside: RedundancyRule[] = [
      { selector: "div", styles: { margin: "0", "margin-top": "4px" } },
      { selector: ".card", styles: { margin: "0" } },
    ];
    expect(ruleRestatements(beside, matches({ a: [1, 0] }))).toEqual([]);
    const all: RedundancyRule[] = [
      { selector: "div", styles: { color: "#333" } },
      { selector: ".card", styles: { all: "unset" } },
      { selector: ".card.featured", styles: { color: "#333" } },
    ];
    expect(ruleRestatements(all, matches({ a: [2, 1, 0] }))).toEqual([]);
  });

  test("relatedProperties: same first segment, the prefix-less groups, all; custom properties only themselves", () => {
    expect(relatedProperties("margin", "margin-top")).toBe(true);
    expect(relatedProperties("border-top-color", "border")).toBe(true);
    expect(relatedProperties("inset", "left")).toBe(true);
    expect(relatedProperties("gap", "row-gap")).toBe(true);
    expect(relatedProperties("align-items", "place-items")).toBe(true);
    expect(relatedProperties("color", "all")).toBe(true);
    expect(relatedProperties("color", "padding")).toBe(false);
    expect(relatedProperties("--x", "--x")).toBe(true);
    expect(relatedProperties("--x", "--y")).toBe(false);
    expect(relatedProperties("--color", "color")).toBe(false);
  });

  test("the first declarer beneath decides: an intermediate rule without the property is walked past", () => {
    const sheet: RedundancyRule[] = [
      { selector: "div", styles: { color: "#333" } },
      { selector: ".card", styles: { padding: "8px" } },
      { selector: ".card.featured", styles: { color: "#333" } },
    ];
    expect(ruleRestatements(sheet, matches({ a: [2, 1, 0] }))).toEqual([
      { rule: 2, property: "color", value: "#333", restates: [0] },
    ]);
  });

  test("different rules beneath for different elements are all named, ascending", () => {
    const sheet: RedundancyRule[] = [
      { selector: "article", styles: { color: "#333" } },
      { selector: "aside", styles: { color: "#333" } },
      { selector: ".card", styles: { color: "#333" } },
    ];
    expect(
      ruleRestatements(sheet, matches({ a: [2, 1], b: [2, 0] })),
    ).toEqual([{ rule: 2, property: "color", value: "#333", restates: [0, 1] }]);
  });

  test("a rule reaching nothing is the dead-rule finding's; one reaching a box through a pseudo-element is left alone", () => {
    const sheet: RedundancyRule[] = [
      { selector: ".card", styles: { color: "#333" } },
      { selector: ".card::before", styles: { color: "#333" } },
      { selector: ".gone", styles: { color: "#333" } },
    ];
    expect(
      ruleRestatements(sheet, matches({ a: ["1::before", 0] })),
    ).toEqual([]);
  });
});
