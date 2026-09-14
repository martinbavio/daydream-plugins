// mrbavio.grid — the grid introspection overlay as a plugin (decisions.md
// #48, P6): DevTools-style track lines, gap hatching and line-number badges
// for the selected grid, or the parent's grid of a selected child
// (decisions.md #11). Everything it reads arrives through `dd`: the
// selection, the document walk (`dd.core.findParent`), and the geometry
// cache (`dd.geometry` — rects, the invalidation state, the camera, and
// the rendered node for the one read the API does not wrap, the browser's
// resolved track lists).
//
// It registers on `overlay.screen`, not the world slot: every stroke, hatch
// tile and badge is sized in screen px so it stays constant at any zoom —
// the DevTools model the original overlay was built on — and screen space
// is where `dd.geometry.rect` already answers.

import type { DaydreamApi } from "@daydream/plugin-api";

import createGridOverlay from "./GridOverlay";

export default function activate(dd: DaydreamApi): void {
  dd.registerOverlay({
    id: "grid",
    slot: "overlay.screen",
    render: () => createGridOverlay(dd),
  });
}
