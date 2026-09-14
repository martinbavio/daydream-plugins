// The panel's CSS as a string (decisions.md #48: plugins ship no CSS
// files — runtime loading cannot serve them). Mounted ONCE, as the first
// child of the panel root (NotesPanel.tsx). Class names carry a prefix
// DERIVED from `dd.plugin.id` (classPrefix — `mbavio.notes` →
// `daydream-notes-…`), so a copy of this plugin under another id styles
// its own nodes and never this plugin's. Values are literal: this panel
// shares no tokens with any other.

/** The class prefix for a plugin id: dots (and anything else a class
 * name cannot carry) become dashes. */
export const classPrefix = (pluginId: string): string =>
  pluginId.replace(/[^A-Za-z0-9_-]/g, "-");

export const css = (p: string): string => `
/* The dock section (src/shell/Dock.tsx) is as tall as this: the notes take
   the height their text needs and the DOCK scrolls (P5 settled the stack's
   proportions; the CSS editor is the panel that grows), so the pane no
   longer pins or caps itself the way it did as a strip inside the CSS
   editor. No padding on the root: without meta the body is absent and the
   section is a zero-height row under its caption. */
.${p}-panel {
  font-size: 11px;
  line-height: 1.55;
  color: #85858c;
}

.${p}-body {
  padding: 6px 14px 12px;
}

.${p}-body strong {
  color: #b8b8c0;
  font-weight: 600;
}

.${p}-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: #b8b8c0;
}

.${p}-paragraph {
  margin: 0 0 8px;
}

.${p}-list {
  margin: 0 0 8px;
  padding-left: 16px;
}

.${p}-list li {
  margin-bottom: 4px;
}

.${p}-source {
  color: #4c9aff;
  text-decoration: none;
  word-break: break-all;
}

.${p}-source:hover {
  text-decoration: underline;
}
`;
