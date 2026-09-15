// mrbavio.glaser — design verbs on the canvas. The BROWSER PART is the
// session's canvas side: the picker (⌘P on a selection, decisions.md #67:
// Glaser's own list in the interactive overlay slot, beside the target),
// the caption that says a pick is waiting or building, the glaser_pick
// tool an agent takes the pick with, `adopt` in a variant's title bar
// (a title-bar action), and cancel / end-session. The verbs themselves —
// Impeccable's playbooks over a viewport — are the host part's
// (bridge.ts): glaser_verb and one prompt each.
//
// How a pick reaches an agent: through dd.storage. Every change here is
// written to `.daydream/plugin-data/mrbavio.glaser.json` at once, and an
// agent in a session watches that file (glaser_session). The canvas never
// calls an agent; it leaves a note where the agent is already looking.

import { createSignal, onCleanup } from "solid-js";

import type { DaydreamApi } from "@daydream/plugin-api";

import { adoptInto, roundOf } from "./adopt";
import createCaption from "./Caption";
import createPicker, { type PickerEntry } from "./Picker";
import { createSession, SESSION_KEY } from "./session";
import { css } from "./styles";

const ID = "mrbavio.glaser";
const VERBS = [
  "bolder",
  "quieter",
  "typeset",
  "layout",
  "colorize",
  "delight",
  "distill",
  "polish",
  "clarify",
  "animate",
  "adapt",
] as const;
/** The picker's last entry: the session's exit, beside the verbs. */
const END_SESSION = "end session";

export const PICK_TOOL = "glaser_pick";

export default async function activate(dd: DaydreamApi): Promise<void> {
  const style = document.createElement("style");
  style.dataset["glaserStyles"] = "";
  style.textContent = css;
  document.head.append(style);
  onCleanup(() => style.remove());

  const session = createSession(dd);

  /** The selection's viewport and, unless the viewport item itself is
   * selected, the element — the target a verb is picked for. */
  const target = (): { viewportId: string; elementId: string | null } | null => {
    const selected = dd.selection();
    if (selected === null) return null;
    const viewport = dd.core.findViewport(dd.document(), selected);
    if (viewport === undefined) return null;
    const whole = dd.itemSelection().includes(viewport.id);
    return { viewportId: viewport.id, elementId: whole ? null : selected };
  };

  // The picker: opened on the current target by ⌘P, closed by Escape, a
  // press outside, or a choice — which becomes the pick.
  const [pickerTarget, setPickerTarget] = createSignal<ReturnType<typeof target>>(null);
  const entries: PickerEntry[] = [
    ...VERBS.map((verb) => ({ id: verb, title: verb })),
    { id: END_SESSION, title: END_SESSION },
  ];
  const picker = {
    open: pickerTarget,
    close: () => {
      setPickerTarget(null);
    },
    choose: (id: string) => {
      const t = pickerTarget();
      setPickerTarget(null);
      if (t === null) return;
      if (id === END_SESSION) session.end();
      else session.pick(id, t.viewportId, t.elementId);
    },
  };

  dd.registerCommand({
    id: `${ID}.pick`,
    title: "Glaser: pick a verb",
    scope: "canvas",
    when: () => target() !== null,
    run: () => {
      const t = target();
      if (t === null) return false;
      setPickerTarget(pickerTarget() === null ? t : null);
    },
  });
  dd.bindShortcut(`${ID}.pick`, "Mod+P");

  dd.registerCommand({
    id: `${ID}.cancel`,
    title: "Glaser: cancel the pick",
    scope: "canvas",
    when: () => session.phase().kind === "waiting",
    run: () => {
      session.cancel();
    },
  });
  dd.bindShortcut(`${ID}.cancel`, "Escape");

  dd.registerCommand({
    id: `${ID}.end-session`,
    title: "Glaser: end the session",
    scope: "canvas",
    run: () => {
      session.end();
    },
  });

  // `adopt`, one word in a variant's title bar: the source takes the
  // variant's page, the round goes, one undo step (adopt.ts).
  dd.registerItemAction({
    id: "adopt",
    title: "adopt",
    when: (item) => roundOf(dd.items(), item.id) !== null,
    run: (item) => {
      const round = roundOf(dd.items(), item.id);
      if (round === null) return;
      // The source's page IS the variant's after this, ids included.
      const adoptedRoot = round.variants.find((v) => v.id === item.id)!.payload.root.id;
      dd.mutateItems((items) => {
        adoptInto(items, item.id);
      });
      dd.select(adoptedRoot);
    },
  });

  dd.registerOverlay({
    id: "caption",
    slot: "overlay.screen",
    render: () => createCaption(dd, session),
  });
  dd.registerOverlay({
    id: "picker",
    slot: "overlay.interactive",
    render: () => createPicker(dd, entries, picker),
  });

  dd.registerTool({
    name: PICK_TOOL,
    title: "Glaser pick",
    description:
      "Take the verb the user picked on the canvas: answers {pick: {verb, viewportId, elementId, at} | null, exit} and clears it (the canvas shows the pick as building). Call it first on any Glaser request and on every wake-up of a session's watch; then glaser_verb with the pick's verb, viewport and element. exit true means the user ended the session.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { idempotentHint: false, destructiveHint: false },
    run: () => session.take(),
  });

  // A landing ends the building state: a variant round lands item by item
  // (the first one is enough to say the agent is delivering), an in-place
  // rework lands as one document change.
  dd.on("items", ({ added }) => {
    if (added.length > 0) session.landed();
  });
  dd.on("document", ({ restored }) => {
    if (!restored) session.landed();
  });

  // After the await: a reload keeps a waiting pick whose viewport is still
  // there (an agent may still be watching for it).
  const saved = await dd.storage.get(SESSION_KEY);
  session.restore(saved, (id) => dd.items().some((item) => item.id === id));
}
