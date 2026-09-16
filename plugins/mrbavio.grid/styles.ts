// The overlay's CSS as a string (decisions.md #48: plugins ship no CSS
// files — runtime loading cannot serve them). Handed to `registerOverlay`
// as `styles` (index.tsx): the kernel mounts it once, first in the overlay
// root, inside the dream-plugin layer (decisions.md #71) — a <style> of the
// overlay's own would be unlayered and is refused. Class names and the hatch pattern
// id carry a prefix DERIVED from `dd.plugin.id` (classPrefix —
// `mrbavio.grid` → `daydream-grid-…`), so a copy of this plugin under
// another id styles its own nodes, and its gap bands reference its own
// <pattern>, never this plugin's.
//
// Same accent hue family as core's selection outline, muted; all
// screen-space, so constant-size at any zoom.

/** The class and id prefix for a plugin id: dots (and anything else a
 * class name cannot carry) become dashes. */
export const classPrefix = (pluginId: string): string =>
  pluginId.replace(/[^A-Za-z0-9_-]/g, "-");

export const css = (p: string): string => `
.${p}-layer {
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
