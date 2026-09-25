// The session's state in the page: the pick the user made on the canvas
// (waiting for an agent), the pick an agent took (building), and the exit
// the user asked for. Every change is written through dd.storage, which
// the host saves to the plugin's file at once — that write IS the
// channel: an agent's watch wakes on it (bridge.ts). Nothing here reads
// layout; the caption overlay does.
//
// A waiting pick names its element by selector, and an edit of the page
// can make that selector name another element, or none, or several. So
// the session also holds the element itself, never stored: its
// render-time id while its mount lives, and where it is written in the
// page's text (held.ts), followed through each edit. Once the page is
// edited, `check` asks whether the selector still names that element
// alone, and drops the pick, with a note, when it does not — the agent's
// tools would refuse a selector naming none or several, and rework the
// wrong element by one naming another.

import type { DaydreamApi, ElementId } from "@daydream/plugin-api";
import { createSignal, untrack } from "solid-js";

import { isViewport } from "./adopt";
import { follow, holdAt, isHeld, type Held } from "./held";
import type { Target } from "./target";

import {
  droppedLegacyPick,
  EMPTY_SESSION,
  roundId,
  sessionState,
  type Pick,
  type SessionState,
} from "./variants";

export const SESSION_KEY = "session";

/** Every phase past idle carries the pick and its `anchor`: the
 * render-time id of the picked element on the canvas, what the caption is
 * drawn beside — null for a whole page, and for a pick restored from
 * storage, whose page has been mounted anew since; the caption finds that
 * one by the pick's selector (target.ts). */
export type Phase =
  | { kind: "idle" }
  /** Picked on the canvas, no agent has taken it. */
  | { kind: "waiting"; pick: Pick; anchor: ElementId | null }
  /** An agent took it and is working; ends when the round is complete —
   * every variant landed, the in-place rework landed, or the agent said
   * so (impeccable_done). `landed` counts a variant round's progress. */
  | {
      kind: "building";
      pick: Pick;
      anchor: ElementId | null;
      landed: number;
      of: number | null;
    };

/** What the session knows of a waiting pick's element, beside its
 * selector — never stored. `check` moves it along one edge at a time, or
 * drops the pick; every other change of phase sets it anew. */
type Watch =
  /** Nothing to watch: no pick waits, or the one waiting is for a whole
   * page. */
  | { kind: "none" }
  /** The element is whatever the selector names in `html` — for a pick
   * restored from storage, or one whose anchor had no place in the text
   * — once the page's mount can say where that is written. An edit
   * before then leaves nothing to say which element it was. */
  | { kind: "learning"; html: string }
  /** The element is held where its page's text has it; `confirmed` is
   * the text the selector was last found to name it in. */
  | { kind: "holding"; held: Held; confirmed: string }
  /** The element has no place in the text — the parser supplied it (an
   * implied `<body>`, a `<tbody>`) — so all an edit can be asked is
   * whether the selector still names one element; `confirmed` is the text
   * it last did in. */
  | { kind: "unplaced"; confirmed: string };

const NONE: Watch = { kind: "none" };

export interface Session {
  phase: () => Phase;
  /** The user picked a verb for the target, with what they typed after
   * it as the brief (empty: none). */
  pick(verb: string, target: Target, brief?: string): void;
  /** An agent takes what waits (impeccable_pick): the pick and the exit flag,
   * both cleared. With nothing waiting, nothing changes and nothing is
   * written. */
  take(): { pick: Pick | null; exit: boolean };
  /** The user withdrew the pick (Escape, the cancel command). */
  cancel(): void;
  /** The user ended the session from the canvas. */
  end(): void;
  /** The round is complete: whatever was building is done. */
  done(): void;
  /** A variant round's progress: `landed` of `of` variants are on the
   * canvas. Reaching `of` completes the round. */
  progress(landed: number, of: number): void;
  /** What the last session left in storage — restored at activation so a
   * reload keeps a waiting pick; `exit` is never restored. */
  restore(saved: unknown, viewportExists: (id: string) => boolean): void;
  /** Whether the waiting pick's selector still names the element picked,
   * and it alone, once its page has been edited: a pick whose selector
   * names another element, none or several is dropped, with a note.
   * Cheap when the page has not changed since the last answer; call it
   * from the document hook and, since the page remounts after the edit,
   * the geometry hook. Reads untracked. */
  check(): void;
}

