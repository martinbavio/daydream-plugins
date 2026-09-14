// The pure half of the grid reader: what the browser's resolved strings
// parse to, and how a track list is walked into bands. The DOM half (the
// computed-style reads) is exercised through the shell in
// src/overlay/overlay.browser.test.tsx.
import { describe, expect, test } from "vitest";

import {
  layOutTracks,
  parseGap,
  parsePx,
  parseTrackList,
} from "./gridGeometry";

describe("parseTrackList", () => {
  test("a resolved px list parses to numbers", () => {
    expect(parseTrackList("220px 440px 220px")).toEqual([220, 440, 220]);
    expect(parseTrackList("0px 12.5px")).toEqual([0, 12.5]);
  });

  test("none and the empty string are zero tracks", () => {
    expect(parseTrackList("none")).toEqual([]);
    expect(parseTrackList("")).toEqual([]);
  });

  test("any token the browser did not resolve to px refuses the whole list", () => {
    // A skipped token would shift every later line; null draws nothing.
    expect(parseTrackList("subgrid")).toBeNull();
    expect(parseTrackList("220px auto 220px")).toBeNull();
    expect(parseTrackList("1fr 2fr")).toBeNull();
  });
});

describe("parsePx", () => {
  test("px lengths and the gap keyword", () => {
    expect(parsePx("12px")).toBe(12);
    expect(parsePx("0px")).toBe(0);
    expect(parsePx("normal")).toBe(0);
  });

  test("anything else is unreadable", () => {
    expect(parsePx("1em")).toBeNull();
    expect(parsePx("calc(1px + 2%)")).toBeNull();
    expect(parsePx("px")).toBeNull();
  });
});

describe("parseGap", () => {
  test("a percentage resolves against the content-box size", () => {
    expect(parseGap("2%", 500)).toBe(10);
    expect(parseGap("10%", 0)).toBe(0);
  });

  test("px and normal pass through parsePx", () => {
    expect(parseGap("16px", 500)).toBe(16);
    expect(parseGap("normal", 500)).toBe(0);
    expect(parseGap("abc%", 500)).toBeNull();
    expect(parseGap("1em", 500)).toBeNull();
  });
});

describe("layOutTracks", () => {
  test("walks sizes and gaps from the origin, scaled by the zoom", () => {
    expect(layOutTracks([100, 200], 16, 10, 1)).toEqual({
      tracks: [
        { start: 10, end: 110 },
        { start: 126, end: 326 },
      ],
      gaps: [{ start: 110, end: 126 }],
    });
    expect(layOutTracks([100, 200], 16, 10, 0.5)).toEqual({
      tracks: [
        { start: 10, end: 60 },
        { start: 68, end: 168 },
      ],
      gaps: [{ start: 60, end: 68 }],
    });
  });

  test("a zero gap yields contiguous tracks and no gap bands", () => {
    expect(layOutTracks([50, 50, 50], 0, 0, 2)).toEqual({
      tracks: [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
        { start: 200, end: 300 },
      ],
      gaps: [],
    });
  });

  test("no tracks, nothing", () => {
    expect(layOutTracks([], 16, 10, 1)).toEqual({ tracks: [], gaps: [] });
  });
});
