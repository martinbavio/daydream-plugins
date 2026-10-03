// The panel's CSS as a string (decision #48: plugins ship no CSS files),
// handed to `registerPanel` as `styles`: the kernel mounts it in the
// dream-plugin layer (decision #71). Class names carry a prefix derived
// from `dd.plugin.id` (`mrbavio.pages` → `mrbavio-pages-…`), and the
// --panel-* tokens are scoped to the panel root, as the HTML editor's are.

/** The class prefix for a plugin id: dots (and anything else a class name
 * cannot carry) become dashes. */
export const classPrefix = (pluginId: string): string =>
  pluginId.replace(/[^A-Za-z0-9_-]/g, "-");

export const css = (p: string): string => `
.${p}-panel {
  --panel-text: #b8b8be;
  --panel-bright: #c8c8ce;
  --panel-dim: #9a9aa0;
  --panel-muted: #55555c;
  --panel-chrome: #232328;
  --panel-hover: #1c1c20;
  --panel-selected: #26262c;
  --panel-amber: #a8842c;

  /* Sized to its rows; what is taller than the panel scrolls. */
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 4px 6px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--panel-text);
}

.${p}-empty {
  margin: 4px 8px 8px;
  font-size: 11px;
  color: var(--panel-muted);
}

.${p}-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.${p}-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 2px 0 0;
  border-radius: 4px;
}

.${p}-row:hover {
  background: var(--panel-hover);
}

.${p}-row[data-selected] {
  background: var(--panel-selected);
}

.${p}-name {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  cursor: grab;
  user-select: none;
}

.${p}-name:focus-visible {
  outline: 1px solid #3a3a41;
  border-radius: 4px;
}

.${p}-row[data-missing] .${p}-name {
  cursor: default;
}

.${p}-path,
.${p}-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.${p}-path {
  flex: 0 1 auto;
  color: var(--panel-bright);
}

.${p}-folder {
  color: var(--panel-dim);
}

.${p}-title {
  flex: 1 1 0;
  min-width: 0;
  font-size: 11px;
  color: var(--panel-muted);
}

/* A page with no viewport on the canvas reads quieter; a missing one
   (its file gone) quieter still. */
.${p}-row[data-off] .${p}-path {
  color: var(--panel-dim);
}

.${p}-row[data-missing] .${p}-path {
  color: var(--panel-muted);
  text-decoration: line-through;
}

.${p}-note {
  flex: none;
  padding: 0 4px;
  font-size: 11px;
  color: var(--panel-muted);
  font-variant-numeric: tabular-nums;
}

.${p}-new {
  margin-top: 6px;
  padding: 0 2px;
}

.${p}-new-button {
  padding: 4px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--panel-dim);
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.${p}-new-button:hover {
  color: var(--panel-bright);
  background: var(--panel-hover);
}

.${p}-new-input {
  box-sizing: border-box;
  width: 100%;
  padding: 4px 8px;
  font: inherit;
  color: var(--panel-bright);
  background: #101012;
  border: 1px solid var(--panel-chrome);
  border-radius: 4px;
  outline: none;
}

.${p}-new-input:focus {
  border-color: #3a3a41;
}

.${p}-problem {
  margin: 6px 8px 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--panel-amber);
}
`;
