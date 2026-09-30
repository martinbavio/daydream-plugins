// The paste hook through the loader seam (decision #56): the real
// shell with this plugin enabled (and Media, where the order matters),
// synthetic paste events, and what a user observes — the items, the
// selection, the console line — never the registry. What Text does with a
// paste this plugin leaves is Text's to test: here, leaving it is the
// event not being claimed. A claimed paste is a new page, which the
// kernel does not make yet (decision #78): what can be read of one is
// what the plugin ASKED the kernel to place (`dd.mutateItems`, recorded)
// and the refusal it reported. That a pasted page lands, renders, is
// cleaned and has its `data:` images stored is Phase 6's to test again.
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  DaydreamApi,
  DreamItem,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  flush,
  mountPlugin,
  mountShell,
  testProject,
  type MountedShell,
} from "@daydream/plugin-testing";

import hero from "./fixtures/hero.html?raw";
import activate from "./index";
import manifest from "./manifest.json";
import { hasElements } from "./page";
import { htmlSource, looksLikeMarkup, MAX_ELEMENTS, MAX_SOURCE } from "./paste";
import { isSingleParagraph } from "./prose";

const PLUGIN = "mrbavio.html-paste";

/** What `dd.mutateItems` answers a viewport carrying a page's text, for
 * now (the kernel's src/core/notYet.ts PAGE_TEXT_NOT_YET, which a plugin
 * cannot import). */
const PAGE_NOT_YET =
  /: Making a page on the canvas is not yet in the project model: a viewport shows a page of the project by its path, \{ page \}\.$/;

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

/** This plugin alone over an empty project, its `dd` in hand and every
 * item it asked the kernel to add recorded, as the mutation left it. */
async function mountRecorded(): Promise<{
  shell: MountedShell;
  dd: DaydreamApi;
  asked: DreamItem[];
}> {
  let dd: DaydreamApi | null = null;
  const asked: DreamItem[] = [];
  const shell = await mountPlugin({
    entry: (api) => {
      dd = api;
      activate({
        ...api,
        mutateItems: (mutation) =>
          api.mutateItems((items) => {
            const before = new Set(items.map((item) => item.id));
            mutation(items);
            for (const item of items) {
              if (!before.has(item.id)) asked.push(structuredClone(item));
            }
          }),
      });
    },
    manifest: manifest as PluginManifest,
    project: testProject([]),
  });
  return { shell, dd: dd!, asked };
}

const items = (shell: MountedShell) => shell.store.document.canvases[0]!.items;

/** The plugin's own error lines, from a spy installed per test. */
let errors: { mock: { calls: unknown[][] }; mockRestore(): void } | null = null;
const errorLines = (): string[] =>
  (errors?.mock.calls ?? [])
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(`[${PLUGIN}]`));

afterEach(() => {
  errors?.mockRestore();
  errors = null;
});

const quiet = (): void => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
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

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

describe("pasting a page", () => {
  test("an HTML paste is claimed and asks for one 960-wide page of the pasted text; the kernel's not-yet refusal is its one console line, and nothing lands", async () => {
    quiet();
    const { shell, asked } = await mountRecorded();
    const event = paste(document.body, {
      "text/html": hero,
      "text/plain": "Ship layouts, not mockups",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      kind: "daydream.viewport",
      frame: { width: 960 },
      payload: { html: hero },
    });
    const lines = errorLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^\\[${PLUGIN}\\] paste refused: `));
    expect(lines[0]).toMatch(PAGE_NOT_YET);
    // Nothing written: no item, no selection, no undo step.
    expect(items(shell)).toHaveLength(0);
    expect(shell.store.selectedId()).toBeNull();
    expect(shell.store.canUndo()).toBe(false);
  });

  test("consecutive pastes cascade by 16px; another action resets the cascade", async () => {
    quiet();
    const { shell, dd, asked } = await mountRecorded();
    paste(document.body, { "text/html": "<h2>one</h2><p>first</p>" });
    paste(document.body, { "text/html": "<h2>two</h2><p>second</p>" });
    const [first, second] = asked;
    expect(second!.position.x - first!.position.x).toBe(16);
    expect(second!.position.y - first!.position.y).toBe(16);
    // Nothing landed to select or deselect: a pan is the other action.
    shell.store.setPanX(shell.store.panX() + 40);
    flush();
    const center = dd.canvas.center();
    paste(document.body, { "text/html": "<h2>three</h2><p>third</p>" });
    expect(asked[2]!.position).toEqual({
      x: center.x - 960 / 2,
      y: center.y - 960 / 4,
    });
  });

  test("a paragraph copied from a website is left for Text; two paragraphs, a list or a paragraph with an image are pages", async () => {
    quiet();
    const { asked } = await mountRecorded();
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
    expect(asked.map((item) => item.kind)).toEqual([
      "daydream.viewport",
      "daydream.viewport",
      "daydream.viewport",
    ]);
  });

  test("plain text is left for Text; plain text that is markup is a page, as it was typed", async () => {
    quiet();
    const { asked } = await mountRecorded();
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
    expect(asked.map((item) => item.payload)).toEqual([
      { html: '<p style="color: red">red</p>' },
    ]);
  });

  test("a paste past the element cap or the source cap is refused with a console line before the kernel is asked", async () => {
    quiet();
    const { shell, asked } = await mountRecorded();
    const many = paste(document.body, {
      "text/html": "<p>x</p>".repeat(MAX_ELEMENTS + 1),
      "text/plain": "x",
    });
    expect(many.defaultPrevented).toBe(true);
    const novel = paste(document.body, {
      "text/plain": "x".repeat(MAX_SOURCE + 1),
    });
    expect(novel.defaultPrevented).toBe(true);
    expect(asked).toHaveLength(0);
    expect(items(shell)).toHaveLength(0);
    expect(errorLines()).toEqual([
      `[${PLUGIN}] paste refused: ${MAX_ELEMENTS + 1} elements; a viewport holds at most ${MAX_ELEMENTS}`,
      `[${PLUGIN}] paste refused: ${MAX_SOURCE + 1} characters; a paste carries at most ${MAX_SOURCE}`,
    ]);
  });

  test("the element cap counts every element the page would hold: the head's, and each template's content", async () => {
    quiet();
    const { asked } = await mountRecorded();
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
    expect(asked).toHaveLength(0);
    expect(errorLines()).toEqual([
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
    const { shell, asked } = await mountRecorded();
    const field = document.createElement("textarea");
    shell.host.appendChild(field);
    field.focus();
    const event = paste(field, { "text/html": hero, "text/plain": "hero" });
    expect(event.defaultPrevented).toBe(false);
    expect(asked).toHaveLength(0);
  });

  test("hasElements tells markup from text that starts with <", () => {
    expect(hasElements(parse("<3 you"))).toBe(false);
    expect(hasElements(parse("<b>3</b> you"))).toBe(true);
    expect(hasElements(parse("plain words"))).toBe(false);
    // A lone stylesheet is hoisted to the head: nothing for the body.
    expect(hasElements(parse("<style>p{}</style>"))).toBe(false);
  });
});
