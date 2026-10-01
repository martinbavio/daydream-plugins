// mrbavio.impeccable — design verbs on the canvas. The BROWSER PART is the
// session's canvas side: the picker (⌘P on a selection, decision #67:
// Impeccable's own list in the interactive overlay slot, beside the target),
// the caption that says a pick is waiting or building, the impeccable_pick
// tool an agent takes the pick with and impeccable_done it ends the round
// with, the page export the detector reads (impeccable_html), and cancel /
// end-session. The verbs themselves — Impeccable's playbooks over a
// viewport — are the host part's (bridge.ts): impeccable_verb and one
// prompt each.
//
// A variants round's copies are finalized into `.daydream/variants/`
// (kernel Phase 9, decision #80), each landing as a viewport of the
// source's page that names its variant: the caption counts them as they
// land, and the round ends at impeccable_done. The user accepts a variant into
// its page or discards it with the kernel's own Accept and Discard in its
// title bar — the plugin adds no word beside them — or names it to the
// agent, who ends it with the kernel's resolve_variant. A rework is written
// to the page's files (decision #78), which tells no end: that round ends
// when the agent says so.
//
// How a pick reaches an agent: through dd.storage. Every change here is
// written to `.daydream/plugin-data/mrbavio.impeccable.json` at once, and an
// agent in a session watches that file (impeccable_session). The canvas never
// calls an agent; it leaves a note where the agent is already looking.

import { createSignal, untrack } from "solid-js";

import type { DaydreamApi } from "@daydream/plugin-api";

import { VERBS as VERB_SPECS } from "./bridge/verbs";
import createCaption from "./Caption";
import { exportPage } from "./pageExport";
import createPicker, { type PickerEntry } from "./Picker";
import { createSession, SESSION_KEY } from "./session";
import { captionCss, pickerCss } from "./styles";
import { createTargeting, type Target } from "./target";

const ID = "mrbavio.impeccable";
/** The verbs, in the picker's order — the host part's list, shared. */
const VERBS = VERB_SPECS.map((v) => v.verb);
const modeOf = (verb: string) => VERB_SPECS.find((v) => v.verb === verb)?.mode;
const isVariantsVerb = (verb: string): boolean => modeOf(verb) === "variants";
/** The picker's last entry: the session's exit, beside the verbs. */
const END_SESSION = "end session";

export const PICK_TOOL = "impeccable_pick";
export const DONE_TOOL = "impeccable_done";
export const HTML_TOOL = "impeccable_html";

