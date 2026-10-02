// An authored track list (`grid-template-columns: 200px 1fr [main]
// repeat(2, minmax(0, 1fr))`) read as text and written back as text, so a
// drag on the canvas changes exactly the tracks it touched and leaves the
// rest of the value as the author typed it (a `repeat()` the drag never
// enters stays a `repeat()`). Pure: no DOM, no API — the browser's
// resolved px sizes come in as numbers.

/** A single length token the drag can scale: `1fr`, `200px`, `1.5rem`,
 * `20%`. `fr` is flexible (a share of the free space); everything else
 * is fixed. */
export interface Length {
  value: number;
  unit: string;
}

/** One explicit track as authored. `length` is null for a value the drag
 * cannot scale as a number — `auto`, `minmax(…)`, `min-content`,
 * `calc(…)` — which a drag rewrites in px when it must. */
export interface AuthoredTrack {
  text: string;
  length: Length | null;
}

interface Item {
  text: string;
  /** Null for a line-name token (`[main]`), which is not a track. */
  track: AuthoredTrack | null;
}

type Segment =
  | { kind: "item"; item: Item }
  /** `repeat(<integer>, <items>)`: kept as written until a drag enters
   * it, then expanded to its copies. */
  | { kind: "repeat"; text: string; count: number; inner: Item[] };

/** A track list read for editing. `tracks` are the explicit tracks in
 * order — the browser's resolved list holds these first, implicit tracks
 * appended after them. */
export interface TrackList {
  segments: Segment[];
  tracks: AuthoredTrack[];
}

const LENGTH = /^(\d*\.?\d+)([a-z%]+)$/i;

function classify(text: string): AuthoredTrack {
  const match = LENGTH.exec(text);
  if (match !== null) {
    return {
      text,
      length: { value: Number(match[1]), unit: match[2]!.toLowerCase() },
    };
  }
  if (text === "0") return { text, length: { value: 0, unit: "px" } };
  return { text, length: null };
}

/** Split on whitespace outside parentheses; a line-name group (`[a b]`)
 * is a token of its own even with nothing around it (`[a]1fr[b]`). */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let names = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (names) {
      if (ch === "]") {
        out.push(text.slice(start, i + 1));
        start = -1;
        names = false;
      }
      continue;
    }
    if (ch === "[" && depth === 0) {
      if (start !== -1) out.push(text.slice(start, i));
      start = i;
      names = true;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    const space = depth === 0 && /\s/.test(ch);
    if (space) {
      if (start !== -1) out.push(text.slice(start, i));
      start = -1;
    } else if (start === -1) start = i;
  }
  if (start !== -1) out.push(text.slice(start));
  return out;
}

function item(text: string): Item {
  const isName = text.startsWith("[") && text.endsWith("]");
  return { text, track: isName ? null : classify(text) };
}

/**
 * Read an authored track list, or null for one the drag leaves alone: a
 * keyword list (`none`, `subgrid`, `masonry`), a `var()` anywhere in it,
 * or a `repeat()` whose count is not an integer (`auto-fill`,
 * `auto-fit`) — none of which map one authored track onto one resolved
 * size the way the drag needs.
 */
