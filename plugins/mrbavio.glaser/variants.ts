// How a variant viewport names its source. Viewport meta has three fields
// — title, sourceUrl, notes — and no room for a plugin's own, so the
// agent writes the marker as the FIRST LINE of `meta.notes`, followed by
// the direction it took; the Notes pane then shows the person choosing
// exactly what they want to read, and the adopt command finds the round
// from the same line. Shared by the host part (which asks for the line)
// and the browser part (which reads it); no imports, so either can take
// it.

export interface VariantMarker {
  verb: string;
  n: number;
  of: number;
  /** The source viewport item's id. */
  sourceId: string;
}

const MARKER = /^Glaser ([a-z]+) · variant (\d+) of (\d+) of (\S+)\s*$/;

/** The line; `n` may be the letter, for a prompt describing every
 * variant at once. */
export function variantMarker(
  m: Omit<VariantMarker, "n"> & { n: number | "n" },
): string {
  return `Glaser ${m.verb} · variant ${m.n} of ${m.of} of ${m.sourceId}`;
}

/** The marker on the first line of a notes text, or null. */
export function parseVariantMarker(
  notes: string | undefined,
): VariantMarker | null {
  if (notes === undefined) return null;
  const first = notes.split(/\r?\n/, 1)[0] ?? "";
  const match = MARKER.exec(first);
  if (match === null) return null;
  return {
    verb: match[1]!,
    n: Number(match[2]),
    of: Number(match[3]),
    sourceId: match[4]!,
  };
}

/** What the browser part keeps under the `session` storage key. `seq`
 * changes on every write so a watcher comparing file contents wakes even
 * when the same verb is picked twice. */
export interface SessionState {
  seq: number;
  /** A verb the user picked on the canvas, waiting for an agent. */
  pick: Pick | null;
  /** The user ended the session from the canvas; the next glaser_pick
   * takes it and the agent stops watching. */
  exit: boolean;
}

export interface Pick {
  verb: string;
  viewportId: string;
  /** The element inside it, or null for the whole page. */
  elementId: string | null;
  /** Epoch ms. */
  at: number;
}

export const EMPTY_SESSION: SessionState = { seq: 0, pick: null, exit: false };

export function sessionState(raw: unknown): SessionState {
  if (typeof raw !== "object" || raw === null) return EMPTY_SESSION;
  const r = raw as Record<string, unknown>;
  const pick = r["pick"];
  return {
    seq: typeof r["seq"] === "number" ? r["seq"] : 0,
    pick: isPick(pick) ? pick : null,
    exit: r["exit"] === true,
  };
}

function isPick(raw: unknown): raw is Pick {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r["verb"] === "string" &&
    typeof r["viewportId"] === "string" &&
    (typeof r["elementId"] === "string" || r["elementId"] === null) &&
    typeof r["at"] === "number"
  );
}
