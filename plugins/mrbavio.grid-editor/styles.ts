// The plugin's CSS as a string (plugins ship no CSS files): handed to
// each `registerOverlay` as `styles`, mounted by the kernel in the
// dream-plugin layer (decision #71). Class names and the hatch pattern id
// carry a prefix derived from the plugin id (`mrbavio.grid-editor` →
// `mrbavio-grid-editor-…`), so a copy under another id styles its own
// nodes. Everything is screen space, so lines, badges, hit bands and the
// note keep their size at any zoom.
//
// The guides (`-guides`, `-line`, `-gap-band`, `-hatch-line`, `-badge`)
// are the read-only DevTools-style drawing in the screen slot, and take
// no input. The handles (`-layer`, `-handle`, `-note`) are the interactive
// slot's. While a band is dragged the layer is `data-dragging`; the
// pressed band is `data-active` (it holds the pointer) and the line under
// the pointer is `data-hot` (lit). The edge bands (`data-edge`) are
// always there to grab — the cursor says so — and show only under the
// pointer or lit.

export const classPrefix = (pluginId: string): string =>
  pluginId.replace(/[^A-Za-z0-9_-]/g, "-");

export const guidesCss = (p: string): string => `
.${p}-guides {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.${p}-line {
  stroke: rgba(76, 154, 255, 0.55);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}

.${p}-gap-band {
  fill: url(#${p}-gap-hatch);
}

.${p}-hatch-line {
  stroke: rgba(76, 154, 255, 0.28);
  stroke-width: 1;
  fill: none;
}

.${p}-badge {
  fill: rgba(23, 34, 51, 0.85);
  stroke: rgba(76, 154, 255, 0.45);
  stroke-width: 1;
}

.${p}-badge-text {
  fill: #a8ccff;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 9px;
  text-anchor: middle;
  dominant-baseline: central;
}
`;

export const handlesCss = (p: string): string => `
.${p}-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
}

.${p}-handle {
  position: absolute;
  box-sizing: border-box;
  background: rgba(76, 154, 255, 0.08);
  transition: background 120ms ease, opacity 120ms ease;
}

.${p}-handle:hover,
.${p}-layer[data-dragging] .${p}-handle[data-hot] {
  background: rgba(76, 154, 255, 0.24);
}

.${p}-layer[data-dragging] .${p}-handle:not([data-hot]) {
  background: transparent;
}

.${p}-layer[data-dragging] .${p}-handle:not([data-active]):not([data-hot]) {
  pointer-events: none;
}

.${p}-handle[data-edge] {
  opacity: 0;
}

.${p}-handle[data-edge]:hover,
.${p}-layer[data-dragging] .${p}-handle[data-edge][data-hot] {
  opacity: 1;
}

.${p}-handle-cols {
  cursor: col-resize;
}

.${p}-handle-rows {
  cursor: row-resize;
}

.${p}-note {
  position: absolute;
  padding: 2px 6px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  color: #a8ccff;
  background: rgba(23, 34, 51, 0.92);
  border: 1px solid rgba(76, 154, 255, 0.45);
  border-radius: 4px;
  pointer-events: none;
}
`;
