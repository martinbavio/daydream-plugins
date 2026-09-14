// The two tree edits the plugin makes, over a viewport payload's WORKING
// COPY inside `dd.updateItem` (one undo step each): swap a subtree for
// its re-parsed self, and remove one element from its parent — and the
// comparison that says a swap would change nothing, so an apply of an
// unchanged pane opens no history step. Pure over plain objects; the
// kernel validates the result before it lands.

import type {
  DeepReadonly,
  DreamElement,
  DreamViewport,
} from "@daydream/plugin-api";

export type ViewportPayload = DreamViewport["payload"];

/** The parent of `id` under `root`, or undefined for the root itself and
 * for an id not in the tree. */
export function parentOf(
  root: DreamElement,
  id: string,
): DreamElement | undefined {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = parentOf(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Replace the subtree rooted at `id` with `replacement`; the root itself
 * when `id` is its id. False when the id is not in the tree. */
export function replaceSubtree(
  payload: ViewportPayload,
  id: string,
  replacement: DreamElement,
): boolean {
  if (payload.root.id === id) {
    payload.root = replacement;
    return true;
  }
  const parent = parentOf(payload.root, id);
  if (parent === undefined) return false;
  const index = parent.children.findIndex((child) => child.id === id);
  parent.children.splice(index, 1, replacement);
  return true;
}

/** Remove the element `id` from its parent; the parent's id, or undefined
 * when `id` is the root (which has no parent to remove it from) or is not
 * in the tree. */
export function removeElement(
  payload: ViewportPayload,
  id: string,
): string | undefined {
  const parent = parentOf(payload.root, id);
  if (parent === undefined) return undefined;
  const index = parent.children.findIndex((child) => child.id === id);
  parent.children.splice(index, 1);
  return parent.id;
}

/** Whether two subtrees are the same element tree: id, tag, text,
 * attributes, styles, layers, label and children, deeply. */
export function sameElement(
  a: DeepReadonly<DreamElement>,
  b: DeepReadonly<DreamElement>,
): boolean {
  return (
    a.id === b.id &&
    a.tag === b.tag &&
    a.text === b.text &&
    a.label === b.label &&
    sameMap(a.attrs, b.attrs) &&
    sameMap(a.styles, b.styles) &&
    sameLayers(a.conditionals, b.conditionals) &&
    a.children.length === b.children.length &&
    a.children.every((child, i) => sameElement(child, b.children[i]!))
  );
}

function sameMap(
  a: DeepReadonly<Record<string, string>> | undefined,
  b: DeepReadonly<Record<string, string>> | undefined,
): boolean {
  const ea = Object.entries(a ?? {});
  const eb = Object.entries(b ?? {});
  return (
    ea.length === eb.length &&
    ea.every(([key, value], i) => eb[i]![0] === key && eb[i]![1] === value)
  );
}

function sameLayers(
  a: DeepReadonly<DreamElement>["conditionals"],
  b: DeepReadonly<DreamElement>["conditionals"],
): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  return (
    la.length === lb.length &&
    la.every(
      (layer, i) =>
        layer.condition === lb[i]!.condition &&
        sameMap(layer.styles, lb[i]!.styles),
    )
  );
}
