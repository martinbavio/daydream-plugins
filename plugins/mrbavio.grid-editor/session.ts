import type { DaydreamApi, ElementId } from "@daydream/plugin-api";

import type { GridGeometry } from "./gridGeometry";
import { createWriter, findTarget, type WritableTarget } from "./ruleWrite";
import {
  formatLength,
  gapShorthand,
  insertAt,
  insertEqual,
  parseGapShorthand,
  parseTrackList,
  removeTrack,
  scaleLength,
  tradeAcross,
  type TrackList,
} from "./trackList";

// One drag on one grid line, from press to release: what it reads once at
// the start (the authored value, the resolved sizes, the rule to write),
// what the press shows without writing, and what each frame writes. The
// note text is what the drag wrote — or, for a line it cannot write,
// why. Lines are numbered from 0 at the start edge; line n stands after
// track n − 1.

export type Axis = "cols" | "rows";
export type Mode = "trade" | "gap" | "insert";

export interface Step {
  note: string;
  /** The line under the pointer: the one pressed, or — for an insert,
   * which opens a new line — the newborn's far edge. */
  line: number;
}

export interface Session {
  /** What the press shows — the values the line holds, or why nothing
   * can be written. Never writes: a click is not an edit. */
  peek(): Step;
  /** Apply the drag's displacement (layout px) and answer the note. */
  step(delta: number): Step;
  /** The release: every frame's write kept as one undo step. */
  commit(): void;
  /** Escape: every frame's write taken back, and no step recorded. */
  restore(): void;
}

const TRACK_PROPERTY: Record<Axis, string> = {
  cols: "grid-template-columns",
  rows: "grid-template-rows",
};
/** What can set an axis's tracks: the longhand, or a shorthand the drag
 * leaves to the panel. */
const TRACK_SHORTHANDS = ["grid-template", "grid"];
const GAP_LONGHAND: Record<Axis, string> = {
  cols: "column-gap",
  rows: "row-gap",
};
const GAP_PROPERTIES: Record<Axis, string[]> = {
  cols: ["column-gap", "grid-column-gap", "gap", "grid-gap"],
  rows: ["row-gap", "grid-row-gap", "gap", "grid-gap"],
};
const NOUN: Record<Axis, string> = { cols: "columns", rows: "rows" };
const ONE: Record<Axis, string> = { cols: "column", rows: "row" };

const inert = (note: string, line: number): Session => ({
  peek: () => ({ note, line }),
  step: () => ({ note, line }),
  commit: () => {},
  restore: () => {},
});

interface Tracks {
  target: WritableTarget;
  list: TrackList;
  property: string;
}

/** Why a track gesture has nothing to write, as the note says it. */
const blockedNote = (
  axis: Axis,
  why: "inline" | "readonly" | "shorthand",
): string =>
  ({
    inline: `${NOUN[axis]} are set inline — the CSS panel edits that`,
    readonly: `${NOUN[axis]} are set by a rule this page can't edit`,
    shorthand: `${NOUN[axis]} come from a grid-template shorthand — the CSS panel edits that`,
  })[why];

/** The authored track list of the axis and the rule holding it, or the
 * note saying why a track gesture has nothing to write; `implicitHint`
 * finishes the note for an axis with no authored tracks. */
function openTracks(
  dd: DaydreamApi,
  gridId: ElementId,
  axis: Axis,
  implicitHint: string,
): Tracks | string {
  const property = TRACK_PROPERTY[axis];
  const target = findTarget(
    dd,
    gridId,
    [property, ...TRACK_SHORTHANDS],
    TRACK_SHORTHANDS,
  );
  if (target === null) return `${NOUN[axis]} can't be written here`;
  if (target.kind === "blocked") return blockedNote(axis, target.why);
  const declaration = target.kind === "rule" ? target.declaration : null;
  if (declaration === null) {
    return `${NOUN[axis]} are implicit — ${implicitHint}`;
  }
  const list = parseTrackList(declaration.value);
  if (list === null) {
    return `${NOUN[axis]} use a value only the CSS panel can edit`;
  }
  if (startsBeforeFirst(dd, gridId, axis, list.tracks.length)) {
    return `${NOUN[axis]} start before the first — the CSS panel edits that`;
  }
  return { target, list, property };
}

/** A child's start or end line as the explicit grid numbers it, or null
 * when it is `auto`, a `span` or a name: an integer, positive from the
 * start, negative from the end (`-1` is the line after the last of
 * `explicit` tracks). */
