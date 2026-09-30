// The gates at a VARIANT'S finalize (decision #80; variantRound.ts),
// through the tab's real draft handlers: a copy of a page (`draft_open
// {copyOf}`), written, then finalized twice — the host's `variant` on
// the second ask, as the host names it — so the gates judge the
// candidate the kernel builds (its markup at its page's path, its own
// sheet last). What they may refuse is what the variant caused: its own
// css and the `<style>` blocks it changed or added, judged as the page
// will read them after the accept, and the classes and inline lines it
// added. The site's sheets, and markup the page already has — wherever
// the variant moved or wrapped it — are advisory, and name no fix.
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Finding, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestRequestHandlers,
  mountPlugin,
  overrideHostForTests,
  pageElementId,
  testProject,
  unusedProjectFiles,
  type Host,
  type HostProject,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import activate, { NECESSITY_GATE, STATIC_GATE } from "./index";

const manifest: PluginManifest = {
  id: "mrbavio.css-author",
  name: "CSS author",
  version: "0.1.0",
  minCore: "0.1.0",
  contributes: { gates: [STATIC_GATE, NECESSITY_GATE] },
};

let mounted: MountedPlugin | null = null;
afterEach(() => {
  overrideHostForTests(null);
  mounted?.dispose();
  mounted = null;
});

type Handlers = Awaited<ReturnType<typeof createTestRequestHandlers>>;

/** What a variant's finalize answered: refused with its findings, or
 * landed (committed, as the host does once it wrote the files) with the
 * advisory ones. */
interface Round {
  landed: boolean;
  findings: Finding[];
}

/**
 * A project of `page.html` (`body` in its body, linking `page.css`,
 * whose text is `css`, then `head` in its head, and `about.html` too
 * when `about` is its body), a copy of it opened and written by `write`,
 * and the copy's finalize.
 */
async function variantRound(
  css: string,
  write: (h: Handlers, draft: string) => Promise<void>,
  body = '<h1 class="title">Hi</h1><p class="lead">x</p>',
  { about, head = "" }: { about?: string; head?: string } = {},
): Promise<Round> {
  const project: HostProject = {
    read: () => Promise.reject(new Error("not read in this test")),
    open: () => Promise.resolve({ cancelled: true }),
    saveManifest: () => Promise.resolve({ hash: "0".repeat(64) }),
    ...unusedProjectFiles,
  };
  const host = {
    storage: {
      loadPluginData: vi.fn(async () => ({})),
      savePluginData: vi.fn(async () => {}),
    },
    project,
  } as unknown as Host;
  overrideHostForTests(host);
  const sheet = { source: { file: "page.css" }, text: css, readOnly: false };
  const pageOf = (id: string, inner: string) => {
    const made = createPageItem(
      {
        html: `<!doctype html><html><head><link rel="stylesheet" href="page.css">${head}</head><body>${inner}</body></html>`,
      },
      {
        id,
        frame: { width: 960 },
        ...(id === "page" ? {} : { position: { x: 0, y: 900 } }),
      },
    );
    // The linked file first, then the head's `<style>` blocks.
    const blocks = made.page.sheets.filter((it) => "style" in it.source);
    return {
      item: made.item,
      page: { ...made.page, sheets: [sheet, ...blocks] },
    };
  };
  const shown = [
    pageOf("page", body),
    ...(about === undefined ? [] : [pageOf("about", about)]),
  ];
  mounted = await mountPlugin({
    entry: activate,
    manifest,
    project: testProject(shown),
    host,
  });
  const h = await createTestRequestHandlers(mounted);
  await vi.waitFor(() => expect(pageElementId("page", "h1")).not.toBeNull());
  const opened = (await h.draftOpen({
    copyOf: "page",
    position: { x: 1200, y: 0 },
  })) as {
    draft: { id: string };
  };
  const draft = opened.draft.id;
  await write(h, draft);
  // The first ask goes to the host, which names the variant.
  await h.draftFinalize({ draft });
  const plan = (await h.draftFinalize({
    draft,
    variant: { file: ".daydream/variants/page.1.html", base: "c".repeat(64) },
  })) as {
    planned?: true;
    epoch?: number;
    landed?: false;
    findings?: Finding[];
  };
  if (plan.planned !== true)
    return { landed: false, findings: plan.findings ?? [] };
  const landed = (await h.draftCommit({ draft, epoch: plan.epoch })) as {
    findings: Finding[];
  };
  return { landed: true, findings: landed.findings };
}

