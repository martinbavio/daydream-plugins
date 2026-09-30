// What the browser part keeps in the plugin's storage file: the pick the
// user made on the canvas, waiting for an agent, and the exit they asked
// for. Read back at activation (session.ts) — a pick saved by an older
// version of the plugin read as it can be. No imports, so the host part
// could take it too.
//
// A pick carried a round id once, for the marker a landed variant wrote
// on its notes, which the caption counted and `adopt` cleared by. A
// viewport has no notes since decision #78 and no draft lands, so nothing
// reads a round now: a stored one is read past. Phase 9 of the project
// model moves Impeccable's variants to `.daydream/variants/`, and a
// round's name with them.

/** What the browser part keeps under the `session` storage key. `seq`
 * changes on every write so a watcher comparing file contents wakes even
 * when the same verb is picked twice. */
export interface SessionState {
  seq: number;
  /** A verb the user picked on the canvas, waiting for an agent. */
  pick: VerbPick | null;
  /** The user ended the session from the canvas; the next impeccable_pick
   * takes it and the agent stops watching. */
  exit: boolean;
}

export interface VerbPick {
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
    pick: isPick(pick) ? ownFields(pick) : null,
    exit: r["exit"] === true,
  };
}

/** The pick's own fields, and nothing an older version stored beside
 * them (a round). */
function ownFields({ verb, viewportId, element, brief, at }: VerbPick): VerbPick {
  return { verb, viewportId, element, ...(brief === undefined ? {} : { brief }), at };
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

function isPick(raw: unknown): raw is VerbPick {
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