function lineNumber(value: string, explicit: number): number | null {
  const match = /^(-?\d+)$/.exec(value.trim());
  if (match === null) return null;
  const n = Number(match[1]);
  return n < 0 ? explicit + 2 + n : n;
}

/** Whether a child can start before the first explicit line
 * (`grid-column: -5` on three tracks, or `span 2 / 1`): Chromium then
 * resolves implicit tracks BEFORE the explicit ones, and the resolved
 * sizes no longer pair with the authored list from the start. Read at the
 * press, from the computed start and end of every child. */
function startsBeforeFirst(
  dd: DaydreamApi,
  gridId: ElementId,
  axis: Axis,
  explicit: number,
): boolean {
  const node = dd.geometry.node(gridId);
  if (node === undefined) return false;
  const [startProperty, endProperty] =
    axis === "cols"
      ? ["grid-column-start", "grid-column-end"]
      : ["grid-row-start", "grid-row-end"];
  for (const child of node.children) {
    const style = getComputedStyle(child);
    const startText = style.getPropertyValue(startProperty).trim();
    const endText = style.getPropertyValue(endProperty).trim();
    const start = lineNumber(startText, explicit);
    const end = lineNumber(endText, explicit);
    // Where the item starts: the lower of two numbered lines; else the
    // numbered end less the span the start asks for (one when it is auto).
    const span = /^span\s+(\d+)$/.exec(startText);
    let first: number | null = null;
    if (start !== null) first = end === null ? start : Math.min(start, end);
    else if (end !== null) first = end - (span === null ? 1 : Number(span[1]));
    if (first !== null && first < 1) return true;
  }
  return false;
}

/** Read the authored track list and the rule, then trade across the
 * line on every step. A track the drag closes stays, at nothing — the
 * note says how to remove it. */
function beginTrade(
  dd: DaydreamApi,
  gridId: ElementId,
  geometry: GridGeometry,
  axis: Axis,
  line: number,
): Session {
  const sizes = geometry[axis].sizes;
  if (line === 0 || line >= sizes.length) {
    return inert(`pull inward to open a ${ONE[axis]}`, line);
  }
  const opened = openTracks(dd, gridId, axis, "⌘-drag adjusts the gap");
  if (typeof opened === "string") return inert(opened, line);
  const { target, list, property } = opened;
  const a = list.tracks[line - 1];
  const b = list.tracks[line];
  if (a === undefined || b === undefined) {
    return inert(`implicit track — ⌘-drag adjusts the gap`, line);
  }
  const writer = createWriter(dd, target);
  return {
    peek: () => ({ note: `${a.text} · ${b.text}`, line }),
    step(delta) {
      const trade = tradeAcross(list, sizes, line - 1, delta);
      if (trade === null) {
        return { note: `${NOUN[axis]} can't be written here`, line };
      }
      if ("refused" in trade) {
        return {
          note: `${NOUN[axis]} use ${trade.refused}() — the CSS panel edits that`,
          line,
        };
      }
      const problem = writer.write(property, trade.list);
      if (problem !== null) return { note: problem, line };
      const hint =
        trade.collapsed === null ? "" : " — ⇧-double-click to remove";
      return { note: `${trade.first} · ${trade.second}${hint}`, line };
    },
    commit: () => writer.commit(),
    restore: () => writer.cancel(),
  };
}

/** Read the authored track list, then pull a new track out of the line
 * on every step, carved from the neighbour the drag points at. */
function beginInsert(
  dd: DaydreamApi,
  gridId: ElementId,
  geometry: GridGeometry,
  axis: Axis,
  line: number,
): Session {
  const sizes = geometry[axis].sizes;
  const opened = openTracks(
    dd,
    gridId,
    axis,
    `a ${ONE[axis]} is born from content`,
  );
  if (typeof opened === "string") return inert(opened, line);
  const { target, list, property } = opened;
  const refused = {
    still: `pull to open a ${ONE[axis]}`,
    outward: `pull inward to open a ${ONE[axis]}`,
    implicit: "implicit track — nothing to carve from",
  };
  const writer = createWriter(dd, target);
  return {
    peek: () => ({ note: refused.still, line }),
    step(delta) {
      const insertion = insertAt(list, sizes, line, delta);
      if ("refused" in insertion) {
        // A newborn pulled back to nothing is gone again.
        writer.reset();
        return { note: refused[insertion.refused], line };
      }
      const problem = writer.write(property, insertion.list);
      if (problem !== null) return { note: problem, line };
      const note =
        delta > 0
          ? `new ${insertion.born} · ${insertion.donor}`
          : `${insertion.donor} · new ${insertion.born}`;
      return { note, line: insertion.line };
    },
    commit: () => writer.commit(),
    restore: () => writer.cancel(),
  };
}

