import type { DaydreamApi, ElementId } from "@daydream/plugin-api";

import { readGridGeometry, type GridGeometry } from "./gridGeometry";

/** The grid a selection stands for, and its geometry. */
export interface SelectedGrid {
  gridId: ElementId;
  geometry: GridGeometry;
}

/**
 * Which grid (Daydream's decision #11): the selected element's own wins;
 * its parent's shows only when the selection is a non-grid child; one grid
 * at a time. The parent is `dd.pageElement`'s — the mount and the markup
 * alone, a lookup per frame. Read from an effect's apply phase.
 */
export function selectedGrid(
  dd: DaydreamApi,
  selectedId: ElementId,
): SelectedGrid | null {
  const found = (gridId: ElementId): SelectedGrid | null => {
    const geometry = readGridGeometry(dd, gridId);
    return geometry === null ? null : { gridId, geometry };
  };
  const own = found(selectedId);
  if (own !== null) return own;
  const parent = dd.pageElement(selectedId)?.parentId ?? null;
  return parent === null ? null : found(parent);
}
