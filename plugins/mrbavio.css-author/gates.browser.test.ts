// The plugin's browser part through the API (decision #48 P9): the
// two gates it registers, each finding at the severity the plugin
// declares — blocking — and each judging on its own: what the two say of
// ONE declaration is the runner's to fold (src/ai/gates.ts dropCovered,
// tested in src/ai/gates.test.ts). Real Chromium: both gates read the
// page through the browser, and the necessity gate mounts it.
import { afterAll, describe, expect, test } from "vitest";

import type {
  DreamDocument,
  Finding,
  GateRegistration,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  createTestKernel,
  documentFrom,
  flush,
  fixturePage,
  pageFixtureDocument,
} from "@daydream/plugin-testing";

import activate, { NECESSITY_GATE, STATIC_GATE } from "./index";

/** What the real manifest declares of gates (the manifests test pins the
 * file itself; a JSON import needs a compiler flag the plugins do not
 * assume). */
const manifest: PluginManifest = {
  id: "mrbavio.css-author",
  name: "CSS author",
  version: "0.1.0",
  minCore: "0.1.0",
  contributes: { gates: [STATIC_GATE, NECESSITY_GATE] },
};

const kernel = createTestKernel({ manifest });
afterAll(() => kernel.dispose());

function gates(): Map<string, GateRegistration> {
  return new Map(
    kernel.registry.gates.entries().map((e) => [e.value.id, e.value]),
  );
}

async function judge(id: string, doc: DreamDocument): Promise<Finding[]> {
  const gate = gates().get(id);
  if (gate === undefined) throw new Error(`no gate ${id}`);
  return gate.run(doc, { measure: kernel.dd.measure });
}

