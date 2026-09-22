// The paste hook through the loader seam (decision #56): the real
// shell with Media and this plugin enabled, synthetic paste events, and
// what a user observes — the items, the selection, one undo step, one
// console line, the page rendered in its shadow root (decision #76) —
// never the registry. What Text does with a paste this plugin leaves is
// Text's to test: here, leaving it is the event not being claimed.
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createEmptyDocument,
  flush,
  mountShell,
  pageNode,
  pageShadow,
  viewportItems,
  type Host,
  type HostStorage,
  type MountedShell,
} from "@daydream/plugin-testing";

import dataImage from "./fixtures/data-image.html?raw";
import form from "./fixtures/form.html?raw";
import hero from "./fixtures/hero.html?raw";
import hostile from "./fixtures/hostile.html?raw";
import mediaInterleaved from "./fixtures/media-interleaved.html?raw";
import mixedInline from "./fixtures/mixed-inline.html?raw";
import ornaments from "./fixtures/ornaments.html?raw";
import svgIcon from "./fixtures/svg-icon.html?raw";
import table from "./fixtures/table.html?raw";
import { htmlSource, looksLikeMarkup, MAX_ELEMENTS, MAX_SOURCE } from "./paste";
import { isSingleParagraph } from "./prose";

const PLUGIN = "mrbavio.html-paste";
const PLUGINS = ["daydream.media", PLUGIN];

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

const mount = (host?: Host) =>
  mountShell({
    document: createEmptyDocument(),
    compiled: PLUGINS,
    settled: true,
    ...(host === undefined ? {} : { host }),
  });

/** The one page on the canvas, and its shadow root once it has mounted. */
async function landedPage(shell: MountedShell): Promise<{
  id: string;
  html: string;
  css: string;
  shadow: ShadowRoot;
}> {
  const [page] = viewportItems(shell.store.document);
  expect(page).toBeDefined();
  let shadow: ShadowRoot | null = null;
  await vi.waitFor(() => {
    shadow = pageShadow(page!.id);
    expect(shadow?.querySelector("body")).not.toBeNull();
  });
  return {
    id: page!.id,
    html: page!.payload.html,
    css: page!.payload.css,
    shadow: shadow!,
  };
}

let info: InfoSpy | null = null;
afterEach(() => {
  info?.mockRestore();
  info = null;
});

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

