// IDENTITY across an HTML edit (decision #58). Element ids are the
// stable handle for selection, the generated stylesheet and agent drafts,
// and HTML text has no place for them — so the parsed tree is matched
// against the stored subtree by CONTENT, TAG AND POSITION, depth first. A
// matched element keeps its id, its styles, its conditional layers and
// its label; an unmatched one gets a fresh id and no styles. An id that
// survived is never re-minted, and no id is used twice.
//
// The match, per level — the pane's own element is a level of one, so
// wrapping it makes a new wrapper around the same element rather than
// moving its id onto the wrapper:
// 1. the longest common subsequence of the two children's CONTENT
//    SIGNATURES (tag, attributes, text and the whole subtree below) —
//    elements that did not change at all, which is what tells the first
//    of three `li`s from the second when one is deleted;
// 2. the longest common subsequence of the leftovers' tags — the in-order
//    survivors of an edit inside them;
// 3. leftover children of the same tag, in order — a reorder keeps ids;
// 4. a RENAME: a leftover parsed element takes a leftover stored one when
//    they sit in the same gap between survivors, are the same kind of tag
//    (a heading for a heading, inline for inline, a void for a void, a
//    list for a list, a block for a block), the parsed tag is new to the
//    subtree and the stored tag is gone from it. A tag that still exists
//    elsewhere is left for the pool rather than mis-paired;
// then, over what no level matched: parsed elements in document order
// take the first unmatched stored element with the same content, else
// the same tag, anywhere in the subtree — a wrap, an unwrap or a move
// keeps the moved elements' ids — and recurse. Same-tag siblings with the same content keep their ids
// through a reorder; same-tag siblings that all changed follow their
// position, the rule of last resort.
//
// Pure: the id source is a parameter, so tests read the fresh ids back.

import type { DeepReadonly, DreamElement } from "@daydream/plugin-api";

import type { ParsedElement } from "./parse";

type Stored = DeepReadonly<DreamElement>;
type Pair = [Stored, ParsedElement];

export interface Reconciled {
  /** The new subtree: parsed structure, stored identities where matched. */
  element: DreamElement;
  /** Ids of the stored elements that survived. */
  kept: Set<string>;
}