describe("css-author gates", () => {
  test("activation registers the two declared gates, static first", () => {
    activate(kernel.dd);
    flush(); // the registry is a signal; a registration lands on the next flush
    expect(
      kernel.registry.gates.entries().map((e) => [e.pluginId, e.value.id]),
    ).toEqual([
      ["mrbavio.css-author", STATIC_GATE],
      ["mrbavio.css-author", NECESSITY_GATE],
    ]);
  });

  test("a clean page passes both", async () => {
    const doc = pageFixtureDocument();
    expect(await judge(STATIC_GATE, doc)).toEqual([]);
    expect(await judge(NECESSITY_GATE, doc)).toEqual([]);
  });

  test("every finding is blocking, tier-named, addressed to an element; the necessity gate reports a dropped declaration too — the runner, not the gate, keeps it to one line", async () => {
    const doc = pageFixtureDocument();
    const page = fixturePage(doc);
    page.payload.html = page.payload.html
      // static rule 1 — and dead in the page; static rule 2 — and dead
      .replace('<div class="grid">', '<div class="grid" style="width: 100; position: static">')
      // static rule 2
      .replace('<div class="header">', '<div class="header" style="float: none">')
      // dead, nothing static
      .replace('<div class="aside">', '<div class="aside" style="--unused: 1px">');

    const statics = await judge(STATIC_GATE, doc);
    expect(statics.map((f) => [f.tier, f.severity, f.elementId, f.property])).toEqual([
      ["static", "blocking", "div.grid", "width"],
      ["static", "blocking", "div.grid", "position"],
      ["static", "blocking", "div.header", "float"],
    ]);

    const necessity = await judge(NECESSITY_GATE, doc);
    // A declaration the parser dropped (width) or that restates the
    // initial value (position, float) changes nothing without it, so the
    // necessity gate names it as well as the static gate does: the gate
    // knows nothing of the other, and the runner drops the symptom once it
    // knows both findings' effective severity — the two address the same
    // declaration (elementId and property). The unread custom property is
    // the necessity gate's alone.
    expect(necessity.map((f) => [f.tier, f.severity, f.elementId, f.property])).toEqual([
      ["necessity", "blocking", "div.grid", "width"],
      ["necessity", "blocking", "div.grid", "position"],
      ["necessity", "blocking", "div.header", "float"],
      ["necessity", "blocking", "div.aside", "--unused"],
    ]);
    expect(necessity.at(-1)!.message).toMatch(
      /^--unused: 1px on `div\.aside` changes nothing at /,
    );
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  test("a rule's declaration both gates judge is addressed the same way by both: the rule's index and the property", async () => {
    const doc = pageFixtureDocument();
    fixturePage(doc).payload.css += ".footer { position: static; }\n";
    const statics = await judge(STATIC_GATE, doc);
    const necessity = await judge(NECESSITY_GATE, doc);
    expect(statics.map((f) => [f.rule, f.property])).toEqual([[5, "position"]]);
    expect(necessity.map((f) => [f.rule, f.property])).toEqual([[5, "position"]]);
  });

  // The eval regression (2026-09-17 raw eval jsonl): the static gate,
  // through the real registration `activate` installed above, judging a
  // document straight from `documentFrom` — never loaded into the app
  // store, never rendered on the canvas, exactly how `src/ai/requests.ts`
  // hands a gate an incoming ingest/replace_viewport document. A `.card`
  // rule whose element is plainly in the page must not be refused as
  // dead just because nothing was ever on the canvas to read a match
  // fact from (matchLint.ts's header).
  test("the static gate does not refuse a landing whose rules match elements that were never on the canvas", async () => {
    const result = documentFrom({
      version: 7,
      items: [
        {
          kind: "daydream.viewport",
          frame: { width: 960, height: 600 },
          payload: {
            html: '<!doctype html><html><body><div class="card"></div></body></html>',
            css: ".card { color: red; }",
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    expect(await judge(STATIC_GATE, result.doc)).toEqual([]);
  });
});

// The CSS the review of the format-7 port found refused, through both
// gates and so all three lints (static, match, necessity): an @scope
// rule, @starting-style, @media print, a height query and the legacy
// `<!--` markers.
describe("css-author gates on at-rules and markers", () => {
  /** One 800 × 600 page: a `.card` holding a paragraph, and the css. */
  function cardPage(css: string): DreamDocument {
    const result = documentFrom({
      version: 7,
      items: [
        {
          id: "v1",
          kind: "daydream.viewport",
          frame: { width: 800, height: 600 },
          payload: {
            html: '<!doctype html><html><body style="margin: 0"><div class="card"><span>a</span><p>b</p></div></body></html>',
            css,
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    return result.doc;
  }

  const addressed = (findings: Finding[]) =>
    findings.map((f) => [f.rule, f.property]);

  test("a page that uses them correctly passes both gates", async () => {
    const doc = cardPage(`<!--
.card { padding: 16px; transition: opacity 0.2s; }
-->
@scope (.card) { :scope > span { display: block; } p { margin: 0; } }
@starting-style { .card { opacity: 0; } }
@media print { .card { padding: 0; } }
@media (min-height: 2000px) { .card { padding: 32px; } }`);
    expect(await judge(STATIC_GATE, doc)).toEqual([]);
    expect(await judge(NECESSITY_GATE, doc)).toEqual([]);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  test("a preference query and a height query are judged the same way by both gates: a rule under one is judged exactly where the mounted window's matchMedia holds it", async () => {
    // `.none` matches nothing, so each rule the static gate judges is a
    // dead rule and each the necessity gate judges a dead declaration.
    const conditions = [
      "(prefers-color-scheme: dark)",
      "(prefers-color-scheme: light)",
      "(max-height: 1000px)",
      "(min-height: 2000px)",
    ];
    const doc = cardPage(
      conditions
        .map((condition) => `@media ${condition} { .none { color: red; } }`)
        .join("\n"),
    );
    const judged = (findings: Finding[]) =>
      findings.flatMap((f) => (f.rule === undefined ? [] : [f.rule]));
    const statics = judged(await judge(STATIC_GATE, doc));
    expect(judged(await judge(NECESSITY_GATE, doc))).toEqual(statics);
    // One colour scheme holds, whichever the browser prefers; the height
    // the 600px frame meets holds, and the one it does not never does.
    expect(statics.filter((rule) => rule < 2)).toHaveLength(1);
    expect(statics.filter((rule) => rule >= 2)).toEqual([2]);
  });

  test("inside them each lint still judges what applies: a unit-less length, a scoped rule matching nothing, a dead declaration under a height the frame meets", async () => {
    const doc = cardPage(`<!-- .card { padding: 16px; } -->
@scope (.card) { p { margin: 4; } :scope > .none { color: red; } }
@starting-style { .card { opacity: 0; } }
@media print { .card { position: static; } }
@media (max-height: 1000px) { .card { position: static; } }`);
    const statics = await judge(STATIC_GATE, doc);
    expect(statics.map((f) => f.message)).toEqual([
      "margin: 4 in rule `p` in `@scope (.card)` of viewport v1 has no unit; a length needs one (px, rem, %, …)",
      "rule `:scope > .none` in `@scope (.card)` in viewport v1 matches no element",
    ]);
    expect(addressed(await judge(NECESSITY_GATE, doc))).toEqual([
      [1, "margin"],
      [2, "color"],
      [5, "position"],
    ]);
  });
});

// An explicit initial value (the static gate's rule 2) is measured, not
// looked up: where Chromium's UA sheet (html.css) sets the property on an
// element, restating the initial there is an override the page needs,
// and removing it changes what the element computes. Format 7 admits any
// element HTML has, so each pair below is a claim about that sheet,
// checked against Chromium.
describe("the static gate on an explicit initial value the UA sheet overrides", () => {
  /** One 800 × 600 page holding `body`, no css. */
  function bodyPage(body: string): DreamDocument {
    const result = documentFrom({
      version: 7,
      items: [
        {
          id: "v1",
          kind: "daydream.viewport",
          frame: { width: 800, height: 600 },
          payload: {
            html: `<!doctype html><html><body>${body}</body></html>`,
            css: "",
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    return result.doc;
  }

  // [the element, `%` its own style; a restated initial the UA overrides]
  const NEEDED: [string, string][] = [
    // dialog { position: absolute; inset-inline-start: 0; inset-inline-end: 0 }
    ['<dialog open style="%">x</dialog>', "position: static"],
    ['<dialog open style="%">x</dialog>', "left: auto"],
    ['<dialog open style="%">x</dialog>', "right: auto"],
    ['<dialog open style="%">x</dialog>', "inset: auto"],
    ['<dialog style="%">x</dialog>', "position: static"],
    // [popover] { position: fixed; inset: 0; overflow: auto }, open or not
    ['<div popover style="%">x</div>', "position: static"],
    ['<div popover style="%">x</div>', "inset: auto"],
    ['<div popover style="%">x</div>', "top: auto"],
    ['<div popover style="%">x</div>', "bottom: auto"],
    ['<div popover style="%">x</div>', "overflow: visible"],
    ['<dialog popover style="%">x</dialog>', "top: auto"],
    // fieldset { min-inline-size: min-content }
    ['<fieldset style="%"><legend>l</legend></fieldset>', "min-width: auto"],
    // select's options have a minimum block and inline size
    ['<select><option style="%">a</option></select>', "min-width: auto"],
    ['<select><option style="%">a</option></select>', "min-height: auto"],
    // a list box scrolls; replaced content and a rule clip
    ['<select multiple style="%"><option>a</option></select>', "overflow: visible"],
    ['<img style="%" alt="">', "overflow: visible"],
    ['<video style="%"></video>', "overflow: visible"],
    ['<video controls style="%"></video>', "overflow: visible"],
    ['<canvas style="%"></canvas>', "overflow: visible"],
    ['<svg style="%"></svg>', "overflow: visible"],
    ['<hr style="%">', "overflow: visible"],
  ];

  // The rest the review of format 7 named, where Chromium sets none of the
  // table: restating an initial there is still redundant.
  const LEFT_ALONE = [
    '<details open style="%"><summary>s</summary>b</details>',
    '<details><summary style="%">s</summary>b</details>',
    '<fieldset><legend style="%">l</legend></fieldset>',
    '<meter style="%" value="0.5"></meter>',
    '<progress style="%" value="0.5"></progress>',
    '<select style="%"><option>a</option></select>',
    '<input type="text" style="%">',
    '<input type="checkbox" style="%">',
    '<input type="range" style="%">',
    '<input type="file" style="%">',
    '<input type="date" style="%">',
    '<textarea style="%"></textarea>',
    '<button style="%">b</button>',
    '<iframe style="%"></iframe>',
    '<audio controls style="%"></audio>',
    '<marquee style="%">x</marquee>',
  ];

  test("restating the initial where the UA sets another value is no finding", async () => {
    const refused: string[] = [];
    for (const [markup, style] of NEEDED) {
      const body = markup.replace("%", style);
      const findings = await judge(STATIC_GATE, bodyPage(body));
      refused.push(...findings.map((f) => `${body}: ${f.message}`));
    }
    expect(refused).toEqual([]);
  });

  test("on the same elements, a property the UA leaves alone is still a finding", async () => {
    for (const markup of new Set(NEEDED.map(([m]) => m))) {
      const findings = await judge(
        STATIC_GATE,
        bodyPage(markup.replace("%", "float: none")),
      );
      expect(findings.map((f) => f.property), markup).toEqual(["float"]);
    }
  });

  test("where the UA sets none of the table, a restated initial is still a finding", async () => {
    for (const markup of LEFT_ALONE) {
      const findings = await judge(
        STATIC_GATE,
        bodyPage(markup.replace("%", "position: static; overflow: visible")),
      );
      expect(findings.map((f) => f.property), markup).toEqual([
        "position",
        "overflow",
      ]);
    }
  });
});
