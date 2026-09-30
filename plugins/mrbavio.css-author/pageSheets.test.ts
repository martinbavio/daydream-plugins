// A page's sheets as the lints read them (pageSheets.ts), from blocks
// written by hand (testBlocks.ts): how a finding names the sheet a rule
// is written in, and how a mounted copy's sheets — one per live sheet, in
// cascade order — are paired with the page's, so a lint reading the copy
// numbers and names each rule as the page writes it. The mount itself is
// the browser tests' (matchLint.browser.test.ts, necessity.browser.test.ts).
import { describe, expect, test } from "vitest";

import type { CssBlock, PageSheet } from "@daydream/plugin-api";

import { pageRules, sheetRules } from "./pageCss";
import { sheetName, writtenRules, type Page } from "./pageSheets";
import { block } from "./testBlocks";

/** A page at `blog/post.html` with these sheets, each text empty: what
 * is judged here is only their sources and their blocks. */
function page(sheets: Omit<PageSheet, "text">[]): Page {
  return {
    path: "blog/post.html",
    html: "",
    sheets: sheets.map((sheet) => ({ ...sheet, text: "" })),
  };
}

const FILE = { source: { file: "blog/post.css" }, readOnly: false };
const STYLE = { source: { style: 1 }, readOnly: false };
const REMOTE = { source: { url: "https://cdn.example/reset.css" }, readOnly: true };

/** The written rules of the copy's sheets (`mounted`), each read as a
 * mount reads it, against the page's sheets (`sheets`). */
function written(
  of: Page,
  sheets: CssBlock[][],
  mounted: CssBlock[][],
): [number, string, string, boolean][][] {
  const read = { blocks: sheets, rules: sheetRules(sheets) };
  const copy = mounted.map((blocks, sheet) => pageRules(blocks, { sheet, first: 0 }));
  return writtenRules(of, read, copy).map((rules) =>
    rules.map((r) => [r.rule, r.written.prelude, r.sheet, r.editable]),
  );
}

describe("sheetName", () => {
  test("a project file by its path, a `<style>` block counted from 1 in its page, a remote sheet by its url", () => {
    const of = page([FILE, STYLE, REMOTE]);
    expect([0, 1, 2].map((sheet) => sheetName(of, sheet))).toEqual([
      "`blog/post.css`",
      "`<style>` block 2 of `blog/post.html`",
      "`https://cdn.example/reset.css`",
    ]);
  });
});

describe("writtenRules", () => {
  const a = [block(".a", "color: red"), block(".b", "margin: 0; padding: 0")];
  const b = [block(".c", "gap: 1px")];
  const reset = [block("*", "box-sizing: border-box")];

  test("each mounted sheet is its page sheet, its rules numbered across the page's sheets and named with their sheet; a read-only sheet's may not be a finding's subject", () => {
    expect(written(page([REMOTE, FILE, STYLE]), [reset, a, b], [reset, a, b])).toEqual([
      [[0, "*", "`https://cdn.example/reset.css`", false]],
      [
        [1, ".a", "`blog/post.css`", true],
        [2, ".b", "`blog/post.css`", true],
      ],
      [[3, ".c", "`<style>` block 2 of `blog/post.html`", true]],
    ]);
  });

  test("a sheet that is not live has no copy: the next one is paired past it, and keeps its number", () => {
    expect(written(page([FILE, STYLE]), [a, b], [b])).toEqual([
      [[2, ".c", "`<style>` block 2 of `blog/post.html`", true]],
    ]);
  });

  test("a copy under a `media` wrapper is still its sheet: the pair is by each rule's prelude and declaration count", () => {
    expect(
      written(page([FILE]), [a], [[block("@media print", "", a)]]),
    ).toEqual([
      [
        [0, ".a", "`blog/post.css`", true],
        [1, ".b", "`blog/post.css`", true],
      ],
    ]);
  });

  test("a mounted sheet no page sheet renders is judged as the copy holds it, numbered after the page's rules, as a sheet with no file", () => {
    expect(written(page([FILE]), [a], [[block(".x", "color: blue")], a])).toEqual([
      [[2, ".x", "a stylesheet of `blog/post.html` with no file", true]],
      [
        [0, ".a", "`blog/post.css`", true],
        [1, ".b", "`blog/post.css`", true],
      ],
    ]);
  });
});
