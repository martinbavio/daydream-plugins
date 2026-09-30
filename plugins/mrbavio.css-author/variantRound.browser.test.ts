// The gates at a VARIANT'S finalize (decision #80; variantRound.ts),
// through the tab's real draft handlers: a copy of a page (`draft_open
// {copyOf}`), written, then finalized twice — the host's `variant` on
// the second ask, as the host names it — so the gates judge the
// candidate the kernel builds (its markup at its page's path, its own
// sheet last). What they may refuse is what the variant caused: its own
// css and the rules it wrote or changed in `<style>` blocks, judged as
// the page will read them after the accept, and the classes and inline
// declarations it added. The site's sheets, the rules of its blocks the
// variant keeps, and markup the page already has — wherever the variant
// moved or wrapped it — are advisory, and name no fix; a line of the
// site's the variant leaves dead once accepted is said as such.
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

/** A page of a test's project: `<id>.html`, its body and what its head
 * holds after the sheets it links (`files`, in order, each with its
 * text). */
interface Spec {
  id: string;
  body: string;
  head?: string;
  files: [string, string][];
}

/** A project of `specs`' pages, the plugin mounted over it, and the
 * tab's request handlers. */
async function setup(specs: Spec[]): Promise<Handlers> {
  // A test may judge more than one project: one mounted at a time.
  mounted?.dispose();
  mounted = null;
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
  const shown = specs.map(({ id, body, head = "", files }, i) => {
    const links = files
      .map(([file]) => `<link rel="stylesheet" href="${file}">`)
      .join("");
    const made = createPageItem(
      {
        html: `<!doctype html><html><head>${links}${head}</head><body>${body}</body></html>`,
      },
      { id, frame: { width: 960 }, ...(i === 0 ? {} : { position: { x: 0, y: i * 900 } }) },
    );
    // The linked files first, then the head's `<style>` blocks.
    const blocks = made.page.sheets.filter((it) => "style" in it.source);
    return {
      item: made.item,
      page: {
        ...made.page,
        sheets: [
          ...files.map(([file, text]) => ({ source: { file }, text, readOnly: false })),
          ...blocks,
        ],
      },
    };
  });
  mounted = await mountPlugin({
    entry: activate,
    manifest,
    project: testProject(shown),
    host,
  });
  const h = await createTestRequestHandlers(mounted);
  await vi.waitFor(() => expect(pageElementId(specs[0]!.id, "body")).not.toBeNull());
  return h;
}

/** A draft of `page.html` — a copy (`copyOf`) or a rework in place
 * (`from`) — written by `write`, and its finalize: a copy's twice, the
 * host's `variant` on the second ask, as the host names it. A refused
 * draft is discarded, so another may open. */
async function finalize(
  h: Handlers,
  from: { copyOf: string } | { from: string },
  write: (h: Handlers, draft: string) => Promise<void>,
): Promise<Round> {
  const opened = (await h.draftOpen({ ...from, position: { x: 1200, y: 0 } })) as {
    draft: { id: string };
  };
  const draft = opened.draft.id;
  await write(h, draft);
  type Plan = { planned?: true; epoch?: number; findings?: Finding[] };
  // A copy's first ask goes to the host, which names the variant.
  let plan = (await h.draftFinalize({ draft })) as Plan;
  if ("copyOf" in from) {
    plan = (await h.draftFinalize({
      draft,
      variant: { file: ".daydream/variants/page.1.html", base: "c".repeat(64) },
    })) as Plan;
  }
  if (plan.planned !== true) {
    await h.draftDiscard({ draft });
    return { landed: false, findings: plan.findings ?? [] };
  }
  const landed = (await h.draftCommit({ draft, epoch: plan.epoch })) as {
    findings: Finding[];
  };
  return { landed: true, findings: landed.findings };
}

const copy = (h: Handlers, write: (h: Handlers, draft: string) => Promise<void>) =>
  finalize(h, { copyOf: "page" }, write);
const inPlace = (h: Handlers, write: (h: Handlers, draft: string) => Promise<void>) =>
  finalize(h, { from: "page" }, write);

