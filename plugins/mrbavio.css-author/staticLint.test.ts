// The static lint against documents (docs/agent-css-knowledge-prd.md,
// "Testing Decisions", seam 3): a document goes in, findings come out, and
// every assertion is on the findings' shape and words. Node project: the
// lint reads the JSON alone, through `dd.core`'s pure helpers.
import { describe, expect, test } from "vitest";

import type {
  DreamDocument,
  DreamElement,
  Finding,
} from "@daydream/plugin-api";
import {
  coreApi,
  createElement,
  createViewportItem,
  fixtureRoot,
  fixtureViewport,
} from "@daydream/plugin-testing";

import { staticLint as lintWith } from "./staticLint";

const staticLint = (document: DreamDocument): Finding[] =>
  lintWith(coreApi(), document);

/** One-viewport v4 document around the given body children, with optional
 * html/body styles — the skeleton every rule walks (decision #32). */
function doc(
  children: DreamElement[],
  skeleton: {
    html?: Record<string, string>;
    body?: Record<string, string>;
    bodyLayers?: DreamElement["conditionals"];
  } = {},
): DreamDocument {
  const body = createElement({
    tag: "body",
    label: "body",
    styles: skeleton.body ?? {},
    children,
  });
  if (skeleton.bodyLayers !== undefined)
    body.conditionals = skeleton.bodyLayers;
  const root = createElement({
    tag: "html",
    styles: skeleton.html ?? {},
    children: [body],
  });
  return {
    version: 5,
    items: [createViewportItem(root, { id: "v1", frame: { width: 960 } })],
  };
}

function el(
  styles: Record<string, string>,
  extra: {
    label?: string;
    tag?: string;
    children?: DreamElement[];
    conditionals?: DreamElement["conditionals"];
  } = {},
): DreamElement {
  const element = createElement({
    styles,
    ...(extra.label !== undefined ? { label: extra.label } : {}),
    ...(extra.tag !== undefined ? { tag: extra.tag } : {}),
    ...(extra.children !== undefined ? { children: extra.children } : {}),
  });
  if (extra.conditionals !== undefined) {
    element.conditionals = extra.conditionals;
  }
  return element;
}

const CARD_QUERY = "@container (width > 400px)";
const NAMED_QUERY = "@container card (width > 400px)";

function queried(prelude = CARD_QUERY): DreamElement {
  return el(
    { display: "block" },
    {
      label: "Card",
      conditionals: [{ condition: prelude, styles: { display: "flex" } }],
    },
  );
}

