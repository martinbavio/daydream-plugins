// The plugin's browser part through the API (decision #48 P9): the
// two gates it registers, each finding at the severity the plugin
// declares — blocking — and each judging on its own: what the two say of
// ONE declaration is the runner's to fold (src/ai/gates.ts dropCovered,
// tested in src/ai/gates.test.ts). Real Chromium: both gates read the
// page through the browser, and the necessity gate mounts it. A gate runs
// over the open project (decision #78), so each judgement opens its
// project and hands the gate its pages as the runner's context does.
import { afterAll, describe, expect, test } from "vitest";

import type {
  DreamViewport,
  Finding,
  GateRegistration,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  flush,
  pageFixtureProject,
  testProject,
  type TestProject,
} from "@daydream/plugin-testing";

import activate, { NECESSITY_GATE, STATIC_GATE } from "./index";
import { pagesOf } from "./testPages.test-support";

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

async function judge(id: string, project: TestProject): Promise<Finding[]> {
  const gate = gates().get(id);
  if (gate === undefined) throw new Error(`no gate ${id}`);
  kernel.store.loadProject(project);
  return gate.run(project.document, {
    measure: kernel.dd.measure,
    page: pagesOf(project),
  });
}

/** The fixture project's one page (PAGE_FIXTURE_HTML, its one sheet
 * PAGE_FIXTURE_CSS), for a test to change before it judges. */
function fixture(): { project: TestProject; page: TestProject["pages"][number] } {
  const project = pageFixtureProject();
  return { project, page: project.pages[0]! };
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
    const { project } = fixture();
    expect(await judge(STATIC_GATE, project)).toEqual([]);
    expect(await judge(NECESSITY_GATE, project)).toEqual([]);
  });

  test("every finding is blocking, tier-named, addressed to an element; the necessity gate reports a dropped declaration too — the runner, not the gate, keeps it to one line", async () => {
    const { project: doc, page } = fixture();
    page.html = page.html
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
    const { project: doc, page } = fixture();
    page.sheets[0]!.text += ".footer { position: static; }\n";
    const statics = await judge(STATIC_GATE, doc);
    const necessity = await judge(NECESSITY_GATE, doc);
    expect(statics.map((f) => [f.rule, f.property])).toEqual([[5, "position"]]);
    expect(necessity.map((f) => [f.rule, f.property])).toEqual([[5, "position"]]);
  });

  test("a stray `;` that drops a rule is one static finding naming its sheet, and the rule it drops is judged by neither gate", async () => {
    const { project: doc, page } = fixture();
    page.sheets[0]!.text = page.sheets[0]!.text.replace(".aside {", "; .aside {");
    const sheet = page.path.replace(/\.html$/, ".css");
    const statics = await judge(STATIC_GATE, doc);
    expect(statics).toEqual([
      {
        tier: "static",
        severity: "blocking",
        message: `the stray \`;\` before \`.aside\` on line 4 of \`${sheet}\` makes the browser drop the rule \`.aside\`; remove it`,
      },
    ]);
    expect(await judge(NECESSITY_GATE, doc)).toEqual([]);
  });

  test("a stray `;` in a read-only sheet is no finding", async () => {
    const { project: doc, page } = fixture();
    page.sheets[0]!.text = page.sheets[0]!.text.replace(".aside {", "; .aside {");
    page.sheets[0]!.readOnly = true;
    expect(await judge(STATIC_GATE, doc)).toEqual([]);
  });

  test("on a page of several sheets, both gates number a rule the same way: among the rules of every sheet before it", async () => {
    const { project: doc, page } = fixture();
    const block = "body { color: #111111; }";
    page.html = page.html.replace("</head>", `<style>${block}</style></head>`);
    page.sheets.unshift({ source: { style: 0 }, text: block, readOnly: false });
    page.sheets[1]!.text += ".footer { position: static; }\n";
    const statics = await judge(STATIC_GATE, doc);
    const necessity = await judge(NECESSITY_GATE, doc);
    expect(statics.map((f) => [f.rule, f.property])).toEqual([[6, "position"]]);
    expect(necessity.map((f) => [f.rule, f.property])).toEqual([[6, "position"]]);
  });

  // The eval regression (2026-09-17 raw eval jsonl): the static gate,
  // through the real registration `activate` installed above, judging a
  // page no canvas renders — nothing is rendered here. A `.card` rule
  // whose element is plainly in the page must not be refused as dead just
  // because nothing was on the canvas to read a match fact from
  // (matchLint.ts's header).
  test("the static gate does not refuse a rule matching elements no canvas rendered", async () => {
    const project = testProject([
      createPageItem(
        {
          html: '<!doctype html><html><body><div class="card"></div></body></html>',
          css: ".card { color: red; }",
        },
        { frame: { width: 960, height: 600 } },
      ),
    ]);
    expect(await judge(STATIC_GATE, project)).toEqual([]);
  });
});

