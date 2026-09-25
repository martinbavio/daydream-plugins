// The necessity lint against real layout (docs/agent-css-knowledge-prd.md,
// "Testing Decisions", seam 1): a page goes in, findings come out, and
// every assertion is on the findings' shape and words — never on how the
// lint decided. Real Chromium only (vite.config.ts): the lint removes
// declarations from a live iframe core mounts (`dd.mountViewport`) and
// reads the CSS engine's answer back. The API object is a test kernel's.
import { afterAll, afterEach, describe, expect, test } from "vitest";

import type { DreamDocument, Finding } from "@daydream/plugin-api";
import {
  coreApi,
  createPageItem,
  createTestKernel,
} from "@daydream/plugin-testing";

import {
  isExemptProperty,
  necessityLint as lintWith,
  probeWidths,
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

afterEach(() => {
  // Every lint disposes its own iframe; a leftover is a bug, not a
  // fixture to clean.
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

/** One page: html › body (its own style `margin: 0` unless given) › the
 * markup, the css, a frame, an id (`v1` unless given). */
function makeDocument(
  frame: { width: number; height?: number } | undefined,
  body: string,
  css = "",
  options: { bodyStyle?: string; id?: string } = {},
): DreamDocument {
  const bodyStyle = options.bodyStyle ?? "margin: 0";
  return {
    version: 7,
    items: [
      createPageItem(
        {
          html: `<!doctype html><html><head><title>t</title></head><body style="${bodyStyle}">${body}</body></html>`,
          css,
        },
        { id: options.id ?? "v1", ...(frame === undefined ? {} : { frame }) },
      ),
    ],
  };
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
    const findings = await necessityLint(
      makeDocument(FRAME, '<div id="box" style="position: static; width: 120px; height: 40px"></div>'),
    );
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "#box",
        property: "position",
        message: `position: static on \`#box\` changes nothing at ${sweptAt(400)}`,
      },
    ]);
  });

  test("a color on a parent that a child inherits is live", async () => {
    const findings = await necessityLint(
      makeDocument(FRAME, '<div id="parent" style="color: rgb(200, 0, 0)"><div id="child">hello</div></div>'),
    );
    expect(findings).toEqual([]);
  });

  test("a custom property nobody reads is dead; one a child reads is live", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="parent" style="--w: 150px; --unused: 1"><div id="reader" style="width: var(--w); height: 20px"></div></div>',
      ),
    );
    expect(properties(findings)).toEqual(["--unused"]);
    expect(findings[0]!.message).toBe(
      `--unused: 1 on \`#parent\` changes nothing at ${sweptAt(400)}`,
    );
  });

  test("a media rule for a width the frame is not at is live (the sweep reaches its breakpoint); one for print, which neither the frame nor a swept width is, is not judged", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="height: 20px"></div>',
        `@media (width >= 300px) { #box { width: 200px; } }
@media (width >= 900px) { #box { width: 300px; } }
@media print { #box { width: 10px; } }`,
      ),
    );
    expect(findings).toEqual([]);
  });

  test("a rule under a height, orientation or preference query that neither the frame nor a swept width meets is not judged; one they meet is", async () => {
    // The frame is 400 × 300, and every swept width is wider than 300: a
    // landscape window at every one of them, never 2000px tall, and the
    // test browser prefers light.
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="height: 20px"></div>',
        `@media (min-height: 2000px) { #box { position: static; } }
@media (orientation: portrait) { #box { position: static; } }
@media (prefers-color-scheme: dark) { #box { position: static; } }
@media (max-height: 1000px) { #box { position: static; } }
#box { @media (height > 1000px) { position: static; } }`,
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[3, "position"]]);
  });

  test("a rule under an @supports this browser fails is not judged; one it passes is", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="height: 20px"></div>',
        `@supports not (display: grid) { #box { position: static; } }
@supports (display: grid) { #box { position: static; } }`,
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[1, "position"]]);
  });

  test("@starting-style declarations are never judged: they apply before an element's first style, which no removal and re-read can see", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div class="a" style="height: 20px"></div><p class="b">b</p>',
        `.a { opacity: 0.5; transition: opacity 1s; }
@starting-style { .a { opacity: 0; } }
.b { color: red; @starting-style { color: blue; } }`,
      ),
    );
    expect(findings).toEqual([]);
  });

  test("a base a matching conditional branch of the same selector overrides is judged WITH the branch, so it is live", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box"></div>',
        "#box { width: 100px; height: 20px; }\n@media (width >= 300px) { #box { width: 200px; } }",
      ),
    );
    expect(findings).toEqual([]);
  });

  test("a base an @supports branch overrides at every width is judged with it — a nested branch too — so a fallback stays", async () => {
    expect(
      await necessityLint(
        makeDocument(
          FRAME,
          '<div id="box" style="height: 20px"><p>a</p><p>b</p></div>',
          "#box { display: block; @supports (display: grid) { display: grid; gap: 4px; } }",
        ),
      ),
    ).toEqual([]);
  });

  test("a base that is initial anyway stays dead even when a branch that never applies restates the property", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box"></div>',
        "#box { position: static; height: 20px; }\n@media print { #box { position: relative; } }",
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[0, "position"]]);
  });

  test("a base paired with a branch the sweep reaches is live: the base is the other branch", async () => {
    expect(
      await necessityLint(
        makeDocument(
          FRAME,
          '<div id="box"></div>',
          "#box { position: static; height: 20px; }\n@media (width >= 900px) { #box { position: relative; } }",
        ),
      ),
    ).toEqual([]);
  });

  test("a container-query declaration that matches is live", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="holder" style="container-type: inline-size; width: 300px"><div id="card" style="height: 20px"></div></div>',
        "@container (width >= 200px) { #card { width: 50%; } }",
      ),
    );
    expect(findings).toEqual([]);
  });

  test("an exempt transition, animation or cursor is never reported, dead or not", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="transition: width 200ms; transition-delay: 10ms; animation: none; cursor: pointer; height: 20px"></div>',
      ),
    );
    expect(findings).toEqual([]);
    expect(isExemptProperty("-webkit-transition")).toBe(true);
    expect(isExemptProperty("animation-name")).toBe(true);
    expect(isExemptProperty("cursor")).toBe(true);
    for (const live of ["will-change", "pointer-events", "user-select", "width"]) {
      expect(isExemptProperty(live), live).toBe(false);
    }
  });

  test("a transition on the element never makes its other declarations read dead", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="parent" style="transition-property: all; transition-duration: 1s; gap: 9px; display: grid"><div id="box" style="transition: all 200ms; opacity: .5; padding: 10px; color: rgb(0, 100, 0); height: 20px"></div></div>',
      ),
    );
    expect(findings).toEqual([]);
  });

  test("a rule whose selector the browser refuses is skipped, not reported: it is the static gate's dead rule", async () => {
    const findings = await necessityLint(
      makeDocument(FRAME, '<div id="box" style="height: 20px"></div>', "#box:nope { width: 1px; }"),
    );
    expect(findings).toEqual([]);
  });

  test("a state rule is never judged: nothing hovers a measured page (decision #53), nested or not", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="height: 20px"></div>',
        "#box:hover { width: 1px; }\n#box { &:focus-within { width: 2px; } }",
      ),
    );
    expect(findings.map((f) => f.message)).toEqual([]);
  });

  test("declarations on the skeleton (html, body) are checked too", async () => {
    const findings = await necessityLint(
      makeDocument(FRAME, '<div style="height: 10px"></div>', "", {
        bodyStyle: "margin: 0; display: block",
      }),
    );
    expect(properties(findings)).toEqual(["display"]);
    expect(findings[0]!.message).toMatch(/^display: block on `body` changes nothing/);
  });

  test("two declarations of one property in a block are one judgement: the earlier is a fallback, and where both agree neither is dead alone", async () => {
    expect(
      await necessityLint(
        makeDocument(FRAME, '<div id="box"></div>', "#box { height: 100vh; height: 100dvh; }"),
      ),
    ).toEqual([]);
    // Judged together, a pair that changes nothing is named by its last.
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="height: 20px; position: relative; position: static"></div>',
      ),
    );
    expect(findings.map((f) => f.message)).toEqual([
      `position: static on \`#box\` changes nothing at ${sweptAt(400)}`,
    ]);
  });

  test("a declaration the parser drops is dead; another engine's prefixed property is not judged", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div id="box" style="height: 20px"></div>',
        "#box { colr: red; -moz-appearance: none; }",
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[0, "colr"]]);
  });

  test("a page's web font survives every removal: the reads stay on the loaded face", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<p id="text">Some words in the face</p>',
        '@font-face { font-family: "Local Face"; src: local("Arial"); }\n#text { font-family: "Local Face", serif; position: static; }',
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[0, "position"]]);
  });

  test("a `<style>` the markup keeps in a noscript is never taken for the page's css", async () => {
    // The kernel keeps a noscript's stylesheet in the markup, and the
    // measurer's copy (no scripting there) parses it as a `<style>` in the
    // head, before the page's own.
    const findings = await necessityLint({
      version: 7,
      items: [
        createPageItem(
          {
            html: '<!doctype html><html><head><noscript><style>#box { color: red; }</style></noscript></head><body style="margin: 0"><div id="box" style="height: 20px"></div></body></html>',
            css: "#box { position: static; }",
          },
          { id: "v1", frame: FRAME },
        ),
      ],
    });
    expect(findings.map((f) => [f.rule, f.property, f.message])).toEqual([
      [
        0,
        "position",
        `position: static in rule \`#box\` of viewport v1 changes nothing at ${sweptAt(400)}`,
      ],
    ]);
  });

  test("an element is named by its selector in the stored markup, which still holds an element the safety walk removed", async () => {
    // The mount drops the `<script>`, so `#box` is unique there; in the
    // markup an agent reads and addresses, it is not.
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<script id="box"></script><div id="box" style="position: static; height: 40px"></div>',
      ),
    );
    expect(findings.map((f) => [f.elementId, f.message])).toEqual([
      ["div", `position: static on \`div\` changes nothing at ${sweptAt(400)}`],
    ]);
  });
});