describe("staticLint: containerless container queries (rule 1)", () => {
  test("a container layer with no container-typed ancestor is a finding", () => {
    const card = queried();
    const findings = staticLint(doc([el({}, { children: [card] })]));
    expect(findings).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: card.id,
        layer: CARD_QUERY,
        message:
          "container query `@container (width > 400px)` on Card can never match: no ancestor declares container-type",
      },
    ]);
  });

  test("a container-type ancestor satisfies the query", () => {
    const card = queried();
    const wrapper = el(
      { "container-type": "inline-size" },
      { children: [card] },
    );
    expect(staticLint(doc([wrapper]))).toEqual([]);
  });

  test("the container shorthand with a slashed type satisfies the query", () => {
    const wrapper = el({ container: "grid / size" }, { children: [queried()] });
    expect(staticLint(doc([wrapper]))).toEqual([]);
  });

  test("an unslashed container shorthand sets a name only, no type", () => {
    const card = queried();
    const wrapper = el({ container: "grid" }, { children: [card] });
    expect(staticLint(doc([wrapper]))).toHaveLength(1);
  });

  test("container-type: normal is not a container", () => {
    const wrapper = el(
      { "container-type": "normal" },
      { children: [queried()] },
    );
    expect(staticLint(doc([wrapper]))).toHaveLength(1);
  });

  test("the element's own container-type does not count — queries read ancestors", () => {
    const card = queried();
    card.styles["container-type"] = "inline-size";
    expect(staticLint(doc([card]))).toHaveLength(1);
  });

  test("container-type on body or html counts as an ancestor", () => {
    expect(
      staticLint(
        doc([queried()], { body: { "container-type": "inline-size" } }),
      ),
    ).toEqual([]);
    expect(
      staticLint(doc([queried()], { html: { "container-type": "size" } })),
    ).toEqual([]);
  });

  test("container-type declared inside an ancestor's media layer counts", () => {
    const wrapper = el({}, { children: [queried()] });
    wrapper.conditionals = [
      {
        condition: "@media (width >= 600px)",
        styles: { "container-type": "inline-size" },
      },
    ];
    expect(staticLint(doc([wrapper]))).toEqual([]);
  });

  test("a named query needs an ancestor carrying that name", () => {
    const card = queried(NAMED_QUERY);
    const typedOnly = el(
      { "container-type": "inline-size" },
      {
        children: [card],
      },
    );
    const findings = staticLint(doc([typedOnly]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.layer).toBe(NAMED_QUERY);
    expect(findings[0]?.message).toMatch(/named `card`/);

    const named = el(
      { "container-type": "inline-size", "container-name": "card" },
      { children: [queried(NAMED_QUERY)] },
    );
    expect(staticLint(doc([named]))).toEqual([]);

    const shorthand = el(
      { container: "card / inline-size" },
      {
        children: [queried(NAMED_QUERY)],
      },
    );
    expect(staticLint(doc([shorthand]))).toEqual([]);

    const otherName = el(
      { container: "sidebar / inline-size" },
      {
        children: [queried(NAMED_QUERY)],
      },
    );
    expect(staticLint(doc([otherName]))).toHaveLength(1);
  });

  test("a name may come from one ancestor and the type from a farther one", () => {
    // The nearest ancestor is what a named query is matched against, so a
    // name without a type on it is not a container; but the lint is static
    // and generous: any ancestor that is BOTH typed and so named passes.
    const outer = el(
      { container: "card / inline-size" },
      { children: [el({}, { children: [queried(NAMED_QUERY)] })] },
    );
    expect(staticLint(doc([outer]))).toEqual([]);
  });

  test("a style()-only query needs no container-type, named or not", () => {
    expect(
      staticLint(doc([queried("@container style(--theme: dark)")])),
    ).toEqual([]);
    expect(
      staticLint(doc([queried("@container card style(--theme: dark)")])),
    ).toEqual([]);
    expect(
      staticLint(
        doc([
          queried("@container (style(--a: 1) and style(--b: calc(1 + 2)))"),
        ]),
      ),
    ).toEqual([]);
    expect(
      staticLint(doc([queried("@container not style(--theme: dark)")])),
    ).toEqual([]);
  });

  test("a scroll-state() query needs a scroll-state container", () => {
    const query = "@container scroll-state(stuck: top)";
    const [finding] = staticLint(doc([queried(query)]));
    expect(finding?.message).toMatch(
      /can never match: no ancestor declares container-type: scroll-state$/,
    );
    const sizeOnly = el(
      { "container-type": "inline-size" },
      { children: [queried(query)] },
    );
    expect(staticLint(doc([sizeOnly]))).toHaveLength(1);
    const scroller = el(
      { "container-type": "scroll-state" },
      { children: [queried(query)] },
    );
    expect(staticLint(doc([scroller]))).toEqual([]);
    const shorthand = el(
      { container: "sticky / size scroll-state" },
      { children: [queried("@container sticky scroll-state(stuck: top)")] },
    );
    expect(staticLint(doc([shorthand]))).toEqual([]);
  });

  test("a mixed size and style() query still needs a size-typed ancestor", () => {
    const mixed = "@container (width > 400px) and style(--x: 1)";
    expect(staticLint(doc([queried(mixed)]))).toHaveLength(1);
    const typed = el(
      { "container-type": "inline-size" },
      { children: [queried(mixed)] },
    );
    expect(staticLint(doc([typed]))).toEqual([]);
  });

  test("size features in every spelling need a size container", () => {
    for (const query of [
      "@container (min-width: 400px)",
      "@container (orientation: landscape)",
      "@container not (width > 400px)",
      "@container ((width > 400px) or (height > 200px))",
    ]) {
      expect(staticLint(doc([queried(query)])), query).toHaveLength(1);
    }
  });

  test("container declarations inside an ancestor's container layer count", () => {
    // Only the wrapper's container layer names `card`; the grandparent types
    // the wrapper's own query but carries no name.
    const wrapper = el({}, { children: [queried(NAMED_QUERY)] });
    wrapper.conditionals = [
      {
        condition: "@container (width > 0px)",
        styles: { container: "card / inline-size" },
      },
    ];
    const outer = el(
      { "container-type": "inline-size" },
      { children: [wrapper] },
    );
    expect(staticLint(doc([outer]))).toEqual([]);
  });

  test("media layers are never container queries", () => {
    const responsive = el(
      {},
      {
        conditionals: [
          { condition: "@media (width >= 600px)", styles: { gap: "8px" } },
        ],
      },
    );
    expect(staticLint(doc([responsive]))).toEqual([]);
  });

  test("a query in one viewport cannot borrow a container from another", () => {
    const card = queried();
    const withContainer = doc([
      el({ "container-type": "inline-size" }, { children: [el({})] }),
    ]);
    const without = doc([card]);
    const both: DreamDocument = {
      version: 5,
      items: [...withContainer.items, ...without.items],
    };
    expect(staticLint(both)).toHaveLength(1);
  });

  test("the element is named tag#id when it has no label", () => {
    const card = queried();
    delete card.label;
    const [finding] = staticLint(doc([card]));
    expect(finding?.message).toContain(`on div#${card.id} can never match`);
  });
});