// mirrors: src/render/parsePage.ts parsePage
/** The page's stored markup as the browser reads it in STANDARDS mode —
 * the kernel's one parse of a page, to the letter, which the agent's
 * tools resolve a selector against; the plugin API has no call that
 * answers it. A text with no doctype would parse in quirks mode, where
 * class and id selectors match case-insensitively. */
function parseMarkup(html: string): Document {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  if (parsed.compatMode === "CSS1Compat") return parsed;
  // A second doctype is a parse error the parser ignores, so a page whose
  // own doctype is a quirky one is read under this one instead.
  const standard = parser.parseFromString(`<!doctype html>${html}`, "text/html");
  if (parsed.doctype === null) standard.doctype?.remove();
  return standard;
}

export function createSession(dd: DaydreamApi): Session {
  const [phase, setPhase] = createSignal<Phase>({ kind: "idle" });
  let state: SessionState = EMPTY_SESSION;
  let watch: Watch = NONE;

  /** Every change goes to the plugin's file, which is what an agent
   * reads. A write the host refuses is said; a pick it refused is no
   * longer waiting, since no agent can see it — the caption would
   * otherwise wait for one forever. */
  const write = (next: Omit<SessionState, "seq">): void => {
    state = { ...next, seq: state.seq + 1 };
    const written = state;
    dd.storage.set(SESSION_KEY, written).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      const what =
        written.pick !== null
          ? `the ${written.pick.verb} pick could not be saved to the plugin's file, where an agent looks for it, so it is not waiting for one: pick the verb again once the file can be written`
          : `the session could not be saved to the plugin's file${written.exit ? ", so an agent watching it is not told the session ended" : ""}`;
      console.error(`[${dd.plugin.id}] ${what}: ${reason}`);
      const current = untrack(phase);
      if (written.pick !== null && state.pick === written.pick && current.kind === "waiting") {
        watch = NONE;
        state = { ...state, pick: null };
        setPhase({ kind: "idle" });
      }
    });
  };
  const pageHtml = (viewportId: string): string | null => {
    const item = untrack(dd.items).find((i) => i.id === viewportId);
    return item !== undefined && isViewport(item) ? item.payload.html : null;
  };
  /** How many elements the selector names in the page's stored text,
   * as the agent's tools count them (0 for one the browser refuses).
   * The last answer is kept: while a page mounts, every geometry change
   * asks again of the same text. */
  let counted: { html: string; selector: string; count: number } | null = null;
  const count = (html: string, selector: string): number => {
    if (counted?.html === html && counted.selector === selector) return counted.count;
    let n: number;
    try {
      n = parseMarkup(html).querySelectorAll(selector).length;
    } catch {
      n = 0;
    }
    counted = { html, selector, count: n };
    return n;
  };
  /** The watch for a pick of `element` in `viewportId`, `anchor` its
   * render-time id while its mount lives. */
  const watchFor = (viewportId: string, element: string | null, anchor: ElementId | null): Watch => {
    const html = pageHtml(viewportId);
    if (element === null || html === null) return NONE;
    const at = anchor === null ? null : dd.pageSource(anchor);
    return at === null ? { kind: "learning", html } : { kind: "holding", held: holdAt(html, at), confirmed: html };
  };
  const drop = (element: string, why: string): void => {
    console.info(
      `[${dd.plugin.id}] the waiting pick's element \`${element}\` ${why}, so the pick was dropped: pick the verb again`,
    );
    watch = NONE;
    setPhase({ kind: "idle" });
    write({ pick: null, exit: false });
  };

  const check = (): void => {
    const current = untrack(phase);
    if (current.kind !== "waiting" || current.pick.element === null || watch.kind === "none") return;
    const { viewportId, element } = current.pick;
    const html = pageHtml(viewportId);
    if (html === null) return;
    if (watch.kind === "learning") {
      if (html !== watch.html) {
        drop(element, "is not known: its page was edited before the element could be found in it");
        return;
      }
    } else if (html === watch.confirmed) {
      return;
    }
    const since = watch.kind === "learning" ? "in its page" : "since the page was edited";
    if (watch.kind === "holding") watch = { ...watch, held: follow(watch.held, html) };
    const n = count(html, element);
    if (n !== 1) {
      drop(element, `names ${n === 0 ? "no element" : `${n} elements`} ${since}`);
      return;
    }
    if (watch.kind === "unplaced") {
      watch = { kind: "unplaced", confirmed: html };
      return;
    }
    // The one element, on the mount: none while the page is mounting, and
    // the geometry hook asks again once it has.
    const id = dd.pageFind(viewportId, element);
    if (id === null) return;
    const at = dd.pageSource(id);
    if (at === null) {
      watch = { kind: "unplaced", confirmed: html };
      return;
    }
    if (watch.kind === "holding" && !isHeld(watch.held, html, at)) {
      drop(element, "names another element since the page was edited");
      return;
    }
    watch = { kind: "holding", held: holdAt(html, at), confirmed: html };
  };

  return {
    phase,
    pick(verb, target, brief) {
      const trimmed = brief?.trim() ?? "";
      const pick: Pick = {
        verb,
        viewportId: target.viewportId,
        element: target.element,
        ...(trimmed === "" ? {} : { brief: trimmed }),
        // The round is minted here, once: whatever the agent lands for
        // this pick carries it, however often it calls the verb.
        round: roundId(),
        at: Date.now(),
      };
      // The element, while its mount lives: where the anchor was written.
      watch = watchFor(target.viewportId, target.element, target.anchor);
      setPhase({ kind: "waiting", pick, anchor: target.anchor });
      write({ pick, exit: false });
    },
    take() {
      check();
      // Nothing waits: nothing to take, and nothing to write — a call
      // mid-round leaves the round as it is.
      if (state.pick === null && !state.exit) return { pick: null, exit: false };
      watch = NONE;
      const taken = { pick: state.pick, exit: state.exit };
      if (taken.pick !== null) {
        const current = untrack(phase);
        const anchor = current.kind === "idle" ? null : current.anchor;
        setPhase({ kind: "building", pick: taken.pick, anchor, landed: 0, of: null });
      }
      write({ pick: null, exit: false });
      return taken;
    },
    cancel() {
      watch = NONE;
      setPhase({ kind: "idle" });
      write({ pick: null, exit: false });
    },
    end() {
      watch = NONE;
      setPhase({ kind: "idle" });
      write({ pick: null, exit: true });
    },
    done() {
      // Called from a hook handler (an effect's apply phase): read, don't track.
      if (untrack(phase).kind === "building") setPhase({ kind: "idle" });
    },
    progress(landed, of) {
      const current = untrack(phase);
      if (current.kind !== "building") return;
      if (landed >= of) setPhase({ kind: "idle" });
      else setPhase({ ...current, landed, of });
    },
    restore(saved, viewportExists) {
      // A pick from before pages that named an element: nothing names it
      // now, so it is dropped, said, and cleared from the file.
      const dropped = droppedLegacyPick(saved);
      if (dropped) {
        console.info(
          `[${dd.plugin.id}] a waiting pick saved before pages named its element by an id no page has, so it was dropped: pick the verb again`,
        );
      }
      const s = sessionState(saved);
      state = { ...s, exit: false };
      if (s.pick !== null && viewportExists(s.pick.viewportId)) {
        // The element is what the selector names now: learned at once
        // when the page is mounted, else once it is.
        watch = watchFor(s.pick.viewportId, s.pick.element, null);
        setPhase({ kind: "waiting", pick: s.pick, anchor: null });
        check();
      } else if (s.pick !== null || dropped) {
        write({ pick: null, exit: false });
      }
    },
    check,
  };
}