describe("an image the lint's copy could not load", () => {
  // `assets/…` with no asset base is a url the test server answers 404:
  // the image is complete with natural width 0, laid out as its alt text,
  // whose box no width or height asked of it changes.
  const broken = (style: string): string =>
    `<img src="assets/missing.png" alt="missing" style="${style}">`;

  test("its sizing and object-* declarations, its own or a rule's, are not judged, and one advisory says so", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        `<div id="frame">${broken("position: static; height: 50vh; object-fit: cover; object-position: 50% 40%")}</div>`,
        "img { width: 100%; max-height: 80vh; }",
      ),
    );
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "img",
        property: "position",
        message: `position: static on \`img\` changes nothing at ${sweptAt(400)}`,
      },
      {
        tier: "necessity",
        severity: "advisory",
        message:
          "An image could not be loaded in the necessity lint's copy of viewport v1 (`img`), so its sizing and object-* declarations were not judged",
      },
    ]);
  });

  test("one advisory per viewport, naming the first three images and counting the rest", async () => {
    const findings = await necessityLint(
      makeDocument(FRAME, Array.from({ length: 5 }, () => broken("height: 40px")).join("")),
    );
    expect(findings.map((f) => [f.severity, f.message])).toEqual([
      [
        "advisory",
        "5 images could not be loaded in the necessity lint's copy of viewport v1 (`img:nth-of-type(1)`, `img:nth-of-type(2)`, `img:nth-of-type(3)` and 2 more), so their sizing and object-* declarations were not judged",
      ],
    ]);
  });
});