describe("landing", () => {
  test("an HTML paste lands one selected 960-wide page as one undo step and logs one line", async () => {
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
    // The page is the pasted text: nothing to gather, nothing rewritten.
    expect(item.payload).toEqual({ html: hero, css: "" });
    // Selected as an item is: the envelope id is the primary and the set.
    expect(shell.store.selectedId()).toBe(item.id);
    expect(shell.store.selectedItemIds()).toEqual([item.id]);
    // The section renders on the canvas with its inline styles, in the
    // page's shadow root.
    const { shadow } = await landedPage(shell);
    const heading = shadow.querySelector("h1");
    expect(heading?.textContent).toBe("Ship layouts, not mockups");
    expect(getComputedStyle(heading!).fontSize).toBe("48px");
    // An inline !important is CSS like any other now, and wins as one.
    expect(getComputedStyle(shadow.querySelector("a")!).fontWeight).toBe("600");
    // One undo step for the paste and the selection together.
    expect(shell.store.canUndo()).toBe(true);
    shell.store.undo();
    flush();
    expect(shell.store.document.items).toHaveLength(0);
    expect(shell.store.canUndo()).toBe(false);
    shell.store.redo();
    flush();
    expect(shell.store.document.items).toHaveLength(1);
    // One line, under the plugin id: nothing is lost from a page's text.
    const lines = infoLines(info);
    expect(lines).toEqual([`[${PLUGIN}] landed 6 elements, nothing lost`]);
    // No panel, no toast: nothing of the plugin's in the page.
    expect(shell.host.textContent).not.toContain("nothing lost");
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

  test("a paragraph copied from a website is left for Text; two paragraphs, a list or a paragraph with an image land as a page", async () => {
    const shell = await mount();
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
    expect(shell.store.document.items.map((item) => item.kind)).toEqual([
      "daydream.viewport",
      "daydream.viewport",
      "daydream.viewport",
    ]);
  });

  test("plain text is left for Text; plain text that is markup lands a page, as it was typed", async () => {
    const shell = await mount();
    const claimed = [
      paste(document.body, { "text/plain": "just a note" }),
      paste(document.body, { "text/plain": "<3 you" }),
      // Markup typed as plain text is deliberate: one paragraph still lands.
      paste(document.body, { "text/plain": '<p style="color: red">red</p>' }),
      // A whitespace-only rich copy (an empty line) lands nothing.
      paste(document.body, {
        "text/html": "<meta charset='utf-8'><br>",
        "text/plain": "\n",
      }),
    ].map((event) => event.defaultPrevented);
    expect(claimed).toEqual([false, false, true, false]);
    expect(shell.store.document.items).toHaveLength(1);
    expect(shell.store.document.items[0]!.payload).toEqual({
      html: '<p style="color: red">red</p>',
      css: "",
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

  test("deep nesting lands as pasted and renders: the innermost words are on the canvas", async () => {
    const shell = await mount();
    const deep = 84;
    const source = `${"<div>".repeat(deep)}deep words${"</div>".repeat(deep)}`;
    // As markup typed in an editor: a chain of sole divs around words is
    // one paragraph to the prose rule, which leaves a rich copy for Text.
    paste(document.body, { "text/plain": source });
    const page = await landedPage(shell);
    expect(page.html).toBe(source);
    await vi.waitFor(() =>
      expect(page.shadow.textContent).toContain("deep words"),
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

  test("a paste into a text field is left alone", async () => {
    const shell = await mount();
    const field = document.createElement("textarea");
    shell.host.appendChild(field);
    field.focus();
    const event = paste(field, { "text/html": hero, "text/plain": "hero" });
    expect(event.defaultPrevented).toBe(false);
    expect(shell.store.document.items).toHaveLength(0);
  });
});

describe("the page renders what the tree could not hold", () => {
  // Pasted as markup from an editor, which always lands: a fixture that
  // is one paragraph (mixed inline runs, two links) would be prose as a
  // rich copy.
  const land = async (html: string) => {
    const shell = await mount();
    paste(document.body, { "text/plain": html });
    return landedPage(shell);
  };

  test("a table is a table, every part itself, every cell's inline style kept", async () => {
    const { shadow } = await land(table);
    expect(shadow.querySelectorAll("table > thead > tr > th")).toHaveLength(2);
    const cells = shadow.querySelectorAll("table > tbody > tr > td");
    expect(cells).toHaveLength(4);
    expect(getComputedStyle(cells[1]!).textAlign).toBe("right");
  });

  test("a form keeps its controls and their attributes", async () => {
    const { shadow } = await land(form);
    const input = shadow.querySelector("form input[type=email]");
    expect(input?.getAttribute("placeholder")).toBe("you@example.com");
    expect(shadow.querySelectorAll("select > option")).toHaveLength(2);
    expect(shadow.querySelector("textarea")?.textContent).toBe("Tell us more");
    expect(shadow.querySelector("button[type=submit]")).not.toBeNull();
  });

  test("an inline svg is the drawing, at its own size", async () => {
    const { shadow } = await land(svgIcon);
    const svg = shadow.querySelector("button > svg");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(
      "M5 12l5 5L20 7",
    );
    expect(svg!.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(svg!).width).toBe("20px");
  });

  test("mixed inline runs render as written: text beside elements, the br kept", async () => {
    const { shadow } = await land(mixedInline);
    const p = shadow.querySelector("p")!;
    expect(p.querySelector("strong")?.textContent).toBe("bold");
    expect(p.querySelector("br")).not.toBeNull();
    expect(p.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Hello bold and emphatic, with a link, abreak, and code.",
    );
  });

  test("the gathered css applies: a @media rule against the 960 frame", async () => {
    const { shadow, html } = await land(mediaInterleaved);
    const btn = shadow.querySelector(".btn")!;
    expect(getComputedStyle(btn).paddingLeft).toBe("24px");
    expect(html).not.toContain("<style");
  });

  test("the gathered css applies: a ::before ornament", async () => {
    const { shadow } = await land(ornaments);
    const tag = shadow.querySelector(".tag")!;
    expect(getComputedStyle(tag, "::before").content).toBe('"★ "');
  });

  test("a hostile paste lands inert: nothing that runs reaches the canvas, and the unfetched link is said", async () => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { shadow } = await land(hostile);
    const everything = Array.from(shadow.querySelectorAll("*"));
    for (const tag of ["script", "object", "embed", "base", "style", "link"])
      expect(shadow.querySelector(tag), tag).toBeNull();
    expect(shadow.querySelector("meta[http-equiv]")).toBeNull();
    for (const element of everything) {
      for (const attr of Array.from(element.attributes)) {
        expect(attr.name.toLowerCase().startsWith("on"), attr.name).toBe(false);
        expect(attr.name).not.toBe("srcdoc");
        expect(/^\s*javascript:/i.test(attr.value), attr.value).toBe(false);
      }
    }
    expect(shadow.querySelector("iframe")?.getAttribute("sandbox")).not.toBe(
      null,
    );
    expect(infoLines(info).at(-1)).toContain(
      'the stylesheet <link href="https://evil.example/site.css"> could not be fetched (a paste fetches nothing)',
    );
  });
});

describe("data: images", () => {
  test("are vendored through the host before the page lands, once, as one undo step; the img names the page's assets/ copy", async () => {
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
    const { id, html } = await landedPage(shell);
    // A page stores no data: url and no root-absolute path.
    expect(html).toContain('src="assets/pasted-image.png"');
    expect(html).not.toContain("data:");
    expect(pageNode(id, "img")?.getAttribute("alt")).toBe("One dot");
    shell.store.undo();
    flush();
    expect(shell.store.document.items).toHaveLength(0);
    expect(shell.store.canUndo()).toBe(false);
    expect(infoLines(info)).toEqual([
      `[${PLUGIN}] landed 5 elements, nothing lost`,
    ]);
  });

  test("a document loaded while vendoring abandons the paste; without storage the img lands with its alt and the removed src is said", async () => {
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
    const { id, html } = await landedPage(bare);
    expect(html).not.toContain("data:");
    const img = pageNode(id, "img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("alt")).toBe("One dot");
    expect(infoLines(info).at(-1)).toBe(
      `[${PLUGIN}] landed 5 elements; removed the attribute img[src] (a data: image the host could not store)`,
    );
  });
});