describe("staticLint: unit-less lengths (rule 2)", () => {
  test("a bare number on a length property is a finding", () => {
    const box = el({ width: "100" }, { label: "Box" });
    expect(staticLint(doc([box]))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: box.id,
        property: "width",
        message:
          "width: 100 on Box has no unit; a length needs one (px, rem, %, …)",
      },
    ]);
  });

  test("every bare number in a multi-value length is caught once per declaration", () => {
    const box = el({ margin: "10 20", padding: "0 16px", gap: "20" });
    const findings = staticLint(doc([box]));
    expect(findings.map((f) => f.property)).toEqual(["margin", "gap"]);
  });

  test("unitless zero is a valid length", () => {
    const box = el({
      margin: "0",
      padding: "0 0",
      top: "0",
      inset: "0",
      "flex-basis": "0",
      width: "0.0",
      "letter-spacing": "-0",
    });
    expect(staticLint(doc([box]))).toEqual([]);
  });

  test("valued lengths, keywords and functions pass", () => {
    const box = el({
      width: "100%",
      height: "50vh",
      "min-width": "min-content",
      "max-width": "fit-content",
      margin: "0 auto",
      padding: "1rem 2em",
      gap: "clamp(8px, 2vw, 24px)",
      translate: "10px 20px",
      "font-size": "1.25rem",
      inset: "var(--inset)",
      "border-radius": "50%",
      "flex-basis": "content",
    });
    expect(staticLint(doc([box]))).toEqual([]);
  });

  test("numbers inside functions are multipliers, not lengths", () => {
    const box = el({
      width: "calc(100 * 1px)",
      gap: "min(10, 2px)",
      margin: "calc(2 * var(--space))",
    });
    expect(staticLint(doc([box]))).toEqual([]);
  });

  test("properties that take unitless numbers are never flagged", () => {
    const box = el({
      "line-height": "1.5",
      opacity: "0.5",
      "z-index": "10",
      order: "2",
      flex: "1",
      "flex-grow": "1",
      "flex-shrink": "0",
      "font-weight": "600",
      zoom: "2",
      "aspect-ratio": "16 / 9",
      "grid-column": "1 / 3",
      "grid-row": "2",
      "grid-column-start": "1",
      columns: "3",
      "column-count": "2",
      "tab-size": "4",
      "stroke-width": "2",
      "animation-iteration-count": "3",
    });
    expect(staticLint(doc([box]))).toEqual([]);
  });

  test("a bare number inside a conditional layer carries the layer", () => {
    const box = el(
      {},
      {
        conditionals: [
          { condition: "@media (width >= 600px)", styles: { gap: "24" } },
        ],
      },
    );
    expect(staticLint(doc([box]))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: box.id,
        property: "gap",
        layer: "@media (width >= 600px)",
        message: expect.stringMatching(/^gap: 24 on div#/),
      },
    ]);
  });

  test("the logical and physical length families are covered", () => {
    const box = el({
      "inline-size": "300",
      "margin-inline": "8",
      "padding-block-start": "4",
      "inset-inline-end": "12",
      "border-top-width": "2",
      "border-top-left-radius": "6",
      "row-gap": "8",
      "column-gap": "8",
      "min-height": "200",
      "max-inline-size": "800",
      "text-indent": "16",
      "word-spacing": "2",
    });
    expect(staticLint(doc([box])).map((f) => f.property)).toEqual([
      "inline-size",
      "margin-inline",
      "padding-block-start",
      "inset-inline-end",
      "border-top-width",
      "border-top-left-radius",
      "row-gap",
      "column-gap",
      "min-height",
      "max-inline-size",
      "text-indent",
      "word-spacing",
    ]);
  });
});