/** A double-click on a line: a track equal to the one before it is
 * written there at once. Answers the note. */
export function insertEqualAt(
  dd: DaydreamApi,
  gridId: ElementId,
  axis: Axis,
  line: number,
): string {
  const opened = openTracks(
    dd,
    gridId,
    axis,
    `a ${ONE[axis]} is born from content`,
  );
  if (typeof opened === "string") return opened;
  const equal = insertEqual(opened.list, line);
  if (equal === null) return "implicit track — nothing to copy";
  const writer = createWriter(dd, opened.target);
  const problem = writer.write(opened.property, equal.list);
  writer.commit();
  return problem ?? `+${equal.text}`;
}

/** A ⇧-double-click on a line: the track before it (the first, at the
 * start edge) is removed at once. Answers the note. */
export function removeBefore(
  dd: DaydreamApi,
  gridId: ElementId,
  axis: Axis,
  line: number,
): string {
  const opened = openTracks(dd, gridId, axis, "nothing to remove");
  if (typeof opened === "string") return opened;
  const index = Math.max(0, line - 1);
  const without = removeTrack(opened.list, index);
  if (without === null) return "implicit track — nothing to remove";
  const writer = createWriter(dd, opened.target);
  const problem = writer.write(opened.property, without);
  writer.commit();
  return problem ?? `${ONE[axis]} ${index + 1} removed`;
}

/** How a gap drag spells its value, decided once at the press: the
 * property it writes, the axis's authored value (null when the rule has
 * none — the longhand is then added in px), and the whole value a
 * scaled reading goes into (the other half of a shorthand kept). */
interface GapPlan {
  property: string;
  current: string | null;
  spell(scaled: string): string;
}

const isFunction = (value: string): boolean => /\(/.test(value);

/** Null for a value the drag leaves to the panel: a function (`var()`,
 * `calc()`, `clamp()`) or a shorthand it cannot split. */
function planGap(
  declaration: { property: string; value: string } | null,
  axis: Axis,
): GapPlan | null {
  if (declaration === null) {
    return { property: GAP_LONGHAND[axis], current: null, spell: (s) => s };
  }
  const { property, value } = declaration;
  if (property === "gap" || property === "grid-gap") {
    const parts = parseGapShorthand(value);
    if (parts === null) return null;
    const current = axis === "cols" ? parts.column : parts.row;
    if (isFunction(current)) return null;
    return {
      property,
      current,
      spell: (s) =>
        axis === "cols"
          ? gapShorthand(parts.row, s)
          : gapShorthand(s, parts.column),
    };
  }
  if (isFunction(value)) return null;
  return { property, current: value, spell: (s) => s };
}

/** Read the authored gap and how it is spelled, then scale it on every
 * step. */
function beginGap(
  dd: DaydreamApi,
  gridId: ElementId,
  geometry: GridGeometry,
  axis: Axis,
  line: number,
): Session {
  const target = findTarget(dd, gridId, GAP_PROPERTIES[axis]);
  if (target === null) return inert("the gap can't be written here", line);
  if (target.kind === "blocked") {
    return inert(
      target.why === "inline"
        ? "the gap is set inline — the CSS panel edits that"
        : "the gap is set by a rule this page can't edit",
      line,
    );
  }
  const plan = planGap(
    target.kind === "rule" ? target.declaration : null,
    axis,
  );
  if (plan === null) {
    return inert("the gap uses a value only the CSS panel can edit", line);
  }
  const px = geometry[axis].gap;
  const label = axis === "cols" ? "column gap" : "row gap";
  const current = plan.current ?? formatLength(px, "px");
  const writer = createWriter(dd, target);
  return {
    peek: () => ({ note: `${label} ${current}`, line }),
    step(delta) {
      const next = Math.max(0, px + delta);
      const scaled = scaleLength(current, px, next);
      const problem = writer.write(plan.property, plan.spell(scaled));
      if (problem !== null) return { note: problem, line };
      return { note: `${label} ${scaled}`, line };
    },
    commit: () => writer.commit(),
    restore: () => writer.cancel(),
  };
}

export function beginSession(
  dd: DaydreamApi,
  gridId: ElementId,
  geometry: GridGeometry,
  axis: Axis,
  line: number,
  mode: Mode,
): Session {
  switch (mode) {
    case "gap":
      return beginGap(dd, gridId, geometry, axis, line);
    case "insert":
      return beginInsert(dd, gridId, geometry, axis, line);
    default:
      return beginTrade(dd, gridId, geometry, axis, line);
  }
}
