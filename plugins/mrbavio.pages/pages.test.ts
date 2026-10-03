import { describe, expect, test } from "vitest";

import type { DreamDocument } from "@daydream/plugin-api";

import {
  CASCADE_STEP,
  centeredAt,
  clearOf,
  DEFAULT_FRAME,
  emptyPage,
  frameFor,
  ghostSize,
  nextViewport,
  pageRows,
  type ViewportLike,
} from "./pages";

const doc = (...paths: string[]): DreamDocument => ({
  version: 8,
  pages: paths.map((path) => ({ path })),
  canvases: [{ id: "c", name: "First Canvas", items: [] }],
});

const viewport = (
  id: string,
  page: string,
  extra: Partial<Pick<ViewportLike, "frame">> & { variant?: unknown } = {},
): ViewportLike => ({
  id,
  frame: extra.frame,
  payload:
    extra.variant === undefined ? { page } : { page, variant: extra.variant },
});

describe("pageRows", () => {
  test("every listed page, sorted by path, split into folder and name", () => {
    const rows = pageRows(
      doc("index.html", "blog/post.html", "about.html"),
      [],
    );
    expect(rows.map((row) => [row.folder, row.name])).toEqual([
      ["", "about.html"],
      ["blog/", "post.html"],
      ["", "index.html"],
    ]);
  });

  test("a page's own viewports in canvas order; a variant's is not one", () => {
    const rows = pageRows(doc("a.html", "b.html"), [
      viewport("v1", "a.html"),
      viewport("v2", "b.html"),
      viewport("v3", "a.html"),
      viewport("v4", "a.html", {
        variant: { file: ".daydream/variants/a.1.html", base: "x" },
      }),
    ]);
    expect(rows.map((row) => row.viewports)).toEqual([["v1", "v3"], ["v2"]]);
  });

  test("a page off the canvas has no viewports", () => {
    expect(pageRows(doc("a.html"), [])[0]!.viewports).toEqual([]);
  });
});

describe("frameFor", () => {
  test("the last of the page's own viewports' frame, copied", () => {
    const frame = { width: 390, height: 844 };
    const viewports = [
      viewport("v1", "a.html", { frame: { width: 1280 } }),
      viewport("v2", "a.html", { frame }),
      viewport("v3", "b.html", { frame: { width: 600 } }),
    ];
    const answer = frameFor("a.html", viewports);
    expect(answer).toEqual(frame);
    expect(answer).not.toBe(frame);
  });

  test("a full-page frame stays full page", () => {
    expect(
      frameFor("a.html", [viewport("v", "a.html", { frame: { width: 1280 } })]),
    ).toEqual({ width: 1280 });
  });

  test("a variant's frame is passed over; none at all is the default", () => {
    const variant = viewport("v", "a.html", {
      frame: { width: 390 },
      variant: { file: "f", base: "b" },
    });
    expect(frameFor("a.html", [variant])).toEqual(DEFAULT_FRAME);
    expect(frameFor("a.html", [])).toEqual(DEFAULT_FRAME);
  });
});

test("centeredAt centers the frame across, its top a quarter-width up", () => {
  expect(centeredAt({ x: 1000, y: 500 }, { width: 960 })).toEqual({
    x: 520,
    y: 260,
  });
});

describe("ghostSize", () => {
  test("the box the page's last viewport shows at, when it has one", () => {
    expect(
      ghostSize({ width: 960 }, 0.5, { width: 480.4, height: 1210.6 }),
    ).toEqual({ width: 480, height: 1211 });
  });

  test("else its frame at the zoom, a full page as tall as the nominal one", () => {
    expect(ghostSize({ width: 960 }, 0.5, null)).toEqual({
      width: 480,
      height: 300,
    });
    expect(ghostSize({ width: 390, height: 844 }, 2, null)).toEqual({
      width: 780,
      height: 1688,
    });
  });
});

test("clearOf steps aside from items already at the spot, and only then", () => {
  const step = CASCADE_STEP;
  expect(clearOf({ x: 10, y: 20 }, [{ x: 0, y: 0 }])).toEqual({ x: 10, y: 20 });
  expect(
    clearOf({ x: 10, y: 20 }, [
      { x: 10, y: 20 },
      { x: 10 + step, y: 20 + step },
    ]),
  ).toEqual({ x: 10 + 2 * step, y: 20 + 2 * step });
});

describe("nextViewport", () => {
  test("the first when none of the page's is selected", () => {
    expect(nextViewport(["a", "b"], null)).toBe("a");
    expect(nextViewport(["a", "b"], "other")).toBe("a");
  });

  test("the next after the selected one, wrapping", () => {
    expect(nextViewport(["a", "b", "c"], "b")).toBe("c");
    expect(nextViewport(["a", "b", "c"], "c")).toBe("a");
  });

  test("none for a page off the canvas", () => {
    expect(nextViewport([], null)).toBeNull();
  });
});

test("emptyPage titles a whole document, its title escaped", () => {
  const html = emptyPage("  Pricing & <plans>  ");
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain("<title>Pricing &amp; &lt;plans&gt;</title>");
  expect(html).toContain("<body>\n</body>");
  expect(html).toContain("html { background: #fff; }");
});
