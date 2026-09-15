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
  /** An agent took it and is working; ends at the next landing. */
  | { kind: "building"; pick: Pick };

export interface Session {
  phase: () => Phase;
  /** The user picked a verb for the selection. */
  pick(verb: string, viewportId: string, elementId: string | null): void;
  /** An agent takes what waits (glaser_pick): the pick and the exit flag,
   * both cleared. */
  take(): { pick: Pick | null; exit: boolean };
  /** The user withdrew the pick (Escape, the cancel command). */
  cancel(): void;
  /** The user ended the session from the canvas. */
  end(): void;
  /** A landing happened: whatever was building is done. */
  landed(): void;
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
    pick(verb, viewportId, elementId) {
      const pick: Pick = { verb, viewportId, elementId, at: Date.now() };
      setPhase({ kind: "waiting", pick });
      write({ pick, exit: false });
    },
    take() {
      const taken = { pick: state.pick, exit: state.exit };
      if (taken.pick !== null) setPhase({ kind: "building", pick: taken.pick });
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
    landed() {
      // Called from a hook handler (an effect's apply phase): read, don't track.
      if (untrack(phase).kind === "building") setPhase({ kind: "idle" });
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