/** `lint` over the whole project. */
async function lintAll(h: Handlers): Promise<Finding[]> {
  return ((await h.lint({})) as { findings: Finding[] }).findings;
}

/** A project of `page.html` alone, linking `page.css` (`css`), its head
 * holding `head` after it. */
const onePage = (css: string, body: string, head = "") =>
  setup([{ id: "page", body, head, files: [["page.css", css]] }]);

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
  const files: [string, string][] = [["page.css", css]];
  const h = await setup([
    { id: "page", body, head, files },
    ...(about === undefined ? [] : [{ id: "about", body: about, head, files }]),
  ]);
  return copy(h, write);
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
    // the copy's markup no longer has, is said and not refused — as the
    // rule the accept leaves matching nothing.
    expect(
      blocking(initial).every((f) =>
        f.message.includes(".daydream/variants/page.1.css"),
      ),
    ).toBe(true);
    expect(said(initial)).toContainEqual([
      "advisory",
      expect.stringMatching(
        /^rule `\.lead` of `page\.css` in viewport \S+ matches no element; `page\.html` has an element it matches, which this variant removes or changes, so once the variant is accepted it matches nothing there/,
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
    }
    // The site's sheet is never the variant's, whoever else links it; the
    // line its css overrides is said as `lint`'s once the accept appends
    // that css to the sheet `about.html` links too.
    const shared = round.findings.filter((f) => f.property === "color" && f.rule === 0);
    expect(shared.map((f) => [f.severity, f.message])).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^color: red in rule `\.title` of `page\.css` in viewport \S+ changes nothing at [^;]+; this variant's css overrides it, and the accept appends that css to `page\.css`, which `about\.html` links too, so once the variant is accepted it can be dead in `page\.css` on every page that links it, which `lint` refuses until it is removed — it is not refused here$/,
        ),
      ],
    ]);
    for (const finding of round.findings.filter((f) => !shared.includes(f))) {
      expect(finding.severity).toBe("advisory");
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

/** The findings whose message says `text`. */
const about = (round: Round, text: string) =>
  round.findings.filter((f) => f.message.includes(text));

/** What `about` found, as severity and message. */
const saidOf = (round: Round, text: string) =>
  about(round, text).map((f) => [f.severity, f.message]);

const HOOK = '<h1 class="title">Hi</h1><nav class="js-menu"><a href="#">x</a></nav>';
const TITLE = ".title { color: red; }\n";
const WRAP = ".bar { padding: 8px; }\n";

/** What a class finding says of the page's own element, and of one the
 * variant adds. */
const keptHook = (selector: string) =>
  `class "js-menu" on \`${selector}\` in page \`page.html\` is named by no rule; \`page.html\` already has it, and this variant keeps it rather than adding it, so it is not refused`;
const addedHook = (selector: string) =>
  `class "js-menu" on \`${selector}\` in page \`page.html\` is named by no rule; drop it, or write the rule that uses it`;

describe("which of the variant's elements a class or an inline line the page has is the variant's", () => {
  test("a hook copied onto a new element before the page's, which the variant wraps, is refused on the new element, never on the page's", async () => {
    const h = await onePage(TITLE + WRAP, HOOK);
    const round = await copy(h, async (h, draft) => {
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<div class="js-menu">dup</div><header class="bar"><nav class="js-menu"><a href="#">x</a></nav></header>',
      });
    });
    expect(round.landed).toBe(false);
    expect(saidOf(round, "js-menu")).toEqual([
      ["blocking", addedHook("div.js-menu")],
      ["advisory", keptHook("nav.js-menu")],
    ]);
  });

  test("a hook added to an element the page has, beside the page's element the variant wraps, is refused on the one it was added to", async () => {
    const h = await onePage(TITLE + WRAP, HOOK);
    const round = await copy(h, async (h, draft) => {
      await h.draftReplace({ draft, target: "h1", html: '<h1 class="title js-menu">Hi</h1>' });
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<header class="bar"><nav class="js-menu"><a href="#">x</a></nav></header>',
      });
    });
    expect(round.landed).toBe(false);
    expect(saidOf(round, "js-menu")).toEqual([
      ["blocking", addedHook("h1.title.js-menu")],
      ["advisory", keptHook("nav.js-menu")],
    ]);
  });

  test("a hook moved to a new element, or kept on its element with a new tag or new attributes, is the page's", async () => {
    let h = await onePage(TITLE, HOOK);
    const moved = await copy(h, async (h, draft) => {
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<nav><a href="#">x</a></nav><div class="js-menu">dup</div>',
      });
    });
    expect(moved.landed).toBe(true);
    expect(saidOf(moved, "js-menu")).toEqual([["advisory", keptHook("div.js-menu")]]);
    h = await onePage(TITLE, HOOK);
    const retagged = await copy(h, async (h, draft) => {
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<div class="js-menu"><a href="#">x</a></div>',
      });
    });
    expect(retagged.landed).toBe(true);
    expect(blocking(retagged)).toEqual([]);
    h = await onePage(TITLE, HOOK);
    const labelled = await copy(h, async (h, draft) => {
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<nav class="js-menu" aria-label="Main" id="m"><a href="#">x</a></nav>',
      });
    });
    expect(labelled.landed).toBe(true);
    expect(saidOf(labelled, "js-menu")).toEqual([["advisory", keptHook("#m")]]);
  });

  test("with the hook on two of the page's elements, both wrapped, a third copy is the one refused", async () => {
    const h = await onePage(
      TITLE + WRAP,
      '<h1 class="title">Hi</h1><nav class="js-menu">a</nav><nav class="js-menu">b</nav>',
    );
    const round = await copy(h, async (h, draft) => {
      await h.draftRemove({ draft, target: "nav:nth-of-type(2)" });
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<header class="bar"><nav class="js-menu">a</nav><nav class="js-menu">b</nav></header><aside class="js-menu">c</aside>',
      });
    });
    expect(round.landed).toBe(false);
    expect(blocking(round).map((f) => f.message)).toEqual([addedHook("aside.js-menu")]);
  });

  test("a class the variant adds to the page's element it wraps is refused; the page's hook beside it is not", async () => {
    const h = await onePage(TITLE + WRAP, HOOK);
    const round = await copy(h, async (h, draft) => {
      await h.draftReplace({
        draft,
        target: "nav",
        html: '<header class="bar"><nav class="js-menu is-open"><a href="#">x</a></nav></header>',
      });
    });
    expect(said(round)).toEqual([
      [
        "blocking",
        'class "is-open" on `nav.js-menu.is-open` in page `page.html` is named by no rule; drop it, or write the rule that uses it',
      ],
      ["advisory", keptHook("nav.js-menu.is-open")],
    ]);
  });

  test("an inline line is the page's by its whole declaration: its value edited, a line added, or a faulty fallback added before the page's, is refused", async () => {
    const css = TITLE + ".lead { color: green; }\n.box { padding: 4px; }\n";
    const inline = '<h1 class="title">Hi</h1><p class="lead" style="width: 100; color: navy">x</p>';
    const wrapped = (style: string) => async (h: Handlers, draft: string) => {
      await h.draftReplace({
        draft,
        target: "p",
        html: `<div class="box"><p class="lead" style="${style}">x</p></div>`,
      });
    };
    let h = await onePage(css, inline);
    const kept = await copy(h, wrapped("width: 100; color: navy"));
    expect(kept.landed).toBe(true);
    expect(saidOf(kept, "width")).toEqual([
      [
        "advisory",
        "width: 100 on `p.lead` has no unit; `page.html` already has it, and this variant keeps it rather than adding it, so it is not refused",
      ],
    ]);
    h = await onePage(css, inline);
    const edited = await copy(h, wrapped("width: 200; color: navy"));
    expect(blocking(edited).map((f) => f.message)).toEqual([
      "width: 200 on `p.lead` has no unit; a length needs one (px, rem, %, …)",
    ]);
    h = await onePage(css, inline);
    const added = await copy(h, wrapped("width: 100; color: navy; position: static"));
    expect(blocking(added).map((f) => f.message)).toEqual([
      "position: static on `p.lead` restates the initial value",
    ]);
    h = await onePage(css, '<h1 class="title">Hi</h1><p class="lead" style="width: 100px">x</p>');
    const fallback = await copy(h, async (h, draft) => {
      await h.draftRemove({ draft, target: "p" });
      await h.draftReplace({
        draft,
        target: "h1",
        html: '<p class="lead" style="width: 100; width: 100px">x</p><h1 class="title">Hi</h1>',
      });
    });
    expect(fallback.landed).toBe(false);
    expect(blocking(fallback).map((f) => f.message)).toEqual([
      "width: 100 on `p.lead` has no unit; a length needs one (px, rem, %, …)",
    ]);
  });
});

