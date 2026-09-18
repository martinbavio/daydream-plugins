import { createEffect, createSignal, For, Show, untrack } from "solid-js";

import type { JSX } from "@solidjs/web";

import type { DaydreamApi, ElementId, OverlayRect } from "@daydream/plugin-api";

import {
  createGridTracker,
  type GridGeometry,
  type GridTrack,
} from "./gridGeometry";
import { classPrefix } from "./styles";

/**
 * DevTools-style read-only grid visuals, drawn into the `overlay.screen`
 * slot: dashed track boundary lines (extended a bit past the container
 * edges), hatched gap bands, and line-number badges (positive lines only,
 * 1..n+1 — decision #11). Screen-space means every stroke, hatch and
 * badge stays constant-size at any zoom. The slot is pointer-events: none,
 * inherited by everything here.
 *
 * Which grid (decision #11): the selected element's own grid wins; the
 * parent's grid shows only when the selection is a non-grid child; one grid
 * at a time. TODO(v1): nested grids.
 */

interface GridVisual {
  geometry: GridGeometry;
  /** Border-box rect of the grid container, overlay coords. */
  rect: OverlayRect;
}

/** How far dashed track lines extend past the container edges (screen px). */
const LINE_EXTENSION = 12;
/** Distance from the container edge to a badge center (screen px). */
const BADGE_OFFSET = 14;

/**
 * Unique track-edge positions along one axis: both edges of every gap band,
 * collapsing the duplicate shared edge when the gap is 0 (track end equals
 * the next track's start exactly — same float arithmetic).
 */
function trackEdges(tracks: GridTrack[]): number[] {
  const edges: number[] = [];
  for (const track of tracks) {
    if (edges[edges.length - 1] !== track.start) edges.push(track.start);
    edges.push(track.end);
  }
  return edges;
}

/**
 * Badge anchor positions for grid lines 1..n+1: the first track's start
 * edge, the center of each gap (the two edges' midpoint — identical to the
 * shared edge when gap is 0), and the last track's end edge.
 */
function lineAnchors(tracks: GridTrack[]): number[] {
  const anchors: number[] = [];
  for (const [i, track] of tracks.entries()) {
    const prev = tracks[i - 1];
    anchors.push(
      prev === undefined ? track.start : (prev.end + track.start) / 2,
    );
  }
  const last = tracks[tracks.length - 1];
  if (last !== undefined) anchors.push(last.end);
  return anchors;
}

/** The [start, end] span covered by a track list, or null when empty. */
function trackSpan(tracks: GridTrack[]): { start: number; end: number } | null {
  const first = tracks[0];
  const last = tracks[tracks.length - 1];
  if (first === undefined || last === undefined) return null;
  return { start: first.start, end: last.end };
}

function Badge(props: { prefix: string; x: number; y: number; line: number }) {
  const label = () => String(props.line);
  const width = () => 8 + label().length * 6;
  return (
    <g>
      <rect
        class={`${props.prefix}-badge`}
        x={props.x - width() / 2}
        y={props.y - 7}
        width={width()}
        height={14}
        rx={7}
      />
      <text class={`${props.prefix}-badge-text`} x={props.x} y={props.y}>
        {label()}
      </text>
    </g>
  );
}

/** The overlay's content: the svg layer, rendered once per registration
 * under the slot's owner (the effect below lives with it). Its CSS is the
 * registration's `styles` (index.tsx), mounted by the kernel. */
