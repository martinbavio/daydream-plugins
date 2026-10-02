import { describe, expect, test } from "vitest";

import { gapsOf, lineAnchors, trackEdges, trackSpan } from "./guideLines";
import type { AxisGeometry } from "./gridGeometry";

const axis = (
  bands: Array<[number, number]>,
  reversed = false,
): AxisGeometry => ({
  sizes: bands.map(([start, end]) => end - start),
  gap: 0,
  bands: bands.map(([start, end]) => ({ start, end })),
  reversed,
});

describe("the guides' lines", () => {
  test("tracks with a gap: two edges each, gaps between, a badge per line", () => {
    const a = axis([
      [10, 110],
      [126, 326],
    ]);
    expect(trackEdges(a)).toEqual([10, 110, 126, 326]);
    expect(gapsOf(a)).toEqual([{ start: 110, end: 126 }]);
    expect(lineAnchors(a)).toEqual([10, 118, 326]);
    expect(trackSpan(a)).toEqual({ start: 10, end: 326 });
  });

  test("touching tracks share an edge and leave no gap", () => {
    const a = axis([
      [0, 100],
      [100, 200],
      [200, 300],
    ]);
    expect(trackEdges(a)).toEqual([0, 100, 200, 300]);
    expect(gapsOf(a)).toEqual([]);
    expect(lineAnchors(a)).toEqual([0, 100, 200, 300]);
  });

  test("free space spread between tracks (space-between) is a gap too", () => {
    const a = axis([
      [0, 50],
      [275, 325],
      [550, 600],
    ]);
    expect(gapsOf(a)).toEqual([
      { start: 50, end: 275 },
      { start: 325, end: 550 },
    ]);
  });

  test("an rtl axis numbers its lines from the right", () => {
    // Track 1 is the rightmost: bands in track order run right to left.
    const a = axis(
      [
        [226, 326],
        [10, 110],
      ],
      true,
    );
    expect(lineAnchors(a)).toEqual([326, 168, 10]);
    expect(trackEdges(a)).toEqual([10, 110, 226, 326]);
    expect(gapsOf(a)).toEqual([{ start: 110, end: 226 }]);
  });

  test("no tracks, nothing", () => {
    const a = axis([]);
    expect(trackEdges(a)).toEqual([]);
    expect(gapsOf(a)).toEqual([]);
    expect(lineAnchors(a)).toEqual([]);
    expect(trackSpan(a)).toBeNull();
  });
});
