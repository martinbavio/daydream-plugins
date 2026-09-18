import type { DaydreamApi, ElementId } from "@daydream/plugin-api";

/**
 * Grid introspection (plan M5; a plugin since decision #48 P6). The
 * browser is the layout engine: everything here is READ from
 * `getComputedStyle`, never computed. Chrome resolves
 * `grid-template-columns/rows` to plain space-separated px lists of USED
 * track sizes ("220px 440px 220px" for an authored "1fr 2fr 1fr"), with
 * implicit tracks appended indistinguishably and unset gaps reading as the
 * keyword "normal" — all verified empirically, see docs/notes.md (M5 entry).
 * The one value the browser hands back unresolved is a percentage gap
 * ("2%" stays "2%"); parseGap resolves it against the measured content box
 * (M5 addendum in docs/notes.md).
 *
 * Coordinate spaces — the one subtle bit: computed style returns UNSCALED
 * layout px (the world transform does not affect computed values), while
 * `dd.geometry.rect` rects are in overlay/screen space, already scaled by
 * the current zoom because getBoundingClientRect reflects the transform. So
 * every computed-style length is multiplied by `zoom` before being added to
 * the tracked rect's origin. Track positions start at the CONTENT-box
 * origin: border-box origin (the tracked rect) + border + padding.
 */

/** One track or gap band: absolute overlay-space px along its axis. */
export interface GridTrack {
  start: number;
  end: number;
}

export interface GridGeometry {
  /** px positions of each column track, in overlay coords (x axis). */
  cols: GridTrack[];
  /** px positions of each row track, in overlay coords (y axis). */
  rows: GridTrack[];
  /** The gap bands between column tracks (empty when gap is 0). */
  colGaps: GridTrack[];
  /** The gap bands between row tracks (empty when gap is 0). */
  rowGaps: GridTrack[];
}

/**
 * Parse a resolved track-list computed value ("220px 440px 220px") into px
 * numbers. "none" (an axis with truly zero tracks) parses to []. A non-px
 * token (e.g. a future `subgrid`) returns null — a skipped token would
 * silently shift every later track, so we refuse to draw rather than draw
 * wrong lines. We only ever draw what the browser has resolved to px.
 */
export function parseTrackList(value: string): number[] | null {
  if (value === "none" || value === "") return [];
  const sizes: number[] = [];
  for (const token of value.split(" ")) {
    const px = token.endsWith("px") ? Number.parseFloat(token) : Number.NaN;
    if (Number.isNaN(px)) return null;
    sizes.push(px);
  }
  return sizes;
}

/**
 * Resolved px length ("12px"), for gap/border/padding computed values. The
 * gap keyword "normal" means 0. Anything else non-px (e.g. a future calc()
 * a browser declines to resolve) returns null so the caller refuses to draw
 * instead of misreading it.
 */
export function parsePx(value: string): number | null {
  if (value === "normal") return 0;
  if (!value.endsWith("px")) return null;
  const px = Number.parseFloat(value);
  return Number.isNaN(px) ? null : px;
}

/**
 * A used gap in unscaled layout px. Computed style resolves track LISTS to
 * px but keeps a percentage GAP as authored ("2%"), so percentages resolve
 * here against the measured content-box size of the gap's axis. Verified
 * (docs/notes.md, M5 addendum): used gap = percentage × final content-box
 * size in every case — including an indefinite axis, which sizes itself as
 * if the gap were zero and then lets the tracks overflow; the track walk
 * draws that overflow faithfully.
 */
export function parseGap(value: string, contentSize: number): number | null {
  if (value.endsWith("%")) {
    const pct = Number.parseFloat(value);
    return Number.isNaN(pct) ? null : (pct / 100) * contentSize;
  }
  return parsePx(value);
}

/**
 * Walk a resolved track list into overlay-space track and gap bands:
 * `origin` is the content-box origin along the axis (overlay px), `sizes`
 * and `gap` are unscaled layout px from computed style, scaled by `zoom` as
 * they are laid down. gap: 0 yields no gap bands.
 */
export function layOutTracks(
  sizes: number[],
  gap: number,
  origin: number,
  zoom: number,
): { tracks: GridTrack[]; gaps: GridTrack[] } {
  const tracks: GridTrack[] = [];
  const gaps: GridTrack[] = [];
  let pos = origin;
  for (const size of sizes) {
    if (tracks.length > 0) {
      const gapEnd = pos + gap * zoom;
      if (gap > 0) gaps.push({ start: pos, end: gapEnd });
      pos = gapEnd;
    }
    const end = pos + size * zoom;
    tracks.push({ start: pos, end });
    pos = end;
  }
  return { tracks, gaps };
}

