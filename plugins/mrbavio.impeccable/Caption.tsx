import { createEffect, createSignal, Show, untrack } from "solid-js";

import type { DaydreamApi, OverlayRect } from "@daydream/plugin-api";

import type { Session } from "./session";
import { classPrefix } from "./styles";
import { createTargetBox } from "./target";

/** The one line the canvas says about a pick: `bolder · waiting for an
 * agent`, then `bolder · building` once an agent took it — `bolder · 1 of
 * 3` as a variant round lands — then nothing, once the round is complete.
 * Drawn in the screen slot from the target's rect — above an element,
 * found again by its selector once its page has been remounted or
 * reloaded since the pick (target.ts), and inside the top-left corner of
 * a whole page (the title bar sits above that), or of a page whose
 * element the selector no longer names alone. Subscribe in compute, read
 * layout in apply (decision #33). */
export default function createCaption(
  dd: DaydreamApi,
  session: Session,
  /** What an agent is doing with the verb while the pick is taken:
   * "building" for the verbs that land, "reviewing" for a report. */
  working: (verb: string) => string = () => "building",
) {
  const [box, setBox] = createSignal<{ rect: OverlayRect; whole: boolean } | null>(null);
  const targetBox = createTargetBox(dd);

  createEffect(
    () => {
      dd.geometry.version(); // subscribe: no layout read here
      return session.phase();
    },
    (phase) => {
      if (phase.kind === "idle") {
        setBox(null);
        return;
      }
      const { viewportId, element } = phase.pick;
      setBox(untrack(() => targetBox({ viewportId, element, anchor: phase.anchor })));
    },
  );

  const text = () => {
    const phase = session.phase();
    if (phase.kind === "idle") return "";
    if (phase.kind === "waiting") return `${phase.pick.verb} · waiting for an agent`;
    return phase.of === null
      ? `${phase.pick.verb} · ${working(phase.pick.verb)}`
      : `${phase.pick.verb} · ${phase.landed} of ${phase.of}`;
  };

  return (
    <Show when={box()}>
      {(b) => {
        const rect = () => b().rect;
        const whole = () => b().whole;
        return (
          <div
            class={`${classPrefix}-caption`}
            data-phase={session.phase().kind}
            style={{
              left: `${rect().x + (whole() ? 8 : 0)}px`,
              top: `${whole() ? rect().y + 6 : rect().y - 18}px`,
            }}
          >
            {text()}
          </div>
        );
      }}
    </Show>
  );
}
