// Adopting a variant: the source viewport takes the variant's page and the
// round goes away — one undo step, so ⌘Z brings the fan back. Pure over an
// item array (the working copy dd.mutateItems hands out, or a document's
// items for a test); the marker on each variant's notes (variants.ts) is
// how a round is known. What a viewport is, is the kernel's to name
// (`dd.core.viewportKind`), handed in.

import type { CoreApi, DreamItem, DreamPage } from "@daydream/plugin-api";

import { parseVariantMarker, type VariantMarker } from "./variants";

/** What tells a viewport item: `dd.core`. */
export type Viewports = Pick<CoreApi, "viewportKind">;

/** A viewport item — a page since format 7 (decision #76). */
export function isViewport(core: Viewports, item: DreamItem): item is DreamPage {
  return item.kind === core.viewportKind;
}

/** The marker on a viewport item's notes, or null. */
export function markerOf(core: Viewports, item: DreamItem): VariantMarker | null {
  return isViewport(core, item) ? parseVariantMarker(item.payload.meta?.notes) : null;
}

export interface Round {
  source: DreamPage;
  /** Every variant of the round, the chosen one included, in item order. */
  variants: DreamPage[];
}

/** The round the item belongs to: its source and every sibling from the
 * same run of the verb over it — the same source, verb and round id. A
 * variant landed before rounds had ids has none, and its round is every
 * such sibling of the same source and verb, never one with an id. Null
 * when the item is not a variant, or its source is gone (adopting into
 * nothing is not a thing; the user deletes it). */
export function roundOf(
  core: Viewports,
  items: readonly DreamItem[],
  variantId: string,
): Round | null {
  const variant = items.find((i) => i.id === variantId);
  if (variant === undefined) return null;
  const marker = markerOf(core, variant);
  if (marker === null) return null;
  const source = items.find(
    (i): i is DreamPage => i.id === marker.sourceId && isViewport(core, i),
  );
  if (source === undefined) return null;
  const variants = items.filter((i): i is DreamPage => {
    const m = markerOf(core, i);
    return (
      m !== null &&
      m.sourceId === marker.sourceId &&
      m.verb === marker.verb &&
      m.round === marker.round
    );
  });
  return { source, variants };
}

/** The mutation: the source keeps its envelope (id, position, frame) and
 * its meta — title (the name its title bar shows), notes, sourceUrl — and
 * takes the variant's page, its two texts verbatim (the variant's web
 * fonts are `@font-face` rules in its css, so they come along); the
 * round's variants are spliced out. False when nothing applies. */
export function adoptInto(
  core: Viewports,
  items: DreamItem[],
  variantId: string,
): boolean {
  const round = roundOf(core, items, variantId);
  if (round === null) return false;
  const chosen = round.variants.find((v) => v.id === variantId)!;
  const { meta } = round.source.payload;
  round.source.payload = {
    html: chosen.payload.html,
    css: chosen.payload.css,
    ...(meta === undefined ? {} : { meta }),
  };
  const gone = new Set(round.variants.map((v) => v.id));
  for (let i = items.length - 1; i >= 0; i--) {
    if (gone.has(items[i]!.id)) items.splice(i, 1);
  }
  return true;
}