/** A container-typed holder (full width, or the given one) around a
 * two-item grid whose base is one column and whose `@container` branch is
 * two. `justify-content: start` keeps the base observable: a stretching
 * grid's implicit auto column is as wide as an explicit `1fr` one, and
 * the browser would (rightly) call that base dead. */
function responsiveGrid(holderWidth?: string): { body: string; css: string } {
  const width = holderWidth === undefined ? "" : `; width: ${holderWidth}`;
  return {
    body: `<div id="holder" style="container-type: inline-size${width}"><div class="grid"><div style="height: 10px">a</div><div style="height: 10px">b</div></div></div>`,
    css: `.grid { display: grid; justify-content: start; grid-template-columns: 1fr; }
@container (width >= 400px) { .grid { grid-template-columns: 1fr 1fr; } }`,
  };
}

function twoViewports(
  widths: [number, number],
  content: (width: number) => { body: string; css: string },
): DreamDocument {
  const first = content(widths[0]);
  const second = content(widths[1]);
  const doc = makeDocument({ width: widths[0], height: 300 }, first.body, first.css);
  doc.items.push(
    makeDocument({ width: widths[1], height: 300 }, second.body, second.css, { id: "v2" })
      .items[0]!,
  );
  return doc;
}

describe("a correct conditional page lands", () => {
  test("single 900-wide viewport: a base the container branch overrides is live", async () => {
    const { body, css } = responsiveGrid();
    expect(await necessityLint(makeDocument({ width: 900, height: 300 }, body, css))).toEqual([]);
  });

  test("the branch never matching: the branch is dead, the base live", async () => {
    const { body, css } = responsiveGrid("300px");
    expect(await necessityLint(makeDocument({ width: 900, height: 300 }, body, css))).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        rule: 1,
        property: "grid-template-columns",
        message: `grid-template-columns: 1fr 1fr in rule \`.grid\` in \`@container (width >= 400px)\` of viewport v1 changes nothing at ${sweptAt(900)}`,
      },
    ]);
  });

  test("two viewports (360/900) of the same page: no findings", async () => {
    expect(await necessityLint(twoViewports([360, 900], () => responsiveGrid()))).toEqual([]);
  });

  test("a declaration dead in both viewports is one finding, named from the first", async () => {
    const box = () => ({ body: '<div id="box" style="position: static; height: 10px"></div>', css: "" });
    expect(await necessityLint(twoViewports([360, 900], box))).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        elementId: "#box",
        property: "position",
        message: `position: static on \`#box\` changes nothing at ${sweptAt(360)}`,
      },
    ]);
  });

  test("elements without ids correspond by their unique selector", async () => {
    // Dead in both → one finding; the branch dead at 360 but live at 900
    // → none.
    const dead = twoViewports([360, 900], () => ({
      body: '<div style="position: static; height: 10px"></div>',
      css: "",
    }));
    expect((await necessityLint(dead)).map((f) => f.elementId)).toEqual(["div"]);
    expect(await necessityLint(twoViewports([360, 900], () => responsiveGrid()))).toEqual([]);
  });

  test("same-looking siblings stay apart: each is its own selector, so one's live verdict never hides the other's", async () => {
    // Two `.item` siblings: the first dead in both viewports, the second
    // live in the second only.
    const doc = twoViewports([360, 900], (width) => ({
      body: `<div class="row"><div class="item" style="position: static; height: 10px"></div><div class="item" style="position: ${width === 360 ? "static" : "relative"}"></div></div>`,
      css: "",
    }));
    expect((await necessityLint(doc)).map((f) => f.elementId)).toEqual([
      "div.item:nth-of-type(1)",
    ]);
  });
});

