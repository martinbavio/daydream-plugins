import type { DaydreamApi, DreamItem } from "@daydream/plugin-api";
import { flush, untrack } from "solid-js";

import { measureInitialTextFrame, measureNaturalTextItem } from "./measurement";
import { isTextItem, TEXT_KIND } from "./model";

/** Both clipboard hooks belong to this activation, and disappear on unload. */
export function registerClipboard(dd: DaydreamApi): void {
  let consecutivePastes = 0;
  let pasting = false;
  let camera = untrack(() => dd.geometry.camera());
  const reset = () => {
    if (!pasting) consecutivePastes = 0;
  };
  dd.canvas.onActivity(reset);
  dd.on("document", reset);
  dd.on("selection", reset);
  dd.on("geometry", () => {
    const next = untrack(() => dd.geometry.camera());
    if (
      next.panX !== camera.panX ||
      next.panY !== camera.panY ||
      next.zoom !== camera.zoom
    )
      reset();
    camera = next;
  });
  dd.canvas.onPaste((event) => {
    if ((event.clipboardData?.files.length ?? 0) > 0) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.trim() === "") return;
    event.preventDefault();
    const cascade = consecutivePastes++ * 16;
    const center = dd.canvas.center();
    const frame = measureInitialTextFrame(text);
    const size = measureNaturalTextItem(text, frame);
    const item: DreamItem = {
      id: dd.core.generateId(),
      kind: TEXT_KIND,
      position: {
        x: center.x + cascade - (size?.width ?? 0) / 2,
        y: center.y + cascade - (size?.height ?? 0) / 2,
      },
      ...(frame === undefined ? {} : { frame }),
      payload: { text },
    };
    // Premeasure with the exact renderer styles, so landing and centering are
    // a single write and undo step, with no guessed text metrics.
    pasting = true;
    try {
      dd.mutateItems((items) => {
        items.push(item);
      });
      dd.select(item.id);
      // Flush the paste's own queued notifications while suppression is
      // explicit; future edits, restores and selection changes reset normally.
      flush();
    } finally {
      pasting = false;
    }
  });
  dd.canvas.onCopy((event) => {
    const range = window.getSelection();
    if (range !== null && !range.isCollapsed) return;
    const selected = dd.itemSelection();
    if (selected.length !== 1 || event.clipboardData === null) return;
    const item = dd.items().find((candidate) => candidate.id === selected[0]);
    if (item === undefined || !isTextItem(item)) return;
    event.clipboardData.setData("text/plain", item.payload.text);
    event.preventDefault();
  });
}
