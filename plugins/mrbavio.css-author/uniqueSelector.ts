// A UNIQUE SELECTOR FOR AN ELEMENT (decision #76, "Addressing is the
// browser's"): how every finding of this plugin names a page element —
// the name `measure`, `get_viewport` and a landing's answer use, so an
// agent can address the element back with it. The kernel's own
// algorithm (src/render/uniqueSelector.ts), kept here to the letter
// because a plugin may not import the kernel's source: the page's own
// `id` when no other element carries it, else the shortest `>`-joined
// path of tag-and-class steps, `:nth-of-type` only where a same-looking
// sibling needs it, each candidate checked with `querySelectorAll`
// against the same root rather than reasoned about. The root the lints
// hand it is the page's STORED markup parsed in standards mode, as the
// kernel's is (pageDom.ts parsePage, storedNames).
//
// Each declaration below is the kernel's, to the letter, and says so on
// the line before it (a `mirrors:` line naming the kernel file and the
// declaration), so the kernel test can compare it with the kernel the
// plugins pin.

// mirrors: src/render/uniqueSelector.ts uniqueSelector
/**
 * A selector that matches `el` and nothing else within `root` — the
 * element's document, shadow root, or any ancestor it should be unique
 * under (default: the element's own root node).
 *
 * - `#id` when the element's `id` is unique under `root` (escaped with
 *   `CSS.escape`, so an id like `1st` or `a:b` is still one selector).
 * - Otherwise the shortest `>`-joined path, most specific step last,
 *   whose steps are each an element's tag and classes, with
 *   `:nth-of-type(n)` added to a step only when a sibling carries the
 *   same tag and classes. The walk stops early at an ancestor whose own
 *   `id` is unique, which anchors the path as `#anchor > …`.
 *
 * Throws when `el` is not inside `root`: there is no selector for it
 * there.
 */
export function uniqueSelector(
  el: Element,
  root: ParentNode = el.getRootNode() as ParentNode,
): string {
  // `querySelectorAll` searches BENEATH its root, so a root cannot name
  // itself, and an element outside it has no selector there at all.
  if ((root as Node) === el || !(root as Node).contains(el)) {
    throw new Error("uniqueSelector: the element is not inside the root");
  }
  const unique = (selector: string): boolean => {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  };

  const own = idSelector(el);
  if (own !== null && unique(own)) return own;

  // Steps from the element upward; `steps[0]` is the element's own.
  const steps: Step[] = [];
  for (
    let node: Element | null = el;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    if (node !== el) {
      const anchor = idSelector(node);
      if (anchor !== null && isUniqueId(root, node, anchor)) {
        const found = shortest(steps, anchor, unique);
        if (found !== null) return found;
      }
    }
    steps.push(stepFor(node));
    const found = shortest(steps, null, unique);
    if (found !== null) return found;
  }
  // Under an ELEMENT root the selector engine still sees the whole
  // document — `div > p` may match through an ancestor outside it — so a
  // path that reached the root without coming out unique is anchored AT
  // the root, which `:scope` names inside its own query.
  // (Asked by node type: an iframe's elements are another realm's, and
  // `instanceof Element` is false for them.)
  if ((root as Node).nodeType === Node.ELEMENT_NODE) {
    const found = shortest(steps, ":scope", unique);
    if (found !== null) return found;
  }
  // Every step down from the root's first element carries `:nth-of-type`
  // wherever a sibling looks the same, so the full path always resolves
  // to one element; reaching here means the root holds `el` somewhere a
  // selector cannot reach (a template's content, say).
  throw new Error("uniqueSelector: no selector under this root names it");
}

// mirrors: src/render/uniqueSelector.ts Step
/** One compound of the path: the element's tag and classes, and the
 * `:nth-of-type` that tells it from a same-looking sibling, kept apart so
 * a pruning pass can try the compound without it. */
interface Step {
  base: string;
  nth: string | null;
}

// mirrors: src/render/uniqueSelector.ts stepFor
function stepFor(node: Element): Step {
  const base =
    CSS.escape(node.localName) +
    Array.from(node.classList)
      .map((name) => `.${CSS.escape(name)}`)
      .join("");
  // The parent NODE, not element: the page's `<html>` is a shadow root's
  // child, and a document's root has the document for a parent.
  const parent = node.parentNode as ParentNode | null;
  if (parent === null) return { base, nth: null };
  const siblings = Array.from(parent.children);
  const collides = siblings.some(
    (sibling) => sibling !== node && sibling.matches(base),
  );
  if (!collides) return { base, nth: null };
  // nth-of-type counts siblings of the same TAG, whatever their classes:
  // `div.card:nth-of-type(3)` is the third div, which must also be a card.
  const sameTag = siblings.filter(
    (sibling) => sibling.localName === node.localName,
  );
  return { base, nth: `:nth-of-type(${sameTag.indexOf(node) + 1})` };
}

// mirrors: src/render/uniqueSelector.ts shortest
/**
 * The path over `steps` (element first) as a selector, or null when it is
 * not unique. When it is, every `:nth-of-type` an ANCESTOR step does not
 * need is dropped again — one at a time, checked each time — so the
 * answer carries an index only where one disambiguates. The element's
 * own index is never dropped: a same-looking sibling shares every
 * ancestor with it, so nothing above can tell them apart.
 */
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

// mirrors: src/render/uniqueSelector.ts idSelector
function idSelector(node: Element): string | null {
  return node.id === "" ? null : `#${CSS.escape(node.id)}`;
}

// mirrors: src/render/uniqueSelector.ts isUniqueId
function isUniqueId(
  root: ParentNode,
  node: Element,
  selector: string,
): boolean {
  const matches = root.querySelectorAll(selector);
  return matches.length === 1 && matches[0] === node;
}
