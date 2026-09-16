// The converter over real fragments (decisions.md #56): the tree AND the
// report, because the report is what every later model step is measured
// by — the same fixtures pasted again after a step should show these
// counts fall. The selectors step (decisions.md #71) did: the style block
// and the class grid report nothing now, and the seven fixtures it added
// pin the sheet a paste lands. Browser project: the converter parses
// with DOMParser and the browser's own CSS parser.
import { describe, expect, test } from "vitest";

import type { DreamElement } from "@daydream/plugin-api";
import { coreApi } from "@daydream/plugin-testing";

import {
  convertDocument,
  countElements,
  fileFromDataUrl,
  hasElements,
  MAX_DEPTH,
  parseHtml,
  VIEWPORT_WIDTH,
  type Conversion,
} from "./convert";
import { emptyReport } from "./report";
import { defaultInline } from "./tags";

import atRules from "./fixtures/at-rules.html?raw";
import chromeFragment from "./fixtures/chrome-fragment.html?raw";
import classGrid from "./fixtures/class-grid.html?raw";
import customProperties from "./fixtures/custom-properties.html?raw";
import dataImage from "./fixtures/data-image.html?raw";
import wholeDocument from "./fixtures/document.html?raw";
import fontFace from "./fixtures/font-face.html?raw";
import form from "./fixtures/form.html?raw";
import hero from "./fixtures/hero.html?raw";
import hostile from "./fixtures/hostile.html?raw";
import idHero from "./fixtures/id-hero.html?raw";
import mediaInterleaved from "./fixtures/media-interleaved.html?raw";
import mixedInline from "./fixtures/mixed-inline.html?raw";
import nested from "./fixtures/nested.html?raw";
import ornaments from "./fixtures/ornaments.html?raw";
import styleBlock from "./fixtures/style-block.html?raw";
import svgIcon from "./fixtures/svg-icon.html?raw";
import table from "./fixtures/table.html?raw";

const at = { x: 10, y: 20 };

function convert(html: string): Conversion {
  return convertDocument(parseHtml(html), coreApi(), at);
}

/** An element without its ids and labels: what a tree assertion reads.
 * Empty maps and lists are left out so an expected tree stays short. */
interface Shape {
  tag: string;
  text?: string;
  styles?: Record<string, string>;
  attrs?: Record<string, string>;
  children?: Shape[];
}
function shape(element: DreamElement): Shape {
  const out: Shape = { tag: element.tag };
  if (element.text !== undefined) out.text = element.text;
  if (Object.keys(element.styles).length > 0) out.styles = element.styles;
  if (element.attrs !== undefined) out.attrs = element.attrs;
  if (element.children.length > 0) out.children = element.children.map(shape);
  return out;
}

const body = (conversion: Conversion): DreamElement =>
  conversion.item.payload.root.children[0]!;

/** Every element of the tree, depth first. */
function all(element: DreamElement): DreamElement[] {
  return [element, ...element.children.flatMap(all)];
}