describe("staticLint: restated initial values (rule 3)", () => {
  test("an initial value in base styles is a finding", () => {
    const box = el({ position: "static" }, { label: "Box" });
    expect(staticLint(doc([box]))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: box.id,
        property: "position",
        message: "position: static on Box restates the initial value",
      },
    ]);
  });

  test("representative initials across the table are findings", () => {
    const box = el({
      float: "none",
      inset: "auto",
      "flex-shrink": "1",
      "flex-basis": "auto",
      opacity: "1",
      transform: "none",
      "max-width": "none",
      "min-height": "auto",
      overflow: "visible",
      "box-shadow": "none",
    });
    const findings = staticLint(doc([box]));
    expect(findings.map((f) => f.property)).toEqual([
      "float",
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
    expect(findings.every((f) => f.tier === "static")).toBe(true);
  });

  test("a non-initial value is not a finding", () => {
    const box = el({
      position: "relative",
      "flex-shrink": "0",
      "flex-grow": "1",
      opacity: "0.5",
      "max-width": "60ch",
      "min-width": "0",
      overflow: "hidden",
      "z-index": "1",
    });
    expect(staticLint(doc([box]))).toEqual([]);
  });

  test("value comparison ignores case and surrounding whitespace", () => {
    const box = el({ position: " Static ", float: "NONE" });
    expect(staticLint(doc([box]))).toHaveLength(2);
  });

  test("a layer resetting to the initial value is a legitimate override", () => {
    const box = el(
      { position: "absolute" },
      {
        conditionals: [
          {
            condition: "@media (width >= 600px)",
            styles: { position: "static", "max-width": "none" },
          },
        ],
      },
    );
    expect(staticLint(doc([box]))).toEqual([]);
  });

  test("properties the UA sheet sets on a tag are skipped for that tag", () => {
    // Chrome's UA sheet gives img and hr an overflow, so restating the
    // initial there is a real reset.
    expect(
      staticLint(doc([el({ overflow: "visible" }, { tag: "img" })])),
    ).toEqual([]);
    expect(
      staticLint(doc([el({ overflow: "visible" }, { tag: "hr" })])),
    ).toEqual([]);
    // The same tags still get the properties the UA leaves alone.
    expect(
      staticLint(doc([el({ position: "static" }, { tag: "img" })])),
    ).toHaveLength(1);
  });

  // The vocabulary widened (decision #57) and the UA sheet was re-read
  // for every new tag: none of the table's properties is set on any of
  // them, so every new tag is held to the whole table — no new exception.
  // Every pair below is a claim about Chromium's html.css; widening the
  // vocabulary again means re-reading the sheet and extending the list.
  const NEW_TAGS = [
    ...["table", "caption", "colgroup", "col", "thead", "tbody", "tfoot"],
    ...["tr", "td", "th", "dl", "dt", "dd"],
    ...["address", "hgroup", "menu", "search"],
    ...["s", "cite", "q", "dfn", "abbr", "time", "var", "samp", "kbd"],
    ...["sub", "sup", "u", "mark", "bdi", "bdo", "wbr", "ins", "del"],
    ...["ruby", "rt", "rp"],
  ];
  const TABLE = [
    ["position", "static"],
    ["float", "none"],
    ["clear", "none"],
    ["z-index", "auto"],
    ["top", "auto"],
    ["right", "auto"],
    ["bottom", "auto"],
    ["left", "auto"],
    ["inset", "auto"],
    ["flex-direction", "row"],
    ["flex-wrap", "nowrap"],
    ["flex-grow", "0"],
    ["flex-shrink", "1"],
    ["flex-basis", "auto"],
    ["opacity", "1"],
    ["transform", "none"],
    ["max-width", "none"],
    ["max-height", "none"],
    ["min-width", "auto"],
    ["min-height", "auto"],
    ["overflow", "visible"],
    ["box-shadow", "none"],
  ] as const;

  test("the UA sheet leaves every table property alone on every new tag: restating one there is still redundant", () => {
    for (const tag of NEW_TAGS) {
      for (const [property, value] of TABLE) {
        const findings = staticLint(doc([el({ [property]: value }, { tag })]));
        expect(
          findings.map((f) => f.property),
          `${tag} ${property}`,
        ).toEqual([property]);
      }
    }
  });

  test("inherited properties are never in the table: a reset under an ancestor is real", () => {
    const reset = el({
      "letter-spacing": "normal",
      "text-transform": "none",
      visibility: "visible",
    });
    const parent = el(
      {
        "letter-spacing": "0.1em",
        "text-transform": "uppercase",
        visibility: "hidden",
      },
      { children: [reset] },
    );
    expect(staticLint(doc([parent]))).toEqual([]);
    // And without any ancestor either — the JSON cannot tell the two apart.
    expect(staticLint(doc([el({ "letter-spacing": "normal" })]))).toEqual([]);
  });

  test("outline-offset is deliberately not in the table", () => {
    expect(staticLint(doc([el({ "outline-offset": "0" })]))).toEqual([]);
  });
});

