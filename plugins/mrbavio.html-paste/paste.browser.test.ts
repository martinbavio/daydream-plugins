// The paste hook through the loader seam (decision #56): the real
// shell with Media, Text and this plugin enabled, synthetic paste events,
// and what a user observes — the items, the selection, one undo step,
// one console line — never the registry.
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createEmptyDocument,
  flush,
  mountShell,
  type Host,
  type HostStorage,
  type MountedShell,
} from "@daydream/plugin-testing";

import hero from "./fixtures/hero.html?raw";
import dataImage from "./fixtures/data-image.html?raw";
import { htmlSource, looksLikeMarkup, MAX_ELEMENTS, MAX_SOURCE } from "./paste";
import { MAX_DEPTH } from "./convert";
import { isSingleParagraph } from "./prose";

const PLUGIN = "mrbavio.html-paste";
const PLUGINS = ["daydream.media", "mrbavio.text", PLUGIN];

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore(): void };

/** The plugin's own console lines, from a spy installed per test. */
function infoLines(spy: InfoSpy): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(`[${PLUGIN}]`));
}

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

function canvasEl(shell: MountedShell): HTMLElement {
  const found = shell.host.querySelector<HTMLElement>('[class*="_canvas_"]');
  if (found === null) throw new Error("no canvas element");
  return found;
}

const mount = (host?: Host) =>
  mountShell({
    document: createEmptyDocument(),
    compiled: PLUGINS,
    settled: true,
    ...(host === undefined ? {} : { host }),
  });

let info: InfoSpy | null = null;
afterEach(() => {
  info?.mockRestore();
  info = null;
});

describe("claiming", () => {
  test("htmlSource: files, text, and markup-free HTML are left; markup in either type is taken", () => {
    expect(htmlSource(null)).toBeNull();
    expect(htmlSource(transfer({ "text/plain": "hello" }))).toBeNull();
    expect(htmlSource(transfer({ "text/plain": "<3 you" }))).toBeNull();
    expect(htmlSource(transfer({ "text/html": "just words" }))).toBeNull();
    expect(
      htmlSource(transfer({ "text/plain": "  <p>markup</p>" })),
    ).not.toBeNull();
    expect(
      htmlSource(
        transfer({
          "text/html": "<h2>rich</h2><p>and structured</p>",
          "text/plain": "rich\nand structured",
        }),
      ),
    ).not.toBeNull();
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
    // syntax-highlighted rendering of it. The markup wins.
    const highlighted =
      '<div style="white-space: pre"><span style="color: #569cd6">&lt;section&gt;</span><span>Hi</span></div>';
    const source = htmlSource(
      transfer({
        "text/html": highlighted,
        "text/plain": "<section><h1>Hi</h1><p>There</p></section>",
      }),
    );
    expect(source?.body.firstElementChild?.localName).toBe("section");
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
    expect(one("<p><span><div>block inside</div></span></p>")).toBe(false);
    expect(one("<table><tr><td>a</td><td>b</td></tr></table>")).toBe(false);
  });
});

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

