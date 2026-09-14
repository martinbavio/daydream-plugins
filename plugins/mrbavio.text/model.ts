import type { DeepReadonly, DreamItem } from "@daydream/plugin-api";

export const TEXT_KIND = "mrbavio.text";
export const DEFAULT_TEXT_FONT_SIZE = 24;
export const TEXT_FONT_SIZE_STEP = 2;

export interface TextPayload {
  text: string;
  fontSize?: number;
}

export type TextItem = DreamItem & { payload: TextPayload };

export function isTextItem(item: DreamItem): item is TextItem;
export function isTextItem(
  item: DeepReadonly<DreamItem>,
): item is DeepReadonly<TextItem>;
export function isTextItem(item: DeepReadonly<DreamItem>): boolean {
  // Unknown-kind documents can carry arbitrary data while this plugin is
  // disabled. Re-enabling must not make shortcuts read malformed payloads.
  return (
    item.kind === TEXT_KIND &&
    textPayloadProblem(item.payload, "payload") === null
  );
}

export function textOf(item: DeepReadonly<DreamItem>): string {
  const payload = item.payload;
  if (typeof payload !== "object" || payload === null) return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

export function textPayloadProblem(raw: unknown, where: string): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return `${where} is not a text payload`;
  const payload = raw as Record<string, unknown>;
  if (typeof payload["text"] !== "string" || payload["text"].trim() === "")
    return `${where}.text must be a non-empty string`;
  const fontSize = payload["fontSize"];
  if (
    fontSize !== undefined &&
    (typeof fontSize !== "number" ||
      !Number.isFinite(fontSize) ||
      fontSize <= 0)
  )
    return `${where}.fontSize must be a positive finite number`;
  if (Object.keys(payload).some((key) => key !== "text" && key !== "fontSize"))
    return `${where} may only contain text and fontSize`;
  return null;
}

export function nextTextFontSize(current: number, delta: number): number {
  const next = Math.max(2, current + delta);
  return Number.isFinite(next) ? next : current;
}

/** Scale the wrapping width with the glyphs. Explicit heights stay explicit. */
export function resizeTextFont(item: TextItem, delta: number): void {
  const previous = item.payload.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
  const next = nextTextFontSize(previous, delta);
  if (item.frame !== undefined) {
    const width = item.frame.width * (next / previous);
    if (!Number.isFinite(width) || width <= 0) return;
    item.frame.width = width;
  }
  item.payload.fontSize = next;
}
