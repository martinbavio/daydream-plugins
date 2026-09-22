// What a verb is picked FOR, read off the canvas selection (decision
// #76): the viewport, and — unless the viewport item itself is selected —
// the element inside its page. Two handles for that element, because two
// readers need it:
//
// - `element`, its UNIQUE SELECTOR in the page, is what goes into the
//   pick and to the agent: get_viewport `element`, the draft tools'
//   `target` and impeccable_html all address a page element by selector,
//   and a selector survives the remount a markup write causes.
// - `anchor`, the render-time id the page's mount stamped on it, is what
//   the caption and the picker are drawn beside (`dd.geometry.rect`). It
//   dies with the mount, so it is never stored, and a caption whose
//   anchor is gone falls back to the viewport's own box.

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
   * element cannot be named (its page is not mounted). */
  read(): Target | null;
}

export function createTargeting(dd: DaydreamApi): Targeting {
  // The page an element belongs to, from `dd.pageStack(id).viewportId`.
  // A render-time id never outlives its mount, so one answer per id holds
  // for its whole life; kept only once there is one.
  let owner: { id: ElementId; viewportId: string } | null = null;
  const pageOf = (id: ElementId): string | null => {
    if (owner?.id === id) return owner.viewportId;
    const stack = untrack(() => dd.pageStack(id));
    if (stack === null) return null;
    owner = { id, viewportId: stack.viewportId };
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
      const node = untrack(() => dd.geometry.node(at.anchor!));
      const element = node === undefined ? null : pageSelector(node);
      return element === null ? null : { ...at, element };
    },
  };
}

/** Where to draw beside a target: the anchored element's box, else the
 * viewport's own — a whole page, or an element whose mount is gone
 * (`whole` says which). A layout read: call it where `dd.geometry.rect`
 * may be called (an effect's apply phase, decision #33). */
export function targetBox(
  dd: DaydreamApi,
  viewportId: string,
  anchor: ElementId | null,
): { rect: OverlayRect; whole: boolean } | null {
  const own = anchor === null ? null : dd.geometry.rect(anchor);
  if (own !== null) return { rect: own, whole: false };
  const item = dd.geometry.itemRect(viewportId);
  return item === null ? null : { rect: item, whole: true };
}

/**
 * The selector that names a page element alone in its page: the same
 * answer `canvas_state`'s `selection.selector` gives (the kernel's
 * render/uniqueSelector.ts, which this follows step for step), asked of
 * the mounted page — the browser's parse of the stored markup, made safe
 * at landing, so a selector unique here is unique in the stored text.
 * The element's `id` when no other element carries it; otherwise the
 * shortest `>`-joined path of tag-and-class steps, `:nth-of-type` added
 * only where a same-looking sibling needs telling apart, anchored at the
 * nearest ancestor whose own `id` is unique. Every candidate is checked
 * with `querySelectorAll` rather than reasoned about. Null when the node
 * is not inside a page's shadow root, or nothing names it.
 */
export function pageSelector(el: Element): string | null {
  const root = el.getRootNode();
  if (!(root instanceof ShadowRoot)) return null;
  const unique = (selector: string): boolean => namesAlone(root, selector, el);
  const own = idSelector(el);
  if (own !== null && unique(own)) return own;

  const steps: Step[] = [];
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node !== el) {
      const anchor = idSelector(node);
      if (anchor !== null && namesAlone(root, anchor, node)) {
        const found = shortest(steps, anchor, unique);
        if (found !== null) return found;
      }
    }
    steps.push(stepFor(node));
    const found = shortest(steps, null, unique);
    if (found !== null) return found;
  }
  return null;
}

/** One compound of the path: tag and classes, and the `:nth-of-type`
 * that tells it from a same-looking sibling, kept apart so a pruning pass
 * can try the compound without it. */
interface Step {
  base: string;
  nth: string | null;
}

function stepFor(node: Element): Step {
  const base =
    CSS.escape(node.localName) +
    Array.from(node.classList, (name) => `.${CSS.escape(name)}`).join("");
  // The parent NODE: a page's `<html>` is its shadow root's child.
  const parent = node.parentNode as ParentNode | null;
  if (parent === null) return { base, nth: null };
  const siblings = Array.from(parent.children);
  if (!siblings.some((s) => s !== node && s.matches(base))) {
    return { base, nth: null };
  }
  const sameTag = siblings.filter((s) => s.localName === node.localName);
  return { base, nth: `:nth-of-type(${sameTag.indexOf(node) + 1})` };
}

/** The path over `steps` (element first) as a selector, or null when it
 * does not name the element alone; an ancestor's `:nth-of-type` the
 * answer does not need is dropped again, one at a time, checked each
 * time. The element's own is never dropped. */
function shortest(
  steps: readonly Step[],
  anchor: string | null,
  unique: (selector: string) => boolean,
): string | null {
  const parts = steps.map((step) => step.base + (step.nth ?? ""));
  const join = (list: readonly string[]): string =>
    [...(anchor === null ? [] : [anchor]), ...[...list].reverse()].join(" > ");
  if (!unique(join(parts))) return null;
  for (let i = parts.length - 1; i >= 1; i--) {
    const step = steps[i]!;
    if (step.nth === null) continue;
    const trial = [...parts];
    trial[i] = step.base;
    if (unique(join(trial))) parts[i] = step.base;
  }
  return join(parts);
}

/** Whether `selector` matches `node` and nothing else under `root`. */
function namesAlone(root: ShadowRoot, selector: string, node: Element): boolean {
  const matches = root.querySelectorAll(selector);
  return matches.length === 1 && matches[0] === node;
}

function idSelector(node: Element): string | null {
  return node.id === "" ? null : `#${CSS.escape(node.id)}`;
}
