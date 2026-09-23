// What a verb is picked FOR, read off the canvas selection (decision
// #76): the viewport, and — unless the viewport item itself is selected —
// the element inside its page. Two handles for that element, because two
// readers need it:
//
// - `element`, its UNIQUE SELECTOR in the page's stored markup
//   (`dd.pageElement`: what canvas_state answers for it), is what goes
//   into the pick and to the agent: get_viewport `element`, the draft
//   tools' `target` and impeccable_html all address a page element by
//   selector, and a selector survives the remount a markup write causes.
// - `anchor`, the render-time id the page's mount stamped on it, is what
//   the caption and the picker are drawn beside (`dd.geometry.rect`). It
//   dies with the mount, so it is never stored; once it is gone, the
//   element is found again by its selector (`dd.pageFind`).

import { untrack } from "solid-js";

import type { DaydreamApi, ElementId, OverlayRect } from "@daydream/plugin-api";

export interface Target {
  viewportId: string;
  /** The element's unique selector in its page, or null: the whole page. */
  element: string | null;
  /** The element's render-time id, for drawing beside it; null with
   * `element`. Never stored. */
  anchor: ElementId | null;
}

const VIEWPORT = "daydream.viewport";

export interface Targeting {
  /** Whether the selection is something a verb can be picked for — a
   * viewport item, or an element inside a page. Cheap: no selector. */
  has(): boolean;
  /** The target, selector included; null when there is none, or when the
   * element cannot be named (its page is not mounted, or has changed and
   * not remounted yet). */
  read(): Target | null;
}

export function createTargeting(dd: DaydreamApi): Targeting {
  // The page an element belongs to, from `dd.pageElement(id).viewportId`.
  // A render-time id never outlives its mount, so one answer per id holds
  // for its whole life; kept only once there is one.
  let owner: { id: ElementId; viewportId: string } | null = null;
  const pageOf = (id: ElementId): string | null => {
    if (owner?.id === id) return owner.viewportId;
    const element = untrack(() => dd.pageElement(id));
    if (element === null) return null;
    owner = { id, viewportId: element.viewportId };
    return owner.viewportId;
  };

  /** The selection as a viewport and, for an element, its anchor. */
  const place = (): { viewportId: string; anchor: ElementId | null } | null => {
    const selected = dd.selection();
    if (selected === null) return null;
    const item = dd.items().find((i) => i.id === selected);
    if (item !== undefined) {
      return item.kind === VIEWPORT ? { viewportId: item.id, anchor: null } : null;
    }
    const viewportId = pageOf(selected);
    return viewportId === null ? null : { viewportId, anchor: selected };
  };

  return {
    has: () => place() !== null,
    read: () => {
      const at = place();
      if (at === null) return null;
      if (at.anchor === null) return { ...at, element: null };
      const element = untrack(() => dd.pageElement(at.anchor!))?.selector ?? null;
      return element === null ? null : { ...at, element };
    },
  };
}

/** Where to draw beside a target: its element's box, else the viewport's
 * own (`whole` says which). */
export type TargetBox = (
  target: Target,
) => { rect: OverlayRect; whole: boolean } | null;

/**
 * A `TargetBox` for one drawer (the caption, the picker). The element is
 * the anchor while its mount lives; after a remount (a markup write) or a
 * reload it is found again by its selector (`dd.pageFind`), and only a
 * whole page — or an element the selector no longer names alone — gets
 * the viewport's box. The id found is kept until the document changes
 * (`dd.documentVersion()`), since a remount is a document change and the
 * drawer draws on every geometry change, a pan's every frame; an id whose
 * node is gone is looked for again, and nothing found is never kept (the
 * page may still be mounting). A layout read: call it where
 * `dd.geometry.rect` may be called (an effect's apply phase, decision #33).
 */
export function createTargetBox(dd: DaydreamApi): TargetBox {
  let kept: {
    viewportId: string;
    element: string;
    version: number;
    id: ElementId;
  } | null = null;
  /** The element's box, by the id kept for it or found again. */
  const found = (viewportId: string, element: string): OverlayRect | null => {
    const version = untrack(dd.documentVersion);
    if (
      kept !== null &&
      kept.viewportId === viewportId &&
      kept.element === element &&
      kept.version === version
    ) {
      const rect = dd.geometry.rect(kept.id);
      if (rect !== null) return rect;
    }
    const id = dd.pageFind(viewportId, element);
    kept = id === null ? null : { viewportId, element, version, id };
    return id === null ? null : dd.geometry.rect(id);
  };
  return ({ viewportId, element, anchor }) => {
    const own = anchor === null ? null : dd.geometry.rect(anchor);
    if (own !== null) return { rect: own, whole: false };
    const again = element === null ? null : found(viewportId, element);
    if (again !== null) return { rect: again, whole: false };
    const item = dd.geometry.itemRect(viewportId);
    return item === null ? null : { rect: item, whole: true };
  };
}
