// Adopting a variant: the source viewport takes the variant's page and the
// round goes away — one undo step, so ⌘Z brings the fan back. Pure over an
// item array (the working copy dd.mutateItems hands out, or a document's
// items for a test); the marker on each variant's notes (variants.ts) is
// how a round is known.

import type { DreamItem, DreamViewport } from "@daydream/plugin-api";

import { parseVariantMarker, type VariantMarker } from "./variants";

const VIEWPORT = "daydream.viewport";

export function isViewport(item: DreamItem): item is DreamViewport {
  return item.kind === VIEWPORT;
}

/** The marker on a viewport item's notes, or null. */
export function markerOf(item: DreamItem): VariantMarker | null {
  return isViewport(item) ? parseVariantMarker(item.payload.meta?.notes) : null;
}

export interface Round {
  source: DreamViewport;
  /** Every variant of the round, the chosen one included, in item order. */
  variants: DreamViewport[];
}

/** The round the item belongs to: its source and every sibling with the
 * same source and verb. Null when the item is not a variant, or its source
 * is gone (adopting into nothing is not a thing; the user deletes it). */
export function roundOf(items: readonly DreamItem[], variantId: string): Round | null {
  const variant = items.find((i) => i.id === variantId);
  if (variant === undefined) return null;
  const marker = markerOf(variant);
  if (marker === null) return null;
  const source = items.find((i) => i.id === marker.sourceId && isViewport(i));
  if (source === undefined) return null;
  const variants = items.filter((i): i is DreamViewport => {
    const m = markerOf(i);
    return m !== null && m.sourceId === marker.sourceId && m.verb === marker.verb;
  });
  return { source: source as DreamViewport, variants };
}

/** The mutation: the source keeps its envelope (id, position, frame) and
 * its meta — title, notes, sourceUrl — and takes the variant's root and
 * fonts; the round's variants are spliced out. False when nothing applies. */
export function adoptInto(items: DreamItem[], variantId: string): boolean {
  const round = roundOf(items, variantId);
  if (round === null) return false;
  const chosen = round.variants.find((v) => v.id === variantId)!;
  round.source.payload = {
    ...round.source.payload,
    root: chosen.payload.root,
    ...(chosen.payload.fonts === undefined
      ? { fonts: undefined }
      : { fonts: chosen.payload.fonts }),
  };
  const gone = new Set(round.variants.map((v) => v.id));
  for (let i = items.length - 1; i >= 0; i--) {
    if (gone.has(items[i]!.id)) items.splice(i, 1);
  }
  return true;
}
