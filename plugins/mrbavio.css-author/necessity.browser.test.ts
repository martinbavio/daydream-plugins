// The necessity lint against real layout (docs/agent-css-knowledge-prd.md,
// "Testing Decisions", seam 1): a document goes in, findings come out, and
// every assertion is on the findings' shape and words — never on how the
// lint decided. Real Chromium only (vite.config.ts): the lint removes
// declarations inside a live iframe core mounts (`dd.mountViewport`) and
// reads the CSS engine's answer back. The API object is a test kernel's.
import { afterAll, afterEach, describe, expect, test } from "vitest";

import type {
  ConditionalLayer,
  DreamDocument,
  DreamElement,
  DreamViewport,
  Finding,
  StyleRule,
} from "@daydream/plugin-api";
import {
  createElement,
  createTestKernel,
  createViewportItem,
  viewportItems,
} from "@daydream/plugin-testing";

import {
  isExemptProperty,
  necessityLint as lintWith,
  probeWidths as probeWidthsWith,
  SWEEP_WIDTHS,
  widthsText,
  type NecessityOptions,
} from "./necessity";

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

const necessityLint = (
  doc: DreamDocument,
  options?: NecessityOptions,
): Promise<Finding[]> => lintWith(kernel.dd, doc, options);

/** The sweep for a viewport rendered at its own frame width. */
const probeWidths = (vp: DreamViewport): number[] =>
  probeWidthsWith(kernel.dd.core, vp, vp.frame!.width);

