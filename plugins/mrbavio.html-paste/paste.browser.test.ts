// The paste hook through the loader seam (decision #56): the real
// shell with this plugin enabled (and Media, where the order matters),
// synthetic paste events, and what a user observes — the items, the
// selection, one undo step, the console lines, the page rendered in its
// shadow root — never the registry. What Text does with a paste this
// plugin leaves is Text's to test: here, leaving it is the event not
// being claimed. A claimed paste is a new page of the project (decision
// #78), made through `dd.createPage` over the kernel's fake project host
// (`fakeProjectHost`), which names and records each page as the host
// does, in memory. That the host downloads a page's media into `assets/`
// and writes the bytes as sent is the kernel's to test on a real host.
// What a pasted page is on the canvas — it renders, what would run never
// does, and its text stays one an editor can save — is this plugin's
// choice of what to write, so it is tested here; the fake host reads a
// page's `<style>` blocks as its sheets where a test needs them
// (`readingStyles`), as the real one does.
//
// Dropped for good with the cleaning and the folding (decision #78: the
// file is the pasted text): the fixtures and tests of `<style>` folded
// into the css (nesting, custom properties, `@font-face`, at-rules, a
// class grid, an id hero, a whole document, a Chrome fragment), of what
// the cleaning cut and said, and of `data:` images stored as assets —
// the kernel downloads remote media only, and a `data:` url stays as
// written.
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DaydreamApi, PluginManifest } from "@daydream/plugin-api";
import {
  fakeProjectHost,
  flush,
  mountPlugin,
  mountShell,
  pageShadow,
  testProject,
  viewportItems,
  type FakeProjectHost,
  type Host,
  type MountedShell,
} from "@daydream/plugin-testing";

import form from "./fixtures/form.html?raw";
import hero from "./fixtures/hero.html?raw";
import hostile from "./fixtures/hostile.html?raw";
import mediaInterleaved from "./fixtures/media-interleaved.html?raw";
import mixedInline from "./fixtures/mixed-inline.html?raw";
import ornaments from "./fixtures/ornaments.html?raw";
import svgIcon from "./fixtures/svg-icon.html?raw";
import table from "./fixtures/table.html?raw";
import activate from "./index";
import manifest from "./manifest.json";
import {
  DOCTYPE,
  hasElements,
  htmlSource,
  looksLikeMarkup,
  MAX_ELEMENTS,
  MAX_SOURCE,
  parseHtml,
} from "./paste";
import { isSingleParagraph } from "./prose";

const PLUGIN = "mrbavio.html-paste";

function transfer(data: Record<string, string>): DataTransfer {
  const out = new DataTransfer();
  for (const [type, value] of Object.entries(data)) out.setData(type, value);
  return out;
}

