/** One change from a text to another: `[from, to)` of the first replaced
 * by `insert`. */
interface Hunk {
  from: number;
  to: number;
  insert: string;
}

/** The one hunk that turns `a` into `b`: everything between their common
 * prefix and their common suffix. */
function hunk(a: string, b: string): Hunk {
  const most = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < most && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < most - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    from: prefix,
    to: a.length - suffix,
    insert: b.slice(prefix, b.length - suffix),
  };
}

/**
 * Typed text carried onto a page that changed underneath it: the typing,
 * `base` → `typed`, as one hunk, applied to `current` when the change
 * that made `current` from `base` — one hunk too — left that hunk's place
 * alone. Null when the two meet: they overlap, or touch, where the order
 * of what each put there is nobody's to guess.
 */
export function rebase(
  base: string,
  typed: string,
  current: string,
): string | null {
  if (typed === base) return current;
  const mine = hunk(base, typed);
  const theirs = hunk(base, current);
  if (mine.to < theirs.from) {
    return current.slice(0, mine.from) + mine.insert + current.slice(mine.to);
  }
  if (mine.from > theirs.to) {
    const shift = current.length - base.length;
    return (
      current.slice(0, mine.from + shift) +
      mine.insert +
      current.slice(mine.to + shift)
    );
  }
  return null;
}
