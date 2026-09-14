/** One shared sheet for mounted text, inline editors, and DOM measurement. */
export const textStyles = `
.daydream-text-item {
  position: absolute;
  min-width: 1rem;
  min-height: 1rem;
  color: #fff;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.5rem;
  font-weight: 400;
  line-height: 1.4;
  overflow: visible;
  pointer-events: auto;
}
.daydream-text-auto { width: max-content; height: max-content; }
.daydream-text-auto-height { min-height: 1lh; }
.daydream-text-content, .daydream-text-editor {
  display: block;
  min-width: 1rem;
  min-height: 1lh;
  color: inherit;
  font: inherit;
  overflow: visible;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.daydream-text-auto .daydream-text-content,
.daydream-text-auto .daydream-text-editor { width: max-content; white-space: pre; }
.daydream-text-content { user-select: none; }
.daydream-text-editor { outline: none; user-select: text; }
`;

export function textClasses(
  frame?: { width: number; height?: number },
  capped = false,
): string {
  return `daydream-text-item ${frame === undefined && !capped ? "daydream-text-auto" : ""} ${frame?.height === undefined ? "daydream-text-auto-height" : ""}`;
}