function paste(
  target: EventTarget,
  data: Record<string, string>,
): ClipboardEvent {
  const event = new ClipboardEvent("paste", {
    clipboardData: transfer(data),
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  flush();
  return event;
}

/** The shell with Media and this plugin, in their compiled order. */
const mountWithMedia = () =>
  mountShell({
    project: testProject([]),
    compiled: ["daydream.media", PLUGIN],
    settled: true,
  });

/** This plugin alone over an empty project whose pages are made by the
 * fake project host (`host` to stand in for it), its `dd` in hand;
 * `wrap` stands in for what the plugin is handed. */
async function mountMade(
  options: {
    host?: Host;
    open?: boolean;
    wrap?: (dd: DaydreamApi) => DaydreamApi;
  } = {},
): Promise<{ shell: MountedShell; dd: DaydreamApi; fake: FakeProjectHost }> {
  let dd: DaydreamApi | null = null;
  const fake = fakeProjectHost();
  const shell = await mountPlugin({
    entry: (api) => {
      dd = api;
      activate(options.wrap?.(api) ?? api);
    },
    manifest: manifest as PluginManifest,
    project: testProject([], options.open === false ? { project: null } : {}),
    host: options.host ?? fake.host,
  });
  return { shell, dd: dd!, fake };
}

const items = (shell: MountedShell) => shell.store.document.canvases[0]!.items;

/** The pages' viewports once `count` have been placed: a page is written
 * by the host before it is placed, never in the paste event. */
async function placed(shell: MountedShell, count: number) {
  await vi.waitFor(() =>
    expect(viewportItems(shell.store.document)).toHaveLength(count),
  );
  return viewportItems(shell.store.document);
}

/** The plugin's own lines on the console's `level`, from a spy
 * installed per test. */
type Level = "info" | "warn" | "error";
const spies: Partial<
  Record<Level, { mock: { calls: unknown[][] }; mockRestore(): void }>
> = {};
const LEVELS: readonly Level[] = ["info", "warn", "error"];
const lines = (level: Level): string[] =>
  (spies[level]?.mock.calls ?? [])
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(`[${PLUGIN}]`));

afterEach(() => {
  for (const level of LEVELS) {
    spies[level]?.mockRestore();
    delete spies[level];
  }
});

const quiet = (): void => {
  for (const level of LEVELS) {
    spies[level] = vi.spyOn(console, level).mockImplementation(() => {});
  }
};

describe("claiming", () => {
  test("htmlSource: files, text, and markup-free HTML are left; markup in either type is taken, with the text it was parsed from", () => {
    expect(htmlSource(null)).toBeNull();
    expect(htmlSource(transfer({ "text/plain": "hello" }))).toBeNull();
    expect(htmlSource(transfer({ "text/plain": "<3 you" }))).toBeNull();
    expect(htmlSource(transfer({ "text/html": "just words" }))).toBeNull();
    expect(
      htmlSource(transfer({ "text/plain": "  <p>markup</p>" }))?.text,
    ).toBe("  <p>markup</p>");
    expect(
      htmlSource(
        transfer({
          "text/html": "<h2>rich</h2><p>and structured</p>",
          "text/plain": "rich\nand structured",
        }),
      )?.text,
    ).toBe("<h2>rich</h2><p>and structured</p>");
    const withFile = new DataTransfer();
    withFile.items.add(new File(["x"], "a.png", { type: "image/png" }));
    withFile.setData("text/html", "<h2>rich</h2><p>and structured</p>");
    expect(htmlSource(withFile)).toBeNull();
    // A paragraph copied from a page is prose: left for Text, as long as
    // the plain-text face carries it.
    const paragraph =
      "<meta charset='utf-8'><p style=\"color: rgb(0, 0, 0); font-size: 16px\">One <b>paragraph</b> of prose.</p>";
    expect(
      htmlSource(
        transfer({
          "text/html": paragraph,
          "text/plain": "One paragraph of prose.",
        }),
      ),
    ).toBeNull();
    // With no plain face to hand to Text, nothing lands rather than a
    // page holding one line.
    expect(htmlSource(transfer({ "text/html": paragraph }))).toBeNull();
    expect(
      htmlSource(
        transfer({
          "text/html": "<meta charset='utf-8'><br>",
          "text/plain": "\n",
        }),
      ),
    ).toBeNull();
    // An editor's copy: the markup is the plain face, the html face is a
    // syntax-highlighted rendering of it. The markup wins, as written.
    const highlighted =
      '<div style="white-space: pre"><span style="color: #569cd6">&lt;section&gt;</span><span>Hi</span></div>';
    const markup = "<section><h1>Hi</h1><p>There</p></section>";
    const source = htmlSource(
      transfer({ "text/html": highlighted, "text/plain": markup }),
    );
    expect(source?.doc.body.firstElementChild?.localName).toBe("section");
    expect(source?.text).toBe(markup);
    expect(
      htmlSource(
        transfer({
          "text/html": "<p>one</p><p>two</p>",
          "text/plain": "one\ntwo",
        }),
      ),
    ).not.toBeNull();
  });

  test("looksLikeMarkup: prose that opens with < is not markup; a closing tag is", () => {
    expect(looksLikeMarkup("<T> extends Foo<U>")).toBe(false);
    expect(looksLikeMarkup("<Component /> renders the list")).toBe(false);
    expect(looksLikeMarkup("<noreply@example.com> wrote:")).toBe(false);
    expect(looksLikeMarkup("<3 you")).toBe(false);
    expect(looksLikeMarkup("  <p>markup</p>")).toBe(true);
    expect(looksLikeMarkup("<section><h1>Hi</h1></section>")).toBe(true);
    expect(looksLikeMarkup("<o:p></o:p>")).toBe(true);
    for (const text of ["<T> extends Foo<U>", "<Component /> renders"])
      expect(htmlSource(transfer({ "text/plain": text }))).toBeNull();
    // Structure with nothing in it lands nothing.
    expect(
      htmlSource(
        transfer({ "text/html": "<p> </p><p> </p>", "text/plain": "\n\n" }),
      ),
    ).toBeNull();
  });

  test("isSingleParagraph: prose in any browser wrapper is one paragraph; structure, lists and replaced content are not", () => {
    const one = (html: string) => isSingleParagraph(parse(html));
    expect(
      one(
        "<meta charset='utf-8'><span style=\"color: red\">a few words</span>",
      ),
    ).toBe(true);
    expect(
      one('<p>One <b>bold</b> <a href="https://x">link</a><br>and more.</p>'),
    ).toBe(true);
    expect(one("<div><p>wrapped twice</p></div>")).toBe(true);
    expect(one("<!--StartFragment-->words<!--EndFragment-->")).toBe(true);
    expect(one("<h1>A heading alone</h1>")).toBe(true);
    expect(one("<pre>two\nlines</pre>")).toBe(true);
    expect(one("<p>text</p><script>x()</script>")).toBe(true);
    expect(one("<p>text</p><style>p { color: red }</style>")).toBe(true);
    expect(one("")).toBe(true);
    expect(one("<p>one</p><p>two</p>")).toBe(false);
    expect(one("<div><p>one</p><p>two</p></div>")).toBe(false);
    expect(one("<ul><li>a</li><li>b</li></ul>")).toBe(false);
    // Structure with one item in it is still structure.
    expect(one("<ul><li>alone</li></ul>")).toBe(false);
    expect(one("<table><tr><td>one cell</td></tr></table>")).toBe(false);
    expect(one("<figure><p>captioned</p></figure>")).toBe(false);
    // Google Docs and Word wrappers are looked through.
    expect(
      one(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:11pt">From Docs</span></p></b>',
      ),
    ).toBe(true);
    expect(one('<p class="MsoNormal">From Word<o:p></o:p></p>')).toBe(true);
    expect(one("<p>lead</p> trailing words")).toBe(false);
    expect(one('<p>An <img src="https://x/a.png"> inline image</p>')).toBe(
      false,
    );
    expect(one('<span>an <svg width="1"></svg> icon</span>')).toBe(false);
    // A page renders an iframe now (sandboxed): an embed is content.
    expect(one('<p>See <iframe src="https://x/embed"></iframe></p>')).toBe(
      false,
    );
    expect(one("<p><span><div>block inside</div></span></p>")).toBe(false);
    expect(one("<table><tr><td>a</td><td>b</td></tr></table>")).toBe(false);
  });
});

const parse = parseHtml;

describe("pasting a page", () => {
  test("an HTML paste writes one new page of the pasted text, places it 960 wide and selected as one undo step, and says so in one line", async () => {
    quiet();
    const { shell, fake } = await mountMade();
    const event = paste(document.body, {
      "text/html": hero,
      "text/plain": "Ship layouts, not mockups",
    });
    expect(event.defaultPrevented).toBe(true);
    const [viewport] = await placed(shell, 1);
    // The file is the pasted text, as it arrived — a fragment's after a
    // doctype — named by the host: the first page of a project is its
    // index.
    expect(fake.made).toEqual([{ html: DOCTYPE + hero, title: null }]);
    expect(viewport!.payload).toEqual({ page: "index.html" });
    expect(shell.store.page("index.html")?.html).toBe(DOCTYPE + hero);
    expect(viewport!.frame).toEqual({ width: 960 });
    // Selected as an item is: the envelope id is the primary and the set.
    await vi.waitFor(() =>
      expect(shell.store.selectedId()).toBe(viewport!.id),
    );
    expect(shell.store.selectedItemIds()).toEqual([viewport!.id]);
    // The section renders on the canvas with its inline styles, in the
    // page's shadow root.
    const heading = await vi.waitFor(() => {
      const found = pageShadow(viewport!.id)?.querySelector("h1");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(heading.textContent).toBe("Ship layouts, not mockups");
    expect(getComputedStyle(heading).fontSize).toBe("48px");
    // One undo step: an undo takes the viewport off, a redo puts it back.
    expect(shell.store.canUndo()).toBe(true);
    shell.store.undo();
    flush();
    expect(viewportItems(shell.store.document)).toHaveLength(0);
    expect(shell.store.canUndo()).toBe(false);
    shell.store.redo();
    flush();
    expect(viewportItems(shell.store.document)).toHaveLength(1);
    expect(lines("info")).toEqual([
      `[${PLUGIN}] pasted a page: index.html, 960px wide`,
    ]);
    expect(lines("warn")).toEqual([]);
    expect(lines("error")).toEqual([]);
  });

  test("a page after the first is named after its <title>, -2 while the name is taken", async () => {
    quiet();
    const { shell, fake } = await mountMade();
    const titled =
      "<!doctype html><html><head><title>Pricing &amp; plans</title></head><body><h1>Plans</h1><p>Two</p></body></html>";
    paste(document.body, { "text/plain": "<h2>first</h2><p>page</p>" });
    await placed(shell, 1);
    paste(document.body, { "text/plain": titled });
    await placed(shell, 2);
    paste(document.body, { "text/plain": titled });
    const pages = (await placed(shell, 3)).map((item) => item.payload.page);
    expect(pages).toEqual([
      "index.html",
      "pricing-plans.html",
      "pricing-plans-2.html",
    ]);
    expect(fake.made.map((made) => made.title)).toEqual([
      null,
      "Pricing & plans",
      "Pricing & plans",
    ]);
  });

  test("each remote file the host could not download is said on the console, left as written", async () => {
    quiet();
    const fake = fakeProjectHost();
    const project = fake.host.project!;
    const host: Host = {
      ...fake.host,
      project: {
        ...project,
        createPage: async (...args) => {
          const made = await project.createPage!(...args);
          return {
            ...made,
            unvendored: [
              { url: "https://cdn.example/hero.png", reason: "HTTP 404" },
            ],
          };
        },
      },
    };
    const { shell } = await mountMade({ host });
    paste(document.body, {
      "text/plain":
        '<section><img src="https://cdn.example/hero.png" alt="hero"><p>Copy</p></section>',
    });
    await placed(shell, 1);
    await vi.waitFor(() => expect(lines("info")).toHaveLength(1));
    expect(lines("warn")).toEqual([
      `[${PLUGIN}] https://cdn.example/hero.png could not be downloaded into assets/ (HTTP 404): it stays as written`,
    ]);
  });

  test("with no project open the paste is claimed, refused in the kernel's words, and nothing is written", async () => {
    quiet();
    const { shell, fake } = await mountMade({ open: false });
    const event = paste(document.body, { "text/html": hero });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(lines("error")).toHaveLength(1));
    expect(lines("error")[0]).toMatch(
      new RegExp(`^\\[${PLUGIN}\\] paste refused: Making a page needs an open project`),
    );
    expect(fake.made).toEqual([]);
    expect(items(shell)).toHaveLength(0);
    expect(shell.store.canUndo()).toBe(false);
  });

  test("consecutive pastes cascade by 16px; another action resets the cascade", async () => {
    quiet();
    const { shell, dd } = await mountMade();
    paste(document.body, { "text/html": "<h2>one</h2><p>first</p>" });
    paste(document.body, { "text/html": "<h2>two</h2><p>second</p>" });
    const [first, second] = await placed(shell, 2);
    expect(second!.position.x - first!.position.x).toBe(16);
    expect(second!.position.y - first!.position.y).toBe(16);
    shell.store.setSelectedId(null);
    flush();
    // The start is read from the canvas as the paste reads it.
    const center = dd.canvas.center();
    paste(document.body, { "text/html": "<h2>three</h2><p>third</p>" });
    const third = (await placed(shell, 3))[2]!;
    expect(third.position).toEqual({
      x: center.x - 960 / 2,
      y: center.y - 960 / 4,
    });
  });

  test("a paragraph copied from a website is left for Text; two paragraphs, a list or a paragraph with an image are pages", async () => {
    quiet();
    const { shell } = await mountMade();
    const chrome = (fragment: string) => `<meta charset='utf-8'>${fragment}`;
    const claimed = [
      paste(document.body, {
        "text/html": chrome(
          '<p style="color: rgb(33, 37, 41); font-family: system-ui; font-size: 16px">Copied from a <a href="https://example.com">page</a>.</p>',
        ),
        "text/plain": "Copied from a page.",
      }),
      paste(document.body, {
        "text/html": chrome('<span style="font-size: 16px">a few words</span>'),
        "text/plain": "a few words",
      }),
      paste(document.body, {
        "text/html": chrome("<p>First.</p><p>Second.</p>"),
        "text/plain": "First.\n\nSecond.",
      }),
      paste(document.body, {
        "text/html": chrome("<ul><li>one</li><li>two</li></ul>"),
        "text/plain": "one\ntwo",
      }),
      paste(document.body, {
        "text/html": chrome(
          '<p>With an <img src="https://example.com/a.png" alt="a"> image.</p>',
        ),
        "text/plain": "With an image.",
      }),
    ].map((event) => event.defaultPrevented);
    expect(claimed).toEqual([false, false, true, true, true]);
    expect((await placed(shell, 3)).map((item) => item.kind)).toEqual([
      "daydream.viewport",
      "daydream.viewport",
      "daydream.viewport",
    ]);
  });

  test("plain text is left for Text; plain text that is markup is a page, as it was typed", async () => {
    quiet();
    const { shell, fake } = await mountMade();
    const claimed = [
      paste(document.body, { "text/plain": "just a note" }),
      paste(document.body, { "text/plain": "<3 you" }),
      // Markup typed as plain text is deliberate: one paragraph is a page.
      paste(document.body, { "text/plain": '<p style="color: red">red</p>' }),
      // A whitespace-only rich copy (an empty line) is nothing.
      paste(document.body, {
        "text/html": "<meta charset='utf-8'><br>",
        "text/plain": "\n",
      }),
    ].map((event) => event.defaultPrevented);
    expect(claimed).toEqual([false, false, true, false]);
    await placed(shell, 1);
    expect(fake.made.map((made) => made.html)).toEqual([
      `${DOCTYPE}<p style="color: red">red</p>`,
    ]);
  });

  test("a paste past the element cap or the source cap is refused with a console line before a page is made", async () => {
    quiet();
    const { shell, fake } = await mountMade();
    const many = paste(document.body, {
      "text/html": "<p>x</p>".repeat(MAX_ELEMENTS + 1),
      "text/plain": "x",
    });
    expect(many.defaultPrevented).toBe(true);
    const novel = paste(document.body, {
      "text/plain": "x".repeat(MAX_SOURCE + 1),
    });
    expect(novel.defaultPrevented).toBe(true);
    expect(fake.made).toHaveLength(0);
    expect(items(shell)).toHaveLength(0);
    expect(lines("error")).toEqual([
      `[${PLUGIN}] paste refused: ${MAX_ELEMENTS + 1} elements; a viewport holds at most ${MAX_ELEMENTS}`,
      `[${PLUGIN}] paste refused: ${MAX_SOURCE + 1} characters; a paste carries at most ${MAX_SOURCE}`,
    ]);
  });

  test("the element cap counts every element the page would hold: the head's, and each template's content", async () => {
    quiet();
    const { fake } = await mountMade();
    // A template's content is not in the tree, and is the page's all the same.
    const templated = paste(document.body, {
      "text/html": `<template>${"<p>x</p>".repeat(MAX_ELEMENTS)}</template><h1>Title</h1><p>Copy</p>`,
    });
    expect(templated.defaultPrevented).toBe(true);
    // What the parser puts in the head is the page's too.
    const headed = paste(document.body, {
      "text/html": `${'<meta name="a">'.repeat(MAX_ELEMENTS)}<h1>Title</h1><p>Copy</p>`,
    });
    expect(headed.defaultPrevented).toBe(true);
    expect(fake.made).toHaveLength(0);
    expect(lines("error")).toEqual([
      `[${PLUGIN}] paste refused: ${MAX_ELEMENTS + 3} elements; a viewport holds at most ${MAX_ELEMENTS}`,
      `[${PLUGIN}] paste refused: ${MAX_ELEMENTS + 2} elements; a viewport holds at most ${MAX_ELEMENTS}`,
    ]);
  });

  test("an image-only HTML paste still goes to Media", async () => {
    const shell = await mountWithMedia();
    const event = paste(document.body, {
      "text/html": '<img src="https://example.com/browser-paste.png">',
      "text/plain": "fallback",
    });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(items(shell)).toHaveLength(1), {
      timeout: 3000,
    });
    expect(items(shell)[0]).toMatchObject({
      kind: "daydream.image",
      payload: { src: "https://example.com/browser-paste.png" },
    });
  });

  test("a paste into a text field is left alone", async () => {
    const { shell, fake } = await mountMade();
    const field = document.createElement("textarea");
    shell.host.appendChild(field);
    field.focus();
    const event = paste(field, { "text/html": hero, "text/plain": "hero" });
    expect(event.defaultPrevented).toBe(false);
    expect(fake.made).toHaveLength(0);
  });

  test("hasElements tells markup from text that starts with <", () => {
    expect(hasElements(parse("<3 you"))).toBe(false);
    expect(hasElements(parse("<b>3</b> you"))).toBe(true);
    expect(hasElements(parse("plain words"))).toBe(false);
    // A lone stylesheet is hoisted to the head: nothing for the body.
    expect(hasElements(parse("<style>p{}</style>"))).toBe(false);
  });
});

/** The fake host, its made page read as the host reads one: each
 * `<style>` block of its markup a sheet, in document order. */
function readingStyles(fake: FakeProjectHost): Host {
  const project = fake.host.project!;
  return {
    ...fake.host,
    project: {
      ...project,
      createPage: async (...args) => {
        const made = await project.createPage!(...args);
        const styles = Array.from(parseHtml(made.page.html).querySelectorAll("style"));
        return {
          ...made,
          page: {
            ...made.page,
            sheets: styles.map((style, n) => ({
              source: { style: n },
              text: style.textContent ?? "",
              readOnly: false,
            })),
          },
        };
      },
    },
  };
}

/** Paste `html` as markup from an editor, which is always claimed (a
 * fixture that is one paragraph would be prose as a rich copy), and wait
 * for its page to render: its viewport id, its stored text and its
 * shadow root. */
async function pastedPage(
  html: string,
): Promise<{ shell: MountedShell; dd: DaydreamApi; id: string; path: string; html: string; shadow: ShadowRoot }> {
  const fake = fakeProjectHost();
  const { shell, dd } = await mountMade({ host: readingStyles(fake) });
  paste(document.body, { "text/plain": html });
  const [viewport] = await placed(shell, 1);
  const path = viewport!.payload.page;
  const shadow = await vi.waitFor(() => {
    const root = pageShadow(viewport!.id);
    expect(root?.querySelector("body")?.childElementCount ?? 0).toBeGreaterThan(0);
    return root!;
  });
  return { shell, dd, id: viewport!.id, path, html: shell.store.page(path)!.html, shadow };
}

describe("the file a paste writes", () => {
  test("a fragment is written after a doctype, so a browser renders the file as the canvas does; a document's own doctype is the author's", async () => {
    quiet();
    const { shell, fake } = await mountMade();
    const legacy =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html><head><title>Old</title></head><body><h1>Old</h1><p>page</p></body></html>';
    paste(document.body, { "text/plain": "<h2>a</h2><p>fragment</p>" });
    await placed(shell, 1);
    paste(document.body, { "text/plain": legacy });
    await placed(shell, 2);
    expect(fake.made.map((made) => made.html)).toEqual([
      "<!doctype html>\n<h2>a</h2><p>fragment</p>",
      legacy,
    ]);
  });

  test("a viewport made that could not be selected is said as what it is, never a refused paste", async () => {
    quiet();
    const { shell } = await mountMade({
      wrap: (dd) => ({
        ...dd,
        select: () => {
          throw new Error("Plugin is disabled");
        },
      }),
    });
    paste(document.body, { "text/plain": "<h2>a</h2><p>page</p>" });
    await placed(shell, 1);
    await vi.waitFor(() => expect(lines("error")).toHaveLength(1));
    expect(lines("error")).toEqual([
      `[${PLUGIN}] pasted a page: index.html, but its viewport could not be selected: Plugin is disabled`,
    ]);
    expect(lines("info")).toEqual([]);
  });

  test("a pan while a page is being written starts the cascade over", async () => {
    quiet();
    const fake = fakeProjectHost();
    const project = fake.host.project!;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host: Host = {
      ...fake.host,
      project: {
        ...project,
        createPage: async (...args) => {
          await held;
          return project.createPage!(...args);
        },
      },
    };
    const { shell, dd } = await mountMade({ host });
    paste(document.body, { "text/html": "<h2>one</h2><p>first</p>" });
    shell.store.setPanX((x) => x + 100);
    flush();
    release();
    await placed(shell, 1);
    const center = dd.canvas.center();
    paste(document.body, { "text/html": "<h2>two</h2><p>second</p>" });
    const second = (await placed(shell, 2))[1]!;
    // Placed where the kernel rounds it: 16px from here were a cascade.
    expect(second.position.x).toBeCloseTo(center.x - 960 / 2, 0);
    expect(second.position.y).toBeCloseTo(center.y - 960 / 4, 0);
  });
});

describe("a pasted page on the canvas", () => {
  test("a table is a table, every part itself, every cell's inline style kept", async () => {
    quiet();
    const { shadow } = await pastedPage(table);
    expect(shadow.querySelectorAll("table > thead > tr > th")).toHaveLength(2);
    const cells = shadow.querySelectorAll("table > tbody > tr > td");
    expect(cells).toHaveLength(4);
    expect(getComputedStyle(cells[1]!).textAlign).toBe("right");
  });

  test("a form keeps its controls and their attributes", async () => {
    quiet();
    const { shadow } = await pastedPage(form);
    const input = shadow.querySelector("form input[type=email]");
    expect(input?.getAttribute("placeholder")).toBe("you@example.com");
    expect(shadow.querySelectorAll("select > option")).toHaveLength(2);
    expect(shadow.querySelector("textarea")?.textContent).toBe("Tell us more");
    expect(shadow.querySelector("button[type=submit]")).not.toBeNull();
  });

  test("an inline svg is the drawing, at its own size", async () => {
    quiet();
    const { shadow } = await pastedPage(svgIcon);
    const svg = shadow.querySelector("button > svg");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M5 12l5 5L20 7");
    expect(svg!.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(svg!).width).toBe("20px");
  });

  test("mixed inline runs render as written: text beside elements, the br kept", async () => {
    quiet();
    const { shadow } = await pastedPage(mixedInline);
    const p = shadow.querySelector("p")!;
    expect(p.querySelector("strong")?.textContent).toBe("bold");
    expect(p.querySelector("br")).not.toBeNull();
    expect(p.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Hello bold and emphatic, with a link, abreak, and code.",
    );
  });

  test("its `<style>` applies against the 960 frame: a @media rule, kept in the file as written", async () => {
    quiet();
    const { shadow, html } = await pastedPage(mediaInterleaved);
    const btn = shadow.querySelector(".btn")!;
    expect(getComputedStyle(btn).paddingLeft).toBe("24px");
    expect(html).toBe(DOCTYPE + mediaInterleaved);
  });

  test("its `<style>` applies: a ::before ornament", async () => {
    quiet();
    const { shadow } = await pastedPage(ornaments);
    const tag = shadow.querySelector(".tag")!;
    expect(getComputedStyle(tag, "::before").content).toBe('"★ "');
  });

  test("deep nesting is written as pasted and renders: the innermost words are on the canvas", async () => {
    quiet();
    const deep = 84;
    const source = `${"<div>".repeat(deep)}deep words${"</div>".repeat(deep)}`;
    const { shadow, html } = await pastedPage(source);
    expect(html).toBe(DOCTYPE + source);
    await vi.waitFor(() => expect(shadow.textContent).toContain("deep words"));
  });

  test("a hostile paste is written as it arrived and renders inert: nothing that runs reaches the canvas", async () => {
    quiet();
    const { shadow, html } = await pastedPage(hostile);
    // The file is the author's: nothing is cut from it.
    expect(html).toBe(DOCTYPE + hostile);
    for (const tag of ["script", "object", "embed", "base"])
      expect(shadow.querySelector(tag), tag).toBeNull();
    expect(shadow.querySelector("meta[http-equiv]")).toBeNull();
    for (const element of Array.from(shadow.querySelectorAll("*"))) {
      for (const attr of Array.from(element.attributes)) {
        expect(attr.name.toLowerCase().startsWith("on"), attr.name).toBe(false);
        expect(attr.name).not.toBe("srcdoc");
        expect(/^\s*javascript:/i.test(attr.value), attr.value).toBe(false);
      }
    }
    expect(shadow.querySelector("iframe")?.getAttribute("sandbox")).not.toBe(null);
  });

  test("its file stays one an editor of its text can save: dd.writePage accepts an ordinary edit, the markup that would run kept", async () => {
    quiet();
    const { shell, dd, path, html } = await pastedPage(
      '<style>.card { padding: 16px }</style>\n<div class="card" onclick="steal()">\n  <h3>Title</h3>\n  <a href="/about">About</a>\n</div>\n<script>steal()</script>',
    );
    const edited = html.replace("<h3>Title</h3>", "<h3>A new title</h3>");
    expect(edited).not.toBe(html);
    expect(dd.writePage({ kind: "html", path, expected: html, html: edited })).toBeNull();
    expect(shell.store.page(path)!.html).toBe(edited);
  });
});