const LEAD = '<h1 class="title">Hi</h1><p class="lead">x</p>';
const FAULTY = "<style>.lead { color: green; position: static; }</style>";
/** What a finding about the page's `position: static` in `.lead` says,
 * in `<style>` block `n`, before its clause. */
const restated = (rule: string, n: number) =>
  new RegExp(
    `^position: static in rule \`\\${rule}\` of \`<style>\` block ${n} of \`page\\.html\` in viewport \\S+ restates the initial value; `,
  );
const KEPT_RULE =
  "that is the page's own rule, which this variant keeps as the page writes it, so it is not refused";

describe("a `<style>` block the variant changes, judged rule by rule", () => {
  test("re-indenting the page's block, or splitting it in two, makes none of its rules the variant's", async () => {
    let h = await onePage(TITLE, LEAD, FAULTY);
    const reindented = await copy(h, async (h, draft) => {
      await h.draftEdit({
        draft,
        html: {
          old: FAULTY,
          new: "<style>\n  .lead {\n    color: green;\n    position: static;\n  }\n</style>",
        },
      });
    });
    expect(reindented.landed).toBe(true);
    expect(saidOf(reindented, "position: static")).toEqual([
      ["advisory", expect.stringMatching(restated(".lead", 1))],
      [
        "advisory",
        expect.stringMatching(/^declaration `position: static` in `\.lead` of `<style>` block 1 of `page\.html` changes nothing in viewport \S+; /),
      ],
    ]);
    for (const finding of reindented.findings) {
      expect(finding.message).toContain(KEPT_RULE);
    }
    const two = "<style>.lead { color: green; }\n.t2 { position: static; }</style>";
    h = await onePage(TITLE, LEAD + '<p class="t2">z</p>', two);
    const split = await copy(h, async (h, draft) => {
      await h.draftEdit({
        draft,
        html: {
          old: two,
          new: "<style>.lead { color: green; }\n</style><style>.t2 { position: static; }</style>",
        },
      });
    });
    expect(split.landed).toBe(true);
    expect(blocking(split)).toEqual([]);
    expect(about(split, "position: static")[0]!.message).toMatch(restated(".t2", 2));
    expect(about(split, "position: static")[0]!.message).toContain(KEPT_RULE);
  });

  test("a rule the variant adds to the page's block, or edits in it, is refused; the page's faulty rule beside it is not", async () => {
    let h = await onePage(TITLE, LEAD + '<p class="lead2">y</p>', FAULTY);
    const added = await copy(h, async (h, draft) => {
      await h.draftEdit({
        draft,
        html: {
          old: FAULTY,
          new: "<style>.lead { color: green; position: static; } .lead2 { color: navy; margin: 12; }</style>",
        },
      });
    });
    expect(added.landed).toBe(false);
    expect(blocking(added).map((f) => f.message)).toEqual([
      "margin: 12 in rule `.lead2` of `<style>` block 1 of `page.html` has no unit; a length needs one (px, rem, %, …)",
    ]);
    expect(saidOf(added, "position: static in rule `.lead`")).toEqual([
      ["advisory", expect.stringMatching(restated(".lead", 1))],
    ]);
    const block = "<style>.lead { color: green; position: static; } .note { color: navy; }</style>";
    h = await onePage(TITLE, LEAD + '<p class="note">n</p>', block);
    const edited = await copy(h, async (h, draft) => {
      await h.draftEdit({
        draft,
        html: { old: ".note { color: navy; }", new: ".note { color: teal; margin: 12; }" },
      });
    });
    expect(edited.landed).toBe(false);
    expect(blocking(edited).map((f) => f.message)).toEqual([
      "margin: 12 in rule `.note` of `<style>` block 1 of `page.html` has no unit; a length needs one (px, rem, %, …)",
    ]);
    const lead = about(edited, "position: static in rule `.lead`");
    expect(lead.map((f) => f.severity)).toEqual(["advisory"]);
    expect(lead[0]!.message).toContain(KEPT_RULE);
  });

  test("a stray `;` the page's block has stays the page's when the variant adds a rule to the block; one the variant writes is refused", async () => {
    const body = '<h1 class="title">Hi</h1><p class="a">a</p><p class="b">b</p><p class="c">c</p>';
    const stray = "<style>.a { color: red; };\n.b { color: blue; }</style>";
    let h = await onePage(TITLE, body, stray);
    const kept = await copy(h, async (h, draft) => {
      await h.draftEdit({
        draft,
        html: { old: ".b { color: blue; }", new: ".b { color: blue; }\n.c { color: navy; }" },
      });
    });
    expect(kept.landed).toBe(true);
    expect(saidOf(kept, "stray")).toEqual([
      [
        "advisory",
        "the stray `;` before `.b` on line 1 of `<style>` block 1 of `page.html` makes the browser drop the rule `.b`; that is the page's own rule, which this variant keeps as the page writes it, so it is not refused",
      ],
    ]);
    const clean = "<style>.a { color: red; }\n.b { color: blue; }</style>";
    h = await onePage(TITLE, body, clean);
    const written = await copy(h, async (h, draft) => {
      await h.draftEdit({ draft, html: { old: "color: red; }", new: "color: red; };" } });
    });
    expect(written.landed).toBe(false);
    expect(blocking(written).map((f) => f.message)).toContainEqual(
      expect.stringMatching(
        /^the stray `;` before `\.b` on line 1 of `<style>` block 1 of `page\.html` makes the browser drop the rule `\.b`; (?!that is the page's own)/,
      ),
    );
  });

  test("a block the variant inserts is its own; the page's block after it, renumbered, stays the page's rule by rule", async () => {
    const h = await onePage(TITLE, LEAD, FAULTY);
    const round = await copy(h, async (h, draft) => {
      await h.draftEdit({
        draft,
        html: { old: FAULTY, new: `<style>.title { margin: 12; }</style>${FAULTY}` },
      });
    });
    expect(round.landed).toBe(false);
    expect(blocking(round).map((f) => f.message)).toEqual([
      "margin: 12 in rule `.title` of `<style>` block 1 of `page.html` has no unit; a length needs one (px, rem, %, …)",
    ]);
    const kept = about(round, "position: static in rule");
    expect(kept.map((f) => f.severity)).toEqual(["advisory"]);
    expect(kept[0]!.message).toMatch(restated(".lead", 2));
    expect(kept[0]!.message).toContain(KEPT_RULE);
    for (const finding of round.findings) {
      expect(finding.message).not.toContain("leaves as it is");
    }
  });

  test("a copy of the page's rule the variant adds is refused as a restatement, and the page's line it leaves dead is said as such", async () => {
    const block = "<style>.lead { color: green; }</style>";
    const h = await onePage(TITLE, LEAD, block);
    const round = await copy(h, async (h, draft) => {
      await h.draftEdit({ draft, html: { old: block, new: block + block } });
    });
    expect(round.landed).toBe(false);
    expect(said(round)).toEqual([
      [
        "blocking",
        expect.stringMatching(
          /^color: green in rule `\.lead` of `<style>` block 2 of `page\.html` in viewport \S+ restates rule `\.lead` of `<style>` block 1 of `page\.html` for every element it reaches; remove it from `\.lead`$/,
        ),
      ],
      [
        "advisory",
        expect.stringMatching(
          /^color: green in rule `\.lead` of `<style>` block 1 of `page\.html` in viewport \S+ changes nothing at [^;]+; this variant's css, or what it writes or moves in the page's `<style>` blocks, overrides it, so once the variant is accepted it is dead in `<style>` block 1 of `page\.html`, and an in-place rework of `page\.html` will refuse it until it is removed there — it is not refused here$/,
        ),
      ],
    ]);
  });

  test("a reorder of the page's blocks that leaves a line it renders dead is said as the variant's doing, never as a block left as it is; in place after the accept it is refused", async () => {
    const two = "<style>.x { color: red; }</style><style>.x { color: blue; }</style>";
    const swapped = "<style>.x { color: blue; }</style><style>.x { color: red; }</style>";
    const body = '<h1 class="title">Hi</h1><p class="x">x</p>';
    let h = await onePage(TITLE, body, two);
    const round = await copy(h, async (h, draft) => {
      await h.draftEdit({ draft, html: { old: two, new: swapped } });
    });
    expect(round.landed).toBe(true);
    expect(saidOf(round, "color: blue")).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^color: blue in rule `\.x` of `<style>` block 1 of `page\.html` in viewport \S+ changes nothing at [^;]+; this variant's css, or what it writes or moves in the page's `<style>` blocks, overrides it, so once the variant is accepted it is dead in `<style>` block 1 of `page\.html`, and an in-place rework of `page\.html` will refuse it until it is removed there — it is not refused here$/,
        ),
      ],
    ]);
    for (const finding of round.findings) {
      expect(finding.message).not.toContain("leaves as it is");
    }
    h = await onePage(TITLE, body, swapped);
    const after = await inPlace(h, async (h, draft) => {
      await h.draftReplace({ draft, target: "h1", html: '<h1 class="title">Hello</h1>' });
    });
    expect(after.landed).toBe(false);
    expect(blocking(after).map((f) => f.message)).toEqual([
      expect.stringMatching(/^color: blue in rule `\.x` of `<style>` block 1 of `page\.html` in viewport page changes nothing at /),
    ]);
  });

  test("the page's rule a reorder moves is said as moved, what the move changes judged in place after the accept", async () => {
    const three =
      "<style>.x { color: red; position: static; }</style><style>.y { color: navy; }</style><style>.z { color: teal; }</style>";
    const moved =
      "<style>.y { color: navy; }</style><style>.z { color: teal; }</style><style>.x { color: red; position: static; }</style>";
    const h = await onePage(
      TITLE,
      '<h1 class="title">Hi</h1><p class="x">x</p><p class="y">y</p><p class="z">z</p>',
      three,
    );
    const round = await copy(h, async (h, draft) => {
      await h.draftEdit({ draft, html: { old: three, new: moved } });
    });
    expect(round.landed).toBe(true);
    expect(about(round, "position: static in rule `.x`").map((f) => [f.severity, f.message])).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^position: static in rule `\.x` of `<style>` block 3 of `page\.html` in viewport \S+ restates the initial value; that is the page's own rule, which this variant keeps as the page writes it but moves among the page's rules, which can change what it overrides or leaves dead, so it is not refused here — once the variant is accepted, an in-place rework of `page\.html` judges it where it then sits$/,
        ),
      ],
    ]);
  });
});

