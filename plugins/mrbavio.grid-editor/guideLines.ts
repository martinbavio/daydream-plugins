import type { AxisGeometry, Band } from "./gridGeometry";

// What the guides draw, from one axis of a grid's geometry: the pure half
// of GridOverlay.tsx. Bands are in track order, overlay px, `start < end`
// whatever the direction — an rtl column axis runs right to left.

/** A band's edges in track order: where the track begins and ends along
 * the axis' direction (an rtl column starts at its right edge). */
const leading = (band: Band, reversed: boolean): number =>
  reversed ? band.end : band.start;
const trailing = (band: Band, reversed: boolean): number =>
  reversed ? band.start : band.end;

/** Unique track-edge positions along one axis: both edges of every track,
 * the edge two touching tracks share once. */
export function trackEdges(axis: AxisGeometry): number[] {
  const edges: number[] = [];
  for (const band of axis.bands) edges.push(band.start, band.end);
  edges.sort((a, b) => a - b);
  return edges.filter((edge, i) => i === 0 || edge - edges[i - 1]! > 1e-6);
}

/**
 * Badge anchor positions for grid lines 1..n+1, in line order: the first
 * track's leading edge, the center of each gap (the midpoint of the two
 * edges — the shared edge when there is none), and the last track's
 * trailing edge.
 */
export function lineAnchors(axis: AxisGeometry): number[] {
  const { bands, reversed } = axis;
  const anchors: number[] = [];
  for (const [i, band] of bands.entries()) {
    const prev = bands[i - 1];
    anchors.push(
      prev === undefined
        ? leading(band, reversed)
        : (trailing(prev, reversed) + leading(band, reversed)) / 2,
    );
  }
  const last = bands[bands.length - 1];
  if (last !== undefined) anchors.push(trailing(last, reversed));
  return anchors;
}

/** The space between neighbouring tracks, where there is any: the gap, and
 * what `justify-content` / `align-content` spread between them. */
export function gapsOf(axis: AxisGeometry): Band[] {
  const sorted = [...axis.bands].sort((a, b) => a.start - b.start);
  const gaps: Band[] = [];
  for (const [i, band] of sorted.entries()) {
    const prev = sorted[i - 1];
    if (prev !== undefined && band.start - prev.end > 1e-6) {
      gaps.push({ start: prev.end, end: band.start });
    }
  }
  return gaps;
}

/** The [start, end] span covered by an axis' tracks, or null when empty. */
export function trackSpan(axis: AxisGeometry): Band | null {
  if (axis.bands.length === 0) return null;
  return {
    start: Math.min(...axis.bands.map((band) => band.start)),
    end: Math.max(...axis.bands.map((band) => band.end)),
  };
}
