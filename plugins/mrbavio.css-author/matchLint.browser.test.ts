// The match-dependent static findings against real layout (decision
// #71, plan phase 9; docs/agent-css-knowledge-prd.md, "Testing
// Decisions"): a page goes in, findings come out, and matching is asked
// of a MOUNTED copy of that page — never the canvas — since a gate's
// document is not, and may never have been, on the canvas (matchLint.ts's
// own header; the eval bug this file guards against: a `.card`/`nav`/`li`
// rule refused as dead on every landing because the old code read canvas
// match facts for a document that was never rendered there).
// `dd.mountViewport` is the same live-strategy seam
// necessity.browser.test.ts uses, so one shared kernel with no document
// loaded serves every test here — nothing in this file loads a document
// into the app store. Real Chromium only.
import { afterAll, afterEach, describe, expect, test } from "vitest";

import type { DreamDocument, Finding } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestKernel,
  documentFrom,
} from "@daydream/plugin-testing";

import { matchLint as lintWith } from "./matchLint";

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

const matchLint = (doc: DreamDocument): Promise<Finding[]> => lintWith(kernel.dd, doc);

afterEach(() => {
  // matchLint mounts and disposes its own iframe per page; a leftover is
  // a bug, not a fixture to clean.
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

/** One page, id `v1`, 960 wide: the body's markup (a `.card` by default)
 * and the css. */
function page(
  css: string,
  body = '<div class="card"></div>',
  id = "v1",
): DreamDocument {
  return {
    version: 7,
    items: [
      createPageItem(
        { html: `<!doctype html><html><head></head><body>${body}</body></html>`, css },
        { id, frame: { width: 960 } },
      ),
    ],
  };
}

async function messages(doc: DreamDocument): Promise<string[]> {
  return (await matchLint(doc)).map((f) => f.message);
}

describe("matchLint", () => {
  // The exact eval scenario (2026-09-17 raw eval jsonl): a document handed
  // to a gate straight from `documentFrom` — the same validation
  // `src/ai/gates.ts`'s caller runs before `runGates`, never a document
  // loaded into the app store or rendered on the canvas. A `.card` rule
  // whose element is plainly in the page must not be refused as dead.
  test("a rule matching an element that was never on the canvas is not dead (the eval bug)", async () => {
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
    expect(await matchLint(result.doc)).toEqual([]);
  });

  test("a rule whose element is not in the page is dead, even for a document never rendered on the canvas", async () => {
    const result = documentFrom({
      version: 7,
      items: [
        {
          kind: "daydream.viewport",
          frame: { width: 960, height: 600 },
          payload: {
            html: '<!doctype html><html><body><div class="card"></div></body></html>',
            css: ".ghost { color: red; }",
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    expect(await messages(result.doc)).toEqual([
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
    ).toEqual(["rule `.card › & > p` in viewport v1 matches no element"]);
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
          "color: red on `div.card` restates rule `.card`; remove it from the element's style",
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
        message: "rule `.nope` in viewport v1 matches no element",
      },
    ]);
  });

  test("a state-pseudo rule matching nothing even state-stripped is dead", async () => {
    expect(await messages(page(".nope:hover { color: red; }"))).toEqual([
      "rule `.nope:hover` in viewport v1 matches no element",
    ]);
  });

  test("a rule under an @media condition inactive at the frame is never called dead on that evidence alone", async () => {
    expect(
      await matchLint(page("@media (min-width: 2000px) { .card { color: red; } }")),
    ).toEqual([]);
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
        "color: #333 in rule `.card.featured` of viewport v1 restates rule `.card` for every element it reaches; remove it from `.card.featured`",
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

  test("a rule reaching the element through a plain member and a ::before member styles the real box: judged, not skipped", async () => {
    const findings = await matchLint(
      page(
        ".card { color: #333; }\n.card.featured, .card.featured::before { color: #333; }",
        '<div class="card featured"></div>',
      ),
    );
    expect(findings.map((f) => [f.rule, f.property])).toEqual([[1, "color"]]);
  });
});

// A container query with no container to ask. On a tree this was the
// static lint's rule 1, asked of an element's `@container` layer; on a
// page every query is in a rule, and which elements it reaches — and so
// whose ancestors to ask — is a match.
describe("matchLint: a container query with no container", () => {
  const QUERY = "@container (width > 400px)";
  const NAMED = "@container card (width > 400px)";

  /** `.card` somewhere in `body`, a `prelude` rule for it, and `css`. */
  function queried(
    body: string,
    css = "",
    prelude = QUERY,
  ): DreamDocument {
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
          "container query `@container (width > 400px)` in rule `.card` of viewport v1 can never match: no ancestor of an element it matches declares container-type",
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
      "container query `@container (width > 400px)` in rule `.card` of viewport v1 can never match: no ancestor of an element it matches declares container-type",
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
    const withContainer = queried(wrapped("container-type: inline-size"));
    const without = page(`${QUERY} { .card { display: flex; } }`, CARD, "v2");
    const both: DreamDocument = {
      version: 7,
      items: [...withContainer.items, ...without.items],
    };
    expect(await messages(both)).toEqual([
      expect.stringContaining("of viewport v2 can never match"),
    ]);
  });
});
