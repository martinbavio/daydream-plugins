// mrbavio.grid — the grid introspection overlay as a plugin (decision
// #48, P6): DevTools-style track lines, gap hatching and line-number badges
// for the selected grid, or the parent's grid of a selected child
// (decision #11). Everything it reads arrives through `dd`: the
// selection, the selected element's parent in its page (the first
// ancestor of `dd.pageStack`, decision #76), and the geometry cache
// (`dd.geometry` — rects, the invalidation state, the camera, and the
// rendered node for the one read the API does not wrap, the browser's
// resolved track lists).
//
// It registers on `overlay.screen`, not the world slot: every stroke, hatch
// tile and badge is sized in screen px so it stays constant at any zoom —
// the DevTools model the original overlay was built on — and screen space
// is where `dd.geometry.rect` already answers.

import type { DaydreamApi } from "@daydream/plugin-api";

import createGridOverlay from "./GridOverlay";
import { classPrefix, css } from "./styles";

export default function activate(dd: DaydreamApi): void {
  dd.registerOverlay({
    id: "grid",
    slot: "overlay.screen",
    // The overlay's CSS, mounted by the kernel in the plugin layer
    // (decision #71) — never a <style> of the overlay's own.
    styles: css(classPrefix(dd.plugin.id)),
    render: () => createGridOverlay(dd),
  });
}