describe("landing", () => {
  test("an HTML paste lands one selected 960-wide viewport as one undo step and logs one line", async () => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    const shell = await mount();
    const event = paste(document.body, {
      "text/html": hero,
      "text/plain": "Ship layouts, not mockups",
    });
    expect(event.defaultPrevented).toBe(true);
    const items = shell.store.document.items;
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.kind).toBe("daydream.viewport");
    expect(item.frame).toEqual({ width: 960 });
    const root = (item.payload as { root: { id: string; tag: string } }).root;
    expect(root.tag).toBe("html");
    // Selected as a viewport is: its root is the primary, the item the set.
    expect(shell.store.selectedId()).toBe(root.id);
    expect(shell.store.selectedItemIds()).toEqual([item.id]);
    // The section renders on the canvas with its inline styles.
    const heading = shell.host.querySelector("h1");
    expect(heading?.textContent).toBe("Ship layouts, not mockups");
    expect(getComputedStyle(heading!).fontSize).toBe("48px");
    // One undo step for the paste and the selection together.
    expect(shell.store.canUndo()).toBe(true);
    shell.store.undo();
    flush();
    expect(shell.store.document.items).toHaveLength(0);
    expect(shell.store.canUndo()).toBe(false);
    shell.store.redo();
    flush();
    expect(shell.store.document.items).toHaveLength(1);
    // One line, under the plugin id, naming what was lost.
    const lines = infoLines(info);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`[${PLUGIN}] landed 6 elements; 1 !important`);
    // No panel, no toast: nothing of the plugin's in the page.
    expect(shell.host.textContent).not.toContain("!important");
  });

  test("consecutive pastes cascade by 16px; another action resets the cascade", async () => {
    const shell = await mount();
    paste(document.body, { "text/html": "<h2>one</h2><p>first</p>" });
    paste(document.body, { "text/html": "<h2>two</h2><p>second</p>" });
    const [first, second] = shell.store.document.items;
    expect(second!.position.x - first!.position.x).toBe(16);
    expect(second!.position.y - first!.position.y).toBe(16);
    shell.store.setSelectedId(null);
    flush();
    paste(document.body, { "text/html": "<h2>three</h2><p>third</p>" });
    const third = shell.store.document.items[2]!;
    expect(third.position).toEqual(first!.position);
  });

  test("a paragraph copied from a website lands as Text; two paragraphs, a list or a paragraph with an image land as a viewport", async () => {
    const shell = await mount();
    const chrome = (fragment: string) => `<meta charset='utf-8'>${fragment}`;
    paste(document.body, {
      "text/html": chrome(
        '<p style="color: rgb(33, 37, 41); font-family: system-ui; font-size: 16px">Copied from a <a href="https://example.com">page</a>.</p>',
      ),
      "text/plain": "Copied from a page.",
    });
    paste(document.body, {
      "text/html": chrome('<span style="font-size: 16px">a few words</span>'),
      "text/plain": "a few words",
    });
    paste(document.body, {
      "text/html": chrome("<p>First.</p><p>Second.</p>"),
      "text/plain": "First.\n\nSecond.",
    });
    paste(document.body, {
      "text/html": chrome("<ul><li>one</li><li>two</li></ul>"),
      "text/plain": "one\ntwo",
    });
    paste(document.body, {
      "text/html": chrome(
        '<p>With an <img src="https://example.com/a.png" alt="a"> image.</p>',
      ),
      "text/plain": "With an image.",
    });
    expect(
      shell.store.document.items.map((item) => [item.kind, item.payload]),
    ).toEqual([
      ["mrbavio.text", { text: "Copied from a page." }],
      ["mrbavio.text", { text: "a few words" }],
      ["daydream.viewport", expect.anything()],
      ["daydream.viewport", expect.anything()],
      ["daydream.viewport", expect.anything()],
    ]);
  });

  test("plain text still goes to Text; plain text that is markup lands a viewport", async () => {
    const shell = await mount();
    paste(document.body, { "text/plain": "just a note" });
    paste(document.body, { "text/plain": "<3 you" });
    // Markup typed as plain text is deliberate: one paragraph still lands.
    paste(document.body, { "text/plain": '<p style="color: red">red</p>' });
    // A whitespace-only rich copy (an empty line) lands nothing.
    paste(document.body, {
      "text/html": "<meta charset='utf-8'><br>",
      "text/plain": "\n",
    });
    expect(shell.store.document.items.map((item) => item.kind)).toEqual([
      "mrbavio.text",
      "mrbavio.text",
      "daydream.viewport",
    ]);
    expect(shell.store.document.items[1]!.payload).toEqual({
      text: "<3 you",
    });
  });

  test("a paste past the element cap or the source cap is refused with a console line and lands nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const shell = await mount();
      const many = paste(document.body, {
        "text/html": "<p>x</p>".repeat(MAX_ELEMENTS + 1),
        "text/plain": "x",
      });
      expect(many.defaultPrevented).toBe(true);
      const novel = paste(document.body, {
        "text/plain": "x".repeat(MAX_SOURCE + 1),
      });
      expect(novel.defaultPrevented).toBe(true);
      expect(shell.store.document.items).toHaveLength(0);
      expect(shell.store.canUndo()).toBe(false);
      expect(error.mock.calls.map((call) => String(call[0]))).toEqual([
        `[${PLUGIN}] paste refused: ${MAX_ELEMENTS + 1} elements; a viewport holds at most ${MAX_ELEMENTS}`,
        `[${PLUGIN}] paste refused: ${MAX_SOURCE + 1} characters; a paste carries at most ${MAX_SOURCE}`,
      ]);
    } finally {
      error.mockRestore();
    }
  });

  test("a tree at the depth cap renders: the leaf's words are on the canvas", async () => {
    const shell = await mount();
    const deep = MAX_DEPTH + 20;
    paste(document.body, {
      "text/html": `${"<div>".repeat(deep)}deep words${"</div>".repeat(deep)}`,
      "text/plain": "deep words",
    });
    expect(shell.store.document.items).toHaveLength(1);
    await vi.waitFor(() =>
      expect(shell.host.textContent).toContain("deep words"),
    );
  });

  test("an image-only HTML paste still goes to Media", async () => {
    const shell = await mount();
    paste(document.body, {
      "text/html": '<img src="/assets/browser-paste.png">',
      "text/plain": "fallback",
    });
    await vi.waitFor(() => expect(shell.store.document.items).toHaveLength(1), {
      timeout: 3000,
    });
    expect(shell.store.document.items[0]).toMatchObject({
      kind: "daydream.image",
      payload: { src: "/assets/browser-paste.png" },
    });
  });

  test("a paste while Text has an editor focused is left alone", async () => {
    const shell = await mount();
    const canvas = canvasEl(shell);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: rect.left + 120,
        clientY: rect.top + 120,
      }),
    );
    flush();
    let editor: HTMLElement | null = null;
    await vi.waitFor(() => {
      editor = shell.host.querySelector<HTMLElement>("[data-text-editor]");
      expect(editor).not.toBeNull();
      expect(document.activeElement).toBe(editor);
    });
    const event = paste(editor!, { "text/html": hero, "text/plain": "hero" });
    expect(event.defaultPrevented).toBe(false);
    expect(shell.store.document.items).toHaveLength(0);
  });
});

