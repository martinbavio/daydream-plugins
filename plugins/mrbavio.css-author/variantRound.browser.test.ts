// The gates at a VARIANT'S finalize (decision #80; variantRound.ts),
// through the tab's real draft handlers: a copy of a page (`draft_open
// {copyOf}`), written, then finalized twice — the host's `variant` on
// the second ask, as the host names it — so the gates judge the
// candidate the kernel builds (its markup at its page's path, its own
// sheet last). What they may refuse is what the variant caused: its own
// css, judged as the page will read it after the accept, and the markup
// it changed. The site's sheets, and markup the page already has, are
// advisory, and name no fix.
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
 * whose text is `css`, and `about.html` too when `about` is its body),
 * a copy of it opened and written by `write`, and the copy's finalize.
 */
async function variantRound(
  css: string,
  write: (h: Handlers, draft: string) => Promise<void>,
  body = '<h1 class="title">Hi</h1><p class="lead">x</p>',
  about?: string,
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
        html: `<!doctype html><html><head><link rel="stylesheet" href="page.css"></head><body>${inner}</body></html>`,
      },
      {
        id,
        frame: { width: 960 },
        ...(id === "page" ? {} : { position: { x: 0, y: 900 } }),
      },
    );
    return { item: made.item, page: { ...made.page, sheets: [sheet] } };
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
      'class "js-menu" on `nav.js-menu` in page `page.html` is named by no rule; `page.html` has it there too, outside what this variant changes, so it is not refused',
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

  test("an override the variant makes lands, and the page's line it leaves dead after the accept is said, advisory, naming no page as not judged", async () => {
    const round = await variantRound(
      ".title { color: red; }\n.lead { color: green; }\n",
      async (h, draft) => {
        await h.draftAppend({ draft, css: ".title { color: blue; }" });
      },
    );
    expect(round.landed).toBe(true);
    expect(blocking(round)).toEqual([]);
    expect(said(round)).toContainEqual([
      "advisory",
      expect.stringMatching(
        /^declaration `color: red` in `\.title` of `page\.css` changes nothing in viewport \S+; `page\.css` is a sheet of `page\.html`, the page this variant is of, which a variant round never writes, so it is not refused$/,
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
      '<h1 class="about">About</h1>',
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
});