export default function createGridOverlay(dd: DaydreamApi): JSX.Element {
  // Class and pattern-id prefix from the plugin id: a copy under another
  // id draws with its own pattern and classes, never this plugin's.
  const p = classPrefix(dd.plugin.id);
  const trackGridGeometry = createGridTracker(dd);
  const [visual, setVisual] = createSignal<GridVisual | null>(null);
  // Compute subscribes to the selection + every geometry trigger
  // (dd.geometry.version); the layout and computed-style reads happen in
  // apply, after render effects hit the DOM — the same frame, no lag
  // (decision #8/#33; the rule is documented on GeometryApi).
  createEffect(
    () => {
      dd.geometry.version();
      return dd.selection();
    },
    (selectedId) => {
      setVisual(
        selectedId === null ? null : untrack(() => readVisual(selectedId)),
      );
    },
  );

  const readVisual = (selectedId: ElementId): GridVisual | null => {
    const own = trackGridGeometry(selectedId);
    let gridId: ElementId;
    let geometry: GridGeometry;
    if (own !== null) {
      gridId = selectedId;
      geometry = own;
    } else {
      const parent = dd.core.findParent(dd.document(), selectedId);
      if (parent === undefined) return null;
      const parentGrid = trackGridGeometry(parent.id);
      if (parentGrid === null) return null;
      gridId = parent.id;
      geometry = parentGrid;
    }
    const rect = dd.geometry.rect(gridId);
    return rect === null ? null : { geometry, rect };
  };

  return (
    <svg class={`${p}-layer`} aria-hidden="true">
      <Show when={visual()}>
        {(v) => {
          const rect = () => v().rect;
          const geometry = () => v().geometry;
          const rowSpan = () => trackSpan(geometry().rows);
          const colSpan = () => trackSpan(geometry().cols);
          return (
            <g>
              <defs>
                {/* Seamless 6x6 diagonal hatch tile; userSpaceOnUse =
                    screen space, so the hatch scale is constant at any
                    zoom. */}
                <pattern
                  id={`${p}-gap-hatch`}
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                >
                  <path class={`${p}-hatch-line`} d="M 0 6 L 6 0" />
                  <path class={`${p}-hatch-line`} d="M -1.5 1.5 L 1.5 -1.5" />
                  <path class={`${p}-hatch-line`} d="M 4.5 7.5 L 7.5 4.5" />
                </pattern>
              </defs>
              {/* Hatched gap bands, clipped to the perpendicular track
                  span. */}
              <Show when={rowSpan()}>
                {(span) => (
                  <For each={geometry().colGaps}>
                    {(gap) => (
                      <rect
                        class={`${p}-gap-band`}
                        x={gap.start}
                        y={span().start}
                        width={gap.end - gap.start}
                        height={span().end - span().start}
                      />
                    )}
                  </For>
                )}
              </Show>
              <Show when={colSpan()}>
                {(span) => (
                  <For each={geometry().rowGaps}>
                    {(gap) => (
                      <rect
                        class={`${p}-gap-band`}
                        x={span().start}
                        y={gap.start}
                        width={span().end - span().start}
                        height={gap.end - gap.start}
                      />
                    )}
                  </For>
                )}
              </Show>
              {/* Dashed track boundary lines, extended past the
                  container. */}
              <For each={trackEdges(geometry().cols)}>
                {(x) => (
                  <line
                    class={`${p}-line`}
                    x1={x}
                    y1={rect().y - LINE_EXTENSION}
                    x2={x}
                    y2={rect().y + rect().height + LINE_EXTENSION}
                  />
                )}
              </For>
              <For each={trackEdges(geometry().rows)}>
                {(y) => (
                  <line
                    class={`${p}-line`}
                    x1={rect().x - LINE_EXTENSION}
                    y1={y}
                    x2={rect().x + rect().width + LINE_EXTENSION}
                    y2={y}
                  />
                )}
              </For>
              {/* Line-number badges: columns across the top, rows down
                  the left. Positive lines only (decision #11). */}
              <For each={lineAnchors(geometry().cols)}>
                {(x, i) => (
                  <Badge
                    prefix={p}
                    x={x}
                    y={rect().y - BADGE_OFFSET}
                    line={i() + 1}
                  />
                )}
              </For>
              <For each={lineAnchors(geometry().rows)}>
                {(y, i) => (
                  <Badge
                    prefix={p}
                    x={rect().x - BADGE_OFFSET}
                    y={y}
                    line={i() + 1}
                  />
                )}
              </For>
            </g>
          );
        }}
      </Show>
    </svg>
  );
}
