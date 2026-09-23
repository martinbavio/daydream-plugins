// WHICH ELEMENTS A PAGE RULE MATCHES in a mounted copy, `@scope`
// included. Matching is the browser's (decision #71): every answer is
// `Element.matches` or `querySelectorAll` on the copy. But a rule inside
// an `@scope` names its root as `:scope` (pageCss.ts PageRule.selector),
// and `Element.matches` reads `:scope` as the element asked — so
// `:scope > img`, asked of an `img`, would never match. `querySelectorAll`
// reads `:scope` as the element it is called on, so each root is asked
// for what its rule matches beneath it, and asked of itself with
// `matches`: exactly the root and its descendants, which is what "in
// scope" admits. Then, as the browser scopes a rule:
//
// - the roots are the elements the scope's start selects — the whole
//   document's for a top-level `@scope`, and each enclosing root's in
//   scope for one nested in another; a prelude with no start has the
//   parent of the sheet's `<style>` for its root (the mounted copy's
//   head, where the page's css is);
// - an element at or under a LIMIT — what the end selects beneath a root,
//   the root itself included when the end names `:scope` — is out of that
//   root's scope;
// - an element matches when some root has it in scope and matches it.
//
// Every one of those was checked against Chromium. Outside `@scope`,
// `:scope` in a sheet is the document's root, as the kernel's own rule
// reader reads it (src/render/pageSheet.ts rewriteRootSelector), so it is
// asked as `:root`. A selector the browser refuses matches nothing, as in
// its cascade.

import type { PageScope } from "./pageCss";

/** Whether `node` matches `selector` — a rule's, or a variant of it (a
 * member, its pseudo-element stripped, its states stripped) — read under
 * the rule's `scopes`. */
export type RuleMatcher = (
  node: Element,
  selector: string,
  scopes: readonly PageScope[],
) => boolean;

/** A matcher for one mounted copy. A scoped selector's matches are found
 * once, from its roots down, and kept: every node asked after is a
 * lookup. */
export function ruleMatcher(doc: Document): RuleMatcher {
  const scoped = new Map<string, Set<Element>>();
  return (node, selector, scopes) => {
    if (scopes.length === 0) return tryMatches(node, unscoped(selector));
    const key = JSON.stringify([selector, scopes]);
    let matched = scoped.get(key);
    if (matched === undefined) {
      matched = new Set(
        scopeRoots(doc, scopes).flatMap((scope) =>
          inScope(scope, beneath(scope.root, selector)),
        ),
      );
      scoped.set(key, matched);
    }
    return matched.has(node);
  };
}

/** One root of a scope, with the limits its scope stops at. */
interface ScopeRoot {
  root: Element;
  limits: Element[];
}

/** The roots of the innermost of `scopes`, each with its limits: an outer
 * scope's roots are where an inner one's start is asked, and an inner
 * root must be in its outer root's scope. */
function scopeRoots(doc: Document, scopes: readonly PageScope[]): ScopeRoot[] {
  let outer: ScopeRoot[] | null = null;
  for (const { start, end } of scopes) {
    let roots: Element[];
    if (start === null) {
      roots = doc.head === null ? [] : [doc.head];
    } else if (outer === null) {
      roots = tryQueryAll(doc, start);
    } else {
      roots = outer.flatMap((scope) =>
        inScope(scope, beneath(scope.root, start)),
      );
    }
    outer = Array.from(new Set(roots), (root) => ({
      root,
      limits: end === null ? [] : beneath(root, end),
    }));
  }
  return outer ?? [];
}

/** What `selector` matches at and under `root`, `:scope` being `root`. */
function beneath(root: Element, selector: string): Element[] {
  const below = tryQueryAll(root, selector);
  return tryMatches(root, selector) ? [root, ...below] : below;
}

/** The elements of `found` in the scope of `scope`: not at or under one
 * of its limits (all of which are at or under its root). */
function inScope(scope: ScopeRoot, found: readonly Element[]): Element[] {
  return found.filter(
    (el) => !scope.limits.some((limit) => limit === el || limit.contains(el)),
  );
}

/** `:scope` outside any `@scope` is the document's root. */
function unscoped(selector: string): string {
  return /:scope(?![\w-])/i.test(selector)
    ? selector.replace(/:scope(?![\w-])/gi, ":root")
    : selector;
}

function tryMatches(node: Element, selector: string): boolean {
  try {
    return node.matches(selector);
  } catch {
    return false;
  }
}

function tryQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}
