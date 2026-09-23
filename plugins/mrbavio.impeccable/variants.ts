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
  /** Which run of the verb over the source the variant is from: the same
   * verb run twice on one source is two rounds, and adopting from one
   * leaves the other. Absent on a variant landed before rounds had ids —
   * those keep to themselves, one round per source and verb. */
  round?: string;
}

/** The line, and the older spelling a canvas may still carry from before
 * the plugin took Impeccable's name; ` · round <id>` after the source is
 * absent from a line written before rounds had ids. */
const MARKER =
  /^(?:Impeccable|Glaser) ([a-z]+) · variant (\d+) of (\d+) of (\S+)(?: · round ([a-z0-9]+))?\s*$/;

/** The line; `n` may be the letter, for a prompt describing every
 * variant at once. */
export function variantMarker(
  m: Omit<VariantMarker, "n"> & { n: number | "n" },
): string {
  const round = m.round === undefined ? "" : ` · round ${m.round}`;
  return `Impeccable ${m.verb} · variant ${m.n} of ${m.of} of ${m.sourceId}${round}`;
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
    ...(match[5] === undefined ? {} : { round: match[5] }),
  };
}

/** What the browser part keeps under the `session` storage key. `seq`
 * changes on every write so a watcher comparing file contents wakes even
 * when the same verb is picked twice. */
export interface SessionState {
  seq: number;
  /** A verb the user picked on the canvas, waiting for an agent. */
  pick: Pick | null;
  /** The user ended the session from the canvas; the next impeccable_pick
   * takes it and the agent stops watching. */
  exit: boolean;
}

export interface Pick {
  verb: string;
  viewportId: string;
  /** The element inside it as a CSS selector matching it alone in the
   * page's stored markup — what get_viewport `element` and the draft
   * tools take (decision #76) — or null for the whole page. Never the
   * canvas's render-time id, which dies with the page's mount. */
  element: string | null;
  /** What the user typed after the verb — the brief, which outranks the
   * playbook's defaults; absent when nothing was typed. */
  brief?: string;
  /** Epoch ms. */
  at: number;
}

export const EMPTY_SESSION: SessionState = { seq: 0, pick: null, exit: false };

export function sessionState(raw: unknown): SessionState {
  if (typeof raw !== "object" || raw === null) return EMPTY_SESSION;
  const r = raw as Record<string, unknown>;
  const pick = legacyWholePage(r["pick"]);
  return {
    seq: typeof r["seq"] === "number" ? r["seq"] : 0,
    pick: isPick(pick) ? pick : null,
    exit: r["exit"] === true,
  };
}

/** A pick saved before pages (decision #76) named its element by
 * `elementId`, the element's id in the document's tree — which a page
 * does not have, so nothing names that element now. Such a pick for an
 * element is not read back; this says one was there, for the canvas to
 * note. One for the whole page (`elementId: null`) loses nothing and is
 * read back as `element: null`. */
export function droppedLegacyPick(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const pick = (raw as Record<string, unknown>)["pick"];
  return (
    typeof pick === "object" &&
    pick !== null &&
    !("element" in pick) &&
    typeof (pick as Record<string, unknown>)["elementId"] === "string"
  );
}

/** A legacy whole-page pick as a page's; anything else as it is. */
function legacyWholePage(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  if ("element" in r || r["elementId"] !== null) return raw;
  const page: Record<string, unknown> = { ...r, element: null };
  delete page["elementId"];
  return page;
}

function isPick(raw: unknown): raw is Pick {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r["verb"] === "string" &&
    typeof r["viewportId"] === "string" &&
    (typeof r["element"] === "string" || r["element"] === null) &&
    (r["brief"] === undefined || typeof r["brief"] === "string") &&
    typeof r["at"] === "number"
  );
}