describe("the width sweep (a page is not a photo)", () => {
  /** A body grid whose one column is `minmax(0, 1fr)` over a child that
   * cannot shrink below 500px. At 900 the auto column would be 900 wide
   * either way, so the line changes nothing THERE; at 360 the auto column
   * grows to the child's 500px min-content and `minmax(0, 1fr)` holds it
   * at 360 — the declaration exists for the width the frame is not at. */
  function boundedColumn(frame: { width: number; height?: number } | undefined): DreamDocument {
    return makeDocument(frame, '<main><div style="width: 500px; height: 10px"></div></main>', "", {
      bodyStyle: "margin: 0; display: grid; grid-template-columns: minmax(0, 1fr)",
    });
  }

  test("a declaration dead at the frame but live at a swept width is live", async () => {
    expect(await necessityLint(boundedColumn({ width: 900, height: 300 }))).toEqual([]);
  });

  test("the same declaration at a frame where it works is live without any probe", async () => {
    expect(await necessityLint(boundedColumn({ width: 360, height: 300 }))).toEqual([]);
  });

  test("a declaration dead at every swept width names them all", async () => {
    const findings = await necessityLint(
      makeDocument(
        { width: 768, height: 300 },
        '<div id="box"></div>',
        "#box { position: static; height: 10px; }\n@media (width <= 600px) { #box { height: 12px; } }",
      ),
    );
    expect(findings.map((f) => f.message)).toEqual([
      `position: static in rule \`#box\` of viewport v1 changes nothing at ${sweptAt(768, 600)}`,
    ]);
    expect(sweptAt(768, 600)).toBe("360, 599, 600, 601, 768, 1280 or 1920px");
  });

  test("a full-page viewport (no frame) sweeps as a full-page view", async () => {
    // 1024 wide by default; the finding names the default plus the sweep.
    expect(await necessityLint(boundedColumn(undefined))).toEqual([]);
    const dead = makeDocument(undefined, '<div id="box" style="position: static; height: 10px"></div>');
    expect((await necessityLint(dead)).map((f) => f.message)).toEqual([
      `position: static on \`#box\` changes nothing at ${sweptAt(1024)}`,
    ]);
  });

  test("probeWidths: the fixed sweep plus one px either side of every media breakpoint in the css, minus the frame", () => {
    const core = coreApi();
    expect(probeWidths(core, "", 400)).toEqual([360, 768, 1280, 1920]);
    expect(probeWidths(core, "", 768)).toEqual([360, 1280, 1920]);
    expect(
      probeWidths(
        core,
        `@media (width >= 900px) { .a { height: 1px } }
.b { @media (360px < width < 1280px) { height: 2px } }
@container (width >= 500px) { .c { height: 3px } }
@media (width >= 50em) { .d { height: 4px } }`,
        400,
      ),
    ).toEqual([359, 360, 361, 768, 799, 800, 801, 899, 900, 901, 1279, 1280, 1281, 1920]);
  });

  test("widthsText", () => {
    expect(widthsText([400])).toBe("400px");
    expect(widthsText([768, 360, 360])).toBe("360 or 768px");
    expect(widthsText([1920, 400, 360])).toBe("360, 400 or 1920px");
  });
});

