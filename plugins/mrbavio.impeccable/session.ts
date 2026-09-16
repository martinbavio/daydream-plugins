// The session's state in the page: the pick the user made on the canvas
// (waiting for an agent), the pick an agent took (building), and the exit
// the user asked for. Every change is written through dd.storage, which
// the host saves to the plugin's file at once — that write IS the
// channel: an agent's watch wakes on it (bridge.ts). Nothing here reads
// layout; the caption overlay does.

import type { DaydreamApi } from "@daydream/plugin-api";
import { createSignal, untrack } from "solid-js";

import {
  EMPTY_SESSION,
  sessionState,
  type Pick,
  type SessionState,
} from "./variants";

export const SESSION_KEY = "session";

export type Phase =
  | { kind: "idle" }
  /** Picked on the canvas, no agent has taken it. */
  | { kind: "waiting"; pick: Pick }
  /** An agent took it and is working; ends when the round is complete —
   * every variant landed, the in-place rework landed, or the agent said
   * so (impeccable_done). `landed` counts a variant round's progress. */
  | { kind: "building"; pick: Pick; landed: number; of: number | null };

export interface Session {
  phase: () => Phase;
  /** The user picked a verb for the selection, with what they typed after
   * it as the brief (empty: none). */
  pick(verb: string, viewportId: string, elementId: string | null, brief?: string): void;
  /** An agent takes what waits (impeccable_pick): the pick and the exit flag,
   * both cleared. */
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
}

export function createSession(dd: DaydreamApi): Session {
  const [phase, setPhase] = createSignal<Phase>({ kind: "idle" });
  let state: SessionState = EMPTY_SESSION;

  const write = (next: Omit<SessionState, "seq">): void => {
    state = { ...next, seq: state.seq + 1 };
    void dd.storage.set(SESSION_KEY, state);
  };

  return {
    phase,
    pick(verb, viewportId, elementId, brief) {
      const trimmed = brief?.trim() ?? "";
      const pick: Pick = {
        verb,
        viewportId,
        elementId,
        ...(trimmed === "" ? {} : { brief: trimmed }),
        at: Date.now(),
      };
      setPhase({ kind: "waiting", pick });
      write({ pick, exit: false });
    },
    take() {
      const taken = { pick: state.pick, exit: state.exit };
      if (taken.pick !== null) {
        setPhase({ kind: "building", pick: taken.pick, landed: 0, of: null });
      }
      write({ pick: null, exit: false });
      return taken;
    },
    cancel() {
      setPhase({ kind: "idle" });
      write({ pick: null, exit: false });
    },
    end() {
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
      const s = sessionState(saved);
      state = { ...s, exit: false };
      if (s.pick !== null && viewportExists(s.pick.viewportId)) {
        setPhase({ kind: "waiting", pick: s.pick });
      } else if (s.pick !== null) {
        write({ pick: null, exit: false });
      }
    },
  };
}
