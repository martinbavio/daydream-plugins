import type { DaydreamApi, ElementId, OverlayRect } from "@daydream/plugin-api";

// The selected grid's tracks and gaps, READ from the browser's resolved
// values (`getComputedStyle`), never computed: Chrome resolves
// `grid-template-columns/rows` to space-separated px lists of the used
// track sizes — line names kept, implicit tracks appended — and an unset
// gap reads as `normal`. Computed lengths are unscaled layout px;
// `dd.geometry.rect` is overlay space, scaled by the zoom — so every
// length is multiplied by the zoom before it is laid against the rect,
// and the drag divides its screen delta by the zoom to get back to
// layout px. Where the tracks sit inside the content box follows
// `justify-content` / `align-content` (free space placed before, between
// or around them) and `direction` (rtl runs the columns from the right).

/** One track along its axis, overlay px, `start < end` whatever the
 * direction. */
export interface Band {
  start: number;
  end: number;
}

export interface AxisGeometry {
  /** Used track sizes, unscaled layout px, in track order: explicit then
   * implicit. */
  sizes: number[];
  /** The used gap, unscaled layout px. */
  gap: number;
  /** The tracks, overlay px along this axis, in track order. */
  bands: Band[];
  /** True when track order runs against the overlay axis: columns of an
   * rtl grid, whose first track is the rightmost. */
  reversed: boolean;
}

export interface GridGeometry {
  cols: AxisGeometry;
  rows: AxisGeometry;
  /** The container's border box, overlay px. */
  rect: OverlayRect;
  zoom: number;
}

/** "220px 440px" → [220, 440]; "[a] 220px [b] 440px [c]" → the same
 * (Chromium keeps the line names in the computed value); "none" → [];
 * a non-px token → null. */
export function parseTrackSizes(value: string): number[] | null {
  if (value === "none" || value === "") return [];
  const sizes: number[] = [];
  for (const token of value
    .replace(/\[[^\]]*\]/g, " ")
    .trim()
    .split(/\s+/)) {
    if (token === "") continue;
    const px = token.endsWith("px") ? Number.parseFloat(token) : Number.NaN;
    if (Number.isNaN(px)) return null;
    sizes.push(px);
  }
  return sizes;
}

/** "12px" → 12; "normal" → 0; else null. */
export function parsePx(value: string): number | null {
  if (value === "normal") return 0;
  if (!value.endsWith("px")) return null;
  const px = Number.parseFloat(value);
  return Number.isNaN(px) ? null : px;
}

/** A used gap: a percentage resolves against the content-box size of
 * its axis (computed style keeps it as authored). A function
 * (`calc()`, `var()`) is null: no handles rather than misplaced ones. */
export function parseGap(value: string, contentSize: number): number | null {
  if (value.endsWith("%")) {
    const pct = Number.parseFloat(value);
    return Number.isNaN(pct) ? null : (pct / 100) * contentSize;
  }
  return parsePx(value);
}

/** Where the free space of an axis goes: before the first track and
 * between tracks (layout px), by its content-distribution keyword. */
export interface Placement {
  offset: number;
  between: number;
}

/** How an axis' free space is placed, beyond the keyword. */
export interface PlaceOptions {
  /** The columns of an rtl grid: physical `left` / `right` name the
   * opposite ends of the logical axis. */
  rtl?: boolean;
}

/** `justify-content` / `align-content` over `free` layout px and `count`
 * tracks. `stretch` has already grown the `auto` tracks in the used
 * sizes, so it is `start` here. Overflowing (`free` below zero), the
 * `space-*` keywords fall back as the spec says (`space-between` to
 * start, `space-around` and `space-evenly` to a safe center); `center`
 * and `end` keep their negative offset, as the tracks overflow both
 * sides or the start, in a scroll container too (Chromium places them
 * there, and `scrollLeft` moves them on) — unless `safe` was written,
 * which holds them at the start. */
export function distribute(
  keyword: string,
  free: number,
  count: number,
  options: PlaceOptions = {},
): Placement {
  const none = { offset: 0, between: 0 };
  if (count === 0) return none;
  const safe = /^safe\s/.test(keyword);
  let word = keyword.replace(/^(safe|unsafe)\s+/, "");
  // `left` and `right` are physical; the axis' end is the right in ltr
  // and the left in rtl.
  if (word === "left") word = options.rtl === true ? "end" : "start";
  else if (word === "right") word = options.rtl === true ? "start" : "end";
  const held = (offset: number): Placement => ({
    offset: safe ? Math.max(0, offset) : offset,
    between: 0,
  });
  switch (word) {
    case "center":
      return held(free / 2);
    case "end":
    case "flex-end":
      return held(free);
    case "space-between":
      return free > 0 && count > 1
        ? { offset: 0, between: free / (count - 1) }
        : none;
    case "space-around":
      return free > 0
        ? { offset: free / count / 2, between: free / count }
        : none;
    case "space-evenly":
      return free > 0
        ? { offset: free / (count + 1), between: free / (count + 1) }
        : none;
    default:
      return none;
  }
}

/** The tracks laid along an axis: from `origin` (overlay px, the content
 * box's start) over `extent` layout px, with the placement's offset
 * before the first and its extra space between them; reversed, from the
 * content box's end backwards. */
