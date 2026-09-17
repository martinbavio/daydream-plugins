// The match-dependent static findings against real layout (decisions.md
// #71, plan phase 9; docs/agent-css-knowledge-prd.md, "Testing
// Decisions"): a document goes in, findings come out, and matching is
// asked of the CANVAS's own rendered document (the simulated strategy),
// never hand-rolled — `dd.matchedRules` reads `appStore.document` once a
// viewport is actually mounted (`renderViewport`). Real Chromium only.
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

  test("a clean document is clean", async () => {
    expect(await matchLint(build([]))).toEqual([]);
  });
});
