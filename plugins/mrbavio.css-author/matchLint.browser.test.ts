// The match-dependent static findings against real layout (decisions.md
// #71, plan phase 9; docs/agent-css-knowledge-prd.md, "Testing
// Decisions"): a document goes in, findings come out, and matching is
// asked of the CANVAS's own rendered document (the simulated strategy),
// never hand-rolled — `dd.matchedRules`, `dd.ruleMatches` and
// `dd.geometry.node` all read `appStore.document` once a viewport is
// actually mounted (`renderViewport`). Real Chromium only.
import { afterEach, describe, expect, test } from "vitest";

import type { DreamDocument, DreamViewport, Finding, StyleRule } from "@daydream/plugin-api";
import {
  createElement,
  createTestKernel,
  createViewportItem,
  renderViewport,
} from "@daydream/plugin-testing";

import { matchLint as lintWith } from "./matchLint";

function build(
  sheet: StyleRule[],
  root = createElement({
    tag: "html",
    children: [
      createElement({
        tag: "body",
        label: "body",
        children: [createElement({ tag: "div", label: "Card", attrs: { class: "card" } })],
      }),
    ],
  }),
): DreamDocument {
  const vp: DreamViewport = createViewportItem(root, {
    id: "v1",
    frame: { width: 960 },
    sheet,
  });
  return { version: 6, items: [vp] };
}

describe("matchLint", () => {
  let kernel: ReturnType<typeof createTestKernel> | undefined;
  let mounted: Awaited<ReturnType<typeof renderViewport>> | undefined;

  afterEach(() => {
    mounted?.dispose();
    kernel?.dispose();
    mounted = undefined;
    kernel = undefined;
  });

  async function matchLint(doc: DreamDocument): Promise<Finding[]> {
    kernel = createTestKernel({ document: doc });
    mounted = await renderViewport(kernel.store);
    return lintWith(kernel.dd, doc);
  }

  test("an element's declaration a matched unconditional rule already sets, verbatim, is redundancy", async () => {
    const card = createElement({
      tag: "div",
      label: "Card",
      attrs: { class: "card" },
      styles: { color: "red" },
    });
    const doc = build(
      [{ selector: ".card", styles: { color: "red" } }],
      createElement({
        tag: "html",
        children: [createElement({ tag: "body", label: "body", children: [card] })],
      }),
    );
    const findings = await matchLint(doc);
    expect(findings).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: card.id,
        property: "color",
        rule: 0,
        message: "color: red on Card restates rule .card (sheet[0]); remove the element's",
      },
    ]);
  });

  test("a differing value is an override, never redundancy", async () => {
    const card = createElement({
      tag: "div",
      label: "Card",
      attrs: { class: "card" },
      styles: { color: "blue" },
    });
    const doc = build(
      [{ selector: ".card", styles: { color: "red" } }],
      createElement({
        tag: "html",
        children: [createElement({ tag: "body", label: "body", children: [card] })],
      }),
    );
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a conditional rule is never redundancy — it may not apply everywhere the element does", async () => {
    const card = createElement({
      tag: "div",
      label: "Card",
      attrs: { class: "card" },
      styles: { color: "red" },
    });
    const doc = build(
      [
        {
          selector: ".card",
          conditions: ["@media (width >= 600px)"],
          styles: { color: "red" },
        },
      ],
      createElement({
        tag: "html",
        children: [createElement({ tag: "body", label: "body", children: [card] })],
      }),
    );
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a pseudo-element rule matches its element (not dead) but is never compared for redundancy against the element's own map", async () => {
    // .card::before matches the Card node once its trailing pseudo-element
    // is stripped (dd.ruleMatches/dd.matchedRules do this), so the rule is
    // not dead — but dd.matchedRules reports it with `pseudo: "before"`,
    // and lintRedundancy skips a pseudo match outright: the element's own
    // base map has no declaration for a pseudo-element's box to restate,
    // even though the property and value happen to coincide here.
    const card = createElement({
      tag: "div",
      label: "Card",
      attrs: { class: "card" },
      styles: { color: "red" },
    });
    const doc = build(
      [{ selector: ".card::before", styles: { color: "red" } }],
      createElement({
        tag: "html",
        children: [createElement({ tag: "body", label: "body", children: [card] })],
      }),
    );
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a rule matching no element is dead", async () => {
    const doc = build([{ selector: ".nope", styles: { color: "red" } }]);
    const findings = await matchLint(doc);
    expect(findings).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: expect.any(String),
        rule: 0,
        message: "rule .nope (sheet[0]) in viewport v1 matches no element",
      },
    ]);
  });

  test("a state-pseudo rule matching its base selector, state stripped, is not dead", async () => {
    const doc = build([{ selector: ".card:hover", styles: { color: "red" } }]);
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a state-pseudo rule matching nothing even state-stripped is dead", async () => {
    const doc = build([{ selector: ".nope:hover", styles: { color: "red" } }]);
    const findings = await matchLint(doc);
    expect(findings.map((f) => f.message)).toEqual([
      "rule .nope:hover (sheet[0]) in viewport v1 matches no element",
    ]);
  });

  test("a rule under an @media condition inactive at the frame is never called dead on that evidence alone", async () => {
    const doc = build([
      {
        selector: ".card",
        conditions: ["@media (min-width: 2000px)"],
        styles: { color: "red" },
      },
    ]);
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a container query on a rule with no satisfying ancestor among its matched elements is a finding", async () => {
    const doc = build([
      {
        selector: ".card",
        conditions: ["@container (width > 400px)"],
        styles: { display: "flex" },
      },
    ]);
    const findings = await matchLint(doc);
    expect(findings.map((f) => f.message)).toEqual([
      "container query `@container (width > 400px)` in rule .card (sheet[0]) of viewport v1 can never match: no matched element has a satisfying ancestor",
    ]);
  });

  test("a container-type ancestor of the matched element satisfies the rule's container query", async () => {
    const card = createElement({ tag: "div", label: "Card", attrs: { class: "card" } });
    const wrapper = createElement({
      tag: "div",
      styles: { "container-type": "inline-size" },
      children: [card],
    });
    const doc = build(
      [
        {
          selector: ".card",
          conditions: ["@container (width > 400px)"],
          styles: { display: "flex" },
        },
      ],
      createElement({
        tag: "html",
        children: [createElement({ tag: "body", label: "body", children: [wrapper] })],
      }),
    );
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a rule matching no element reports only the dead-rule finding, never a second container-query one", async () => {
    const doc = build([
      {
        selector: ".nope",
        conditions: ["@container (width > 400px)"],
        styles: { display: "flex" },
      },
    ]);
    const findings = await matchLint(doc);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("matches no element");
  });

  test("a clean document is clean", async () => {
    expect(await matchLint(build([]))).toEqual([]);
  });
});
