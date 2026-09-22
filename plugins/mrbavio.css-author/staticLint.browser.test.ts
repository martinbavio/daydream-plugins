// The static lint against pages (docs/agent-css-knowledge-prd.md,
// "Testing Decisions", seam 3): a document goes in, findings come out, and
// every assertion is on the findings' shape and words. Real Chromium: the
// lint parses a page's markup with the browser's own parser (decision
// #76), and reads a `font` shorthand through the CSSOM. The rule-level
// checks alone are proved under node too (staticLint.rules.test.ts); a
// container query with no container moved to matchLint.browser.test.ts,
// since a page's query lives in a rule whose elements only a match finds.
import { describe, expect, test } from "vitest";

import type { DreamDocument, Finding } from "@daydream/plugin-api";
import { coreApi, createPageItem } from "@daydream/plugin-testing";

import { staticLint as lintWith } from "./staticLint";

const staticLint = (document: DreamDocument): Finding[] =>
  lintWith(coreApi(), document);

/** One page, id `v1`, 960 wide: the body's markup and the css. */
function page(body: string, css = "", html = ""): DreamDocument {
  return {
    version: 7,
    items: [
      createPageItem(
        {
          html: `<!doctype html><html${html}><head><title>t</title></head><body>${body}</body></html>`,
          css,
        },
        { id: "v1", frame: { width: 960 } },
      ),
    ],
  };
}

/** One element, `#box`, with the given own style. */
function box(style: string, tag = "div"): DreamDocument {
  return page(`<${tag} id="box" style="${style}"></${tag}>`);
}

