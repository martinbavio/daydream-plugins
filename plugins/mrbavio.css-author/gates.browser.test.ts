// The plugin's browser part through the API (decision #48 P9): the
// two gates it registers, each finding at the severity the plugin
// declares — blocking — and each judging on its own: what the two say of
// ONE declaration is the runner's to fold (src/ai/gates.ts dropCovered,
// tested in src/ai/gates.test.ts). Real Chromium: both gates read the
// page through the browser, and both mount it. A gate runs over the open
// project (decision #78), so each judgement opens its project and hands
// the gate a context as the runner builds it (plugin-testing's
// `gateContext`) over its pages.
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
  gateContext,
  pageFixtureProject,
  testProject,
  type TestProject,
} from "@daydream/plugin-testing";

import activate, { NECESSITY_GATE, STATIC_GATE } from "./index";
import { pagesOf, withSheets } from "./testPages.test-support";

/** What the real manifest declares of gates (the manifests test pins the
 * file itself; a JSON import needs a compiler flag the plugins do not
 * assume). */
const manifest: PluginManifest = {
  id: "mrbavio.css-author",
  name: "CSS author",
  version: "0.1.0",
  api: "1.0",
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
  return gate.run(project.document, gateContext({ page: pagesOf(project) }));
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
// Both lints mount it through the context (`ctx.mountViewport`), so they
// judge the page about to be written — a new page no file holds, a rework
// as it will be read — never the store's.
describe("css-author gates at a finalize, over the page about to be written", () => {
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
      gateContext({
        page: (p) => (p === path ? { ...candidate, path } : kernel.dd.page(p)),
      }),
    );
  }

  const addressed = (findings: Finding[]) =>
    findings.map((f) => [f.severity, f.elementId, f.rule, f.property]);

  test("a new page is judged as it will be written, and a clean one is not refused", async () => {
    const project = testProject([
      createPageItem({ html: HTML, css: ".a { color: red }\n" }, { id: "old" }),
    ]);
    // Its own sheet, brand-new.css: a sheet old.html links too is judged
    // apart (the describe below).
    const pageOf = (css: string) =>
      testProject([createPageItem({ html: HTML, css }, { id: "brand-new" })]).pages[0]!;
    // Clean: no file holds brand-new.html, and neither gate refuses it or
    // throws.
    const clean = pageOf(".a { color: blue }\n");
    expect(await finalizing(STATIC_GATE, project, "brand-new.html", clean)).toEqual([]);
    expect(await finalizing(NECESSITY_GATE, project, "brand-new.html", clean)).toEqual([]);
    // Flawed: a rule nothing in the new page matches, which only a mount
    // of the new page can tell, is dead to both.
    const flawed = pageOf(".a { color: blue }\n.gone { color: red }\n");
    const statics = await finalizing(STATIC_GATE, project, "brand-new.html", flawed);
    expect(addressed(statics)).toEqual([["blocking", "html", 1, undefined]]);
    expect(statics[0]!.message).toMatch(/^rule `\.gone` of `[^`]+` in viewport old matches no element/);
    expect(
      addressed(await finalizing(NECESSITY_GATE, project, "brand-new.html", flawed)),
    ).toEqual([["blocking", undefined, 1, "color"]]);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  test("a rework is judged as it will be read, never as the page it replaces", async () => {
    const project = testProject([
      createPageItem(
        { html: HTML, css: ".a { color: red; float: none }\n" },
        { id: "ed" },
      ),
    ]);
    const stored = project.pages[0]!;
    // Control: the stored page's `float` restates the initial and is dead.
    expect(addressed(await judge(STATIC_GATE, project))).toEqual([
      ["blocking", undefined, 0, "float"],
    ]);
    expect(addressed(await judge(NECESSITY_GATE, project))).toEqual([
      ["blocking", undefined, 0, "float"],
    ]);
    // The draft drops the `float`, adds a length with no unit (the texts
    // decide it) and a rule nothing matches (a mount of the draft does):
    // the stored page's `float` is no finding, the draft's flaws are.
    const candidate = {
      ...stored,
      html: HTML.replace('class="a"', 'class="a" style="width: 100"'),
      sheets: stored.sheets.map((sheet) => ({
        ...sheet,
        text: ".a { color: red }\n.gone { color: red }\n",
      })),
    };
    expect(
      addressed(await finalizing(STATIC_GATE, project, stored.path, candidate)),
    ).toEqual([
      ["blocking", "div.a", undefined, "width"],
      ["blocking", "html", 1, undefined],
    ]);
    expect(
      addressed(await finalizing(NECESSITY_GATE, project, stored.path, candidate)),
    ).toEqual([
      ["blocking", "div.a", undefined, "width"],
      ["blocking", undefined, 1, "color"],
    ]);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
});

// A sheet several pages link, judged where the document shows only some
// of them (pageSheets.ts `unjudgedLinks`): at a finalize the document is
// the one page about to be written, and under `lint {viewportIds}` the
// named viewports. A rule another page may use is never a refusal there
// — nothing in the draft could satisfy one without breaking that page —
// but one advisory per sheet naming the pages; a flaw of the page's own
// sheet, or one its text shows, is still refused.
describe("css-author gates over a sheet pages outside the judged document link", () => {
  const SITE = ".home { color: red; }\n.about { color: blue; }\n";

  /** Viewport `id` of page `<id>.html`, linking `site.css` and, if
   * given, a sheet of its own (`<id>.css`). */
  function sharing(id: string, body: string, own?: string) {
    const link = (href: string) => `<link rel="stylesheet" href="${href}">`;
    return withSheets(
      createPageItem(
        {
          html: `<!doctype html><html><head>${link("site.css")}${own === undefined ? "" : link(`${id}.css`)}</head><body>${body}</body></html>`,
        },
        { id, frame: { width: 960 } },
      ),
      [
        { source: { file: "site.css" }, text: SITE, readOnly: false },
        ...(own === undefined
          ? []
          : [{ source: { file: `${id}.css` }, text: own, readOnly: false }]),
      ],
    );
  }

  /** home.html (`.home`, and its own home.css) and about.html (`.about`),
   * both linking site.css. */
  function site(): TestProject {
    return testProject([
      sharing("home", '<div class="home">h</div>', ".home { padding: 4px; }\n"),
      sharing("about", '<div class="about">a</div>'),
    ]);
  }

  /** The gates as a finalize runs them (kernel src/ai/draftFinalize.ts):
   * `project` in the store, the document one viewport showing `path`,
   * its `pages` that path alone, and `ctx.page` answering `candidate`
   * for it and the store's page for every other. */
  async function finalizing(
    id: string,
    project: TestProject,
    path: string,
    candidate: TestProject["pages"][number],
  ): Promise<Finding[]> {
    kernel.store.loadProject(project);
    const viewport = project.document.canvases[0]!.items[0]! as DreamViewport;
    return gates().get(id)!.run(
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
      gateContext({
        page: (p) => (p === path ? { ...candidate, path } : kernel.dd.page(p)),
      }),
    );
  }

  /** The gates as `lint {viewportIds}` runs them (kernel src/ai/gates.ts
   * `runGates`): the document narrowed to the named viewports, its pages
   * the project's, and the ids in the context. */
  async function narrowed(
    id: string,
    project: TestProject,
    viewportIds: string[],
  ): Promise<Finding[]> {
    kernel.store.loadProject(project);
    const doc = project.document;
    return gates().get(id)!.run(
      {
        ...doc,
        canvases: [
          {
            ...doc.canvases[0]!,
            items: doc.canvases[0]!.items.filter((item) => viewportIds.includes(item.id)),
          },
        ],
      },
      gateContext({ page: pagesOf(project), viewportIds }),
    );
  }

  const said = (findings: Finding[]) => findings.map((f) => [f.severity, f.message]);

  const ABOUT_STATIC = (where: string, pages: string) =>
    `rule \`.about\` of \`site.css\` matches no element in viewport ${where}; ${pages} too and ${pages.startsWith("pages") ? "were" : "was"} not judged, so it is not refused`;
  const ABOUT_NECESSITY = (where: string, pages: string) =>
    `declaration \`color: blue\` in \`.about\` of \`site.css\` changes nothing in viewport ${where}; ${pages} too and ${pages.startsWith("pages") ? "were" : "was"} not judged, so it is not refused`;

  test("over the whole project, a rule of the shared sheet each page uses is no finding", async () => {
    const project = site();
    expect(await judge(STATIC_GATE, project)).toEqual([]);
    expect(await judge(NECESSITY_GATE, project)).toEqual([]);
  });

  test("a rework's finalize is not refused for a rule of the shared sheet only another page uses; a dead rule of the page's own sheet still is", async () => {
    const project = site();
    const stored = project.pages.find((p) => p.path === "home.html")!;
    const candidate = {
      ...stored,
      html: stored.html.replace(">h<", ">home, edited<"),
      sheets: stored.sheets.map((sheet) =>
        "file" in sheet.source && sheet.source.file === "home.css"
          ? { ...sheet, text: ".home { padding: 4px; }\n.gone { color: red; }\n" }
          : sheet,
      ),
    };
    expect(said(await finalizing(STATIC_GATE, project, "home.html", candidate))).toEqual([
      ["blocking", "rule `.gone` of `home.css` in viewport home matches no element"],
      ["advisory", ABOUT_STATIC("home", "page `about.html` links `site.css`")],
    ]);
    const necessity = await finalizing(NECESSITY_GATE, project, "home.html", candidate);
    expect(necessity.map((f) => [f.severity, f.rule, f.property])).toEqual([
      ["blocking", 3, "color"],
      ["advisory", undefined, undefined],
    ]);
    expect(necessity[1]!.message).toBe(
      ABOUT_NECESSITY("home", "page `about.html` links `site.css`"),
    );
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  test("a new page linking the shared sheet is not refused for the rules the pages already there use", async () => {
    const project = site();
    const about = project.pages.find((p) => p.path === "about.html")!;
    // A page no file holds yet: `.about`'s markup under another path.
    const fresh = { ...about, path: "new.html" };
    const pages = "pages `home.html` and `about.html` link `site.css`";
    expect(said(await finalizing(STATIC_GATE, project, "new.html", fresh))).toEqual([
      [
        "advisory",
        `rule \`.home\` of \`site.css\` matches no element in viewport home; ${pages} too and were not judged, so it is not refused`,
      ],
    ]);
    expect(said(await finalizing(NECESSITY_GATE, project, "new.html", fresh))).toEqual([
      [
        "advisory",
        `declaration \`color: red\` in \`.home\` of \`site.css\` changes nothing in viewport home; ${pages} too and were not judged, so it is not refused`,
      ],
    ]);
  });

  test("`lint {viewportIds}` of one page is not refused for a rule of the shared sheet another page uses", async () => {
    const project = site();
    expect(said(await narrowed(STATIC_GATE, project, ["home"]))).toEqual([
      ["advisory", ABOUT_STATIC("home", "page `about.html` links `site.css`")],
    ]);
    expect(said(await narrowed(NECESSITY_GATE, project, ["home"]))).toEqual([
      ["advisory", ABOUT_NECESSITY("home", "page `about.html` links `site.css`")],
    ]);
  });

  test("what the shared sheet's text shows is still refused, and a font face another page names is used", async () => {
    const project = testProject([
      sharing("home", '<div class="home">h</div>'),
      // about.html names the face through its own style.
      sharing("about", '<div class="about" style="font-family: Brand">a</div>'),
    ]);
    const home = project.pages.find((p) => p.path === "home.html")!;
    const candidate = {
      ...home,
      sheets: home.sheets.map((sheet) => ({
        ...sheet,
        text: `@font-face { font-family: Brand; src: local(Arial); }\n${SITE}.home { width: 100; }\n`,
      })),
    };
    expect(said(await finalizing(STATIC_GATE, project, "home.html", candidate))).toEqual([
      [
        "blocking",
        "width: 100 in rule `.home` of `site.css` has no unit; a length needs one (px, rem, %, …)",
      ],
      ["advisory", ABOUT_STATIC("home", "page `about.html` links `site.css`")],
    ]);
  });
});