export default async function activate(dd: DaydreamApi): Promise<void> {
  const session = createSession(dd);

  // The selection's viewport and, unless the viewport item itself is
  // selected, the element inside its page — the target a verb is picked
  // for, named by selector for the agent and anchored by its render-time
  // id for the canvas (target.ts).
  const targeting = createTargeting(dd);

  // The picker: opened on the current target by ⌘P, closed by Escape, a
  // press outside, or a choice — which becomes the pick.
  const [pickerTarget, setPickerTarget] = createSignal<Target | null>(null);
  const entries: PickerEntry[] = [
    ...VERBS.map((verb) => ({ id: verb, title: verb })),
    { id: END_SESSION, title: END_SESSION },
  ];
  const picker = {
    open: pickerTarget,
    close: () => {
      setPickerTarget(null);
    },
    choose: (id: string, brief: string) => {
      const t = pickerTarget();
      setPickerTarget(null);
      if (t === null) return;
      if (id === END_SESSION) session.end();
      else session.pick(id, t, brief);
    },
  };

  dd.registerCommand({
    id: `${ID}.pick`,
    title: "Impeccable: pick a verb",
    scope: "canvas",
    when: () => targeting.has(),
    run: () => {
      const t = targeting.read();
      if (t === null) return false;
      setPickerTarget(pickerTarget() === null ? t : null);
    },
  });
  dd.bindShortcut(`${ID}.pick`, "Mod+P");

  dd.registerCommand({
    id: `${ID}.cancel`,
    title: "Impeccable: cancel the pick",
    scope: "canvas",
    when: () => session.phase().kind === "waiting",
    run: () => {
      session.cancel();
    },
  });
  dd.bindShortcut(`${ID}.cancel`, "Escape");

  dd.registerCommand({
    id: `${ID}.end-session`,
    title: "Impeccable: end the session",
    scope: "canvas",
    run: () => {
      session.end();
    },
  });

  // Each overlay's CSS rides its registration: the kernel mounts it in the
  // overlay root, inside the dream-plugin layer (decision #71) — a
  // <style> the plugin appended to the head itself would be unlayered.
  dd.registerOverlay({
    id: "caption",
    slot: "overlay.screen",
    styles: captionCss,
    render: () =>
      createCaption(dd, session, (verb) =>
        modeOf(verb) === "report" ? "reviewing" : "building",
      ),
  });
  dd.registerOverlay({
    id: "picker",
    slot: "overlay.interactive",
    styles: pickerCss,
    render: () => createPicker(dd, entries, picker),
  });

  // The viewport as one standalone HTML page (pageExport.ts). Root-
  // relative urls — the mount's routes to the project's files — are made
  // absolute to this tab's origin, so the file stands alone.
  dd.registerTool({
    name: HTML_TOOL,
    title: "Impeccable HTML",
    description:
      "One viewport's page as a standalone HTML file — the page exactly as the canvas renders it, each stylesheet that applies inline in cascade order — for Impeccable's detector: write it to a file and run `impeccable detect --json <file>`. With `element`, a CSS selector matching exactly one element of the page, that element and its subtree carry data-impeccable-target=\"\" and the page is otherwise whole, so the target is styled as the page styles it; with `baseline` too, the answer adds the page with the target taken out (a bare element of its tag in its place) — the findings over the page that this one lacks are the target's, which is what impeccable_detect answers. Answers {viewportId, page, html, bytes, target?: {selector, kept}, baseline?}, page the file's path in the project. Reads only.",
    inputSchema: {
      type: "object",
      properties: {
        viewport: { type: "string", description: "A viewport id from canvas_state" },
        element: {
          type: "string",
          description:
            "A CSS selector matching exactly one element of the viewport's page (a pick's element, canvas_state's selection.selector): the target to mark, subtree included",
        },
        baseline: {
          type: "boolean",
          description: "With element: also answer the page with the target taken out, as `baseline`",
        },
      },
      required: ["viewport"],
    },
    annotations: { readOnlyHint: true },
    run: async (input) => {
      const element = typeof input["element"] === "string" ? input["element"] : undefined;
      return exportPage(dd, {
        viewportId: String(input["viewport"] ?? ""),
        ...(element === undefined ? {} : { element }),
        baseline: input["baseline"] === true,
        origin: window.location.origin,
      });
    },
  });

  // What the canvas can see of a VARIANTS round's progress: the variants
  // of the source's page it gains while the round builds — each a copy the
  // agent finalized, landing as a viewport whose `payload.variant` the
  // kernel wrote — counted, never against a total: impeccable_verb takes
  // any count, so only the agent's impeccable_done ends the round. A
  // variant of the page already there before the round is not one of its
  // own, and neither is anything else the canvas gains. Nothing is stored:
  // a variant carries nothing of the plugin's, and the round is this tab's.
  let round: { page: string; landed: Set<string> } | null = null;
  const pageOf = (viewportId: string): string | null =>
    dd.core.viewportItems(dd.document()).find((v) => v.id === viewportId)?.payload.page ?? null;
  const countVariants = (added: readonly string[]): void => {
    const current = untrack(session.phase);
    if (current.kind !== "building" || round === null) return;
    const viewports = dd.core.viewportItems(dd.document());
    for (const id of added) {
      const viewport = viewports.find((v) => v.id === id);
      if (viewport?.payload.variant !== undefined && viewport.payload.page === round.page) {
        round.landed.add(id);
      }
    }
    if (round.landed.size > 0) session.progress(round.landed.size);
  };

  dd.registerTool({
    name: PICK_TOOL,
    title: "Impeccable pick",
    description:
      "Take the verb the user picked on the canvas: answers {pick: {verb, viewportId, element, brief?, at} | null, exit} — element a CSS selector naming the target in the viewport's page, null for the whole page — and clears it (the canvas shows the pick as building — a variants round counting its variants as they land — until the round ends). Call it first on any Impeccable request and on every wake-up of a session's watch; then impeccable_verb with the pick's verb, viewport, element and, when present, brief, the user's own words about this round, which outrank the playbook's defaults. exit true means the user ended the session.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { idempotentHint: false, destructiveHint: false },
    run: () => {
      const taken = session.take();
      const { pick } = taken;
      // The round's page, taken with its pick and only then: a call with
      // nothing waiting leaves the round being built as it is.
      if (pick !== null) {
        const page = isVariantsVerb(pick.verb) ? untrack(() => pageOf(pick.viewportId)) : null;
        round = page === null ? null : { page, landed: new Set() };
      }
      return taken;
    },
  });

  dd.registerTool({
    name: DONE_TOOL,
    title: "Impeccable done",
    description:
      "Tell the canvas the round is complete — every copy finalized as a variant, the rework written to the page's files, the report given, or you stopped — so its caption stops saying building. The canvas counts a round's variants as they land but cannot tell when the round is over: call it at the end of every round.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { idempotentHint: true, destructiveHint: false },
    run: () => {
      session.done();
      return { done: true };
    },
  });

  dd.on("document", () => {
    untrack(session.check);
  });
  // A hook handler runs in an effect's apply phase: the document is read
  // there as a snapshot, never tracked.
  dd.on("items", ({ added }) => {
    if (added.length > 0) untrack(() => countVariants(added));
  });
  // A new text of the page remounts it, and until it has, the selector
  // may name nothing the check can place.
  dd.on("geometry", () => {
    untrack(session.check);
  });

  // After the await: a reload keeps a waiting pick whose viewport is still
  // there (an agent may still be watching for it).
  const saved = await dd.storage.get(SESSION_KEY);
  session.restore(saved, (id) => dd.items().some((item) => item.id === id));
}
