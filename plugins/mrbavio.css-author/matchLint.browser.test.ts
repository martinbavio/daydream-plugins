// The match-dependent static findings against real layout (decisions.md
// #71, plan phase 9; docs/agent-css-knowledge-prd.md, "Testing
// Decisions"): a document goes in, findings come out, and matching is
// asked of a MOUNTED copy of that document — never the canvas — since a
// gate's document is not, and may never have been, on the canvas
// (matchLint.ts's own header; the eval bug this file guards against: a
// `.card`/`nav`/`li` rule refused as dead on every landing because the
// old code read canvas match facts for a document that was never
// rendered there). `dd.mountViewport` is the same live-strategy seam
// necessity.browser.test.ts already uses, so one shared kernel with no
// document loaded serves every test here too — nothing in this file ever
// calls `renderViewport` or loads a document into the app store. Real
// Chromium only.
import { afterAll, afterEach, describe, expect, test } from "vitest";

import type { DreamDocument, DreamViewport, Finding, StyleRule } from "@daydream/plugin-api";
import {
  createElement,
  createTestKernel,
  createViewportItem,
  documentFrom,
} from "@daydream/plugin-testing";

import { matchLint as lintWith } from "./matchLint";

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

const matchLint = (doc: DreamDocument): Promise<Finding[]> => lintWith(kernel.dd, doc);

afterEach(() => {
  // matchLint mounts and disposes its own iframe per viewport; a leftover
  // is a bug, not a fixture to clean.
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

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
  // The exact eval scenario (2026-09-17 raw eval jsonl): a document handed
  // to a gate straight from `documentFrom` — the same validation
  // `src/ai/gates.ts`'s caller runs before `runGates`, never a document
  // loaded into the app store or rendered on the canvas. A `.card` rule
  // whose element is plainly in the tree must not be refused as dead.
  test("a rule matching an element that was never on the canvas is not dead (the eval bug)", async () => {
    const result = documentFrom({
      version: 6,
      items: [
        {
          kind: "daydream.viewport",
          frame: { width: 960, height: 600 },
          payload: {
            root: {
              tag: "html",
              children: [
                {
                  tag: "body",
                  children: [{ tag: "div", attrs: { class: "card" } }],
                },
              ],
            },
            sheet: [{ selector: ".card", styles: { color: "red" } }],
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    expect(await matchLint(result.doc)).toEqual([]);
  });

  test("a rule whose element is not in the tree is dead, even for a document never rendered on the canvas", async () => {
    const result = documentFrom({
      version: 6,
      items: [
        {
          kind: "daydream.viewport",
          frame: { width: 960, height: 600 },
          payload: {
            root: {
              tag: "html",
              children: [
                {
                  tag: "body",
                  children: [{ tag: "div", attrs: { class: "card" } }],
                },
              ],
            },
            sheet: [{ selector: ".ghost", styles: { color: "red" } }],
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    const findings = await matchLint(result.doc);
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringContaining("rule .ghost"),
    ]);
  });

  test("a descendant-combinator rule (`nav a`) matching a real ancestor/descendant pair is not dead", async () => {
    const doc = build(
      [{ selector: "nav a", styles: { color: "inherit" } }],
      createElement({
        tag: "html",
        children: [
          createElement({
            tag: "body",
            label: "body",
            children: [
              createElement({
                tag: "nav",
                children: [createElement({ tag: "a", label: "Link" })],
              }),
            ],
          }),
        ],
      }),
    );
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a state-pseudo rule matching its base selector, state stripped, is not dead", async () => {
    const doc = build(
      [{ selector: ".a:hover", styles: { color: "red" } }],
      createElement({
        tag: "html",
        children: [
          createElement({
            tag: "body",
            label: "body",
            children: [createElement({ tag: "div", label: "A", attrs: { class: "a" } })],
          }),
        ],
      }),
    );
    expect(await matchLint(doc)).toEqual([]);
  });

  test("a pseudo-element rule (`.card::before`) matching its element is not dead", async () => {
    const doc = build([{ selector: ".card::before", styles: { color: "red" } }]);
    expect(await matchLint(doc)).toEqual([]);
  });

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
    // is stripped, so the rule is not dead — but the redundancy question
    // skips a pseudo-element match outright: the element's own base map
    // has no declaration for a pseudo-element's box to restate, even
    // though the property and value happen to coincide here.
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

  // Rule-against-rule redundancy (ruleRedundancy.ts, proved under node;
  // this is the mount-backed end to end): two featured cards, `.card`
  // and `.card.featured` both `color: #333`.
  test("a rule declaration restating the rule beneath it everywhere it reaches is refused, named at sheet[i]", async () => {
    const root = createElement({
      tag: "html",
      children: [
        createElement({
          tag: "body",
          label: "body",
          children: [
            createElement({ tag: "div", label: "A", attrs: { class: "card featured" } }),
            createElement({ tag: "div", label: "B", attrs: { class: "card featured" } }),
          ],
        }),
      ],
    });
    const findings = await matchLint(
      build(
        [
          { selector: ".card", styles: { color: "#333", padding: "16px" } },
          { selector: ".card.featured", styles: { color: "#333", border: "1px solid #333" } },
        ],
        root,
      ),
    );
    expect(findings.map((f) => [f.rule, f.property, f.message])).toEqual([
      [
        1,
        "color",
        "color: #333 in rule .card.featured (sheet[1]) of viewport v1 restates rule .card (sheet[0]) for every element it reaches; remove it from .card.featured",
      ],
    ]);
  });

  test("a rule reaching an element the rule beneath does not is load-bearing there: no finding", async () => {
    const root = createElement({
      tag: "html",
      children: [
        createElement({
          tag: "body",
          label: "body",
          children: [
            createElement({ tag: "div", label: "A", attrs: { class: "card featured" } }),
            createElement({ tag: "div", label: "B", attrs: { class: "featured" } }),
          ],
        }),
      ],
    });
    const findings = await matchLint(
      build(
        [
          { selector: ".card", styles: { color: "#333" } },
          { selector: ".featured", styles: { color: "#333" } },
        ],
        root,
      ),
    );
    expect(findings).toEqual([]);
  });
});