describe("a line of the site's the variant leaves dead once it is accepted", () => {
  test("one that applies only at another width, overridden there by the variant's css, is said as dead after the accept, which an in-place rework then refuses", async () => {
    const css = TITLE + "@media (max-width: 600px) { .title { color: green; } }\n";
    let h = await onePage(css, '<h1 class="title">Hi</h1>');
    const round = await copy(h, async (h, draft) => {
      await h.draftAppend({ draft, css: ".title { color: blue; }" });
    });
    expect(round.landed).toBe(true);
    expect(saidOf(round, "color: green")).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^color: green in rule `\.title` in `@media \(max-width: 600px\)` of `page\.css` in viewport \S+ changes nothing at [^;]+; this variant's css overrides it, so once the variant is accepted it is dead in `page\.css`, and an in-place rework of `page\.html` will refuse it until it is removed there — it is not refused here$/,
        ),
      ],
    ]);
    h = await onePage(css + ".title { color: blue; }\n", '<h1 class="title">Hi</h1>');
    const after = await inPlace(h, async (h, draft) => {
      await h.draftReplace({ draft, target: "h1", html: '<h1 class="title">Hello</h1>' });
    });
    expect(after.landed).toBe(false);
    expect(blocking(after).map((f) => f.property)).toEqual(["color", "color"]);
  });

  test("a rule whose element the variant removes is said as matching nothing after the accept, its lines as changing nothing, which an in-place rework then refuses", async () => {
    const css = TITLE + ".lead { color: green; }\n";
    let h = await onePage(css, LEAD);
    const round = await copy(h, async (h, draft) => {
      await h.draftRemove({ draft, target: "p" });
    });
    expect(round.landed).toBe(true);
    expect(said(round)).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^rule `\.lead` of `page\.css` in viewport \S+ matches no element; `page\.html` has an element it matches, which this variant removes or changes, so once the variant is accepted it matches nothing there, and an in-place rework of `page\.html` will refuse it until it is removed from `page\.css` — it is not refused here$/,
        ),
      ],
      [
        "advisory",
        expect.stringMatching(
          /^color: green in rule `\.lead` of `page\.css` in viewport \S+ changes nothing at [^;]+; `page\.html` has an element its rule matches, which this variant removes or changes, so once the variant is accepted it changes nothing there, and an in-place rework of `page\.html` will refuse it until it is removed from `page\.css` — it is not refused here$/,
        ),
      ],
    ]);
    h = await onePage(css, '<h1 class="title">Hi</h1>');
    const after = await inPlace(h, async (h, draft) => {
      await h.draftReplace({ draft, target: "h1", html: '<h1 class="title">Hello</h1>' });
    });
    expect(after.landed).toBe(false);
    expect(blocking(after)).toHaveLength(2);
  });

  test("an override of a shared sheet's line is said as `lint`'s once the accept appends to that sheet — which `lint` then refuses — and not when the accept appends to a sheet only the page links, which nothing then refuses", async () => {
    const shared = (page: [string, string][], site = TITLE) =>
      setup([
        { id: "page", body: '<h1 class="title">Hi</h1>', files: page },
        { id: "about", body: '<h1 class="title">About</h1>', files: [["site.css", site]] },
      ]);
    const override = async (h: Handlers, draft: string) => {
      await h.draftAppend({ draft, css: ".title { color: blue; }" });
    };
    let h = await shared([["site.css", TITLE]]);
    const appended = await copy(h, override);
    expect(appended.landed).toBe(true);
    expect(said(appended)).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^color: red in rule `\.title` of `site\.css` in viewport \S+ changes nothing at [^;]+; this variant's css overrides it, and the accept appends that css to `site\.css`, which `about\.html` links too, so once the variant is accepted it can be dead in `site\.css` on every page that links it, which `lint` refuses until it is removed — it is not refused here$/,
        ),
      ],
    ]);
    const both = TITLE + ".title { color: blue; }\n";
    h = await shared([["site.css", both]], both);
    expect((await lintAll(h)).map((f) => [f.severity, f.property])).toEqual([
      ["blocking", "color"],
    ]);
    h = await shared([["site.css", TITLE], ["page.css", ".p { margin: 0; }\n"]]);
    const elsewhere = await copy(h, override);
    expect(elsewhere.landed).toBe(true);
    expect(saidOf(elsewhere, "color: red")).toEqual([
      [
        "advisory",
        expect.stringMatching(
          /^declaration `color: red` in `\.title` of `site\.css` changes nothing in viewport \S+; `site\.css` is a sheet of `page\.html`, the page this variant is of, which a variant round never writes, so it is not refused$/,
        ),
      ],
    ]);
    h = await shared([["site.css", TITLE], ["page.css", ".title { color: blue; }\n"]]);
    expect(await lintAll(h)).toEqual([]);
  });
});