export function layOutBands(
  sizes: number[],
  gap: number,
  origin: number,
  zoom: number,
  placement: Placement = { offset: 0, between: 0 },
  reversed = false,
  extent = 0,
): Band[] {
  const bands: Band[] = [];
  let pos = placement.offset;
  for (const size of sizes) {
    if (bands.length > 0) pos += gap + placement.between;
    const start = pos;
    const end = pos + size;
    bands.push(
      reversed
        ? {
            start: origin + (extent - end) * zoom,
            end: origin + (extent - start) * zoom,
          }
        : { start: origin + start * zoom, end: origin + end * zoom },
    );
    pos = end;
  }
  return bands;
}

/** Read from an effect's apply phase or an event handler (the rule every
 * DOM read of the API obeys), never from compute or JSX. Null for what
 * is not a grid, or one laid out in a way the bands would misplace (a
 * vertical writing mode, a gap written as a function). */
export function readGridGeometry(
  dd: DaydreamApi,
  elementId: ElementId,
): GridGeometry | null {
  const rect = dd.geometry.rect(elementId);
  const node = dd.geometry.node(elementId);
  if (rect === null || node === undefined) return null;
  const style = getComputedStyle(node);
  if (style.display !== "grid" && style.display !== "inline-grid") return null;
  if (style.writingMode !== "horizontal-tb") return null;
  const { zoom } = dd.geometry.camera();
  const colSizes = parseTrackSizes(style.gridTemplateColumns);
  const rowSizes = parseTrackSizes(style.gridTemplateRows);
  const edges = [
    style.borderLeftWidth,
    style.borderTopWidth,
    style.paddingLeft,
    style.paddingTop,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.paddingRight,
    style.paddingBottom,
  ].map(parsePx);
  if (colSizes === null || rowSizes === null || edges.some((e) => e === null))
    return null;
  const [bl, bt, pl, pt, br, bb, pr, pb] = edges as number[];
  const contentWidth = rect.width / zoom - (bl! + br! + pl! + pr!);
  const contentHeight = rect.height / zoom - (bt! + bb! + pt! + pb!);
  const colGap = parseGap(style.columnGap, contentWidth);
  const rowGap = parseGap(style.rowGap, contentHeight);
  if (colGap === null || rowGap === null) return null;
  // A scrolled grid carries its tracks with its content.
  const contentX = rect.x + (bl! + pl! - node.scrollLeft) * zoom;
  const contentY = rect.y + (bt! + pt! - node.scrollTop) * zoom;
  const used = (sizes: number[], gap: number) =>
    sizes.reduce((a, v) => a + v, 0) + gap * Math.max(0, sizes.length - 1);
  const cols = distribute(
    style.justifyContent,
    contentWidth - used(colSizes, colGap),
    colSizes.length,
    { rtl: style.direction === "rtl" },
  );
  const rows = distribute(
    style.alignContent,
    contentHeight - used(rowSizes, rowGap),
    rowSizes.length,
    {},
  );
  const rtl = style.direction === "rtl";
  return {
    cols: {
      sizes: colSizes,
      gap: colGap,
      bands: layOutBands(
        colSizes,
        colGap,
        contentX,
        zoom,
        cols,
        rtl,
        contentWidth,
      ),
      reversed: rtl,
    },
    rows: {
      sizes: rowSizes,
      gap: rowGap,
      bands: layOutBands(rowSizes, rowGap, contentY, zoom, rows),
      reversed: false,
    },
    rect,
    zoom,
  };
}

/** A child's start or end line as the explicit grid numbers it, or null
 * when it is `auto`, a `span` or a name: an integer, positive from the
 * start, negative from the end (`-1` is the line after the last of
 * `explicit` tracks). */
function lineNumber(value: string, explicit: number): number | null {
  const match = /^(-?\d+)$/.exec(value.trim());
  if (match === null) return null;
  const n = Number(match[1]);
  return n < 0 ? explicit + 2 + n : n;
}

/** The grid items under `node`: its children that take part in the
 * layout (not `display: none`, not absolutely positioned) and, through a
 * `display: contents` child, that child's own. */
function gridItems(node: Element): Element[] {
  const items: Element[] = [];
  for (const child of node.children) {
    const style = getComputedStyle(child);
    if (style.display === "none") continue;
    if (style.display === "contents") items.push(...gridItems(child));
    else if (style.position !== "absolute" && style.position !== "fixed")
      items.push(child);
  }
  return items;
}

/**
 * Whether an item can start before the first explicit line of an axis
 * (`grid-column: -5` on three tracks, `span 2 / 1`, `auto / 1`):
 * Chromium then resolves implicit tracks BEFORE the explicit ones, and
 * the resolved sizes no longer pair with the authored list from the
 * start. Read from the computed start and end of every grid item.
 * Names are not followed — an unknown name lands after the explicit
 * tracks, and a known one is a line the author numbered.
 */
export function startsBeforeFirst(
  node: Element,
  axis: "cols" | "rows",
  explicit: number,
): boolean {
  const [startProperty, endProperty] =
    axis === "cols"
      ? ["grid-column-start", "grid-column-end"]
      : ["grid-row-start", "grid-row-end"];
  for (const child of gridItems(node)) {
    const style = getComputedStyle(child);
    const startText = style.getPropertyValue(startProperty).trim();
    const endText = style.getPropertyValue(endProperty).trim();
    const start = lineNumber(startText, explicit);
    const end = lineNumber(endText, explicit);
    // Where the item starts: the lower of two numbered lines; else the
    // numbered end less the span the start asks for (one when it is auto).
    const span = /^span\s+(\d+)$/.exec(startText);
    let first: number | null = null;
    if (start !== null) first = end === null ? start : Math.min(start, end);
    else if (end !== null) first = end - (span === null ? 1 : Number(span[1]));
    if (first !== null && first < 1) return true;
  }
  return false;
}