// The CSS the review of the format-7 port found refused, through both
// gates and so all three lints (static, match, necessity): an @scope
// rule, @starting-style, @media print, a height query and the legacy
// `<!--` markers.
describe("css-author gates on at-rules and markers", () => {
  /** One 800 × 600 page: a `.card` holding a paragraph, and the css. */
  function cardPage(css: string): TestProject {
    return testProject([
      createPageItem(
        {
          html: '<!doctype html><html><body style="margin: 0"><div class="card"><span>a</span><p>b</p></div></body></html>',
          css,
        },
        { id: "v1", frame: { width: 800, height: 600 } },
      ),
    ]);
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
      "margin: 4 in rule `p` in `@scope (.card)` of `v1.css` has no unit; a length needs one (px, rem, %, …)",
      "rule `:scope > .none` in `@scope (.card)` of `v1.css` in viewport v1 matches no element",
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
  function bodyPage(body: string): TestProject {
    return testProject([
      createPageItem(
        { html: `<!doctype html><html><body>${body}</body></html>` },
        { id: "v1", frame: { width: 800, height: 600 } },
      ),
    ]);
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

// A gate at a `draft_finalize` (kernel src/ai/draftFinalize.ts): the
// document is the one viewport of the page about to be written, and
// `ctx.page` answers that page for its path and the store's for the rest.
// A lint's mount shows the store's page (`dd.mountViewport`), so the two
// mounting lints judge only a page the store holds as handed in, and say
// of the other that they did not (pageMount.ts `mountable`); the texts'
// own lint judges the page handed in. Until the kernel mounts the page a
// gate is handed.
describe("css-author gates over a page the project does not hold yet", () => {
  const HTML =
    '<!doctype html><html><head><title>t</title></head><body><div class="a">x</div></body></html>';

  /** The gates as a finalize runs them: `project` in the store, and the
   * candidate page `candidate` answering for `path`. */
  async function finalizing(
    id: string,
    project: TestProject,
    path: string,
    candidate: TestProject["pages"][number],
  ): Promise<Finding[]> {
    const gate = gates().get(id)!;
    kernel.store.loadProject(project);
    const viewport = project.document.canvases[0]!.items[0]! as DreamViewport;
    return gate.run(
      {
        version: 8,
        pages: [{ path }],
        canvases: [
          {
            id: "finalize",
            name: "First Canvas",
            items: [{ ...viewport, payload: { ...viewport.payload, page: path } }],
          },
        ],
      },
      {
        measure: kernel.dd.measure,
        page: (p) => (p === path ? { ...candidate, path } : kernel.dd.page(p)),
      },
    );
  }

  function unread(viewport: string, path: string, lint: string): string {
    return `viewport ${viewport} shows a version of ${path} the project does not hold yet, and a lint can mount only the project's own, so the ${lint} did not judge it; \`lint\` judges it once it is written`;
  }

  test("a new page is not refused: each mounting lint says it did not read it, and throws nothing", async () => {
    const project = testProject([
      createPageItem({ html: HTML, css: ".a { color: red }\n" }, { id: "old" }),
    ]);
    const candidate = testProject([
      createPageItem({ html: HTML, css: ".a { color: blue }\n" }, { id: "old" }),
    ]).pages[0]!;
    expect(
      await finalizing(STATIC_GATE, project, "brand-new.html", candidate),
    ).toEqual([
      {
        tier: "static",
        severity: "advisory",
        message: unread("old", "brand-new.html", "match-dependent static lint"),
      },
    ]);
    expect(
      await finalizing(NECESSITY_GATE, project, "brand-new.html", candidate),
    ).toEqual([
      {
        tier: "necessity",
        severity: "advisory",
        message: unread("old", "brand-new.html", "necessity lint"),
      },
    ]);
  });

  test("a rework is never judged as the page it replaces: a dead line the draft removed is no finding, and the texts' lint reads the draft", async () => {
    const project = testProject([
      createPageItem(
        { html: HTML, css: ".a { color: red; float: none }\n" },
        { id: "ed" },
      ),
    ]);
    const stored = project.pages[0]!;
    // The draft drops the dead `float` and adds a length with no unit,
    // which the texts alone decide.
    const candidate = {
      ...stored,
      html: HTML.replace('class="a"', 'class="a" style="width: 100"'),
      sheets: stored.sheets.map((sheet) => ({ ...sheet, text: ".a { color: red }\n" })),
    };
    const statics = await finalizing(STATIC_GATE, project, stored.path, candidate);
    expect(statics.map((f) => [f.severity, f.elementId, f.property])).toEqual([
      ["blocking", "div.a", "width"],
      ["advisory", undefined, undefined],
    ]);
    expect(statics[1]!.message).toBe(
      unread("ed", stored.path, "match-dependent static lint"),
    );
    expect(
      await finalizing(NECESSITY_GATE, project, stored.path, candidate),
    ).toEqual([
      {
        tier: "necessity",
        severity: "advisory",
        message: unread("ed", stored.path, "necessity lint"),
      },
    ]);
    // Control: handed the page the store holds, both judge it in full.
    expect(
      (await judge(NECESSITY_GATE, project)).map((f) => [f.severity, f.property]),
    ).toEqual([["blocking", "float"]]);
  });
});
