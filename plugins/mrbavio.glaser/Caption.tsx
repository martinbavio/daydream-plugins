import { createEffect, createSignal, Show, untrack } from "solid-js";

import type { DaydreamApi, OverlayRect } from "@daydream/plugin-api";

import type { Session } from "./session";
import { classPrefix } from "./styles";

/** The one line the canvas says about a pick: `bolder · waiting for an
 * agent`, then `bolder · building` once an agent took it — `bolder · 1 of
 * 3` as a variant round lands — then nothing, once the round is complete.
 * Drawn in the screen slot from the target's rect — above an element,
 * inside the top-left corner of a whole page (the title bar sits above
 * that). Subscribe in compute, read layout in apply (decisions.md #33). */
export default function createCaption(dd: DaydreamApi, session: Session) {
  const [box, setBox] = createSignal<OverlayRect | null>(null);

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
      const { viewportId, elementId } = phase.pick;
      const rect = untrack(() =>
        elementId === null ? dd.geometry.itemRect(viewportId) : dd.geometry.rect(elementId),
      );
      setBox(rect);
    },
  );

  const text = () => {
    const phase = session.phase();
    if (phase.kind === "idle") return "";
    if (phase.kind === "waiting") return `${phase.pick.verb} · waiting for an agent`;
    return phase.of === null
      ? `${phase.pick.verb} · building`
      : `${phase.pick.verb} · ${phase.landed} of ${phase.of}`;
  };
  const whole = () => {
    const phase = session.phase();
    return phase.kind !== "idle" && phase.pick.elementId === null;
  };

  return (
    <Show when={box()}>
      {(rect) => (
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
      )}
    </Show>
  );
}