describe("staticLint: unit-less lengths (rule 1)", () => {
  test("a bare number on a length property in an element's own style is a finding, the element named by its unique selector", () => {
    expect(staticLint(box("width: 100"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "#box",
        property: "width",
        message:
          "width: 100 on `#box` has no unit; a length needs one (px, rem, %, …)",
      },
    ]);
  });

  test("every bare number in a multi-value length is caught once per declaration", () => {
    const findings = staticLint(box("margin: 10 20; padding: 0 16px; gap: 20"));
    expect(findings.map((f) => f.property)).toEqual(["margin", "gap"]);
  });

  test("unitless zero is a valid length", () => {
    expect(
      staticLint(
        box(
          "margin: 0; padding: 0 0; top: 0; inset: 0; flex-basis: 0; width: 0.0; letter-spacing: -0",
        ),
      ),
    ).toEqual([]);
  });

  test("valued lengths, keywords and functions pass", () => {
    expect(
      staticLint(
        box(
          "width: 100%; height: 50vh; min-width: min-content; max-width: fit-content; margin: 0 auto; padding: 1rem 2em; gap: clamp(8px, 2vw, 24px); translate: 10px 20px; font-size: 1.25rem; inset: var(--inset); border-radius: 50%; flex-basis: content",
        ),
      ),
    ).toEqual([]);
  });

  test("numbers inside functions are multipliers, not lengths", () => {
    expect(
      staticLint(
        box("width: calc(100 * 1px); gap: min(10, 2px); margin: calc(2 * var(--space))"),
      ),
    ).toEqual([]);
  });

  test("properties that take unitless numbers are never flagged", () => {
    expect(
      staticLint(
        box(
          "line-height: 1.5; opacity: 0.5; z-index: 10; order: 2; flex: 1; flex-grow: 1; flex-shrink: 0; font-weight: 600; zoom: 2; aspect-ratio: 16 / 9; grid-column: 1 / 3; grid-row: 2; grid-column-start: 1; columns: 3; column-count: 2; tab-size: 4; stroke-width: 2; animation-iteration-count: 3",
        ),
      ),
    ).toEqual([]);
  });

  test("a bare number in a rule under a condition is a finding at that rule, named with its condition", () => {
    const doc = page(
      '<div id="box"></div>',
      "#box { gap: 8px; }\n@media (width >= 600px) { #box { gap: 24 } }",
    );
    expect(staticLint(doc)).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 1,
        property: "gap",
        message:
          "gap: 24 in rule `#box` in `@media (width >= 600px)` of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      },
    ]);
  });

  test("the logical and physical length families are covered", () => {
    const findings = staticLint(
      box(
        "inline-size: 300; margin-inline: 8; padding-block-start: 4; inset-inline-end: 12; border-top-width: 2; border-top-left-radius: 6; row-gap: 8; column-gap: 8; min-height: 200; max-inline-size: 800; text-indent: 16; word-spacing: 2",
      ),
    );
    expect(findings.map((f) => f.property)).toEqual([
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

describe("staticLint: restated initial values (rule 2)", () => {
  test("an initial value in an element's own style is a finding", () => {
    expect(staticLint(box("position: static"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "#box",
        property: "position",
        message: "position: static on `#box` restates the initial value",
      },
    ]);
  });

  test("representative initials across the table are findings", () => {
    const findings = staticLint(
      box(
        "float: none; inset: auto; flex-shrink: 1; flex-basis: auto; opacity: 1; transform: none; max-width: none; min-height: auto; overflow: visible; box-shadow: none",
      ),
    );
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
    expect(
      staticLint(
        box(
          "position: relative; flex-shrink: 0; flex-grow: 1; opacity: 0.5; max-width: 60ch; min-width: 0; overflow: hidden; z-index: 1",
        ),
      ),
    ).toEqual([]);
  });

  test("value comparison ignores case and surrounding whitespace", () => {
    expect(staticLint(box("position:  Static ; float: NONE"))).toHaveLength(2);
  });

  test("a rule under a condition resetting to the initial value is a legitimate override", () => {
    const doc = page(
      '<div id="box" style="position: absolute"></div>',
      "@media (width >= 600px) { #box { position: static; max-width: none } }",
    );
    expect(staticLint(doc)).toEqual([]);
  });

  test("properties the UA sheet sets on a tag are skipped for that tag", () => {
    // Chrome's UA sheet gives img and hr an overflow, so restating the
    // initial there is a real reset.
    expect(staticLint(box("overflow: visible", "img"))).toEqual([]);
    expect(staticLint(box("overflow: visible", "hr"))).toEqual([]);
    // The same tags still get the properties the UA leaves alone.
    expect(staticLint(box("position: static", "img"))).toHaveLength(1);
  });

  // Every pair below is a claim about Chromium's html.css (decision #57's
  // audit): none of the table's properties is set on any of these tags,
  // so each is held to the whole table. Each tag sits in the parent the
  // HTML parser keeps it in.
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

  /** `tag` carrying `style`, inside the parent the parser keeps it in. */
  function placed(tag: string, style: string): string {
    const own = `<${tag} style="${style}">${tag === "wbr" || tag === "col" ? "" : `</${tag}>`}`;
    if (["caption", "colgroup", "thead", "tbody", "tfoot"].includes(tag)) {
      return `<table>${own}</table>`;
    }
    if (tag === "col") return `<table><colgroup>${own}</colgroup></table>`;
    if (tag === "tr") return `<table><tbody>${own}</tbody></table>`;
    if (tag === "td" || tag === "th") return `<table><tbody><tr>${own}</tr></tbody></table>`;
    if (tag === "dt" || tag === "dd") return `<dl>${own}</dl>`;
    if (tag === "rt" || tag === "rp") return `<ruby>a${own}</ruby>`;
    return own;
  }

  test("the UA sheet leaves every table property alone on every new tag: restating one there is still redundant", () => {
    for (const tag of NEW_TAGS) {
      for (const [property, value] of TABLE) {
        const findings = staticLint(page(placed(tag, `${property}: ${value}`)));
        expect(
          findings.map((f) => f.property),
          `${tag} ${property}`,
        ).toEqual([property]);
      }
    }
  });

  test("inherited properties are never in the table: a reset under an ancestor is real", () => {
    const doc = page(
      '<div style="letter-spacing: 0.1em; text-transform: uppercase; visibility: hidden"><div style="letter-spacing: normal; text-transform: none; visibility: visible"></div></div>',
    );
    expect(staticLint(doc)).toEqual([]);
    // And without any ancestor either — the text cannot tell the two apart.
    expect(staticLint(box("letter-spacing: normal"))).toEqual([]);
  });

  test("outline-offset is deliberately not in the table", () => {
    expect(staticLint(box("outline-offset: 0"))).toEqual([]);
  });

  test("an !important initial in an element's own style is there to win, and is not judged", () => {
    expect(staticLint(box("position: static !important"))).toEqual([]);
  });
});

describe("staticLint: whole document", () => {
  test("a clean page has no findings, and an empty canvas is clean", () => {
    const clean = page(
      '<main class="grid"><div style="padding: 24px"></div><div style="min-width: 0"></div></main>',
      "body { margin: 0; }\n.grid { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; }",
    );
    expect(staticLint(clean)).toEqual([]);
    expect(staticLint({ version: 7, items: [] })).toEqual([]);
  });

  test("findings come in tree order, one element's together, then the rules'", () => {
    const doc = page(
      '<div id="outer" style="position: static; gap: 8"><div id="inner" style="width: 100"></div></div>',
      "#outer { top: 5; }",
    );
    expect(
      staticLint(doc).map((f) => [f.elementId ?? f.rule, f.property]),
    ).toEqual([
      ["#outer", "gap"],
      ["#outer", "position"],
      ["#inner", "width"],
      [0, "top"],
    ]);
  });

  test("an element without an id is named by the shortest path that is unique in its page", () => {
    const doc = page(
      '<section class="a"><p style="width: 10"></p><p></p></section>',
      ".a {}",
    );
    expect(staticLint(doc).map((f) => f.elementId)).toEqual([
      "p:nth-of-type(1)",
    ]);
  });

  test("a page with no doctype is read in standards mode, as it renders: a class differing only in case is another class", () => {
    // In quirks mode `div.a` would match both, and the name would need an
    // index the canvas and an agent's selector do not.
    const doc: DreamDocument = {
      version: 7,
      items: [
        createPageItem(
          {
            html: '<html><head></head><body><div class="a" style="width: 10"></div><div class="A"></div></body></html>',
            css: ".a {}\n.A {}",
          },
          { id: "v1", frame: { width: 960 } },
        ),
      ],
    };
    expect(staticLint(doc).map((f) => f.elementId)).toEqual(["div.a"]);
  });

  test("a `<style>` block the markup still carries is read with the css, after it, as the renderer folds it", () => {
    const doc = page('<div class="late"></div><style>.late { width: 100 }</style>');
    expect(staticLint(doc).map((f) => [f.rule, f.property])).toEqual([[0, "width"]]);
  });
});

describe("staticLint: a @font-face nothing names (rule 3)", () => {
  const FACE = (family: string): string =>
    `@font-face { font-family: ${family}; src: url(assets/gen-1.woff2); }\n`;

  test("a face named by the root's font-family is fine, case-insensitively", () => {
    expect(
      staticLint(page("", `${FACE("Montserrat")}html { font-family: montserrat, system-ui, sans-serif; }`)),
    ).toEqual([]);
  });

  test("a face named only inside a conditional rule, or by a quoted name, is fine", () => {
    expect(
      staticLint(
        page("", `${FACE('"Noto Serif"')}@media (width < 600px) { body { font-family: "Noto Serif", serif; } }`),
      ),
    ).toEqual([]);
  });

  test("the font shorthand counts — the browser reads its family list — in an element's own style too", () => {
    expect(
      staticLint(
        page('<p style="font: 400 1rem/1.4 Montserrat, sans-serif"></p>', FACE("Montserrat")),
      ),
    ).toEqual([]);
  });

  test("the shorthand's family list is the browser's reading, not a substring: a face whose name sits inside another family's is still unused", () => {
    expect(
      staticLint(page("", `${FACE("Mont")}p { font: 12px Montserrat, sans-serif; }`)).map(
        (f) => f.message,
      ),
    ).toEqual([
      "@font-face Mont in viewport v1 is named by no font-family in the page — remove the face or use it",
    ]);
  });

  test("a shorthand the browser cannot read (a var() in it) counts generously, by its text", () => {
    expect(
      staticLint(page("", `${FACE("Montserrat")}p { font: var(--size) Montserrat; }`)),
    ).toEqual([]);
  });

  test("a face reached through a custom property is fine", () => {
    expect(
      staticLint(
        page(
          "",
          `${FACE('"Noto Serif"')}html { --stack: "Noto Serif", serif; }\nbody { font-family: var(--stack); }`,
        ),
      ),
    ).toEqual([]);
  });

  test("a face nothing names is one static finding on the page's root", () => {
    expect(
      staticLint(
        page("", `${FACE("Montserrat")}${FACE('"Noto Serif"')}html { font-family: Montserrat, sans-serif; }`),
      ),
    ).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "html",
        message:
          "@font-face Noto Serif in viewport v1 is named by no font-family in the page — remove the face or use it",
      },
    ]);
  });

  test("a face named only by a rule's font-family is fine", () => {
    expect(
      staticLint(page("", `${FACE("Montserrat")}h1 { font-family: Montserrat, sans-serif; }`)),
    ).toEqual([]);
  });
});

describe("staticLint: rule-level findings", () => {
  test("a unit-less length in a rule is a finding at the rule's index", () => {
    expect(staticLint(page("", ".card { width: 100; }"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "width",
        message:
          "width: 100 in rule `.card` of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      },
    ]);
  });

  test("a restated initial in a rule is a finding at the rule's index", () => {
    expect(staticLint(page("", ".card { position: static; }"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "position",
        message:
          "position: static in rule `.card` of viewport v1 restates the initial value",
      },
    ]);
  });

  test("a rule typed to img is excused overflow: visible, the same exception an element gets", () => {
    expect(staticLint(page("", "img.hero { overflow: visible; }"))).toEqual([]);
  });
});

describe("staticLint: a class no rule names (rule 4)", () => {
  test("a class no rule names is a finding on its element; a named one, and an empty class, are not", () => {
    const doc = page(
      '<div class="card"></div><div class="card featured"></div><div class=""></div>',
      ".card { padding: 16px; }",
    );
    expect(staticLint(doc)).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "div.card.featured",
        message:
          'class "featured" on `div.card.featured` in viewport v1 is named by no rule; drop it, or write the rule that uses it',
      },
    ]);
  });

  test("with no css at all every class is unreferenced", () => {
    const doc = page('<div id="a" class="a"></div><div id="b" class="b c"></div>');
    expect(staticLint(doc).map((f) => f.elementId)).toEqual(["#a", "#b", "#b"]);
  });

  test("an element only a substring form reaches is not refused", () => {
    expect(
      staticLint(page('<i class="i-home"></i>', '[class*="i-"] { color: red; }')),
    ).toEqual([]);
  });

  test("a nested rule's `&.open` and an @scope prelude name their classes too", () => {
    expect(
      staticLint(
        page(
          '<div class="card open"><h2 class="title"></h2></div>',
          ".card { &.open { color: red } }\n@scope (.title) { :scope { color: blue } }",
        ),
      ),
    ).toEqual([]);
  });

  test("classes on the skeleton and inside an svg are judged like any element's", () => {
    const doc = page(
      '<svg class="icon"><path class="stroke" d="M0 0"/></svg>',
      ".icon { width: 1rem; }",
      ' class="theme"',
    );
    expect(staticLint(doc).map((f) => f.message.split(" on ")[0])).toEqual([
      'class "theme"',
      'class "stroke"',
    ]);
  });
});
