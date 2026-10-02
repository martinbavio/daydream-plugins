import { describe, expect, test } from "vitest";

import {
  distribute,
  layOutBands,
  parseGap,
  parseTrackSizes,
} from "./gridGeometry";

describe("parseTrackSizes", () => {
  test("reads the used sizes and skips the line names Chromium keeps", () => {
    expect(parseTrackSizes("220px 440px 220px")).toEqual([220, 440, 220]);
    expect(
      parseTrackSizes("[full-start] 320px [content-start a] 640px [c]"),
    ).toEqual([320, 640]);
    expect(parseTrackSizes("none")).toEqual([]);
    expect(parseTrackSizes("1fr 2fr")).toBeNull();
  });

  test("a gap written as a function withholds the handles", () => {
    expect(parseGap("16px", 800)).toBe(16);
    expect(parseGap("5%", 800)).toBe(40);
    expect(parseGap("normal", 800)).toBe(0);
    expect(parseGap("calc(5% + 4px)", 800)).toBeNull();
  });
});

describe("distribute", () => {
  test("places the free space as the keyword says", () => {
    expect(distribute("normal", 100, 3)).toEqual({ offset: 0, between: 0 });
    expect(distribute("center", 100, 3)).toEqual({ offset: 50, between: 0 });
    expect(distribute("safe end", 100, 3)).toEqual({ offset: 100, between: 0 });
    expect(distribute("space-between", 100, 3)).toEqual({
      offset: 0,
      between: 50,
    });
    expect(distribute("space-around", 90, 3)).toEqual({
      offset: 15,
      between: 30,
    });
    expect(distribute("space-evenly", 100, 3)).toEqual({
      offset: 25,
      between: 25,
    });
    // No free space (fr tracks, or stretch already applied): nothing moves.
    expect(distribute("center", 0, 3)).toEqual({ offset: 0, between: 0 });
  });

  test("physical left and right name opposite ends under rtl", () => {
    expect(distribute("right", 100, 3)).toEqual({ offset: 100, between: 0 });
    expect(distribute("left", 100, 3)).toEqual({ offset: 0, between: 0 });
    // The rtl axis' end is the left: `left` is where the free space goes.
    expect(distribute("left", 100, 3, { rtl: true })).toEqual({
      offset: 100,
      between: 0,
    });
    expect(distribute("right", 100, 3, { rtl: true })).toEqual({
      offset: 0,
      between: 0,
    });
  });

  test("overflowing tracks keep center and end's negative offset", () => {
    expect(distribute("center", -100, 3)).toEqual({ offset: -50, between: 0 });
    expect(distribute("end", -100, 3)).toEqual({ offset: -100, between: 0 });
    expect(distribute("unsafe center", -100, 3)).toEqual({
      offset: -50,
      between: 0,
    });
    // `safe`, and a scroll container, hold them at the start.
    expect(distribute("safe center", -100, 3)).toEqual({
      offset: 0,
      between: 0,
    });
    expect(distribute("end", -100, 3, { scrolls: true })).toEqual({
      offset: 0,
      between: 0,
    });
    // The space-* keywords fall back, never to a negative offset.
    for (const keyword of ["space-between", "space-around", "space-evenly"]) {
      expect(distribute(keyword, -100, 3)).toEqual({ offset: 0, between: 0 });
    }
  });
});

describe("layOutBands", () => {
  test("lays tracks from the start, offset and spaced by the placement", () => {
    expect(layOutBands([100, 200], 10, 0, 1)).toEqual([
      { start: 0, end: 100 },
      { start: 110, end: 310 },
    ]);
    expect(
      layOutBands([100, 200], 10, 50, 2, { offset: 20, between: 5 }),
    ).toEqual([
      { start: 90, end: 290 },
      { start: 320, end: 720 },
    ]);
  });

  test("runs the columns from the right for rtl, first track rightmost", () => {
    const bands = layOutBands(
      [100, 200],
      10,
      0,
      1,
      { offset: 0, between: 0 },
      true,
      400,
    );
    expect(bands).toEqual([
      { start: 300, end: 400 },
      { start: 90, end: 290 },
    ]);
  });
});
