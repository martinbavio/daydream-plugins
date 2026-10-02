// mrbavio.grid-editor — the grid on the canvas, to read and to edit. Two
// overlays over one reading of the selected grid (`selectedGrid`):
//
// - `grid`, the guides, in `overlay.screen`: DevTools-style dashed track
//   lines, hatched gaps and line-number badges for the selected grid, or
//   the parent's grid of a selected child (Daydream's decision #11).
//   Read-only; screen space, so every stroke stays one size at any zoom.
// - `grid-handles`, the editor, in `overlay.interactive` (the one slot that
//   takes input, decision #67): with a grid selected (or a child of one),
//   every gap between two tracks is a band that takes a drag. A plain drag
//   moves the line — the two tracks beside it trade size, written in the
//   units the author used (`1fr 2fr` → `1.2fr 1.8fr`, `200px 1fr` →
//   `240px 1fr`), stopping at nothing (`0fr`); a ⌘-drag (Ctrl elsewhere)
//   resizes the gap itself. A new track is a new line: ⇧-drag a band to
//   pull one out of it, carved from the neighbour the drag points at (`1fr
//   2fr` → `1fr 0.5fr 1.5fr`); the grid's two edges are bands too, shown
//   under the pointer, and a drag inward on one pulls a track in from that
//   end; double-click a band for a track equal to the one before it
//   (`repeat(3, 1fr)` → `repeat(4, 1fr)`), ⇧-double-click to remove that
//   track. Every frame writes real CSS into the page's own rule through
//   a page transaction (`dd.beginItemTransaction`), and the note beside the pointer shows exactly what was
//   written. Nothing else is created here — a grid comes from the page or
//   from an agent.
//
// Everything either reads arrives through `dd` — the selection, the
// element's parent in its page (`dd.pageElement`), the geometry cache
// (`dd.geometry`, with the rendered node for the one read the API does not
// wrap, the browser's resolved track lists).

import type { DaydreamApi } from "@daydream/plugin-api";

import createGridOverlay from "./GridOverlay";
import createGridHandles from "./GridHandles";
import { classPrefix, guidesCss, handlesCss } from "./styles";

export default function activate(dd: DaydreamApi): void {
  const p = classPrefix(dd.plugin.id);
  dd.registerOverlay({
    id: "grid",
    slot: "overlay.screen",
    // The CSS is mounted by the kernel in the plugin layer (decision #71)
    // — never a <style> of the overlay's own.
    styles: guidesCss(p),
    render: () => createGridOverlay(dd),
  });
  dd.registerOverlay({
    id: "grid-handles",
    slot: "overlay.interactive",
    styles: handlesCss(p),
    render: () => createGridHandles(dd),
  });
}
