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

interface Step {
  base: string;
  nth: string | null;
}

/** A selector matching `el` and nothing else within `root` (default: the
 * element's own root node — its document). Throws when `el` is not
 * inside `root`. */
export function uniqueSelector(
  el: Element,
  root: ParentNode = el.getRootNode() as ParentNode,
): string {
  if ((root as Node) === el || !(root as Node).contains(el)) {
    throw new Error("uniqueSelector: the element is not inside the root");
  }
  const unique = (selector: string): boolean => {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  };

  const own = idSelector(el);
  if (own !== null && unique(own)) return own;

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
  if ((root as Node).nodeType === 1) {
    const found = shortest(steps, ":scope", unique);
    if (found !== null) return found;
  }
  throw new Error("uniqueSelector: no selector under this root names it");
}

function stepFor(node: Element): Step {
  const base =
    CSS.escape(node.localName) +
    Array.from(node.classList)
      .map((name) => `.${CSS.escape(name)}`)
      .join("");
  const parent = node.parentNode as ParentNode | null;
  if (parent === null) return { base, nth: null };
  const siblings = Array.from(parent.children);
  const collides = siblings.some(
    (sibling) => sibling !== node && sibling.matches(base),
  );
  if (!collides) return { base, nth: null };
  const sameTag = siblings.filter(
    (sibling) => sibling.localName === node.localName,
  );
  return { base, nth: `:nth-of-type(${sameTag.indexOf(node) + 1})` };
}

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

function idSelector(node: Element): string | null {
  return node.id === "" ? null : `#${CSS.escape(node.id)}`;
}

function isUniqueId(root: ParentNode, node: Element, selector: string): boolean {
  const matches = root.querySelectorAll(selector);
  return matches.length === 1 && matches[0] === node;
}