describe("viewports and disposal", () => {
  test("viewportIds restricts the lint; an unknown id is an error", async () => {
    const doc = makeDocument(FRAME, '<div id="a" style="position: static; height: 10px"></div>');
    doc.items.push(
      makeDocument(FRAME, '<div id="b" style="position: static; height: 10px"></div>', "", {
        id: "other",
      }).items[0]!,
    );
    expect((await necessityLint(doc)).map((f) => f.elementId)).toEqual(["#a", "#b"]);
    const some = await necessityLint(doc, { viewportIds: ["other"] });
    expect(some.map((f) => f.elementId)).toEqual(["#b"]);
    await expect(necessityLint(doc, { viewportIds: ["nope"] })).rejects.toThrow(
      "No such viewport: nope",
    );
  });

  test("disposal leaves no iframe behind, findings or none", async () => {
    const clean = makeDocument(FRAME, '<div id="a" style="height: 10px"></div>');
    const dirty = makeDocument(FRAME, '<div id="b" style="position: static; height: 10px"></div>');
    expect(await necessityLint(clean)).toEqual([]);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(await necessityLint(dirty)).toHaveLength(1);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("cost", () => {
  test("a 40-element page: one finding per dead declaration, nothing else", async () => {
    // 40 boxes in a grid, each with three live declarations and one dead
    // (position: static) — 160 removals over 43 elements.
    const boxes = Array.from(
      { length: 40 },
      (_, i) =>
        `<div style="padding: 4px; background: rgb(${(i * 6) % 255}, 120, 120); min-height: 24px; position: static">box ${i}</div>`,
    ).join("");
    const doc = makeDocument(
      { width: 800, height: 600 },
      `<div id="grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px">${boxes}</div>`,
    );
    const findings = await necessityLint(doc);
    expect(findings).toHaveLength(40);
    expect(new Set(properties(findings))).toEqual(new Set(["position"]));
  });
});

describe("necessity on rules", () => {
  test("a rule's custom property nobody reads is dead, reported at the rule's index", async () => {
    const findings = await necessityLint(
      makeDocument(FRAME, '<div class="a">hi</div>', ".a { --unused: 1px; }"),
    );
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        rule: 0,
        property: "--unused",
        message: `--unused: 1px in rule \`.a\` of viewport v1 changes nothing at ${sweptAt(400)}`,
      },
    ]);
  });

  test("a rule after the legacy marker `<!--` is judged and named by its own selector, the marker no part of it", async () => {
    const findings = await necessityLint(
      makeDocument(FRAME, '<div class="a">hi</div>', "<!--\n.a { --unused: 1px; }\n-->"),
    );
    expect(findings.map((f) => f.message)).toEqual([
      `--unused: 1px in rule \`.a\` of viewport v1 changes nothing at ${sweptAt(400)}`,
    ]);
  });

  test("a pseudo-element rule's declaration is necessary when nothing else sets it: the baseline reads getComputedStyle(node, '::before') too", async () => {
    expect(
      await necessityLint(
        makeDocument(FRAME, '<div class="card"></div>', '.card::before { content: ""; color: red; }'),
      ),
    ).toEqual([]);
  });

  test("a pseudo-element declaration a later rule on the same pseudo-element always overrides is dead, reported at its own index", async () => {
    // Two unconditional .card::before rules at the same specificity: the
    // later one always wins, so removing rule 0's color changes nothing —
    // genuinely dead, and the finding is addressed at rule 0, never rule 1
    // (removing rule 1's would reveal rule 0's).
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div class="card"></div>',
        '.card::before { content: ""; color: red; }\n.card::before { color: blue; }',
      ),
    );
    expect(findings).toEqual([
      {
        tier: "necessity",
        severity: "blocking",
        rule: 0,
        property: "color",
        message: `color: red in rule \`.card::before\` of viewport v1 changes nothing at ${sweptAt(400)}`,
      },
    ]);
  });

  test("a rule's width that sizes its matched element is live", async () => {
    expect(
      await necessityLint(
        makeDocument(FRAME, '<div class="a" style="height: 20px"></div>', ".a { width: 120px; }"),
      ),
    ).toEqual([]);
  });

  test("a rule's declaration every matched element also shadows in its own style is judged WITH the shadow, so it is not falsely dead — that shape is the redundancy finding's", async () => {
    // Removed alone, the rule's declaration would read dead (the inline
    // copy keeps the element red); removed together with the element's
    // own shadowing declaration (the paired check), color really does
    // change — so the rule is alive, and the element's own line is the
    // redundancy finding's story (matchLint.ts), never necessity's.
    expect(
      await necessityLint(
        makeDocument(FRAME, '<div class="a" style="color: red">hi</div>', ".a { color: red; }"),
      ),
    ).toEqual([]);
  });

  test("a rule inside an @scope reaches its elements from the scope's root, so the ones shadowing it in their own style are judged with it", async () => {
    // `:scope > .a` asked of `.a` itself would match nothing, the rule's
    // color would be removed alone, and the element's own blue would keep
    // the page unchanged.
    expect(
      await necessityLint(
        makeDocument(
          FRAME,
          '<div class="card"><p class="a" style="color: blue">hi</p></div>',
          "@scope (.card) { :scope > .a { color: red; } }",
        ),
      ),
    ).toEqual([]);
  });

  test("@scope and @layer gate nothing by themselves: a dead declaration in either is found", async () => {
    const findings = await necessityLint(
      makeDocument(
        FRAME,
        '<div class="card"><p class="a">hi</p></div>',
        "@scope (.card) { :scope > .a { position: static; } }\n@layer base { .a { float: none; } }",
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([
      [0, "position"],
      [1, "float"],
    ]);
  });

  test("a rule under a state pseudo-class is never judged — in a rule, :hover belongs to the selector", async () => {
    expect(
      await necessityLint(makeDocument(FRAME, '<div class="a"></div>', ".a:hover { color: red; }")),
    ).toEqual([]);
  });

  test("a rule under an @media the frame is not at is judged where it applies: the sweep reaches its breakpoint", async () => {
    expect(
      await necessityLint(
        makeDocument(FRAME, '<div class="a">hi</div>', "@media (min-width: 2000px) { .a { color: red; } }"),
      ),
    ).toEqual([]);
  });

  test("rule verdicts intersect across viewports by selector and conditions, never by index — dead in one, live in the other, stays alive overall", async () => {
    const doc = makeDocument({ width: 360 }, '<div class="a"></div>', ".a { --unused: 1px; }");
    doc.items.push(
      makeDocument(
        { width: 1280 },
        '<div class="a" style="width: var(--unused); height: 10px"></div>',
        ".a { --unused: 1px; }",
        { id: "v2" },
      ).items[0]!,
    );
    // The first page's element reads nothing from --unused (dead there);
    // the second's `width: var(--unused)` does (live there). The SAME
    // rule is dead only where dead EVERYWHERE it exists, so the
    // intersection reports nothing.
    expect(await necessityLint(doc)).toEqual([]);
  });

  test("the same rule's declaration dead in every viewport it exists in is reported once", async () => {
    const doc = makeDocument({ width: 360 }, '<div class="a"></div>', ".a { --unused: 1px; }");
    doc.items.push(
      makeDocument({ width: 1280 }, '<div class="a"></div>', ".a { --unused: 1px; }", { id: "v2" })
        .items[0]!,
    );
    expect(properties(await necessityLint(doc))).toEqual(["--unused"]);
  });
});
