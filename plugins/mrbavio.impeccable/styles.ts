// The plugin's CSS as strings, one per overlay, handed to each
// `registerOverlay` as `styles` (index.tsx): the kernel mounts each once
// in its overlay root, inside the dream-plugin layer (decisions.md #71) —
// a <style> of the plugin's own would be unlayered and is refused. Quiet:
// small, sentence case, the chrome's own colours; the caption reads as a
// note on the target, the picker as a list beside it.
export const classPrefix = "impeccable";

/** The caption overlay's rules. */
export const captionCss = `
.${classPrefix}-caption {
  position: absolute;
  font: 11px/1.4 system-ui, sans-serif;
  color: #8a8a8a;
  white-space: nowrap;
  pointer-events: none;
}
.${classPrefix}-caption[data-phase="building"] {
  color: #c98a1f;
}
`;

/** The picker overlay's rules. */
export const pickerCss = `
.${classPrefix}-picker {
  position: absolute;
  width: 180px;
  background: #111113;
  color: #9a9aa0;
  border: 1px solid #232326;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font: 12px/1.4 system-ui, sans-serif;
}
.${classPrefix}-picker-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 0;
  border-bottom: 1px solid #232326;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: #c8c8ce;
  font: inherit;
  outline: none;
}
.${classPrefix}-picker-input::placeholder {
  color: #6f6f76;
}
.${classPrefix}-picker-list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: 240px;
  overflow-y: auto;
}
.${classPrefix}-picker-item {
  padding: 4px 8px;
  cursor: default;
}
.${classPrefix}-picker-item[aria-selected="true"] {
  background: #1c1c20;
  color: #c8c8ce;
}
`;