export function parseTrackList(value: string): TrackList | null {
  const text = value.trim();
  if (text === "" || /^(none|subgrid|masonry)$/i.test(text)) return null;
  if (/var\(/i.test(text)) return null;
  const segments: Segment[] = [];
  const tracks: AuthoredTrack[] = [];
  for (const token of splitTopLevel(text)) {
    if (/^repeat\(/i.test(token) && token.endsWith(")")) {
      const inside = token.slice("repeat(".length, -1);
      const comma = inside.indexOf(",");
      if (comma === -1) return null;
      const count = inside.slice(0, comma).trim();
      if (!/^\d+$/.test(count) || Number(count) < 1) return null;
      const rest = inside.slice(comma + 1).trim();
      if (/repeat\(/i.test(rest)) return null;
      const inner = splitTopLevel(rest).map(item);
      const times = Number(count);
      segments.push({ kind: "repeat", text: token, count: times, inner });
      for (let copy = 0; copy < times; copy++) {
        for (const each of inner)
          if (each.track !== null) tracks.push(each.track);
      }
      continue;
    }
    const each = item(token);
    segments.push({ kind: "item", item: each });
    if (each.track !== null) tracks.push(each.track);
  }
  return { segments, tracks };
}

/** Where a written list puts a new track: before track `index` (`index`
 * = the track count appends). `after` puts it past the line names that
 * precede that track — beside the track after it — else before them,
 * beside the track before it: the band that stays keeps the name. */
export interface Insert {
  index: number;
  text: string;
  after: boolean;
}

/** How many tracks one copy of a repeat holds (its names aside). */
function perCopy(segment: { inner: Item[] }): number {
  return segment.inner.filter((each) => each.track !== null).length;
}

function changed(
  list: TrackList,
  edits: ReadonlyMap<number, string>,
  index: number,
): boolean {
  const edit = edits.get(index);
  return edit !== undefined && edit !== list.tracks[index]?.text;
}

/**
 * The list written back with `edits` (track index → new text) applied,
 * `insert` added and track `remove` dropped. A `repeat()` none of whose
 * tracks change is kept verbatim; one the edits, the insert or the
 * removal touch is expanded into its copies, the change landing in the
 * one copy it names. An edit that repeats a track's own text is no edit.
 */
export function writeTrackList(
  list: TrackList,
  edits: ReadonlyMap<number, string>,
  insert?: Insert,
  remove?: number,
): string {
  const out: string[] = [];
  let index = 0;
  let inserted = insert === undefined;
  const place = (): void => {
    if (!inserted && insert !== undefined && insert.index === index) {
      out.push(insert.text);
      inserted = true;
    }
  };
  const emit = (each: Item): void => {
    if (each.track === null) {
      if (insert?.after === false) place();
      out.push(each.text);
      return;
    }
    place();
    if (index !== remove) out.push(edits.get(index) ?? each.text);
    index++;
  };
  for (const segment of list.segments) {
    if (segment.kind === "item") {
      emit(segment.item);
      continue;
    }
    const last = index + segment.count * perCopy(segment);
    let touched = remove !== undefined && remove >= index && remove < last;
    if (insert !== undefined && insert.index > index && insert.index < last)
      touched = true;
    for (let i = index; !touched && i < last; i++) {
      if (changed(list, edits, i)) touched = true;
    }
    if (!touched) {
      place();
      out.push(segment.text);
      index = last;
      continue;
    }
    for (let copy = 0; copy < segment.count; copy++) {
      for (const each of segment.inner) emit(each);
    }
  }
  if (!inserted && insert !== undefined) out.push(insert.text);
  // Two name groups left adjacent by a removal are one line's names.
  return out.join(" ").replace(/\]\s+\[/g, " ");
}

/** `12.5px`, `1.33fr`: px to a tenth, everything else to a hundredth,
 * trailing zeros dropped. */
export function formatLength(value: number, unit: string): string {
  const precision = unit === "px" ? 1 : 2;
  return `${String(Number(value.toFixed(precision)))}${unit}`;
}

/**
 * A length token scaled from the px it resolved to (`px`) to the px it
 * should resolve to next: the same unit, its number scaled by the ratio
 * — so `1fr` at 220px dragged to 264px is `1.2fr`, `10rem` at 160px
 * dragged to 176px is `11rem`. A value that is not a single length, or
 * one that resolved to 0px (no ratio to keep), is written in px.
 */
export function scaleLength(text: string, px: number, nextPx: number): string {
  const { length } = classify(text);
  if (length === null || px <= 0) return formatLength(nextPx, "px");
  return formatLength((length.value * nextPx) / px, length.unit);
}

/** The two values a trade wrote, and the whole list holding them.
 * `collapsed` is the index of the track the drag closed to nothing, if
 * one did — the note says how to remove it. */
export interface Trade {
  list: string;
  first: string;
  second: string;
  collapsed: number | null;
}

const isShare = (track: AuthoredTrack): boolean =>
  track.length !== null && track.length.unit === "fr";

/** The function a track is written with (`minmax`, `fit-content`), or
 * null: a value a px rewrite would throw away. */
const functionOf = (track: AuthoredTrack): string | null =>
  /^([a-z-]+)\(/i.exec(track.text)?.[1] ?? null;

/** A trade refused: the track that would be rewritten in px is a
 * function, which the panel edits. */
export interface TradeRefusal {
  refused: string;
}

/** How much a track's authored value is worth writing when its boundary
 * moves: a fixed length first (it is the exact edit — the free space
 * absorbs the rest), a flexible share next (exact only when both sides
 * are shares), nothing for a value that is no single length. */
function precedence(track: AuthoredTrack, px: number): number {
  if (track.length === null || px <= 0) return 0;
  return track.length.unit === "fr" ? 1 : 2;
}

/**
 * The boundary between explicit tracks `boundary` and `boundary + 1`
 * moved by `delta` layout px: the first track grows by it, the second
 * shrinks by it, neither below zero. What is written follows the pair:
 * two shares (`1fr 2fr`) trade shares priced over the pair — its shares
 * over its width, so a track closed to `0fr` (which still has its
 * min-content width) prices like its neighbour and opens again — and
 * keep their sum exact; a fixed length beside a share writes the fixed
 * length alone, the share absorbing the change; two fixed lengths trade
 * px; a grid's only share beside a track with no number (`1fr auto`)
 * writes that track in px, since scaling the one share that takes all
 * the free space moves nothing; a pair with no scalable value is
 * written in px — unless the value is a function (`minmax()`,
 * `fit-content()`), which a px rewrite would throw away: refused, by
 * the function's name. Null when the boundary is not between two
 * explicit tracks — an implicit track has no authored value to write.
 */
export function tradeAcross(
  list: TrackList,
  sizes: readonly number[],
  boundary: number,
  delta: number,
): Trade | TradeRefusal | null {
  const a = list.tracks[boundary];
  const b = list.tracks[boundary + 1];
  const pa = sizes[boundary];
  const pb = sizes[boundary + 1];
  if (
    a === undefined ||
    b === undefined ||
    pa === undefined ||
    pb === undefined
  )
    return null;
  const d = Math.max(-pa, Math.min(pb, delta));
  const na = pa + d;
  const nb = pb - d;
  const shares = list.tracks.filter(isShare).length;
  const lone = (share: AuthoredTrack, other: AuthoredTrack) =>
    isShare(share) && other.length === null && shares === 1;
  let first: string;
  let second: string;
  if (isShare(a) && isShare(b) && pa + pb > 0) {
    const total = a.length!.value + b.length!.value;
    const k = total / (pa + pb);
    const fa = Number((na * k).toFixed(2));
    first = formatLength(fa, "fr");
    second = formatLength(Math.max(0, total - fa), "fr");
  } else if (lone(a, b) || lone(b, a)) {
    const fn = functionOf(isShare(a) ? b : a);
    if (fn !== null) return { refused: fn };
    first = isShare(a) ? a.text : formatLength(na, "px");
    second = isShare(b) ? b.text : formatLength(nb, "px");
  } else {
    const top = Math.max(precedence(a, pa), precedence(b, pb));
    if (top === 0) {
      const fn = functionOf(a) ?? functionOf(b);
      if (fn !== null) return { refused: fn };
      first = formatLength(na, "px");
      second = formatLength(nb, "px");
    } else {
      first = precedence(a, pa) === top ? scaleLength(a.text, pa, na) : a.text;
      second = precedence(b, pb) === top ? scaleLength(b.text, pb, nb) : b.text;
    }
  }
  const edits = new Map<number, string>([
    [boundary, first],
    [boundary + 1, second],
  ]);
  const collapsed = na <= 0 ? boundary : nb <= 0 ? boundary + 1 : null;
  return { list: writeTrackList(list, edits), first, second, collapsed };
}

/** A new track pulled out of a line. */
export interface Insertion {
  list: string;
  /** The newborn's value, in the donor's unit. */
  born: string;
  /** The donor's value with the newborn carved out of it. */
  donor: string;
  /** The line the pointer holds: the newborn's far edge. */
  line: number;
}

/** Why a pull opened nothing: under half a pixel of it (`still`), an
 * edge pulled outward (`outward`), or a donor the author never wrote
 * (`implicit`). */
export interface InsertRefusal {
  refused: "still" | "outward" | "implicit";
}

/**
 * A new track born at grid line `line` (0 = the start edge, the track
 * count = the end edge), carved from the neighbour the drag points at
 * — the track after the line for a positive `delta` (layout px), the
 * one before it otherwise — and written in that neighbour's unit: `2fr`
 * at 440px pulled 110px gives `0.5fr` beside `1.5fr`, `240px` pulled
 * 72px gives `72px` beside `168px`. Only the donor changes. A donor with
 * no number to scale (`auto`, `minmax()`, `0fr`) is kept as written and
 * the newborn is px.
 */
export function insertAt(
  list: TrackList,
  sizes: readonly number[],
  line: number,
  delta: number,
): Insertion | InsertRefusal {
  if (Math.abs(delta) < 0.5) return { refused: "still" };
  const donorIndex = delta > 0 ? line : line - 1;
  const px = sizes[donorIndex];
  if (donorIndex < 0 || px === undefined) return { refused: "outward" };
  const donor = list.tracks[donorIndex];
  if (donor === undefined) return { refused: "implicit" };
  const size = Math.min(Math.abs(delta), px);
  if (size < 0.5) return { refused: "still" };
  const scalable = donor.length !== null && donor.length.value > 0 && px > 0;
  const born = scalable
    ? scaleLength(donor.text, px, size)
    : formatLength(size, "px");
  const rest = scalable ? scaleLength(donor.text, px, px - size) : donor.text;
  const edits = new Map<number, string>([[donorIndex, rest]]);
  return {
    list: writeTrackList(list, edits, {
      index: line,
      text: born,
      after: delta > 0,
    }),
    born,
    donor: rest,
    line: delta > 0 ? line + 1 : line,
  };
}

/** The repeat holding track `track`, with its count changed by `by`,
 * when it is a one-track repeat and `line` lies inside it or at either
 * end: `repeat(3, 1fr)` → `repeat(4, 1fr)`. Null when no such repeat. */
function bumpRepeat(
  list: TrackList,
  track: number,
  line: number,
  by: 1 | -1,
): string | null {
  const out: string[] = [];
  let index = 0;
  let hit = false;
  for (const segment of list.segments) {
    if (segment.kind === "item") {
      out.push(segment.item.text);
      if (segment.item.track !== null) index++;
      continue;
    }
    const last = index + segment.count * perCopy(segment);
    const inside = track >= index && track < last && line >= index;
    if (!hit && perCopy(segment) === 1 && inside && line <= last) {
      hit = true;
      const count = segment.count + by;
      const inner = segment.inner.map((each) => each.text).join(" ");
      if (count >= 2) out.push(`repeat(${count}, ${inner})`);
      else if (count === 1) out.push(inner);
    } else out.push(segment.text);
    index = last;
  }
  return hit ? out.join(" ") : null;
}

/** A track equal to the one before `line` (the first, at the start
 * edge) inserted there, beside its twin; inside a one-track `repeat()`
 * the count grows instead. Null past the explicit tracks. */
export function insertEqual(
  list: TrackList,
  line: number,
): { list: string; text: string } | null {
  const copy = list.tracks[Math.max(0, line - 1)];
  if (copy === undefined || line > list.tracks.length) return null;
  const bumped = bumpRepeat(list, Math.max(0, line - 1), line, 1);
  if (bumped !== null) return { list: bumped, text: copy.text };
  const insert = { index: line, text: copy.text, after: line === 0 };
  return { list: writeTrackList(list, new Map(), insert), text: copy.text };
}

/** The list without track `index`; a one-track `repeat()` loses a copy
 * instead. `none` when no track is left. Null off the list. */
export function removeTrack(list: TrackList, index: number): string | null {
  if (index < 0 || index >= list.tracks.length) return null;
  const written =
    bumpRepeat(list, index, index, -1) ??
    writeTrackList(list, new Map(), undefined, index);
  // Names with no track left between them (`[a b]`) are no list.
  const left = parseTrackList(written);
  return left === null || left.tracks.length === 0 ? "none" : written;
}

/** A `gap` shorthand's two values (`16px` → both; `16px 24px` → row,
 * column), or null for a value that is not one or two tokens. */
export function parseGapShorthand(
  value: string,
): { row: string; column: string } | null {
  const tokens = splitTopLevel(value.trim());
  const row = tokens[0];
  if (row === undefined || tokens.length > 2) return null;
  return { row, column: tokens[1] ?? row };
}

/** The shorthand for two values: one token when they agree. */
export function gapShorthand(row: string, column: string): string {
  return row === column ? row : `${row} ${column}`;
}