/** What `createGridTracker` returns: the element's grid geometry in overlay
 * coordinates, or null when the element is not a grid container (or has no
 * rendered node). */
export type GridTracker = (elementId: ElementId) => GridGeometry | null;

/**
 * A tracker with its own per-invalidation-state cache, keyed on
 * `dd.geometry.version()` — the same discipline as the kernel's rect cache
 * (decision #8): within one invalidation state, repeated calls per
 * element hit the cache and perform no getComputedStyle/layout reads; any
 * trigger (pan/zoom, resize, document mutation) starts a fresh state and
 * consumers re-read synchronously in the same flush. Reactive exactly like
 * `dd.geometry.rect`: subscribe from an effect's compute phase, READ from
 * its apply phase (decision #33). One tracker per overlay instance, so
 * two copies of the plugin never share a cache.
 */
export function createGridTracker(dd: DaydreamApi): GridTracker {
  let cacheStateVersion = -1;
  const cache = new Map<ElementId, GridGeometry | null>();
  return (elementId) => {
    const state = dd.geometry.version();
    if (state !== cacheStateVersion) {
      cacheStateVersion = state;
      cache.clear();
    }
    const cached = cache.get(elementId);
    if (cached !== undefined) return cached;
    const geometry = readGridGeometry(dd, elementId);
    cache.set(elementId, geometry);
    return geometry;
  };
}

function readGridGeometry(
  dd: DaydreamApi,
  elementId: ElementId,
): GridGeometry | null {
  const rect = dd.geometry.rect(elementId);
  const node = dd.geometry.node(elementId);
  if (rect === null || node === undefined) return null;

  const style = getComputedStyle(node);
  if (style.display !== "grid" && style.display !== "inline-grid") return null;

  // TODO(v1): nested grids (one grid drawn at a time for now), negative /
  // leading-implicit line numbering, and content-distribution alignment
  // (justify-content: center/space-between/... shifts tracks away from the
  // content-box start; the cumulative walk below assumes start-packing).
  const { zoom } = dd.geometry.camera();
  const colSizes = parseTrackList(style.gridTemplateColumns);
  const rowSizes = parseTrackList(style.gridTemplateRows);
  const borderLeft = parsePx(style.borderLeftWidth);
  const borderTop = parsePx(style.borderTopWidth);
  const paddingLeft = parsePx(style.paddingLeft);
  const paddingTop = parsePx(style.paddingTop);
  const borderRight = parsePx(style.borderRightWidth);
  const borderBottom = parsePx(style.borderBottomWidth);
  const paddingRight = parsePx(style.paddingRight);
  const paddingBottom = parsePx(style.paddingBottom);
  if (
    colSizes === null ||
    rowSizes === null ||
    borderLeft === null ||
    borderTop === null ||
    paddingLeft === null ||
    paddingTop === null ||
    borderRight === null ||
    borderBottom === null ||
    paddingRight === null ||
    paddingBottom === null
  ) {
    return null;
  }
  // Content-box sizes in unscaled layout px: the tracked rect is the
  // border box in overlay (zoom-scaled) space, the edges are unscaled —
  // box-sizing-proof, unlike computed width/height, whose meaning follows
  // the element's box-sizing.
  const contentWidth =
    rect.width / zoom - (borderLeft + borderRight + paddingLeft + paddingRight);
  const contentHeight =
    rect.height / zoom -
    (borderTop + borderBottom + paddingTop + paddingBottom);
  const colGap = parseGap(style.columnGap, contentWidth);
  const rowGap = parseGap(style.rowGap, contentHeight);
  if (colGap === null || rowGap === null) return null;
  const contentX = rect.x + (borderLeft + paddingLeft) * zoom;
  const contentY = rect.y + (borderTop + paddingTop) * zoom;

  const cols = layOutTracks(colSizes, colGap, contentX, zoom);
  const rows = layOutTracks(rowSizes, rowGap, contentY, zoom);

  return {
    cols: cols.tracks,
    rows: rows.tracks,
    colGaps: cols.gaps,
    rowGaps: rows.gaps,
  };
}
