// mrbavio.notes — the notes pane as a plugin (decision #48, P5): one
// panel that reads the project's meta, and the source of the selected
// viewport's page, through the API (decision #78). It
// lifted out of the CSS editor to force a second panel before a
// third party asks, and it is the smallest REAL plugin: an author reading
// this folder learns the whole shape — manifest, entry, panel, styles.

import type { DaydreamApi } from "@daydream/plugin-api";

import createNotesPanel from "./NotesPanel";
import { classPrefix, css } from "./styles";

export default function activate(dd: DaydreamApi): void {
  // No `grow`: the pane starts content-sized under the editors; its
  // length after that, its width and where it sits are the user's
  // (decision #79).
  dd.registerPanel({
    id: "notes",
    title: "Notes",
    // The panel's CSS, mounted by the kernel in the plugin layer
    // (decision #71) — never a <style> of the panel's own.
    styles: css(classPrefix(dd.plugin.id)),
    render: () => createNotesPanel(dd),
  });
}
