// The match-dependent static findings against real layout (decision
// #71, plan phase 9; docs/agent-css-knowledge-prd.md, "Testing
// Decisions"): a page goes in, findings come out, and matching is asked
// of a MOUNTED copy of that page — never the canvas — since a gate's
// viewport need not be rendered there (matchLint.ts's own header; the
// eval bug this file guards against: a `.card`/`nav`/`li` rule refused as
// dead because the old code read canvas match facts for a page that was
// never rendered there). `dd.mountViewport` is the same live-strategy
// seam necessity.browser.test.ts uses, and mounts a viewport's page from
// the open project, so each test loads its project into the app store
// first — and renders no canvas. Real Chromium only.
import { afterAll, afterEach, describe, expect, test } from "vitest";

import type { Finding, PageSheet } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  testProject,
  type TestPage,
  type TestProject,
} from "@daydream/plugin-testing";

import { matchLint as lintWith } from "./matchLint";
import { pagesOf, withSheets } from "./testPages";

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

/** The lint over a project, opened as the gate's lint runs over the open
 * one: its pages are what the mount reads and what the gate's context
 * hands the lint. */
const matchLint = (project: TestProject): Promise<Finding[]> => {
  kernel.store.loadProject(project);
  return lintWith(kernel.dd, project.document, pagesOf(project));
};

