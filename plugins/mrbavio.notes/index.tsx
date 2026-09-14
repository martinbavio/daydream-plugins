// mrbavio.notes — the notes pane as a plugin (decisions.md #48, P5): one
// panel that reads the selected item's viewport meta through the API. It
// lifted out of the CSS editor to force the dock multi-panel before a
// third party asks, and it is the smallest REAL plugin: an author reading
// this folder learns the whole shape — manifest, entry, panel, styles.

import type { DaydreamApi } from "@daydream/plugin-api";

import createNotesPanel from "./NotesPanel";

export default function activate(dd: DaydreamApi): void {
  // No `grow`: the pane is content-sized under the editors, and the dock's
  // width is the dock's own (src/shell/Dock.tsx, decisions.md #59; the line
  // from the panels that declare one).
  dd.registerPanel({
    id: "notes",
    title: "Notes",
    render: () => createNotesPanel(dd),
  });
}