describe("the envelope", () => {
  test("a fragment lands as html › body at a 960 frame with no height, fresh unique ids, and a label on every element", () => {
    const { item, report } = convert(hero);
    expect(item.kind).toBe("daydream.viewport");
    expect(item.position).toEqual(at);
    expect(item.frame).toEqual({ width: VIEWPORT_WIDTH });
    expect(item.payload.meta).toBeUndefined();
    const root = item.payload.root;
    expect(root.tag).toBe("html");
    expect(root.children.map((child) => child.tag)).toEqual(["body"]);
    const ids = all(root).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id !== "" && !id.startsWith("__"))).toBe(true);
    expect(all(root).every((element) => element.label !== undefined)).toBe(
      true,
    );
    expect(countElements(root)).toBe(all(root).length);
    // The report counts loss by name; a whole `hero` loses one flag only.
    expect(report).toEqual({ ...emptyReport(), important: 1 });
  });

  test("a whole document keeps its body, lifts the html element's inline styles, takes the title and drops the head", () => {
    const conversion = convert(wholeDocument);
    const { item, report } = conversion;
    expect(item.payload.meta).toEqual({ title: "Pricing page" });
    expect(item.payload.root.styles).toEqual({
      background: "#111",
      color: "#eee",
    });
    expect(item.payload.root.attrs).toBeUndefined();
    expect(shape(body(conversion))).toEqual({
      tag: "body",
      styles: { margin: "0", "font-family": "Georgia, serif" },
      children: [
        {
          tag: "main",
          children: [
            { tag: "h1", text: "Pricing" },
            { tag: "img", attrs: { alt: "Hero" } },
            { tag: "span", text: " " },
            { tag: "img", attrs: { alt: "Logo" } },
            { tag: "span", text: " " },
            {
              tag: "img",
              attrs: { alt: "Photo", src: "https://cdn.example.com/photo.jpg" },
            },
            {
              tag: "pre",
              styles: { "font-family": "monospace" },
              text: "  two\n   lines",
            },
          ],
        },
      ],
    });
    expect(report).toEqual({
      downgraded: {},
      dropped: { script: 2, iframe: 1, link: 1 },
      stripped: { lang: 1, srcset: 1 },
      important: 0,
      images: { relative: 1, "http:": 1 },
    });
  });

  test("a Chrome copy — meta charset and StartFragment comments inside a document — is the fragment, with nothing reported", () => {
    const conversion = convert(chromeFragment);
    expect(shape(body(conversion))).toEqual({
      tag: "body",
      children: [
        {
          tag: "div",
          styles: {
            color: "rgb(33, 37, 41)",
            "font-family": "system-ui, sans-serif",
            "font-size": "16px",
          },
          children: [
            {
              tag: "h2",
              styles: { "margin-top": "0px" },
              text: "Copied from a page",
            },
            {
              tag: "p",
              styles: { "margin-bottom": "0px" },
              text: "The clipboard wraps this in a document.",
            },
          ],
        },
      ],
    });
    expect(conversion.report).toEqual(emptyReport());
  });
});

describe("text", () => {
  test("a hero: whitespace collapsed and trimmed at block edges, inline styles verbatim, !important stripped and counted, labels from tag and words", () => {
    const conversion = convert(hero);
    const section = body(conversion).children[0]!;
    expect(shape(section)).toEqual({
      tag: "section",
      styles: {
        padding: "64px 32px",
        background: "linear-gradient(135deg, #1b2a49, #0f172a)",
        color: "#fff",
        "text-align": "center",
      },
      children: [
        {
          tag: "h1",
          styles: {
            "font-size": "48px",
            margin: "0 0 16px",
            "letter-spacing": "-0.02em",
          },
          text: "Ship layouts, not mockups",
        },
        {
          tag: "p",
          styles: {
            "font-size": "20px",
            "max-width": "40ch",
            margin: "0 auto 32px",
            opacity: "0.8",
          },
          text: "Real HTML and CSS is the grain. Paste a section and it is a page.",
        },
        {
          tag: "a",
          attrs: { href: "https://example.com/start" },
          styles: {
            display: "inline-block",
            padding: "12px 24px",
            background: "#fbbf24",
            color: "#111",
            "border-radius": "6px",
            "text-decoration": "none",
            "font-weight": "600",
          },
          text: "Start now",
        },
      ],
    });
    expect(section.children.map((child) => child.label)).toEqual([
      "h1: Ship layouts, not mockups",
      "p: Real HTML and CSS…",
      "a",
    ]);
    expect(section.label).toBe("section");
  });

  test("mixed inline runs become span children in order, single spaces kept between inline siblings, br kept", () => {
    const conversion = convert(mixedInline);
    const paragraph = body(conversion).children[0]!;
    expect(shape(paragraph)).toEqual({
      tag: "p",
      styles: { "line-height": "1.5" },
      children: [
        { tag: "span", text: "Hello " },
        { tag: "strong", text: "bold" },
        { tag: "span", text: " and " },
        { tag: "em", text: "emphatic" },
        { tag: "span", text: ", with " },
        { tag: "a", attrs: { href: "https://example.com" }, text: "a link" },
        { tag: "span", text: ", a" },
        { tag: "br" },
        { tag: "span", text: "break, and " },
        { tag: "code", text: "code" },
        { tag: "span", text: "." },
      ],
    });
    expect(paragraph.label).toBe("p: Hello bold and emphatic,…");
    expect(paragraph.children[0]!.label).toBe("text");
    expect(conversion.report).toEqual(emptyReport());
  });
});