describe("staticLint: whole document", () => {
  test("a clean document has no findings, and an empty canvas is clean", () => {
    const clean = doc(
      [
        el(
          { display: "grid", "grid-template-columns": "1fr 2fr", gap: "16px" },
          { children: [el({ padding: "24px" }), el({ "min-width": "0" })] },
        ),
      ],
      { body: { margin: "0" } },
    );
    expect(staticLint(clean)).toEqual([]);
    expect(staticLint({ version: 5, items: [] })).toEqual([]);
  });

  test("findings come in tree order, one element's rules together", () => {
    const inner = el({ width: "100" });
    const outer = el({ position: "static", gap: "8" }, { children: [inner] });
    outer.conditionals = [
      { condition: CARD_QUERY, styles: { display: "flex" } },
    ];
    const findings = staticLint(doc([outer]));
    expect(findings.map((f) => [f.elementId, f.property ?? f.layer])).toEqual([
      [outer.id, CARD_QUERY],
      [outer.id, "gap"],
      [outer.id, "position"],
      [inner.id, "width"],
    ]);
  });
});

describe("rule 4 — a @font-face no element names", () => {
  const face = (family: string) => ({
    "font-family": family,
    src: "url(/assets/gen-1.woff2)",
  });
  function withFonts(
    fonts: Record<string, string>[],
    skeleton: Parameters<typeof doc>[1] = {},
    children: DreamElement[] = [],
  ): DreamDocument {
    const document = doc(children, skeleton);
    fixtureViewport(document).payload.fonts = fonts;
    return document;
  }

  test("a face named by the root's font-family is fine, case-insensitively", () => {
    expect(
      staticLint(
        withFonts([face("Montserrat")], {
          html: { "font-family": "montserrat, system-ui, sans-serif" },
        }),
      ),
    ).toEqual([]);
  });

  test("a face named only inside a layer, or by a quoted name, is fine", () => {
    expect(
      staticLint(
        withFonts([face("Noto Serif")], {
          bodyLayers: [
            {
              condition: "@media (width < 600px)",
              styles: { "font-family": '"Noto Serif", serif' },
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("the font shorthand counts, generously", () => {
    expect(
      staticLint(
        withFonts([face("Montserrat")], {}, [
          el({ font: "400 1rem/1.4 Montserrat, sans-serif" }),
        ]),
      ),
    ).toEqual([]);
  });

  test("a face reached through a custom property is fine", () => {
    expect(
      staticLint(
        withFonts([face("Noto Serif")], {
          html: { "--stack": '"Noto Serif", serif' },
          body: { "font-family": "var(--stack)" },
        }),
      ),
    ).toEqual([]);
  });

  test("a face nothing names is one static finding on the root", () => {
    const document = withFonts([face("Montserrat"), face("Noto Serif")], {
      html: { "font-family": "Montserrat, sans-serif" },
    });
    expect(staticLint(document)).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: fixtureRoot(document).id,
        message:
          "@font-face Noto Serif in viewport v1 is named by no element's font-family — remove the face or use it",
      },
    ]);
  });

  test("a face named only by a rule's font-family is fine (decision #71, plan phase 9)", () => {
    const document = withFonts([face("Montserrat")]);
    fixtureViewport(document).payload.sheet = [
      { selector: "h1", styles: { "font-family": "Montserrat, sans-serif" } },
    ];
    expect(staticLint(document)).toEqual([]);
  });
});

describe("rule-level static findings (decision #71, plan phase 9)", () => {
  test("a unit-less length in a rule is a finding at sheet[i]", () => {
    const document = doc([]);
    fixtureViewport(document).payload.sheet = [
      { selector: ".card", styles: { width: "100" } },
    ];
    expect(staticLint(document)).toEqual([
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

  test("a restated initial in a rule is a finding at sheet[i]", () => {
    const document = doc([]);
    fixtureViewport(document).payload.sheet = [
      { selector: ".card", styles: { position: "static" } },
    ];
    expect(staticLint(document)).toEqual([
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

  test("a rule typed to img is excused overflow: visible, the same exception an element gets", () => {
    const document = doc([]);
    fixtureViewport(document).payload.sheet = [
      { selector: "img.hero", styles: { overflow: "visible" } },
    ];
    expect(staticLint(document)).toEqual([]);
  });
});