afterEach(() => {
  // Every lint disposes its own iframe; a leftover is a bug, not a
  // fixture to clean.
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

interface Spec {
  id?: string;
  tag?: string;
  label?: string;
  text?: string;
  styles?: Record<string, string>;
  layers?: ConditionalLayer[];
  children?: DreamElement[];
  /** Real HTML attributes — a rule's selector hook (decisions.md #71),
   * never the kernel id `id` already addresses above. */
  attrs?: Record<string, string>;
}

function build(spec: Spec): DreamElement {
  const element = createElement({
    tag: spec.tag ?? "div",
    styles: spec.styles ?? {},
    children: spec.children ?? [],
    ...(spec.attrs === undefined ? {} : { attrs: spec.attrs }),
  });
  if (spec.id !== undefined) element.id = spec.id;
  if (spec.label !== undefined) element.label = spec.label;
  if (spec.text !== undefined) element.text = spec.text;
  if (spec.layers !== undefined) element.conditionals = spec.layers;
  return element;
}

/** html › body (margin 0) › children, in one viewport of the given frame,
 * with an optional `sheet` (decisions.md #71, plan phase 9). */
function makeDocument(
  frame: { width: number; height?: number },
  bodyChildren: DreamElement[],
  bodyStyles: Record<string, string> = { margin: "0" },
  sheet?: StyleRule[],
): DreamDocument {
  const vp: DreamViewport = createViewportItem(
    build({
      tag: "html",
      children: [
        build({
          tag: "body",
          label: "Body",
          styles: bodyStyles,
          children: bodyChildren,
        }),
      ],
    }),
    { frame, ...(sheet === undefined ? {} : { sheet }) },
  );
  return { version: 6, items: [vp] };
}

const FRAME = { width: 400, height: 300 };

/** The widths a finding names for a viewport of the given frame width
 * (rule 2): the frame plus the fixed sweep, plus any breakpoints given. */
function sweptAt(frame: number, ...breakpoints: number[]): string {
  const widths = [frame, ...SWEEP_WIDTHS];
  for (const b of breakpoints) widths.push(b - 1, b, b + 1);
  return widthsText(widths);
}

function properties(findings: Finding[]): string[] {
  return findings.map((f) => f.property ?? "");
}

describe("dead and live declarations", () => {
  test("a redundant position: static is dead; a width that sizes a box is live", async () => {
    const box = build({
      id: "box",
      label: "Box",
      styles: { position: "static", width: "120px", height: "40px" },
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "box",
        property: "position",
        message: `position: static on Box changes nothing (in base) at ${sweptAt(400)}`,
      },
    ]);
  });

  test("a color on a parent that a child inherits is live", async () => {
    const child = build({ id: "child", text: "hello" });
    const parent = build({
      id: "parent",
      styles: { color: "rgb(200, 0, 0)" },
      children: [child],
    });
    const findings = await necessityLint(makeDocument(FRAME, [parent]));
    expect(findings).toEqual([]);
  });

  test("a custom property nobody reads is dead; one a child reads is live", async () => {
    const reader = build({
      id: "reader",
      styles: { width: "var(--w)", height: "20px" },
    });
    const parent = build({
      id: "parent",
      styles: { "--w": "150px", "--unused": "1" },
      children: [reader],
    });
    const findings = await necessityLint(makeDocument(FRAME, [parent]));
    expect(properties(findings)).toEqual(["--unused"]);
    expect(findings[0]!.message).toBe(
      `--unused: 1 on div#parent changes nothing (in base) at ${sweptAt(400)}`,
    );
  });

  test("a media layer for a width the frame is not at is live (the sweep reaches its breakpoint); one no width can satisfy is dead", async () => {
    const box = build({
      id: "box",
      label: "Box",
      styles: { height: "20px" },
      layers: [
        { condition: "@media (width >= 300px)", styles: { width: "200px" } },
        { condition: "@media (width >= 900px)", styles: { width: "300px" } },
        { condition: "@media print", styles: { width: "10px" } },
      ],
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "box",
        property: "width",
        layer: "@media print",
        message: `width: 10px on Box changes nothing (in @media print) at ${sweptAt(400, 300, 900)}`,
      },
    ]);
  });

  test("a base a matching layer overrides is judged WITH the layer, so it is live", async () => {
    const box = build({
      id: "box",
      styles: { width: "100px", height: "20px" },
      layers: [
        { condition: "@media (width >= 300px)", styles: { width: "200px" } },
      ],
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings).toEqual([]);
  });

  test("a base that is initial anyway stays dead even when a dead layer restates the property", async () => {
    const box = build({
      id: "box",
      styles: { position: "static", height: "20px" },
      layers: [{ condition: "@media print", styles: { position: "relative" } }],
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings.map((f) => [f.property, f.layer])).toEqual([
      ["position", undefined],
      ["position", "@media print"],
    ]);
  });

  test("a base paired with a layer the sweep reaches is live: the base is the other branch", async () => {
    const box = build({
      id: "box",
      styles: { position: "static", height: "20px" },
      layers: [
        {
          condition: "@media (width >= 900px)",
          styles: { position: "relative" },
        },
      ],
    });
    expect(await necessityLint(makeDocument(FRAME, [box]))).toEqual([]);
  });

  test("a container-layer declaration that matches is live", async () => {
    const card = build({
      id: "card",
      styles: { height: "20px" },
      layers: [
        { condition: "@container (width >= 200px)", styles: { width: "50%" } },
      ],
    });
    const holder = build({
      id: "holder",
      styles: { "container-type": "inline-size", width: "300px" },
      children: [card],
    });
    const findings = await necessityLint(makeDocument(FRAME, [holder]));
    expect(findings).toEqual([]);
  });

  test("an exempt transition, animation or cursor is never reported, dead or not", async () => {
    const box = build({
      id: "box",
      styles: {
        transition: "width 200ms",
        "transition-delay": "10ms",
        animation: "none",
        cursor: "pointer",
        height: "20px",
      },
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings).toEqual([]);
    expect(isExemptProperty("-webkit-transition")).toBe(true);
    expect(isExemptProperty("animation-name")).toBe(true);
    expect(isExemptProperty("cursor")).toBe(true);
    for (const live of [
      "will-change",
      "pointer-events",
      "user-select",
      "width",
    ]) {
      expect(isExemptProperty(live), live).toBe(false);
    }
  });

  test("a transition on the element never makes its other declarations read dead", async () => {
    const box = build({
      id: "box",
      styles: {
        transition: "all 200ms",
        opacity: ".5",
        padding: "10px",
        color: "rgb(0, 100, 0)",
        height: "20px",
      },
    });
    const parent = build({
      id: "parent",
      styles: {
        "transition-property": "all",
        "transition-duration": "1s",
        gap: "9px",
        display: "grid",
      },
      children: [box],
    });
    const findings = await necessityLint(makeDocument(FRAME, [parent]));
    expect(findings).toEqual([]);
  });

  test("a dropped prelude is skipped, not reported", async () => {
    const box = build({
      id: "box",
      styles: { height: "20px" },
      layers: [{ condition: "&:visited", styles: { width: "1px" } }],
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings).toEqual([]);
  });

  test("a state layer is never judged: nothing hovers a measured page (decisions.md #53)", async () => {
    const box = build({
      id: "box",
      styles: { height: "20px" },
      layers: [{ condition: "&:hover", styles: { width: "1px" } }],
    });
    const findings = await necessityLint(makeDocument(FRAME, [box]));
    expect(findings).toEqual([]);
  });

  test("declarations on the skeleton (html, body) are checked too", async () => {
    const doc = makeDocument(FRAME, [build({ styles: { height: "10px" } })], {
      margin: "0",
      display: "block",
    });
    const findings = await necessityLint(doc);
    expect(properties(findings)).toEqual(["display"]);
    expect(findings[0]!.message).toMatch(/on Body changes nothing/);
  });
});

/** A container-typed holder (full width, or the given one) around a
 * two-item grid whose base is one column and whose container layer is two.
 * `justify-content: start` keeps the base observable: a stretching grid's
 * implicit auto column is as wide as an explicit `1fr` one, and the
 * browser would (rightly) call that base dead. */
function responsiveGrid(holderWidth?: string, labels = true): DreamElement {
  const grid = build({
    id: "grid",
    ...(labels ? { label: "Grid" } : {}),
    styles: {
      display: "grid",
      "justify-content": "start",
      "grid-template-columns": "1fr",
    },
    layers: [
      {
        condition: "@container (width >= 400px)",
        styles: { "grid-template-columns": "1fr 1fr" },
      },
    ],
    children: [
      build({ id: "a", text: "a", styles: { height: "10px" } }),
      build({ id: "b", text: "b", styles: { height: "10px" } }),
    ],
  });
  return build({
    id: "holder",
    ...(labels ? { label: "Holder" } : {}),
    styles: {
      "container-type": "inline-size",
      ...(holderWidth === undefined ? {} : { width: holderWidth }),
    },
    children: [grid],
  });
}

/** Fresh ids for a second copy of the same tree (ids are unique across a
 * document; correspondence never uses them). */
function reid(el: DreamElement, suffix: string): DreamElement {
  el.id = `${el.id}-${suffix}`;
  el.children.forEach((child) => reid(child, suffix));
  return el;
}

function twoViewports(
  widths: [number, number],
  content: (width: number) => DreamElement,
): DreamDocument {
  const doc = makeDocument({ width: widths[0], height: 300 }, [
    content(widths[0]),
  ]);
  const second = makeDocument({ width: widths[1], height: 300 }, [
    reid(content(widths[1]), "2"),
  ]);
  doc.items.push(second.items[0]!);
  return doc;
}

describe("a correct conditional document lands", () => {
  test("single 900-wide viewport: a base the container layer overrides is live", async () => {
    const doc = makeDocument({ width: 900, height: 300 }, [responsiveGrid()]);
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("the layer never matching: the layer is dead, the base live", async () => {
    const doc = makeDocument({ width: 900, height: 300 }, [
      responsiveGrid("300px"),
    ]);
    expect(await necessityLint(doc)).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "grid",
        property: "grid-template-columns",
        layer: "@container (width >= 400px)",
        message: `grid-template-columns: 1fr 1fr on Grid changes nothing (in @container (width >= 400px)) at ${sweptAt(900)}`,
      },
    ]);
  });

  test("two viewports (360/900) of the same labelled tree: no findings", async () => {
    const doc = twoViewports([360, 900], () => responsiveGrid());
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("a declaration dead in both viewports is one finding, named from the first", async () => {
    const doc = twoViewports([360, 900], () =>
      build({
        id: "box",
        label: "Box",
        styles: { position: "static", height: "10px" },
      }),
    );
    expect(await necessityLint(doc)).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "box",
        property: "position",
        message: `position: static on Box changes nothing (in base) at ${sweptAt(360)}`,
      },
    ]);
  });

  test("without labels, elements correspond by tree path", async () => {
    // Dead in both → one finding; the layer dead at 360 but live at 900 →
    // none: both decided by path alone.
    const dead = twoViewports([360, 900], () =>
      build({ id: "box", styles: { position: "static", height: "10px" } }),
    );
    expect((await necessityLint(dead)).map((f) => f.elementId)).toEqual([
      "box",
    ]);
    const responsive = twoViewports([360, 900], () =>
      responsiveGrid(undefined, false),
    );
    expect(await necessityLint(responsive)).toEqual([]);
  });

  test("a duplicated label falls back to the path, so siblings are not conflated", async () => {
    // Two "Item" siblings: the first dead in both viewports, the second
    // live in the second only. Conflated by label, the second's live
    // verdict would hide the first's; by path, exactly one finding.
    const doc = twoViewports([360, 900], (width) =>
      build({
        id: "row",
        children: [
          build({
            id: "i1",
            label: "Item",
            styles: { position: "static", height: "10px" },
          }),
          build({
            id: "i2",
            label: "Item",
            styles: { position: width === 360 ? "static" : "relative" },
          }),
        ],
      }),
    );
    expect((await necessityLint(doc)).map((f) => f.elementId)).toEqual(["i1"]);
  });
});

describe("the width sweep (a page is not a photo)", () => {
  /** A body grid whose one column is `minmax(0, 1fr)` over a child that
   * cannot shrink below 500px. At 900 the auto column would be 900 wide
   * either way, so the line changes nothing THERE; at 360 the auto column
   * grows to the child's 500px min-content and `minmax(0, 1fr)` holds it
   * at 360 — the declaration exists for the width the frame is not at. */
  function boundedColumn(frameWidth: number): DreamDocument {
    const main = build({
      id: "main",
      children: [
        build({ id: "wide", styles: { width: "500px", height: "10px" } }),
      ],
    });
    return makeDocument({ width: frameWidth, height: 300 }, [main], {
      margin: "0",
      display: "grid",
      "grid-template-columns": "minmax(0, 1fr)",
    });
  }

  test("a declaration dead at the frame but live at a swept width is live", async () => {
    expect(await necessityLint(boundedColumn(900))).toEqual([]);
  });

  test("the same declaration at a frame where it works is live without any probe", async () => {
    expect(await necessityLint(boundedColumn(360))).toEqual([]);
  });

  test("a declaration dead at every swept width names them all", async () => {
    const box = build({
      id: "box",
      label: "Box",
      styles: { position: "static", height: "10px" },
      layers: [
        { condition: "@media (width <= 600px)", styles: { height: "12px" } },
      ],
    });
    const findings = await necessityLint(
      makeDocument({ width: 768, height: 300 }, [box]),
    );
    expect(findings.map((f) => f.message)).toEqual([
      `position: static on Box changes nothing (in base) at ${sweptAt(768, 600)}`,
    ]);
    expect(sweptAt(768, 600)).toBe("360, 599, 600, 601, 768, 1280 or 1920px");
  });

  test("a full-page viewport (no frame height) sweeps as a full-page view", async () => {
    // 1024 wide by default; the finding names the default plus the sweep.
    const doc = boundedColumn(900);
    delete doc.items[0]!.frame;
    expect(await necessityLint(doc)).toEqual([]);
    const dead = makeDocument({ width: 1024 }, [
      build({ id: "box", styles: { position: "static", height: "10px" } }),
    ]);
    delete dead.items[0]!.frame;
    expect((await necessityLint(dead)).map((f) => f.message)).toEqual([
      `position: static on div#box changes nothing (in base) at ${sweptAt(1024)}`,
    ]);
  });

  test("probeWidths: the fixed sweep plus one px either side of every media breakpoint, minus the frame", () => {
    const plain = viewportItems(makeDocument(FRAME, []))[0]!;
    expect(probeWidths(plain)).toEqual([360, 768, 1280, 1920]);

    const atSweep = viewportItems(
      makeDocument({ width: 768, height: 300 }, []),
    )[0]!;
    expect(probeWidths(atSweep)).toEqual([360, 1280, 1920]);

    const layered = viewportItems(
      makeDocument(FRAME, [
        build({
          styles: { height: "10px" },
          layers: [
            { condition: "@media (width >= 900px)", styles: { height: "1px" } },
            {
              condition: "@media (360px < width < 1280px)",
              styles: { height: "2px" },
            },
            // A container breakpoint is the container's width, not the window's.
            {
              condition: "@container (width >= 500px)",
              styles: { height: "3px" },
            },
            // em/rem convert at the initial font size (50em = 800px).
            { condition: "@media (width >= 50em)", styles: { height: "4px" } },
          ],
        }),
      ]),
    )[0]!;
    expect(probeWidths(layered)).toEqual([
      359, 360, 361, 768, 799, 800, 801, 899, 900, 901, 1279, 1280, 1281, 1920,
    ]);
  });

  test("widthsText", () => {
    expect(widthsText([400])).toBe("400px");
    expect(widthsText([768, 360, 360])).toBe("360 or 768px");
    expect(widthsText([1920, 400, 360])).toBe("360, 400 or 1920px");
  });
});

describe("viewports and disposal", () => {
  test("viewportIds restricts the lint; an unknown id is an error", async () => {
    const doc = makeDocument(FRAME, [
      build({ id: "a", styles: { position: "static", height: "10px" } }),
    ]);
    const second: DreamViewport = structuredClone(viewportItems(doc)[0]!);
    second.id = "other";
    second.payload.root.id = "other-root";
    second.payload.root.children[0]!.id = "other-body";
    second.payload.root.children[0]!.children[0]!.id = "b";
    doc.items.push(second);

    // Both viewports hold the same path with the same dead declaration:
    // ONE finding, named from the first viewport.
    const all = await necessityLint(doc);
    expect(all.map((f) => f.elementId)).toEqual(["a"]);
    const some = await necessityLint(doc, { viewportIds: ["other"] });
    expect(some.map((f) => f.elementId)).toEqual(["b"]);
    await expect(necessityLint(doc, { viewportIds: ["nope"] })).rejects.toThrow(
      "No such viewport: nope",
    );
  });

  test("disposal leaves no iframe behind, findings or none", async () => {
    const clean = makeDocument(FRAME, [
      build({ id: "a", styles: { height: "10px" } }),
    ]);
    const dirty = makeDocument(FRAME, [
      build({ id: "b", styles: { position: "static", height: "10px" } }),
    ]);
    expect(await necessityLint(clean)).toEqual([]);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(await necessityLint(dirty)).toHaveLength(1);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("cost", () => {
  test("a 40-element fixture: one finding per dead declaration, nothing else", async () => {
    // 40 boxes in a grid, each with three live declarations and one dead
    // (position: static) — 160 removals over 43 measured elements.
    const boxes = Array.from({ length: 40 }, (_, i) =>
      build({
        id: `b${i}`,
        text: `box ${i}`,
        styles: {
          padding: "4px",
          background: `rgb(${(i * 6) % 255}, 120, 120)`,
          "min-height": "24px",
          position: "static",
        },
      }),
    );
    const grid = build({
      id: "grid",
      styles: {
        display: "grid",
        "grid-template-columns": "repeat(5, 1fr)",
        gap: "8px",
      },
      children: boxes,
    });
    const doc = makeDocument({ width: 800, height: 600 }, [grid]);
    const findings = await necessityLint(doc);
    expect(findings).toHaveLength(40);
    expect(new Set(properties(findings))).toEqual(new Set(["position"]));
  });
});

describe("necessity on rules (decisions.md #71, plan phase 9)", () => {
  test("a rule's custom property nobody reads is dead, reported at sheet[i]", async () => {
    const box = build({ id: "box", attrs: { class: "a" }, text: "hi" });
    const doc = makeDocument(FRAME, [box], undefined, [
      { selector: ".a", styles: { "--unused": "1px" } },
    ]);
    const vpId = doc.items[0]!.id;
    const findings = await necessityLint(doc);
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        rule: 0,
        property: "--unused",
        message: `--unused: 1px in rule .a (sheet[0]) of viewport ${vpId} changes nothing at ${sweptAt(400)}`,
      },
    ]);
  });

  test("a pseudo-element rule's declaration is judged too, addressed at sheet[i] — necessity has no read of a pseudo-element's own box or computed style", async () => {
    // .card::before is neither a state pseudo-class (hasStatePseudo is
    // for :hover and its kin, never a pseudo-ELEMENT) nor media-inactive,
    // so judgeRules creates a candidate for it same as any other rule.
    // The observation baseline reads only `[data-dream-id]` real element
    // nodes, never a pseudo-element's own generated box or computed
    // style, so removing the declaration never registers as a change —
    // dead, reported at the rule's own sheet[i], not at any element.
    const card = build({ id: "card", attrs: { class: "card" } });
    const doc = makeDocument(FRAME, [card], undefined, [
      { selector: ".card::before", styles: { color: "red" } },
    ]);
    const vpId = doc.items[0]!.id;
    const findings = await necessityLint(doc);
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        rule: 0,
        property: "color",
        message: `color: red in rule .card::before (sheet[0]) of viewport ${vpId} changes nothing at ${sweptAt(400)}`,
      },
    ]);
  });

  test("a rule's width that sizes its matched element is live", async () => {
    const box = build({ id: "box", attrs: { class: "a" }, styles: { height: "20px" } });
    const doc = makeDocument(FRAME, [box], undefined, [
      { selector: ".a", styles: { width: "120px" } },
    ]);
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("a rule's declaration every matched element also shadows inline is judged WITH the shadow, so it is not falsely dead — that shape is the redundancy finding's, not this one's", async () => {
    const box = build({
      id: "box",
      attrs: { class: "a" },
      text: "hi",
      styles: { color: "red" },
    });
    const doc = makeDocument(FRAME, [box], undefined, [
      { selector: ".a", styles: { color: "red" } },
    ]);
    // Removed alone, the rule's declaration would read dead (the inline
    // copy keeps the element red); removed together with the element's
    // own shadowing declaration (the paired check), color really does
    // change — so the rule is alive, and the element's own line is the
    // redundancy finding's story (matchLint.ts), never necessity's.
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("a rule under a state pseudo-class is never judged — in a rule, :hover belongs to the selector", async () => {
    const box = build({ id: "box", attrs: { class: "a" } });
    const doc = makeDocument(FRAME, [box], undefined, [
      { selector: ".a:hover", styles: { color: "red" } },
    ]);
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("a rule under an @media condition inactive at the frame is left alone: the generated sheet never marks it here to judge", async () => {
    const box = build({ id: "box", attrs: { class: "a" } });
    const doc = makeDocument(FRAME, [box], undefined, [
      {
        selector: ".a",
        conditions: ["@media (min-width: 2000px)"],
        styles: { color: "red" },
      },
    ]);
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("rule verdicts intersect across viewports by selector and conditions, never by index — dead in one, live in the other, stays alive overall", async () => {
    const dead = makeDocument(
      { width: 360 },
      [build({ id: "n", attrs: { class: "a" } })],
      undefined,
      [{ selector: ".a", styles: { "--unused": "1px" } }],
    );
    const alive = makeDocument(
      { width: 1280 },
      [build({ id: "w", attrs: { class: "a" }, styles: { width: "var(--unused)", height: "10px" } })],
      undefined,
      [{ selector: ".a", styles: { "--unused": "1px" } }],
    );
    const doc: DreamDocument = { version: 6, items: [...dead.items, ...alive.items] };
    // The first viewport's element reads nothing from --unused (dead
    // there); the second's `width: var(--unused)` does (live there). The
    // SAME rule (same selector, same conditions — both empty) is dead
    // only where dead EVERYWHERE it exists, so the intersection reports
    // nothing.
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("the same rule's declaration dead in every viewport it exists in is reported once", async () => {
    const a = makeDocument(
      { width: 360 },
      [build({ id: "n1", attrs: { class: "a" } })],
      undefined,
      [{ selector: ".a", styles: { "--unused": "1px" } }],
    );
    const b = makeDocument(
      { width: 1280 },
      [build({ id: "n2", attrs: { class: "a" } })],
      undefined,
      [{ selector: ".a", styles: { "--unused": "1px" } }],
    );
    const doc: DreamDocument = { version: 6, items: [...a.items, ...b.items] };
    const findings = await necessityLint(doc);
    expect(findings.map((f) => f.property)).toEqual(["--unused"]);
  });
});