describe("whitespace the page would render", () => {
  test("a space alone inside an inline element is a separator and stays", () => {
    const conversion = convert("<p>Hello<span> </span>world</p>");
    expect(shape(body(conversion).children[0]!)).toEqual({
      tag: "p",
      children: [
        { tag: "span", text: "Hello" },
        { tag: "span", text: " " },
        { tag: "span", text: "world" },
      ],
    });
  });

  test("an unknown tag is inline like the browser's default and keeps the spaces around it; an inline display: block does not", () => {
    const conversion = convert(
      '<p>Hello <font color=red>red</font> world <span style="display: block">x</span> y</p>',
    );
    expect(shape(body(conversion).children[0]!)).toEqual({
      tag: "p",
      children: [
        { tag: "span", text: "Hello " },
        { tag: "span", text: "red" },
        { tag: "span", text: " world" },
        { tag: "span", styles: { display: "block" }, text: "x" },
        { tag: "span", text: "y" },
      ],
    });
    expect(conversion.report).toEqual({
      ...emptyReport(),
      downgraded: { font: 1 },
      stripped: { color: 1 },
    });
  });

  test("an element whose own white-space keeps text as written is preformatted, like pre", () => {
    const conversion = convert(
      `<div style="white-space: pre-wrap">  two\n   lines\n</div><div style="white-space: normal">  two\n   lines\n</div>`,
    );
    expect(body(conversion).children.map((el) => el.text)).toEqual([
      "  two\n   lines\n",
      "two lines",
    ]);
  });

  test("a heading's label reads its words, never a script's source; a head script is counted", () => {
    const conversion = convert(
      "<html><head><script>x()</script></head><body><h1>Real <script>alert(1)</script>words</h1></body></html>",
    );
    const heading = body(conversion).children[0]!;
    expect(heading.text).toBe("Real words");
    expect(heading.label).toBe("h1: Real words");
    expect(conversion.report.dropped).toEqual({ script: 2 });
  });

  test("past the depth cap an element lands as a leaf holding its words, the structure below counted", () => {
    const open = "<div>".repeat(MAX_DEPTH + 10);
    const close = "</div>".repeat(MAX_DEPTH + 10);
    const conversion = convert(`${open}deep <b>words</b>${close}`);
    let element = body(conversion);
    let depth = 1;
    while (element.children.length > 0) {
      element = element.children[0]!;
      depth += 1;
    }
    expect(depth).toBe(MAX_DEPTH);
    expect(element.text).toBe("deep words");
    // body is 1, the cap sits at MAX_DEPTH: MAX_DEPTH + 10 divs minus the
    // MAX_DEPTH - 1 that landed as elements, plus the b.
    expect(conversion.report.dropped).toEqual({
      [`deeper than ${MAX_DEPTH}`]: 12,
    });
  });
});