afterEach(() => {
  // matchLint mounts and disposes its own iframe per page; a leftover is
  // a bug, not a fixture to clean.
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

/** One viewport, id `v1`, 960 wide, and its page `v1.html`: the body's
 * markup (a `.card` by default) and the css, its one sheet `v1.css`. */
function shown(
  css: string,
  body = '<div class="card"></div>',
  id = "v1",
): TestPage {
  return createPageItem(
    { html: `<!doctype html><html><head></head><body>${body}</body></html>`, css },
    { id, frame: { width: 960 } },
  );
}

/** A project of that one page. */
function page(css: string, body?: string, id?: string): TestProject {
  return testProject([shown(css, body, id)]);
}

async function messages(doc: TestProject): Promise<string[]> {
  return (await matchLint(doc)).map((f) => f.message);
}

describe("matchLint", () => {
  // The eval scenario (2026-09-17 raw eval jsonl): a page no canvas has
  // rendered — here, nothing renders one at all. A `.card` rule whose
  // element is plainly in the page must not be refused as dead.
  test("a rule matching an element of a page no canvas rendered is not dead (the eval bug)", async () => {
    expect(await matchLint(page(".card { color: red; }"))).toEqual([]);
  });

  test("a rule whose element is not in the page is dead, on a page no canvas rendered", async () => {
    expect(await messages(page(".ghost { color: red; }"))).toEqual([
      expect.stringContaining("rule `.ghost`"),
    ]);
  });

  test("a descendant-combinator rule (`nav a`) matching a real ancestor/descendant pair is not dead", async () => {
    expect(
      await matchLint(page("nav a { color: inherit; }", "<nav><a>Link</a></nav>")),
    ).toEqual([]);
  });

  test("a state-pseudo rule matching its base selector, state stripped, is not dead", async () => {
    expect(await matchLint(page(".card:hover { color: red; }"))).toEqual([]);
  });

  test("a pseudo-element rule (`.card::before`, or the legacy `.card:after`) matching its element is not dead", async () => {
    expect(await matchLint(page(".card::before { color: red; }"))).toEqual([]);
    expect(await matchLint(page(".card:after { color: red; }"))).toEqual([]);
  });

  test("a nested rule is matched as the browser desugars it: `&` is its parent", async () => {
    expect(
      await matchLint(
        page(
          ".card { color: red; &.on { color: blue } & > p { margin: 0 } }",
          '<div class="card on"><p></p></div>',
        ),
      ),
    ).toEqual([]);
    expect(
      await messages(page(".card { color: red; & > p { margin: 0 } }")),
    ).toEqual(["rule `.card › & > p` of `v1.css` in viewport v1 matches no element"]);
  });

  test("an element's own declaration a matched unconditional rule already sets, verbatim, is redundancy", async () => {
    const findings = await matchLint(
      page(".card { color: red; }", '<div class="card" style="color: red"></div>'),
    );
    expect(findings).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "div.card",
        property: "color",
        rule: 0,
        message:
          "color: red on `div.card` restates rule `.card` of `v1.css`; remove it from the element's style",
      },
    ]);
  });

  test("the element is named by its selector in the stored markup, which still holds an element the safety walk removed", async () => {
    // The mount drops the `<script>`, so `#card` is unique there; in the
    // markup an agent reads and addresses, it is not.
    const findings = await matchLint(
      page(
        ".card { color: red; }",
        '<script id="card"></script><div id="card" class="card" style="color: red"></div>',
      ),
    );
    expect(findings.map((f) => f.elementId)).toEqual(["div.card"]);
  });

  test("a differing value is an override, never redundancy", async () => {
    expect(
      await matchLint(
        page(".card { color: red; }", '<div class="card" style="color: blue"></div>'),
      ),
    ).toEqual([]);
  });

  test("a conditional rule is never redundancy — it may not apply everywhere the element does", async () => {
    expect(
      await matchLint(
        page(
          "@media (width >= 600px) { .card { color: red; } }",
          '<div class="card" style="color: red"></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("an element's own declaration a matched rule restates is not redundancy when the cascade without it picks another rule", async () => {
    // Without the element's `color: red !important`, the later
    // `.special`'s important blue wins, not `.card`'s red.
    expect(
      await matchLint(
        page(
          ".card { color: red !important; }\n.special { color: blue !important; }",
          '<div class="card special" style="color: red !important"></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("an element's own declaration is not redundancy when a rule that applies at another width or in another state could win without it", async () => {
    for (const other of [
      "@media (width >= 2000px) { .card.x { color: blue; } }",
      ".card:hover { color: blue; }",
    ]) {
      expect(
        await matchLint(
          page(`.card { color: red; }\n${other}`, '<div class="card x" style="color: red"></div>'),
        ),
        other,
      ).toEqual([]);
    }
  });

  test("a pseudo-element rule matches its element (not dead) but is never compared for redundancy against the element's own style", async () => {
    expect(
      await matchLint(
        page(".card::before { color: red; }", '<div class="card" style="color: red"></div>'),
      ),
    ).toEqual([]);
  });

  test("a rule matching no element is dead", async () => {
    expect(await matchLint(page(".nope { color: red; }"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "html",
        rule: 0,
        message: "rule `.nope` of `v1.css` in viewport v1 matches no element",
      },
    ]);
  });

  test("a state-pseudo rule matching nothing even state-stripped is dead", async () => {
    expect(await messages(page(".nope:hover { color: red; }"))).toEqual([
      "rule `.nope:hover` of `v1.css` in viewport v1 matches no element",
    ]);
  });

  test("outside @scope only a real `:scope` pseudo-class is the root: the text `:scope` in a string, an attribute or an escape is not one", async () => {
    expect(
      await matchLint(
        page(
          `[data-value=":scope"] { color: red; }
[data-value=\\:scope] { padding: 1px; }
.a\\:scope { margin: 1px; }
[title=':scope x'] > p { color: blue; }
:scope > body { margin: 0; }`,
          '<div data-value=":scope" class="a:scope" title=":scope x"><p>x</p></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("a rule under an @media condition inactive at the frame is never called dead on that evidence alone", async () => {
    expect(
      await matchLint(page("@media (min-width: 2000px) { .card { color: red; } }")),
    ).toEqual([]);
  });

  test("a rule inside an @scope is matched from the scope's roots: `:scope` is the root, a bare member its descendant, and a limit ends the scope", async () => {
    expect(
      await messages(
        page(
          `@scope (.card) { :scope { padding: 8px; } :scope > img { width: 10px; } p { margin: 0; } border: 0; }
@scope (.card) to (.content) { img { height: 10px; } }
@scope (.card) to (.content) { .content p { color: red; } }
@scope (.content) { .card p { color: blue; } }
.card { @scope (img) { :scope { max-width: 100%; } } }`,
          '<div class="card"><img><div class="content"><p>x</p></div></div>',
        ),
      ),
    ).toEqual([
      "rule `.content p` in `@scope (.card) to (.content)` of `v1.css` in viewport v1 matches no element",
      "rule `.card p` in `@scope (.content)` of `v1.css` in viewport v1 matches no element",
    ]);
  });

  test("a rule under @media print or a height query the frame fails is never called dead; one under @starting-style is matched like any other", async () => {
    const doc = page(
      `@starting-style { .card { opacity: 0; } }
@media print { .nope { color: red; } }
@media (min-height: 2000px) { .nope { color: red; } }
@starting-style { .nope { opacity: 0; } }`,
    );
    doc.document.canvases[0]!.items[0]!.frame = { width: 960, height: 600 };
    expect(await messages(doc)).toEqual([
      "rule `.nope` in `@starting-style` of `v1.css` in viewport v1 matches no element",
    ]);
  });

  test("the legacy comment markers `<!--` and `-->` between rules are no part of the next rule's selector", async () => {
    expect(
      await matchLint(
        page(
          '<!--\n.card { color: red; }\n-->\n<!-- .note { color: blue; } -->',
          '<div class="card"></div><p class="note"></p>',
        ),
      ),
    ).toEqual([]);
  });

  test("a clean page is clean, and a page with no css pays no mount", async () => {
    expect(await matchLint(page(".card { color: red; }"))).toEqual([]);
    expect(await matchLint(page(""))).toEqual([]);
  });

  // Rule-against-rule redundancy (ruleRedundancy.ts, proved under node;
  // this is the mount-backed end to end): two featured cards, `.card`
  // and `.card.featured` both `color: #333`.
  test("a rule declaration restating the rule beneath it everywhere it reaches is refused, at the rule's index", async () => {
    const findings = await matchLint(
      page(
        ".card { color: #333; padding: 16px; }\n.card.featured { color: #333; border: 1px solid #333; }",
        '<div class="card featured"></div><div class="card featured"></div>',
      ),
    );
    expect(findings.map((f) => [f.rule, f.property, f.message])).toEqual([
      [
        1,
        "color",
        "color: #333 in rule `.card.featured` of `v1.css` in viewport v1 restates rule `.card` for every element it reaches; remove it from `.card.featured`",
      ],
    ]);
  });

  test("a rule reaching an element the rule beneath does not is load-bearing there: no finding", async () => {
    expect(
      await matchLint(
        page(
          ".card { color: #333; }\n.featured { color: #333; }",
          '<div class="card featured"></div><div class="featured"></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("a rule declaration is not redundancy when a state rule between it and the rule beneath would win without it", async () => {
    // Hovered, `.a.a.a`'s red holds off `.a:hover`'s blue; without it the
    // card turns blue. The rule beneath restates it only while nobody
    // hovers.
    expect(
      await matchLint(
        page(
          ".a.a.a { color: red; }\n.a:hover { color: blue; }\n.a { color: red; }",
          '<div class="a"></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("a rule reaching the element through a plain member and a ::before member styles the real box: judged, not skipped", async () => {
    const findings = await matchLint(
      page(
        ".card { color: #333; }\n.card.featured, .card.featured::before { color: #333; }",
        '<div class="card featured"></div>',
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[1, "color"]]);
  });

  test("a layered or scoped rule applies wherever it matches: an element's own declaration it already makes is redundancy", async () => {
    for (const css of [
      "@layer base { .card { color: red; } }",
      "@scope (body) { .card { color: red; } }",
    ]) {
      const findings = await matchLint(
        page(css, '<div class="card" style="color: red"></div>'),
      );
      expect(findings.map((f) => [f.elementId, f.rule, f.property]), css).toEqual([
        ["div.card", 0, "color"],
      ]);
    }
  });

  test("a layered rule beneath restates a rule's declaration as an unlayered one does", async () => {
    const findings = await matchLint(
      page(
        "@layer base { .card { color: #333; } }\n.card.featured { color: #333; border: 1px solid; }",
        '<div class="card featured"></div>',
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[1, "color"]]);
  });
});

describe("matchLint: a pseudo-element's declarations are measured on the pseudo-element", () => {
  test("a reset to the initial that overrides a pseudo-element's value is the override, not a restatement", async () => {
    expect(
      await matchLint(
        page(
          '.card::before { content: ""; opacity: 0.2; }\n.card.on::before { opacity: 1; }',
          '<div class="card on"></div>',
        ),
      ),
    ).toEqual([]);
  });

  test("a pseudo-element's restated initial nothing overrides is a finding", async () => {
    const findings = await matchLint(
      page('.card::before { content: ""; opacity: 1; }'),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[0, "opacity"]]);
  });

  test("a pseudo-element the browser's computed style cannot read is never called a restatement", async () => {
    expect(
      await matchLint(
        page(".card::placeholder { opacity: 1; }", '<input class="card">'),
      ),
    ).toEqual([]);
  });
});

// A container query with no container to ask. On a tree this was the
// static lint's rule 1, asked of an element's `@container` layer; on a
// page every query is in a rule, and which elements it reaches — and so
// whose ancestors to ask — is a match.
// An explicit initial value (the static gate's rule 2, initialValues.ts):
// a candidate is a finding only once cutting it leaves the page computing
// what it did. The UA-sheet overrides are pinned at the gate
// (gates.browser.test.ts).
describe("matchLint: an explicit initial value", () => {
  /** One element, `#box`, with the given own style, and the css. */
  const box = (style: string, css = "", tag = "div"): TestProject =>
    page(css, `<${tag} id="box" style="${style}"></${tag}>`);

  test("an initial value in an element's own style is a finding, and pays for a mount with no css", async () => {
    expect(await matchLint(box("position: static"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        elementId: "#box",
        property: "position",
        message: "position: static on `#box` restates the initial value",
      },
    ]);
  });

  test("representative initials across the table are findings, in the element's order", async () => {
    const findings = await matchLint(
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
  });

  test("an initial that overrides a rule's value is the override, not a restatement", async () => {
    expect(
      await matchLint(
        box("position: static", "#box { position: absolute; }"),
      ),
    ).toEqual([]);
  });

  test("an initial a rule at another width or in another state could override is not judged at the frame", async () => {
    for (const css of [
      "@media (width >= 2000px) { #box { position: absolute; } }",
      "#box:hover { position: absolute; }",
    ]) {
      expect(await matchLint(box("position: static", css)), css).toEqual([]);
    }
  });

  test("a rule under a condition resetting to the initial is a legitimate override", async () => {
    expect(
      await matchLint(
        box(
          "position: absolute",
          "@media (width >= 600px) { #box { position: static; max-width: none } }",
        ),
      ),
    ).toEqual([]);
  });

  test("a restated initial in a rule is a finding at the rule's index", async () => {
    expect(await matchLint(page(".card { position: static; }"))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        property: "position",
        message:
          "position: static in rule `.card` of `v1.css` in viewport v1 restates the initial value",
      },
    ]);
  });

  test("a rule's initial that an element it reaches needs is no finding; on elements that do not need it, it is", async () => {
    // Chromium clips an img's overflow; a div's is visible anyway.
    expect(
      await matchLint(
        page(".thumb { overflow: visible; }", '<img class="thumb" alt=""><div class="thumb"></div>'),
      ),
    ).toEqual([]);
    expect(
      await messages(
        page(".thumb { overflow: visible; }", '<div class="thumb"></div>'),
      ),
    ).toEqual([
      "overflow: visible in rule `.thumb` of `v1.css` in viewport v1 restates the initial value",
    ]);
  });

  // Decision #57's audit, now measured: Chromium's html.css sets none of
  // the table's properties on these tags, so a restated initial on any of
  // them changes nothing. Each tag sits in the parent the HTML parser
  // keeps it in.
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

  /** `tag` as `#t-<tag>` carrying `style`, inside the parent the parser
   * keeps it in. */
  function placed(tag: string, style: string): string {
    const own = `<${tag} id="t-${tag}" style="${style}">${tag === "wbr" || tag === "col" ? "" : `</${tag}>`}`;
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

  test("the UA sheet leaves every table property alone on every new tag: restating one there is measured redundant", async () => {
    const style = TABLE.map(([property, value]) => `${property}: ${value}`).join("; ");
    const findings = await matchLint(
      page("", NEW_TAGS.map((tag) => placed(tag, style)).join("")),
    );
    for (const tag of NEW_TAGS) {
      expect(
        findings
          .filter((f) => f.elementId === `#t-${tag}`)
          .map((f) => f.property),
        tag,
      ).toEqual(TABLE.map(([property]) => property));
    }
  });
});

describe("matchLint: a container query with no container", () => {
  const QUERY = "@container (width > 400px)";
  const NAMED = "@container card (width > 400px)";

  /** `.card` somewhere in `body`, a `prelude` rule for it, and `css`. */
  function queried(
    body: string,
    css = "",
    prelude = QUERY,
  ): TestProject {
    return page(`${css}\n${prelude} { .card { display: flex; } }`, body);
  }

  const CARD = '<div class="card"></div>';
  const wrapped = (style: string): string =>
    `<div style="${style}">${CARD}</div>`;

  test("a rule's container query with no container-typed ancestor of its elements is a finding", async () => {
    expect(await matchLint(queried(`<div>${CARD}</div>`))).toEqual([
      {
        tier: "static",
        severity: "blocking",
        rule: 0,
        message:
          "container query `@container (width > 400px)` in rule `.card` of `v1.css` in viewport v1 can never match: no ancestor of an element it matches declares container-type",
      },
    ]);
  });

  test("a container-type ancestor satisfies the query, from its own style or from a rule matching it", async () => {
    expect(await matchLint(queried(wrapped("container-type: inline-size")))).toEqual([]);
    expect(
      await matchLint(
        queried(`<section class="wrap">${CARD}</section>`, ".wrap { container-type: inline-size; }"),
      ),
    ).toEqual([]);
  });

  test("the container shorthand with a slashed type satisfies the query; an unslashed one names only", async () => {
    expect(await matchLint(queried(wrapped("container: grid / size")))).toEqual([]);
    expect(await matchLint(queried(wrapped("container: grid")))).toHaveLength(1);
  });

  test("an !important container-type is not reset by a later normal container shorthand", async () => {
    expect(
      await matchLint(
        queried(wrapped("container-type: inline-size !important; container: card"), "", NAMED),
      ),
    ).toEqual([]);
    expect(
      await matchLint(
        queried(
          `<section class="wrap">${CARD}</section>`,
          ".wrap { container-type: inline-size !important; container: card; }",
          NAMED,
        ),
      ),
    ).toEqual([]);
  });

  test("a container type the text cannot read is measured: an inherited container-type counts", async () => {
    expect(
      await matchLint(
        queried(
          `<div class="outer"><div class="wrap">${CARD}</div></div>`,
          ".outer { container-type: inline-size; } .wrap { container-type: inherit; container-name: card; }",
          NAMED,
        ),
      ),
    ).toEqual([]);
  });

  test("container-type: normal is not a container", async () => {
    expect(await matchLint(queried(wrapped("container-type: normal")))).toHaveLength(1);
  });

  test("the element's own container-type does not count — queries read ancestors", async () => {
    expect(
      await matchLint(
        queried('<div class="card" style="container-type: inline-size"></div>'),
      ),
    ).toHaveLength(1);
  });

  test("container-type on body or html counts as an ancestor", async () => {
    expect(await matchLint(queried(CARD, "body { container-type: inline-size; }"))).toEqual([]);
    expect(await matchLint(queried(CARD, "html { container-type: size; }"))).toEqual([]);
  });

  test("container-type declared in a rule under an @media the frame is not at still counts", async () => {
    expect(
      await matchLint(
        queried(
          `<div class="wrap">${CARD}</div>`,
          ".wrap { color: red; } @media (width >= 2000px) { .wrap { container-type: inline-size; } }",
        ),
      ),
    ).toEqual([]);
  });

  test("a named query needs an ancestor carrying that name", async () => {
    const [finding, ...rest] = await matchLint(
      queried(wrapped("container-type: inline-size"), "", NAMED),
    );
    expect(rest).toEqual([]);
    expect(finding?.message).toMatch(/declares a container named `card`$/);
    expect(
      await matchLint(
        queried(wrapped("container-type: inline-size; container-name: card"), "", NAMED),
      ),
    ).toEqual([]);
    expect(
      await matchLint(queried(wrapped("container: card / inline-size"), "", NAMED)),
    ).toEqual([]);
    expect(
      await matchLint(queried(wrapped("container: sidebar / inline-size"), "", NAMED)),
    ).toHaveLength(1);
  });

  test("a farther ancestor both typed and so named passes, whatever sits between", async () => {
    expect(
      await matchLint(
        queried(`<div style="container: card / inline-size"><div>${CARD}</div></div>`, "", NAMED),
      ),
    ).toEqual([]);
  });

  test("a style()-only query needs no container-type, named or not", async () => {
    for (const prelude of [
      "@container style(--theme: dark)",
      "@container card style(--theme: dark)",
      "@container (style(--a: 1) and style(--b: calc(1 + 2)))",
      "@container not style(--theme: dark)",
    ]) {
      expect(await matchLint(queried(CARD, "", prelude)), prelude).toEqual([]);
    }
  });

  test("a scroll-state() query needs a scroll-state container", async () => {
    const query = "@container scroll-state(stuck: top)";
    const [finding] = await matchLint(queried(CARD, "", query));
    expect(finding?.message).toMatch(
      /can never match: no ancestor of an element it matches declares container-type: scroll-state$/,
    );
    expect(
      await matchLint(queried(wrapped("container-type: inline-size"), "", query)),
    ).toHaveLength(1);
    expect(
      await matchLint(queried(wrapped("container-type: scroll-state"), "", query)),
    ).toEqual([]);
    expect(
      await matchLint(
        queried(
          wrapped("container: sticky / size scroll-state"),
          "",
          "@container sticky scroll-state(stuck: top)",
        ),
      ),
    ).toEqual([]);
  });

  test("a mixed size and style() query still needs a size-typed ancestor", async () => {
    const mixed = "@container (width > 400px) and style(--x: 1)";
    expect(await matchLint(queried(CARD, "", mixed))).toHaveLength(1);
    expect(
      await matchLint(queried(wrapped("container-type: inline-size"), "", mixed)),
    ).toEqual([]);
  });

  test("size features in every spelling need a size container", async () => {
    for (const query of [
      "@container (min-width: 400px)",
      "@container (orientation: landscape)",
      "@container not (width > 400px)",
      "@container ((width > 400px) or (height > 200px))",
    ]) {
      expect(await matchLint(queried(CARD, "", query)), query).toHaveLength(1);
    }
  });

  test("a container declared by a rule under an ancestor's own @container counts", async () => {
    // Only the wrapper's @container rule names `card`; the outer box types
    // the wrapper's own query but carries no name.
    expect(
      await matchLint(
        queried(
          `<div class="outer"><div class="wrap">${CARD}</div></div>`,
          ".outer { container-type: inline-size; } @container (width > 0px) { .wrap { container: card / inline-size; } }",
          NAMED,
        ),
      ),
    ).toEqual([]);
  });

  test("a query nested in its rule is judged the same, named by the rule", async () => {
    expect(
      await messages(page(".card { color: red; @container (width > 400px) { display: flex } }")),
    ).toEqual([
      "container query `@container (width > 400px)` in rule `.card` of `v1.css` in viewport v1 can never match: no ancestor of an element it matches declares container-type",
    ]);
  });

  test("media rules are never container queries", async () => {
    expect(await matchLint(page("@media (width >= 600px) { .card { gap: 8px; } }"))).toEqual([]);
  });

  test("a rule matching no element reports only the dead-rule finding, never a second container-query one", async () => {
    const findings = await matchLint(page(`${QUERY} { .nope { display: flex; } }`));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("matches no element");
  });

  test("a query in one page cannot borrow a container from another", async () => {
    const both = testProject([
      shown(`${QUERY} { .card { display: flex; } }`, wrapped("container-type: inline-size")),
      shown(`${QUERY} { .card { display: flex; } }`, CARD, "v2"),
    ]);
    expect(await messages(both)).toEqual([
      expect.stringContaining("in viewport v2 can never match"),
    ]);
  });
});

// A page's css is its sheets (decision #78): the copy mounts one
// `<style>` per live sheet, and each is read as the page's sheet it
// renders — so a finding numbers a rule across the page's sheets, names
// the sheet it is written in, and is never about a read-only one.
describe("matchLint: a page of several sheets", () => {
  /** `v1.html` in viewport `v1`: the head's sheets (`head`), the body,
   * and the sheets the host read for it, in document order. */
  function sheeted(head: string, body: string, sheets: PageSheet[]): TestProject {
    return testProject([
      withSheets(
        createPageItem(
          {
            html: `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
          },
          { id: "v1", frame: { width: 960 } },
        ),
        sheets,
      ),
    ]);
  }
  const KIT = "https://cdn.example/kit.css";

  test("a rule is numbered across the page's sheets and named with the sheet it is written in", async () => {
    const ghost = ".ghost { color: red; }";
    const findings = await matchLint(
      sheeted(
        `<style>${ghost}</style><link rel="stylesheet" href="v1.css">`,
        '<div class="card"></div>',
        [
          { source: { style: 0 }, text: ghost, readOnly: false },
          {
            source: { file: "v1.css" },
            text: ".card { color: red; }\n.nope { color: red; }",
            readOnly: false,
          },
        ],
      ),
    );
    expect(findings.map((f) => [f.rule, f.message])).toEqual([
      [0, "rule `.ghost` of `<style>` block 1 of `v1.html` in viewport v1 matches no element"],
      [2, "rule `.nope` of `v1.css` in viewport v1 matches no element"],
    ]);
  });

  test("a read-only sheet's rule is never a finding's subject, but it is matched, ranked and named as the rule another restates", async () => {
    const findings = await matchLint(
      sheeted(
        `<link rel="stylesheet" href="${KIT}"><link rel="stylesheet" href="v1.css">`,
        '<div class="card featured"></div><div class="plain" style="color: red"></div>',
        [
          {
            source: { url: KIT },
            text: ".nope { color: red; }\n.card { color: #333; position: static; }\n.plain { color: red; }",
            readOnly: true,
          },
          {
            source: { file: "v1.css" },
            text: ".card.featured { color: #333; }",
            readOnly: false,
          },
        ],
      ),
    );
    expect(findings.map((f) => [f.elementId, f.rule, f.message])).toEqual([
      [
        "div.plain",
        2,
        `color: red on \`div.plain\` restates rule \`.plain\` of \`${KIT}\`; remove it from the element's style`,
      ],
      [
        undefined,
        3,
        `color: #333 in rule \`.card.featured\` of \`v1.css\` in viewport v1 restates rule \`.card\` of \`${KIT}\` for every element it reaches; remove it from \`.card.featured\``,
      ],
    ]);
  });
  test("a sheet file the host would never write is read-only as a remote one is; a remote sheet the host could not fetch holds no rule", async () => {
    const findings = await matchLint(
      sheeted(
        `<link rel="stylesheet" href="${KIT}"><link rel="stylesheet" href="kit.css"><link rel="stylesheet" href="v1.css">`,
        '<div class="card"></div>',
        [
          {
            source: { url: KIT },
            text: "",
            readOnly: true,
            error: "it answered HTTP 404",
          },
          {
            source: { file: "kit.css" },
            text: ".nope { color: red; }\n.card { color: #333; }",
            readOnly: true,
            unwritable:
              "kit.css is a link: it is neither written nor removed through it",
          },
          {
            source: { file: "v1.css" },
            text: ".card { color: #333; }\n.ghost { color: red; }",
            readOnly: false,
          },
        ],
      ),
    );
    // kit.css's `.nope` matches nothing and is not said; its `.card` is
    // the rule v1.css's restates. The empty remote sheet numbers nothing.
    expect(findings.map((f) => [f.rule, f.message])).toEqual([
      [
        2,
        "color: #333 in rule `.card` of `v1.css` in viewport v1 restates rule `.card` of `kit.css` for every element it reaches; remove it from `.card`",
      ],
      [3, "rule `.ghost` of `v1.css` in viewport v1 matches no element"],
    ]);
  });
});