const said = (round: Round) =>
  round.findings.map((f) => [f.severity, f.message]);
const blocking = (round: Round) =>
  round.findings.filter((f) => f.severity === "blocking");

/** A finding that names a fix to make in the site's files. */
const FIX = /; (?:drop|remove)|a length needs one|remove the face/;

describe("css-author gates at a variant's finalize", () => {
  test("a JavaScript hook class the page already has, outside what the variant changes, is advisory; a class the variant writes with no rule is refused", async () => {
    const hook =
      '<h1 class="title">Hi</h1><nav class="js-menu"><a href="#">x</a></nav>';
    const round = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftAppend({ draft, css: ".title { color: blue; }" });
      },
      hook,
    );
    expect(round.landed).toBe(true);
    const menu = round.findings.filter((f) => f.message.includes("js-menu"));
    expect(menu.map((f) => f.severity)).toEqual(["advisory"]);
    expect(menu[0]!.message).toBe(
      'class "js-menu" on `nav.js-menu` in page `page.html` is named by no rule; `page.html` already has it, and this variant keeps it rather than adding it, so it is not refused',
    );
    // A class the variant itself writes, on markup it changed, is its to
    // fix in the draft; the page's hook beside it is still not refused.
    const own = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "h1",
          html: '<h1 class="title loud">Hi</h1>',
        });
      },
      hook,
    );
    expect(own.landed).toBe(false);
    expect(blocking(own).map((f) => f.message)).toEqual([
      'class "loud" on `h1.title.loud` in page `page.html` is named by no rule; drop it, or write the rule that uses it',
    ]);
  });

  test("a unit-less length the site's sheet already has is advisory and names no fix; one in the variant's own css is refused", async () => {
    const round = await variantRound(
      ".title { color: red; }\n.lead { width: 100; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "h1",
          html: '<h1 class="title">Hello</h1>',
        });
      },
    );
    expect(round.landed).toBe(true);
    const unit = round.findings.filter((f) => f.property === "width");
    expect(unit.map((f) => [f.severity, f.message])).toEqual([
      [
        "advisory",
        "width: 100 in rule `.lead` of `page.css` has no unit; `page.css` is a sheet of `page.html`, the page this variant is of, which a variant round never writes, so it is not refused",
      ],
    ]);
    for (const finding of round.findings)
      expect(finding.message).not.toMatch(FIX);
    const own = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftAppend({ draft, css: ".title { margin: 12; }" });
      },
    );
    expect(own.landed).toBe(false);
    expect(blocking(own).map((f) => f.message)).toContainEqual(
      "margin: 12 in rule `.title` of the draft's css (`.daydream/variants/page.1.css`) has no unit; a length needs one (px, rem, %, …)",
    );
  });

  test("the variant's own css is judged as the page will read it after the accept: a restated initial, a rule restating the page's, or a line that changes nothing is refused", async () => {
    const initial = await variantRound(
      ".title { color: red; }\n.lead { color: green; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "p",
          html: '<div class="intro">x</div>',
        });
        await h.draftAppend({
          draft,
          css: ".intro { position: static; color: green; }",
        });
      },
    );
    expect(initial.landed).toBe(false);
    expect(blocking(initial).map((f) => f.message)).toContainEqual(
      expect.stringMatching(
        /^position: static in rule `\.intro` of the draft's css \(`\.daydream\/variants\/page\.1\.css`\) in viewport \S+ restates the initial value$/,
      ),
    );
    // Nothing the site's sheet says is a refusal of it: `.lead`, which
    // the copy's markup no longer has, is said and not refused.
    expect(
      blocking(initial).every((f) =>
        f.message.includes(".daydream/variants/page.1.css"),
      ),
    ).toBe(true);
    expect(said(initial)).toContainEqual([
      "advisory",
      expect.stringMatching(
        /^rule `\.lead` of `page\.css` matches no element in viewport \S+; `page\.css` is a sheet of `page\.html`/,
      ),
    ]);
    const restating = await variantRound(
      ".title { color: red; }\n.lead { color: green; }\n",
      async (h, draft) => {
        await h.draftAppend({ draft, css: ".lead { color: green; }" });
      },
    );
    expect(restating.landed).toBe(false);
    expect(blocking(restating).map((f) => f.message)).toContainEqual(
      expect.stringMatching(
        /^color: green in rule `\.lead` of the draft's css \(`\.daydream\/variants\/page\.1\.css`\) in viewport \S+ restates rule `\.lead` of `page\.css` for every element it reaches; remove it from `\.lead`$/,
      ),
    );
    const dead = await variantRound(
      ".title { color: red; }\n.lead { color: green; }\n",
      async (h, draft) => {
        await h.draftAppend({
          draft,
          css: ".title { color: blue; display: block; }",
        });
      },
    );
    expect(dead.landed).toBe(false);
    expect(blocking(dead).map((f) => [f.property, f.message])).toContainEqual([
      "display",
      expect.stringMatching(
        /^display: block in rule `\.title` of the draft's css \(`\.daydream\/variants\/page\.1\.css`\) in viewport \S+ changes nothing at /,
      ),
    ]);
  });

  test("an override the variant makes lands, and the page's line it leaves dead after the accept is said, advisory, naming its rule, no fix here and no page as not judged", async () => {
    const round = await variantRound(
      ".title { color: red; display: block; }\n.lead { color: green; }\n",
      async (h, draft) => {
        await h.draftAppend({ draft, css: ".title { color: blue; }" });
      },
    );
    expect(round.landed).toBe(true);
    expect(blocking(round)).toEqual([]);
    const overridden = round.findings.filter((f) => f.property === "color");
    expect(overridden.map((f) => [f.severity, f.rule, f.message])).toEqual([
      [
        "advisory",
        0,
        expect.stringMatching(
          /^color: red in rule `\.title` of `page\.css` in viewport \S+ changes nothing at [\d, ]+ or \d+px; this variant's css overrides it, so once the variant is accepted it is dead in `page\.css`, and an in-place rework of `page\.html` will refuse it until it is removed there — it is not refused here$/,
        ),
      ],
    ]);
    // Said once: not again among the site's dead lines, where a line
    // dead with or without the variant still is.
    expect(
      round.findings.filter((f) => f.message.includes("`color: red`")),
    ).toEqual([]);
    expect(said(round)).toContainEqual([
      "advisory",
      expect.stringMatching(
        /^declaration `display: block` in `\.title` of `page\.css` changes nothing in viewport \S+; `page\.css` is a sheet of `page\.html`, the page this variant is of, which a variant round never writes, so it is not refused$/,
      ),
    ]);
    // The variant is its page: never a page that "was not judged".
    for (const finding of round.findings) {
      expect(finding.message).not.toContain(".daydream/variants/page.1.html");
      expect(finding.message).not.toContain("was not judged");
      expect(finding.message).not.toContain("were not judged");
    }
  });

  test("with another page linking the site's sheet, a variant still names no fix in it, and names the other page nowhere as the variant", async () => {
    const round = await variantRound(
      ".title { color: red; }\n.about { color: blue; }\n",
      async (h, draft) => {
        await h.draftAppend({ draft, css: ".title { color: blue; }" });
      },
      '<h1 class="title">Hi</h1>',
      { about: '<h1 class="about">About</h1>' },
    );
    expect(round.landed).toBe(true);
    expect(round.findings.length).toBeGreaterThan(0);
    for (const finding of round.findings) {
      expect(finding.message).not.toContain(".daydream/variants/page.1.html");
      expect(finding.message).not.toMatch(FIX);
      // The site's sheet is never the variant's, whoever else links it.
      expect(finding.message).toContain(
        "`page.css` is a sheet of `page.html`, the page this variant is of, which a variant round never writes",
      );
    }
  });

  test("a hook class and an inline line the page already has stay advisory when the variant wraps or moves their element, naming no fix", async () => {
    const hook =
      '<h1 class="title">Hi</h1><nav class="js-menu" style="width: 100"><a href="#">x</a></nav><footer class="js-foot">f</footer>';
    const wrapped = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "nav",
          html: '<header class="bar"><nav class="js-menu" style="width: 100"><a href="#">x</a></nav></header>',
        });
        await h.draftAppend({ draft, css: ".bar { padding: 8px; }" });
      },
      hook,
    );
    expect(wrapped.landed).toBe(true);
    expect(said(wrapped)).toEqual(
      expect.arrayContaining([
        [
          "advisory",
          'class "js-menu" on `nav.js-menu` in page `page.html` is named by no rule; `page.html` already has it, and this variant keeps it rather than adding it, so it is not refused',
        ],
        [
          "advisory",
          "width: 100 on `nav.js-menu` has no unit; `page.html` already has it, and this variant keeps it rather than adding it, so it is not refused",
        ],
      ]),
    );
    for (const finding of wrapped.findings) {
      expect(finding.message).not.toMatch(FIX);
      expect(finding.message).not.toContain("write the rule");
    }
    // Two elements swapped, each carrying a hook: moved, not added.
    const swapped = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftRemove({ draft, target: "footer" });
        await h.draftReplace({
          draft,
          target: "nav",
          html: '<footer class="js-foot">f</footer><nav class="js-menu" style="width: 100"><a href="#">x</a></nav>',
        });
      },
      hook,
    );
    expect(swapped.landed).toBe(true);
    expect(blocking(swapped)).toEqual([]);
    expect(
      swapped.findings
        .filter((f) => /js-(?:menu|foot)"/.test(f.message))
        .map((f) => f.severity),
    ).toEqual(["advisory", "advisory"]);
    for (const finding of swapped.findings)
      expect(finding.message).not.toMatch(FIX);
  });

  test("a hook class copied onto an element the variant adds is refused once past as many elements as the page has it on", async () => {
    const round = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "nav",
          html: '<nav class="js-menu"><a href="#">x</a></nav><div class="js-menu">y</div>',
        });
      },
      '<h1 class="title">Hi</h1><nav class="js-menu"><a href="#">x</a></nav>',
    );
    expect(round.landed).toBe(false);
    expect(said(round)).toEqual([
      [
        "blocking",
        'class "js-menu" on `div.js-menu` in page `page.html` is named by no rule; drop it, or write the rule that uses it',
      ],
      [
        "advisory",
        'class "js-menu" on `nav.js-menu` in page `page.html` is named by no rule; `page.html` already has it, and this variant keeps it rather than adding it, so it is not refused',
      ],
    ]);
  });

  test("a `<style>` block the variant edits or adds is judged like its own css; one it leaves as the page has it is advisory", async () => {
    const block = "<style>.lead { color: green; width: 100; }</style>";
    const edited = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftEdit({
          draft,
          html: {
            old: ".lead { color: green; width: 100; }",
            new: ".lead { color: green; width: 100; margin: 12; position: static; }",
          },
        });
      },
      undefined,
      { head: block },
    );
    expect(edited.landed).toBe(false);
    expect(blocking(edited).map((f) => f.message)).toEqual(
      expect.arrayContaining([
        "margin: 12 in rule `.lead` of `<style>` block 1 of `page.html` has no unit; a length needs one (px, rem, %, …)",
        "width: 100 in rule `.lead` of `<style>` block 1 of `page.html` has no unit; a length needs one (px, rem, %, …)",
        expect.stringMatching(
          /^position: static in rule `\.lead` of `<style>` block 1 of `page\.html` in viewport \S+ restates the initial value$/,
        ),
      ]),
    );
    const added = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "h1",
          html: '<h1 class="title loud">Hi</h1><style>.loud { margin: 12; position: static; }</style>',
        });
      },
    );
    expect(added.landed).toBe(false);
    expect(blocking(added).map((f) => f.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^margin: 12 in rule `\.loud` of `<style>` block \d of `page\.html` has no unit; a length needs one/,
        ),
        expect.stringMatching(
          /^position: static in rule `\.loud` of `<style>` block \d of `page\.html` in viewport \S+ restates the initial value$/,
        ),
      ]),
    );
    // The page's block, as it stands, is the site's: its fault is said.
    const kept = await variantRound(
      ".title { color: red; }\n",
      async (h, draft) => {
        await h.draftReplace({
          draft,
          target: "h1",
          html: '<h1 class="title">Hello</h1>',
        });
      },
      undefined,
      { head: block },
    );
    expect(kept.landed).toBe(true);
    expect(
      kept.findings
        .filter((f) => f.property === "width")
        .map((f) => [f.severity, f.message]),
    ).toEqual([
      [
        "advisory",
        "width: 100 in rule `.lead` of `<style>` block 1 of `page.html` has no unit; `<style>` block 1 of `page.html` is the page's own, which this variant leaves as it is, so it is not refused",
      ],
    ]);
    for (const finding of kept.findings)
      expect(finding.message).not.toMatch(FIX);
  });
});