describe("the downgrade table", () => {
  test("a table lands as a table (decisions.md #57), every part itself, every cell's inline style kept", () => {
    const conversion = convert(table);
    const grid = body(conversion).children[0]!;
    expect(shape(grid)).toEqual({
      tag: "table",
      styles: { "border-collapse": "collapse", width: "100%" },
      children: [
        {
          tag: "thead",
          children: [
            {
              tag: "tr",
              children: [
                {
                  tag: "th",
                  styles: { "text-align": "left", padding: "8px" },
                  text: "Plan",
                },
                {
                  tag: "th",
                  styles: { "text-align": "right", padding: "8px" },
                  text: "Price",
                },
              ],
            },
          ],
        },
        {
          tag: "tbody",
          children: [
            {
              tag: "tr",
              children: [
                { tag: "td", styles: { padding: "8px" }, text: "Free" },
                {
                  tag: "td",
                  styles: { padding: "8px", "text-align": "right" },
                  text: "$0",
                },
              ],
            },
            {
              tag: "tr",
              children: [
                { tag: "td", styles: { padding: "8px" }, text: "Pro" },
                {
                  tag: "td",
                  styles: { padding: "8px", "text-align": "right" },
                  text: "$12",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(grid.label).toBe("table");
    expect(conversion.report).toEqual(emptyReport());
  });

  test("a downgraded block inside a paragraph is a span, since the parser left it there and a div would close the p", () => {
    // An svg icon in a sentence; an option in a select in a sentence.
    const conversion = convert(
      '<p>Save <svg width="10" height="10"><path d="M0 0"/></svg> now <select><option>a</option></select></p>',
    );
    const p = body(conversion).children[0]!;
    expect(p.tag).toBe("p");
    expect(all(p).map((el) => el.tag)).not.toContain("div");
    const icon = all(p).find((el) => el.label === "svg")!;
    expect(shape(icon)).toEqual({
      tag: "span",
      styles: { width: "10px", height: "10px", display: "inline-block" },
    });
    const option = all(p).find((el) => el.label === "option")!;
    expect(option.tag).toBe("span");
    expect(conversion.report.downgraded).toEqual({
      svg: 1,
      select: 1,
      option: 1,
    });
    // Past a button-scope boundary the p is closed: a div again.
    const inCell = convert(
      '<p><button><svg width="10" height="10"></svg></button></p>',
    );
    expect(body(inCell).children[0]!.children[0]!.children[0]!.tag).toBe("div");
  });

  test("at the depth cap a table container keeps no words: the kernel holds it to its parts", () => {
    // A row at the cap (body is depth 1; table, tbody, tr below the
    // wrappers): it lands as an empty tr, its cell and words counted with
    // the structure below rather than foster-parented as text.
    let html = "<table><tbody><tr><td>deep</td></tr></tbody></table>";
    for (let i = 0; i < MAX_DEPTH - 4; i++) html = `<div>${html}</div>`;
    const conversion = convert(html);
    const row = all(conversion.item.payload.root).find(
      (el) => el.tag === "tr",
    )!;
    expect(row).toBeDefined();
    expect(row.text).toBeUndefined();
    expect(row.children).toEqual([]);
    expect(conversion.report.dropped).toEqual({
      [`deeper than ${MAX_DEPTH}`]: 1,
    });
  });

  test("a form: controls become spans or divs by their display, their attributes go with the lost tag; the button stays", () => {
    const conversion = convert(form);
    expect(shape(body(conversion).children[0]!)).toEqual({
      tag: "div",
      styles: { display: "grid", gap: "12px", "max-width": "320px" },
      children: [
        {
          tag: "span",
          styles: { "font-weight": "600" },
          children: [
            // The input says display: block, so it is one: a div, and
            // the space before it is a block boundary's.
            { tag: "span", text: "Email" },
            { tag: "div", styles: { display: "block", width: "100%" } },
          ],
        },
        {
          tag: "span",
          children: [
            { tag: "div", text: "Free" },
            { tag: "div", text: "Pro" },
          ],
        },
        { tag: "span", text: "Tell us more" },
        { tag: "button", styles: { padding: "8px 16px" }, text: "Subscribe" },
      ],
    });
    expect(conversion.report).toEqual({
      downgraded: {
        form: 1,
        label: 1,
        input: 1,
        select: 1,
        option: 2,
        textarea: 1,
      },
      dropped: {},
      stripped: {
        action: 1,
        method: 1,
        type: 2,
        name: 3,
        placeholder: 1,
        value: 2,
        rows: 1,
      },
      important: 0,
      images: {},
    });
  });

  test("an inline svg becomes an inline-block div sized from its attributes, its drawing gone with the tag; a flex parent's items carry no edge whitespace", () => {
    const conversion = convert(svgIcon);
    expect(shape(body(conversion).children[0]!)).toEqual({
      tag: "button",
      styles: {
        display: "inline-flex",
        "align-items": "center",
        gap: "8px",
        padding: "8px 12px",
      },
      children: [
        {
          tag: "div",
          styles: { width: "20px", height: "20px", display: "inline-block" },
        },
        { tag: "span", text: "Save changes" },
      ],
    });
    expect(body(conversion).children[0]!.children[0]!.label).toBe("svg");
    expect(conversion.report).toEqual({
      ...emptyReport(),
      downgraded: { svg: 1 },
      stripped: { xmlns: 1, viewBox: 1, fill: 1, stroke: 1, "stroke-width": 1 },
    });
  });

  test("a style block lands as the sheet, even when the parser hoists it into the head; class stays; nothing is reported", () => {
    const conversion = convert(styleBlock);
    expect(shape(body(conversion))).toEqual({
      tag: "body",
      children: [
        {
          tag: "div",
          attrs: { class: "card" },
          children: [
            { tag: "h3", text: "Styled by a class" },
            { tag: "p", text: "The stylesheet is the viewport's sheet." },
          ],
        },
      ],
    });
    // The CSSOM's spelling: the colour as rgb(), the zero lengths in px.
    expect(conversion.item.payload.sheet).toEqual([
      {
        selector: ".card",
        styles: {
          padding: "16px",
          border: "1px solid rgb(221, 221, 221)",
          "border-radius": "8px",
        },
      },
      { selector: ".card h3", styles: { margin: "0px 0px 8px" } },
    ]);
    expect(conversion.item.payload.fonts).toBeUndefined();
    expect(conversion.report).toEqual(emptyReport());
  });

  test("a class-only card grid keeps its structure, text, classes and ids, and reports nothing", () => {
    const conversion = convert(classGrid);
    const grid = body(conversion).children[0]!;
    expect(grid.tag).toBe("div");
    expect(grid.styles).toEqual({});
    expect(grid.attrs).toEqual({ id: "pricing", class: "grid grid-3" });
    expect(grid.children.map(shape)).toEqual(
      [
        ["free", "Free", "For trying it out."],
        ["pro", "Pro", "For daily work."],
        ["team", "Team", "For everyone at once."],
      ].map(([id, title, copy]) => ({
        tag: "article",
        attrs: { class: "card", id: `card-${id}` },
        children: [
          { tag: "h3", attrs: { class: "card-title" }, text: title },
          { tag: "p", attrs: { class: "card-copy" }, text: copy },
        ],
      })),
    );
    expect(conversion.item.payload.sheet).toBeUndefined();
    expect(conversion.report).toEqual(emptyReport());
  });
});

describe("the sheet (decisions.md #71)", () => {
  test("interleaved @media: rules in source order, the at-rule ancestry as conditions on each rule inside", () => {
    const conversion = convert(mediaInterleaved);
    expect(conversion.item.payload.sheet).toEqual([
      {
        selector: ".btn",
        styles: { padding: "8px 16px", "border-radius": "6px" },
      },
      {
        selector: ".btn-primary",
        styles: {
          background: "rgb(10, 102, 194)",
          color: "rgb(255, 255, 255)",
        },
      },
      {
        selector: ".btn",
        conditions: ["@media (min-width: 600px)"],
        styles: { padding: "12px 24px" },
      },
      {
        selector: ".btn-primary",
        conditions: ["@media print"],
        styles: { background: "none" },
      },
    ]);
    const links = body(conversion).children[0]!.children;
    expect(links.map((el) => el.attrs)).toEqual([
      { class: "btn btn-primary", href: "https://example.com/start" },
      undefined,
      { class: "btn", href: "https://example.com/docs" },
    ]);
    expect(conversion.report).toEqual(emptyReport());
  });

  test("nested CSS is flattened: a leading & under one parent writes the parent out, a list parent goes inside :is(), trailing declarations take the parent's selector, nested rules follow their parent", () => {
    const conversion = convert(nested);
    expect(conversion.item.payload.sheet).toEqual([
      { selector: ".nav", styles: { display: "flex", gap: "16px" } },
      { selector: ".nav a", styles: { color: "inherit" } },
      { selector: ".nav a:hover", styles: { "text-decoration": "underline" } },
      { selector: ".nav .brand, .nav .cta", styles: { "font-weight": "700" } },
      {
        selector: ":is(.nav .brand, .nav .cta) span",
        styles: { color: "rgb(10, 102, 194)" },
      },
      { selector: ".nav", styles: { padding: "0px" } },
    ]);
    expect(conversion.report).toEqual(emptyReport());
  });

  test(":root custom properties land as a rule on :root, the values as written", () => {
    const conversion = convert(customProperties);
    expect(conversion.item.payload.sheet).toEqual([
      { selector: ":root", styles: { "--brand": "#0a66c2", "--gap": "12px" } },
      {
        selector: ".stack",
        styles: { display: "grid", gap: "var(--gap)", color: "var(--brand)" },
      },
    ]);
    expect(conversion.report).toEqual(emptyReport());
  });

  test("::before and ::after ornaments are stored with their pseudo-elements, a one-colon :first-letter in the CSSOM's two-colon spelling", () => {
    const conversion = convert(ornaments);
    expect(conversion.item.payload.sheet).toEqual([
      {
        selector: ".tag::before",
        styles: { content: '"★ "', color: "rgb(245, 158, 11)" },
      },
      {
        selector: ".tag::after",
        styles: {
          content: '""',
          display: "inline-block",
          width: "8px",
          height: "8px",
          "border-radius": "50%",
          background: "currentcolor",
        },
      },
      { selector: "h2::first-letter", styles: { "font-size": "2em" } },
    ]);
    expect(conversion.report).toEqual(emptyReport());
  });

  test("an id-styled hero: the id and the class stay as attributes, the #top rules land, the href to the fragment is kept, the body's style block is consumed in place", () => {
    const conversion = convert(idHero);
    expect(shape(body(conversion))).toEqual({
      tag: "body",
      children: [
        {
          tag: "section",
          attrs: { id: "top", class: "hero" },
          children: [
            { tag: "h1", text: "Back to the top" },
            {
              tag: "p",
              text: "An id styles the hero, and the link points at it.",
            },
            { tag: "a", attrs: { class: "back", href: "#top" }, text: "Top" },
          ],
        },
      ],
    });
    expect(conversion.item.payload.sheet).toEqual([
      {
        selector: "#top",
        styles: {
          padding: "48px",
          background: "rgb(15, 23, 42)",
          color: "rgb(255, 255, 255)",
        },
      },
      { selector: "#top h1", styles: { margin: "0px 0px 8px" } },
      { selector: "#top .back", styles: { color: "rgb(251, 191, 36)" } },
    ]);
    expect(conversion.report).toEqual(emptyReport());
  });

  test("@import, @layer, @keyframes and @property are counted by name and not stored — a @layer block's rules go with it; a @supports rule lands with its condition", () => {
    const conversion = convert(atRules);
    expect(conversion.item.payload.sheet).toEqual([
      {
        selector: ".spinner",
        conditions: ["@supports (display: grid)"],
        styles: { display: "grid" },
      },
      {
        selector: ".spinner",
        styles: { animation: "1s linear 0s infinite normal none running spin" },
      },
    ]);
    expect(conversion.report).toEqual({
      ...emptyReport(),
      dropped: { "@import": 1, "@layer": 1, "@keyframes": 1, "@property": 1 },
    });
  });

  test("a @font-face lifts into fonts in its descriptor grain; a face whose url is not https is dropped and counted; the body rule that uses it lands", () => {
    const conversion = convert(fontFace);
    expect(conversion.item.payload.fonts).toEqual([
      {
        "font-family": "Inter",
        src: 'url("https://fonts.example/inter.woff2") format("woff2")',
        "font-weight": "100 900",
        "font-display": "swap",
      },
    ]);
    expect(conversion.item.payload.sheet).toEqual([
      { selector: "body", styles: { "font-family": "Inter, sans-serif" } },
    ]);
    expect(conversion.report).toEqual({
      ...emptyReport(),
      dropped: { "@font-face": 1 },
    });
  });

  test("two style blocks are one sheet in document order, each parsed as its own sheet; a script's text never reaches the sheet", () => {
    const conversion = convert(
      "<style>.a { color: red</style><div class='a'><style>.b { color: blue }</style><script>.c { color: green }</script></div>",
    );
    expect(conversion.item.payload.sheet).toEqual([
      { selector: ".a", styles: { color: "red" } },
      { selector: ".b", styles: { color: "blue" } },
    ]);
    expect(conversion.report).toEqual({
      ...emptyReport(),
      dropped: { script: 1 },
    });
  });

  test("a style block under a noscript goes with the noscript, counted once under its tag: the page never applies it", () => {
    const conversion = convert(
      '<noscript><style>.n { display: none }</style></noscript><p class="n">shown</p>',
    );
    expect(conversion.item.payload.sheet).toBeUndefined();
    expect(conversion.report).toEqual({
      ...emptyReport(),
      dropped: { noscript: 1 },
    });
  });
});

describe("images", () => {
  test("a data: image is decoded to a File for the caller to vendor, the img kept with its alt; the src lands once written back", () => {
    const conversion = convert(dataImage);
    const figure = body(conversion).children[0]!;
    const img = figure.children[0]!;
    expect(shape(figure)).toEqual({
      tag: "figure",
      styles: { margin: "0" },
      children: [
        { tag: "img", attrs: { alt: "One dot", width: "1", height: "1" } },
        {
          tag: "figcaption",
          styles: { "font-size": "12px" },
          text: "A single pixel",
        },
      ],
    });
    expect(conversion.dataImages).toHaveLength(1);
    const { element, file } = conversion.dataImages[0]!;
    expect(element).toBe(img);
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("pasted-image.png");
    expect(file.size).toBe(70);
    expect(conversion.report).toEqual({
      ...emptyReport(),
    });

    // The element is the handle: the caller writes the vendored src on it.
    element.attrs = { ...element.attrs, src: "/assets/pasted.png" };
    expect(img.attrs).toEqual({
      alt: "One dot",
      width: "1",
      height: "1",
      src: "/assets/pasted.png",
    });
  });

  test("fileFromDataUrl: base64 and percent-encoded images decode, anything else is null", () => {
    const svg = fileFromDataUrl(
      "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
    );
    expect(svg?.type).toBe("image/svg+xml");
    expect(svg?.name).toBe("pasted-image.svg");
    expect(fileFromDataUrl("data:image/jpeg;base64,/9j/4AAQ")?.name).toBe(
      "pasted-image.jpg",
    );
    expect(fileFromDataUrl("data:text/plain;base64,aGk=")).toBeNull();
    expect(fileFromDataUrl("data:image/png;base64,***")).toBeNull();
    expect(fileFromDataUrl("data:image/png;base64,")).toBeNull();
    expect(fileFromDataUrl("https://example.com/a.png")).toBeNull();
  });
});

describe("the pieces that need a parser", () => {
  test("hasElements tells markup from text that starts with <", () => {
    expect(hasElements(parseHtml("<3 you"))).toBe(false);
    expect(hasElements(parseHtml("<b>3</b> you"))).toBe(true);
    expect(hasElements(parseHtml("plain words"))).toBe(false);
    // A lone stylesheet is hoisted to the head: nothing for the body.
    expect(hasElements(parseHtml("<style>.a{}</style>"))).toBe(false);
  });

  test("a declaration the renderer would refuse — a bad name, a value that escapes — is counted as a stripped style, never stored", () => {
    const conversion = convert(
      `<p style="color: red; } body { background: url(https://evil); width: 1px} html{display:none; font: 'unterminated; margin: 0">red</p>`,
    );
    expect(shape(body(conversion).children[0]!)).toEqual({
      tag: "p",
      styles: { color: "red" },
      text: "red",
    });
    expect(conversion.report.stripped).toEqual({
      "style (} body { background)": 1,
      "style (width)": 1,
      "style (font)": 1,
    });
  });

  test("the allowlist's own tags sit on the right side of the inline line", () => {
    const core = coreApi();
    const inline = [
      "span",
      "a",
      "strong",
      "em",
      "b",
      "i",
      "small",
      "code",
      "img",
      "button",
      "br",
    ];
    const block = [
      "html",
      "body",
      "div",
      "section",
      "article",
      "aside",
      "header",
      "footer",
      "main",
      "nav",
      "figure",
      "figcaption",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "hr",
    ];
    for (const tag of [...inline, ...block])
      expect(core.tagProblem(tag), tag).toBeNull();
    expect(inline.filter(defaultInline)).toEqual(inline);
    expect(block.filter(defaultInline)).toEqual([]);
  });

  test("a hostile fragment lands inert: every script-bearing tag, attribute and scheme is gone, and the report names them", () => {
    const conversion = convert(hostile);
    const root = conversion.item.payload.root;
    const everything = all(root);
    const attrs = everything.flatMap((el) => Object.entries(el.attrs ?? {}));
    // Nothing that runs, navigates to script, or restyles the page.
    expect(everything.map((el) => el.tag)).not.toContain("script");
    expect(
      attrs.every(
        ([name, value]) => coreApi().attrProblem(name, value) === null,
      ),
    ).toBe(true);
    expect(attrs.every(([, value]) => !/^\s*javascript:/i.test(value))).toBe(
      true,
    );
    for (const el of everything)
      for (const value of Object.values(el.styles))
        expect(coreApi().isSafeValue(value), value).toBe(true);
    // The inline siblings sit on their own lines in the source, so the
    // page shows a space between them; the block paragraph closes them.
    const space = { tag: "span", text: " " };
    expect(shape(body(conversion))).toEqual({
      tag: "body",
      children: [
        { tag: "a", text: "one" },
        space,
        { tag: "a", text: "two" },
        space,
        { tag: "a", text: "three" },
        space,
        { tag: "a", attrs: { href: "#top" }, text: "four" },
        space,
        // The srcset is a plain https fetch, kept as an https src is; the
        // javascript: src beside it goes.
        {
          tag: "img",
          attrs: { srcset: "https://evil.example/2x.png 2x", alt: "pixel" },
        },
        space,
        { tag: "div", styles: { width: "10px", display: "inline-block" } },
        { tag: "p", styles: { color: "red" }, text: "styled" },
      ],
    });
    // The style block's `body { display: none }` is the honest rule it
    // is, and lands; its `@import` is counted by name.
    expect(conversion.item.payload.sheet).toEqual([
      { selector: "body", styles: { display: "none" } },
    ]);
    // A template's script and an iframe's onload go with their element;
    // the three javascript: hrefs are stripped by name.
    expect(conversion.report).toEqual({
      downgraded: { svg: 1 },
      dropped: {
        script: 1,
        "@import": 1,
        iframe: 1,
        object: 1,
        embed: 1,
        template: 1,
        link: 1,
      },
      stripped: {
        href: 3,
        onclick: 1,
        onerror: 1,
        target: 1,
        "style (background)": 1,
        xmlns: 1,
      },
      important: 0,
      images: { "javascript:": 1 },
    });
  });
});