describe("data: images", () => {
  test("are vendored through the host before the viewport lands, once, as one undo step", async () => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    const vendorFile = vi.fn(async (file: File) => ({
      src: `/assets/${file.name}`,
    }));
    const shell = await mount({
      storage: { vendorFile } as unknown as HostStorage,
    });
    const event = paste(document.body, { "text/html": dataImage });
    expect(event.defaultPrevented).toBe(true);
    // Nothing lands until the file is stored.
    expect(shell.store.document.items).toHaveLength(0);
    await vi.waitFor(() => expect(shell.store.document.items).toHaveLength(1));
    expect(vendorFile).toHaveBeenCalledTimes(1);
    expect(vendorFile.mock.calls[0]![0].type).toBe("image/png");
    const img = shell.host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/assets/pasted-image.png");
    expect(img?.getAttribute("alt")).toBe("One dot");
    shell.store.undo();
    flush();
    expect(shell.store.document.items).toHaveLength(0);
    expect(shell.store.canUndo()).toBe(false);
    expect(infoLines(info)).toEqual([
      `[${PLUGIN}] landed 5 elements, nothing lost`,
    ]);
  });

  test("an svg icon inside a sentence lands: the downgrade is a span the structure gate keeps (decision #57)", async () => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const shell = await mount();
    paste(document.body, {
      "text/html":
        '<p>Save <svg width="10" height="10"><path d="M0 0"/></svg> now</p>',
    });
    expect(error).not.toHaveBeenCalled();
    expect(shell.store.document.items).toHaveLength(1);
    const p = shell.host.querySelector("p")!;
    expect(p.querySelector("div")).toBeNull();
    const spans = Array.from(p.querySelectorAll("span"));
    expect(spans.map((span) => getComputedStyle(span).width)).toContain("10px");
    error.mockRestore();
  });

  test("a document loaded while vendoring abandons the paste; without storage the img lands with its alt and the src is counted", async () => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    let release: (value: { src: string }) => void = () => {};
    const vendorFile = vi.fn(
      () =>
        new Promise<{ src: string }>((resolve) => {
          release = resolve;
        }),
    );
    const shell = await mount({
      storage: { vendorFile } as unknown as HostStorage,
    });
    paste(document.body, { "text/html": dataImage });
    await vi.waitFor(() => expect(vendorFile).toHaveBeenCalledTimes(1));
    shell.store.loadDocument(createEmptyDocument(), { slug: null });
    flush();
    release({ src: "/assets/late.png" });
    await vi.waitFor(() =>
      expect(infoLines(info!)).toEqual([
        `[${PLUGIN}] paste abandoned: another document was loaded while its images were vendored`,
      ]),
    );
    expect(shell.store.document.items).toHaveLength(0);
    shell.dispose();

    const bare = await mount({});
    paste(document.body, { "text/html": dataImage });
    await vi.waitFor(() => expect(bare.store.document.items).toHaveLength(1));
    const img = bare.host.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("alt")).toBe("One dot");
    expect(infoLines(info).at(-1)).toBe(
      `[${PLUGIN}] landed 5 elements; image src dropped data:×1`,
    );
  });
});
