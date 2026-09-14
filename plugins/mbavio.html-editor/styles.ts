// The panel's CSS as a string (decisions.md #48: plugins ship no CSS
// files). Mounted ONCE, as the first child of the panel root
// (HtmlPanel.tsx). Class names carry a prefix derived from `dd.plugin.id`
// (`mbavio.html-editor` → `daydream-html-editor-…`), so a copy of this
// folder under another id styles its own nodes and never this one's. The
// --panel-* tokens are scoped to the panel root, not :root, so nothing of
// the app leaks into a rendered document.

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
  --panel-amber: #a8842c;
  --panel-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  /* The dock section is the flex column this fills: the panel registers
     with \`grow\`, so the section is its share of the dock's spare height
     and this root, the editor box and CodeMirror fill it top to bottom. */
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 14px 12px;
  overflow: hidden;
}

.${p}-empty {
  font-size: 12px;
  color: var(--panel-muted);
  user-select: none;
}

/* The editor box fills the section; CodeMirror's scroller scrolls. */
.${p}-editor {
  flex: 1;
  display: flex;
  min-height: 0;
  background: #101012;
  border: 1px solid var(--panel-chrome);
  border-radius: 4px;
  overflow: hidden;
}

.${p}-editor-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.${p}-editor-host .cm-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* A refusal: the sentence the parser or the kernel gave, and nothing
   changed. Cleared by the next apply or selection. */
.${p}-message {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--panel-amber);
}
`;
