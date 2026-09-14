import { textClasses } from "./styles";

export interface TextSize {
  width: number;
  height: number;
}

/** Glyph metrics and wrapping are always the browser's, never estimated. */
export function measureNaturalTextItem(
  text: string,
  frame?: { width: number; height?: number },
  fontSize?: number,
): TextSize | null {
  return measureText(text, frame, undefined, fontSize);
}

/** An ingest/paste creation default, not a permanent resize limit. */
export function measureInitialTextFrame(
  text: string,
  fontSize?: number,
): { width: number } | undefined {
  if (Array.from(text).length <= 60) return undefined;
  const size = measureText(text, undefined, 60, fontSize);
  return size === null ? undefined : { width: size.width };
}

function measureText(
  text: string,
  frame?: { width: number; height?: number },
  maxWidthCh?: number,
  fontSize?: number,
): TextSize | null {
  if (typeof document === "undefined" || document.body === null) return null;
  const item = document.createElement("div");
  item.className = textClasses(frame, maxWidthCh !== undefined);
  Object.assign(item.style, {
    position: "fixed",
    left: "-100000px",
    top: "-100000px",
    visibility: "hidden",
    pointerEvents: "none",
  });
  if (fontSize !== undefined) item.style.fontSize = `${fontSize}px`;
  if (frame !== undefined) {
    item.style.width = `${frame.width}px`;
    if (frame.height !== undefined) item.style.height = `${frame.height}px`;
  }
  if (maxWidthCh !== undefined) {
    item.style.width = "max-content";
    item.style.maxWidth = `${maxWidthCh}ch`;
  }
  const content = document.createElement("div");
  content.className = "daydream-text-content";
  content.textContent = text;
  if (text.endsWith("\n")) content.append(document.createElement("br"));
  item.append(content);
  document.body.append(item);
  try {
    const { width, height } = item.getBoundingClientRect();
    return Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
      ? { width, height }
      : null;
  } finally {
    item.remove();
  }
}
