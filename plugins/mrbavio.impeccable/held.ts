// Which element a waiting pick is FOR, kept while the page is edited. The
// pick names its element by selector (target.ts), and a selector is a
// place in the markup: a paragraph written before the target makes
// `p:nth-of-type(2)` name another element. So beside the selector the
// session holds where the element was written in the page's stored text
// (`dd.pageSource`), follows that span through each edit of the text, and
// asks, once the page is edited, whether the element the selector names
// now (`dd.pageFind`) is still the one held. Pure: the text in, the
// answer out.

/** `[start, end)` in a page's stored html: an element's start tag's `<`
 * to just past its end tag. */
export interface Span {
  start: number;
  end: number;
}

export interface Held {
  /** The page's stored html the span is read against. */
  html: string;
  /** Where the element is written in `html`; null once an edit cut
   * across one of its edges. */
  span: Span | null;
  /** The element as it was last seen written. */
  written: string;
  /** Its tag, lowercased. */
  tag: string;
}

/** The tag of the element written at `start`, lowercased, or "" when no
 * start tag begins there. */
function tagAt(html: string, start: number): string {
  return /^<([A-Za-z][^\s/>]*)/.exec(html.slice(start, start + 64))?.[1]?.toLowerCase() ?? "";
}

/** The element written at `span` in `html`, held. */
export function holdAt(html: string, span: Span): Held {
  return { html, span, written: html.slice(span.start, span.end), tag: tagAt(html, span.start) };
}

/**
 * Where `span` of `before` is in `after`, the edit between them read as
 * the one stretch the two texts do not share at their start and at their
 * end. A span wholly before that stretch stays, one wholly after it moves
 * by the change in length, and one holding it (an edit inside the
 * element) grows or shrinks by it. Null when the stretch crosses one of
 * the span's edges: the element itself was rewritten there.
 */
export function followSpan(before: string, after: string, span: Span): Span | null {
  if (before === after) return span;
  const shortest = Math.min(before.length, after.length);
  let head = 0;
  while (head < shortest && before.charCodeAt(head) === after.charCodeAt(head)) head += 1;
  let tail = 0;
  while (
    tail < shortest - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail += 1;
  }
  const editEnd = before.length - tail;
  const delta = after.length - before.length;
  if (span.end <= head) return span;
  if (span.start >= editEnd) return { start: span.start + delta, end: span.end + delta };
  if (span.start <= head && span.end >= editEnd) return { start: span.start, end: span.end + delta };
  return null;
}

/** `held`, once the page's text is `html`. */
export function follow(held: Held, html: string): Held {
  if (held.html === html) return held;
  return { ...held, html, span: held.span === null ? null : followSpan(held.html, html, held.span) };
}

/** Whether the element written at `found` in `html` is the held one: the
 * same tag, and either where the held one went or written exactly as it
 * was — where an edit wrote a twin beside it, or began with the same
 * characters it does, the text cannot tell where the edit was. `held`
 * must have been followed to `html`. */
export function isHeld(held: Held, html: string, found: Span): boolean {
  if (tagAt(html, found.start) !== held.tag) return false;
  if (held.span !== null && held.span.start === found.start && held.span.end === found.end) return true;
  return html.slice(found.start, found.end) === held.written;
}
