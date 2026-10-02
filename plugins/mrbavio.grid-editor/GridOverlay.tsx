import { createEffect, createSignal, For, Show, untrack } from "solid-js";

import type { JSX } from "@solidjs/web";

import type { DaydreamApi } from "@daydream/plugin-api";

import type { GridGeometry } from "./gridGeometry";
import { gapsOf, lineAnchors, trackEdges, trackSpan } from "./guideLines";
import { selectedGrid } from "./selectedGrid";
import { classPrefix } from "./styles";

/**
 * DevTools-style read-only grid visuals, drawn into the `overlay.screen`
 * slot: dashed track boundary lines (extended a bit past the container
 * edges), hatched gap bands, and line-number badges (positive lines only,
 * 1..n+1 — decision #11). Screen-space means every stroke, hatch and
 * badge stays constant-size at any zoom. The slot is pointer-events: none,
 * inherited by everything here.
 *
 * Which grid: `selectedGrid` (decision #11). TODO(v1): nested grids and
 * negative / leading-implicit line numbering.
 */

/** How far dashed track lines extend past the container edges (screen px). */
const LINE_EXTENSION = 12;
/** Distance from the container edge to a badge center (screen px). */
const BADGE_OFFSET = 14;

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
  const [geometry, setGeometry] = createSignal<GridGeometry | null>(null);
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
      setGeometry(
        selectedId === null
          ? null
          : untrack(() => selectedGrid(dd, selectedId)?.geometry ?? null),
      );
    },
  );

  return (
    <svg class={`${p}-guides`} aria-hidden="true">
      <Show when={geometry()}>
        {(g) => {
          const rect = () => g().rect;
          const rowSpan = () => trackSpan(g().rows);
          const colSpan = () => trackSpan(g().cols);
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
                  <For each={gapsOf(g().cols)}>
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
                  <For each={gapsOf(g().rows)}>
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
              <For each={trackEdges(g().cols)}>
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
              <For each={trackEdges(g().rows)}>
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
              <For each={lineAnchors(g().cols)}>
                {(x, i) => (
                  <Badge
                    prefix={p}
                    x={x}
                    y={rect().y - BADGE_OFFSET}
                    line={i() + 1}
                  />
                )}
              </For>
              <For each={lineAnchors(g().rows)}>
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