export function reconcile(
  stored: Stored,
  parsed: ParsedElement,
  generateId: () => string,
): Reconciled {
  const storedCounts = tagCounts(stored);
  const parsedCounts = tagCounts(parsed);
  const matched = new Map<ParsedElement, Stored>();
  const matchedStored = new Set<Stored>();
  /** Stored elements no level matched, document order, ancestors first —
   * a pool for wraps, unwraps and moves. An entry may be matched later
   * through its ancestor's level pass; `matchedStored` says so. */
  const pool: Stored[] = [];
  const queue: ParsedElement[] = [];

  const pair = (s: Stored, p: ParsedElement): void => {
    matched.set(p, s);
    matchedStored.add(s);
    level(s.children, p.children);
  };

  const level = (ss: readonly Stored[], ps: ParsedElement[]): void => {
    const sUsed = ss.map((s) => matchedStored.has(s));
    const pUsed = new Array<boolean>(ps.length).fill(false);
    const pairs: Pair[] = [];
    const take = (i: number, j: number): void => {
      sUsed[i] = true;
      pUsed[j] = true;
      pairs.push([ss[i]!, ps[j]!]);
    };
    const unusedS = (): number[] => ss.flatMap((_, i) => (sUsed[i] ? [] : [i]));
    const unusedP = (): number[] => ps.flatMap((_, j) => (pUsed[j] ? [] : [j]));

    // 1. Unchanged subtrees, in order.
    for (const [a, b] of lcsOver(unusedS(), unusedP(), signature)) take(a, b);
    // 2. In-order survivors by tag.
    for (const [a, b] of lcsOver(unusedS(), unusedP(), (node) => node.tag)) {
      take(a, b);
    }
    // 3. Reordered siblings.
    for (const j of unusedP()) {
      const i = ss.findIndex((s, k) => !sUsed[k] && s.tag === ps[j]!.tag);
      if (i !== -1) take(i, j);
    }
    // 4. Renames: same gap between survivors, same kind, new tag for a
    //    gone one.
    const gapS = gaps(ss, pairs, (pr) => pr[0]);
    const gapP = gaps(ps, pairs, (pr) => pr[1]);
    for (const j of unusedP()) {
      const p = ps[j]!;
      if ((parsedCounts.get(p.tag) ?? 0) <= (storedCounts.get(p.tag) ?? 0)) {
        continue;
      }
      const i = ss.findIndex(
        (s, k) =>
          !sUsed[k] &&
          gapS[k] === gapP[j] &&
          kind(s.tag) === kind(p.tag) &&
          (storedCounts.get(s.tag) ?? 0) > (parsedCounts.get(s.tag) ?? 0),
      );
      if (i !== -1) take(i, j);
    }
    // The rest: stored subtrees to the pool, parsed ones to the queue.
    for (const i of unusedS()) collect(ss[i]!, pool);
    for (const j of unusedP()) queue.push(ps[j]!);
    // Depth first, in parsed order.
    pairs.sort((a, b) => ps.indexOf(a[1]) - ps.indexOf(b[1]));
    for (const [s, p] of pairs) pair(s, p);

    function lcsOver(
      si: number[],
      pj: number[],
      key: (node: Stored | ParsedElement) => string,
    ): [number, number][] {
      return lcs(
        si.map((i) => key(ss[i]!)),
        pj.map((j) => key(ps[j]!)),
      ).map(([a, b]) => [si[a]!, pj[b]!]);
    }
  };

  // The pane's element is a level of one: it may be renamed, wrapped or
  // replaced like any child.
  level([stored], [parsed]);

  // Wraps, unwraps and moves: the same content, else the same tag,
  // anywhere in the subtree. Document order throughout: an element's
  // children are considered before its later siblings.
  while (queue.length > 0) {
    const p = queue.shift()!;
    const free = pool.filter((entry) => !matchedStored.has(entry));
    const sig = signature(p);
    const s =
      free.find((entry) => signature(entry) === sig) ??
      free.find((entry) => entry.tag === p.tag);
    if (s === undefined) {
      queue.unshift(...p.children);
      continue;
    }
    pair(s, p);
  }

  const kept = new Set<string>();
  const build = (p: ParsedElement): DreamElement => {
    const s = matched.get(p);
    const el: DreamElement = {
      id: s === undefined ? generateId() : s.id,
      tag: p.tag,
      styles: s === undefined ? {} : { ...s.styles },
      children: [],
    };
    if (s !== undefined) {
      kept.add(s.id);
      if (s.conditionals !== undefined && s.conditionals.length > 0) {
        el.conditionals = s.conditionals.map((layer) => ({
          condition: layer.condition,
          styles: { ...layer.styles },
        }));
      }
      if (s.label !== undefined) el.label = s.label;
    }
    if (p.attrs !== undefined && Object.keys(p.attrs).length > 0) {
      el.attrs = { ...p.attrs };
    }
    if (p.text !== undefined) el.text = p.text;
    el.children = p.children.map(build);
    return el;
  };

  return { element: build(parsed), kept };
}

/** For each child, the pair of the nearest matched sibling before it (null
 * at the start): two leftovers are in the same gap when these agree. */
function gaps<T>(
  list: readonly T[],
  pairs: Pair[],
  side: (pair: Pair) => unknown,
): (Pair | null)[] {
  const byNode = new Map<unknown, Pair>();
  for (const pr of pairs) byNode.set(side(pr), pr);
  let last: Pair | null = null;
  return list.map((node) => {
    const pr = byNode.get(node);
    if (pr !== undefined) last = pr;
    return last;
  });
}

/** What kind of tag a tag is, for renames: a heading stays a heading, an
 * inline an inline, a void a void, a list a list, a block a block. */
export function kind(tag: string): string {
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (INLINE.has(tag)) return "inline";
  if (VOID.has(tag)) return "void";
  if (tag === "ul" || tag === "ol") return "list";
  return "block";
}
const INLINE = new Set([
  "span",
  "a",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "code",
]);
const VOID = new Set(["img", "br", "hr"]);

/** The whole subtree as one string: tag, attributes, text, children. Two
 * elements with the same signature are the same content. */
export function signature(node: Stored | ParsedElement): string {
  const attrs =
    node.attrs === undefined
      ? ""
      : Object.entries(node.attrs)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
          .join(" ");
  const children = node.children.map(signature).join("");
  return `<${node.tag} ${attrs}>${JSON.stringify(node.text ?? "")}[${children}]`;
}

/** Every element of a subtree, document order. */
function collect(el: Stored, into: Stored[]): void {
  into.push(el);
  for (const child of el.children) collect(child, into);
}

function tagCounts(el: Stored | ParsedElement): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (node: Stored | ParsedElement): void => {
    counts.set(node.tag, (counts.get(node.tag) ?? 0) + 1);
    for (const child of node.children) walk(child);
  };
  walk(el);
  return counts;
}

/** Index pairs of a longest common subsequence of two key lists. */
function lcs(a: string[], b: string[]): [number, number][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
