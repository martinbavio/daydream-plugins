/** The change that turns `from` into `to`, as one span: the longest common
 * prefix and suffix stay put. Null when equal. */
export function diffSpan(
  from: string,
  to: string,
): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) {
    start++;
  }
  let endFrom = from.length;
  let endTo = to.length;
  while (
    endFrom > start &&
    endTo > start &&
    from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)
  ) {
    endFrom--;
    endTo--;
  }
  return { from: start, to: endFrom, insert: to.slice(start, endTo) };
}

/**
 * Typed text carried onto a page that changed underneath it: the typing,
 * `base` → `typed`, as one span, applied to `current` when the change
 * that made `current` from `base` — one span too — left that span's place
 * alone. Null when the two meet: they overlap, or touch, where the order
 * of what each put there is nobody's to guess.
 */
export function rebase(
  base: string,
  typed: string,
  current: string,
): string | null {
  // Typed to what the page holds already: nothing of the typing to carry.
  if (typed === current) return current;
  const mine = diffSpan(base, typed);
  const theirs = diffSpan(base, current);
  if (mine === null) return current;
  if (theirs === null) return typed;
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
