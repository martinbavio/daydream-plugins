// The pure pieces, in the node project: no parser, no DOM — the style
// attribute grammar, the display table, the report's counting. Stand-ins
// for the renderer's two grammars are enough here; the browser tests
// hold the real `dd.core` faces against real fragments.
import { describe, expect, test } from "vitest";

import { count, describeReport, emptyReport } from "./report";
import {
  cssLength,
  parseStyleAttribute,
  preservesWhitespace,
  stripComments,
} from "./styleAttribute";
import { defaultInline, displayOf, dropRule, resolveTag } from "./tags";

/** The renderer's grammars, roughly: a kebab-case or custom property
 * name, and a value with no braces, no comment opener or `;` outside a
 * string, no `!important`, and no unterminated string. */
const rules = {
  isPropertyName: (name: string) => /^(--[\w-]+|[a-z-]+)$/.test(name),
  isSafeValue: (value: string) => {
    let quote: string | null = null;
    let depth = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value[i]!;
      if (quote !== null) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "{" || char === "}") return false;
      else if (char === "/" && value[i + 1] === "*") return false;
      else if (char === ";" && depth === 0) return false;
    }
    return quote === null && !/!\s*important/i.test(value);
  },
};

describe("parseStyleAttribute", () => {
  test("semicolons inside parentheses and quotes, lower-cased properties, custom properties as written, !important counted", () => {
    expect(
      parseStyleAttribute(
        `Background: url("a;b.png") no-repeat; --Accent: rgb(1;2;3); font-family: 'x;y', serif !IMPORTANT ; color:; : red; margin :0`,
        rules,
      ),
    ).toEqual({
      styles: {
        background: `url("a;b.png") no-repeat`,
        "--Accent": "rgb(1;2;3)",
        "font-family": "'x;y', serif",
        margin: "0",
      },
      important: 1,
      invalid: [""],
    });
  });

  test("comments go, a refused property or value is reported not stored, and an !important declaration keeps winning over a later plain one", () => {
    expect(
      parseStyleAttribute(
        `/* lead */ color: red /* trail; */; } body { background: url(https://evil); padding: 4px !important; padding: 0; margin: 1px; margin: 2px; width: 1px} html{display:none; font: 'unterminated`,
        rules,
      ),
    ).toEqual({
      styles: { color: "red", padding: "4px", margin: "2px" },
      important: 1,
      invalid: ["} body { background", "width", "font"],
    });
    expect(
      parseStyleAttribute(`content: "/* not a comment */"; color: blue`, rules)
        .styles,
    ).toEqual({ content: `"/* not a comment */"`, color: "blue" });
    expect(stripComments("a /* b */ c /* unterminated")).toBe("a  c ");
  });
});

describe("the display table", () => {
  test("preservesWhitespace and displayOf read the element's own styles; an unknown tag defaults to inline like the browser", () => {
    expect(preservesWhitespace({ "white-space": "pre-wrap" })).toBe(true);
    expect(preservesWhitespace({ "white-space": "normal" })).toBe(false);
    expect(preservesWhitespace({})).toBe(false);
    expect(displayOf("span", {})).toEqual({ inline: true, box: false });
    expect(displayOf("div", {})).toEqual({ inline: false, box: false });
    expect(displayOf("font", {})).toEqual({ inline: true, box: false });
    expect(displayOf("o:p", {})).toEqual({ inline: true, box: false });
    expect(displayOf("span", { display: "block" })).toEqual({
      inline: false,
      box: false,
    });
    expect(displayOf("div", { display: "inline-flex" })).toEqual({
      inline: true,
      box: true,
    });
    expect(displayOf("div", { display: "grid" })).toEqual({
      inline: false,
      box: true,
    });
    expect(defaultInline("table")).toBe(false);
    expect(defaultInline("custom-element")).toBe(true);
  });

  test("dropRule and resolveTag: code and foreign content counted, packaging and the consumed style block silent, the rest kept or downgraded by the kernel's answer", () => {
    expect(dropRule("script")).toBe("counted");
    expect(dropRule("style")).toBe("silent");
    expect(dropRule("meta")).toBe("silent");
    expect(dropRule("head")).toBe("silent");
    expect(dropRule("div")).toBeNull();
    // The kernel's answer, judged outside an svg (decision #75): an svg
    // is kept, a `path` there is an unknown HTML element.
    const core = {
      tagProblem: (tag: string, insideSvg?: boolean) =>
        ["div", "span", "p"].includes(tag) ||
        (tag === "svg" && insideSvg !== true) ||
        (tag === "path" && insideSvg === true)
          ? null
          : "no",
    } as Parameters<typeof resolveTag>[2];
    expect(resolveTag("p", {}, core)).toEqual({
      kind: "keep",
      tag: "p",
      inline: false,
      box: false,
    });
    expect(resolveTag("font", {}, core)).toEqual({
      kind: "downgrade",
      tag: "span",
      inline: true,
      box: false,
    });
    expect(resolveTag("table", {}, core)).toEqual({
      kind: "downgrade",
      tag: "div",
      inline: false,
      box: false,
    });
    // An svg is kept (decision #75); an SVG-only tag outside one is an
    // unknown HTML element and downgrades as one.
    expect(resolveTag("svg", {}, core)).toEqual({
      kind: "keep",
      tag: "svg",
      inline: true,
      box: false,
    });
    expect(resolveTag("path", {}, core)).toEqual({
      kind: "downgrade",
      tag: "span",
      inline: true,
      box: false,
    });
    expect(resolveTag("font", { display: "block" }, core).tag).toBe("div");
  });

  test("cssLength: user units become px, lengths and percentages pass", () => {
    expect(cssLength("24")).toBe("24px");
    expect(cssLength("1e3")).toBe("1e3px");
    expect(cssLength(" 1.5 ")).toBe("1.5px");
    expect(cssLength("1.5em")).toBe("1.5em");
    expect(cssLength("100%")).toBe("100%");
  });
});

describe("the report", () => {
  test("count adds own properties only: a tag named constructor is a real count", () => {
    const bucket: Record<string, number> = {};
    count(bucket, "constructor");
    count(bucket, "constructor");
    count(bucket, "__proto__", 3);
    expect(Object.entries(bucket)).toEqual([
      ["constructor", 2],
      ["__proto__", 3],
    ]);
  });

  test("describeReport is one line, by name, most lost first", () => {
    expect(describeReport(emptyReport(), 1)).toBe(
      "landed 1 element, nothing lost",
    );
    const report = emptyReport();
    count(report.downgraded, "td", 4);
    count(report.downgraded, "table");
    count(report.stripped, "class", 8);
    report.important = 2;
    count(report.images, "relative");
    expect(describeReport(report, 12)).toBe(
      "landed 12 elements; downgraded td×4, table×1; stripped class×8; 2 !important; image src dropped relative×1",
    );
  });
});
