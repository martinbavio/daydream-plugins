// The caption's CSS, mounted once as a <style> (a plugin ships CSS as a
// string). Quiet: small, sentence case, one muted colour; it reads as a
// note on the target, not a control.
export const classPrefix = "glaser";

export const css = `
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
