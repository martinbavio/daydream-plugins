// mrbavio.impeccable — design verbs on the canvas. The BROWSER PART is the
// session's canvas side: the picker (⌘P on a selection, decision #67:
// Impeccable's own list in the interactive overlay slot, beside the target),
// the caption that says a pick is waiting or building, the impeccable_pick
// tool an agent takes the pick with, `adopt` in a variant's title bar
// (a title-bar action), and cancel / end-session. The verbs themselves —
// Impeccable's playbooks over a viewport — are the host part's
// (bridge.ts): impeccable_verb and one prompt each.
//
// How a pick reaches an agent: through dd.storage. Every change here is
// written to `.daydream/plugin-data/mrbavio.impeccable.json` at once, and an
// agent in a session watches that file (impeccable_session). The canvas never
// calls an agent; it leaves a note where the agent is already looking.

import { createSignal, untrack } from "solid-js";

import type { DaydreamApi } from "@daydream/plugin-api";

import { adoptInto, isViewport, markerOf, roundOf } from "./adopt";
import { VERBS as VERB_SPECS } from "./bridge/verbs";
import createCaption from "./Caption";
import { absoluteUrls, pruneTo, soleMatch } from "./pageExport";
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

  // `adopt`, one word in a variant's title bar: the source takes the
  // variant's page, the round goes, one undo step (adopt.ts).
  dd.registerItemAction({
    id: "adopt",
    title: "adopt",
    when: (item) => roundOf(dd.items(), item.id) !== null,
    run: (item) => {
      const round = roundOf(dd.items(), item.id);
      if (round === null) return;
      dd.mutateItems((items) => {
        adoptInto(items, item.id);
      });
      // The source, selected whole: its page is the variant's now, mounted
      // anew, so no element id from before names anything in it.
      dd.select(round.source.id);
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

  // The viewport as one standalone HTML page, for a judge that reads
  // HTML — Impeccable's detector (the critique and audit verbs). The
  // kernel renders it: a live mount — the page's own text made safe, its
  // css one <style> (decision #76) — its document read once, disposed.
  // Root-relative urls (a page's `assets/<file>` pointed at this host's
  // route for its document) are made absolute so the file stands alone.
  dd.registerTool({
    name: HTML_TOOL,
    title: "Impeccable HTML",
    description:
      "One viewport as a standalone HTML file — the page exactly as the canvas renders it, styles and fonts inline — for Impeccable's detector: write it to a file and run `impeccable detect --json <file>`. With `element`, a CSS selector matching exactly one element of the page, the page is PRUNED to that element: its subtree and its ancestors (the cascade it inherits from), every ancestor's other children removed — so every finding over the file is the target's; the subtree also carries data-impeccable-target=\"\". Answers {viewportId, html, bytes, target?: {selector, kept, pruned}}. Reads only.",
    inputSchema: {
      type: "object",
      properties: {
        viewport: { type: "string", description: "A viewport id from canvas_state" },
        element: {
          type: "string",
          description:
            "A CSS selector matching exactly one element of the viewport's page (a pick's element, canvas_state's selection.selector): the target to mark, subtree included",
        },
      },
      required: ["viewport"],
    },
    annotations: { readOnlyHint: true },
    run: async (input) => {
      const id = String(input["viewport"] ?? "");
      const element = typeof input["element"] === "string" ? input["element"] : undefined;
      const viewport = dd.core.viewportItems(dd.document()).find((v) => v.id === id);
      if (viewport === undefined) throw new Error(`no viewport with id "${id}"`);
      const mounted = await dd.mountViewport(viewport, { still: true });
      try {
        const doc = mounted.document();
        let target: { selector: string; kept: number; pruned: number } | undefined;
        if (element !== undefined) {
          const node = soleMatch(doc, element, id);
          target = { selector: element, ...pruneTo(node) };
        }
        absoluteUrls(doc, window.location.origin);
        const html = `<!doctype html>\n${doc.documentElement.outerHTML}`;
        return { viewportId: id, html, bytes: html.length, ...(target === undefined ? {} : { target }) };
      } finally {
        mounted.dispose();
      }
    },
  });

  // What the canvas can see of a round's progress (the agent's impeccable_done
  // is the explicit end). A VARIANTS round: every variant carries the
  // source and the verb in its notes marker, so the count on the canvas
  // against the marker's `of` is the progress, and reaching it is the end.
  // An IN-PLACE round lands as one change to the source's page: its two
  // texts, compared before and after — a move, a rename or a meta edit
  // is not it.
  const pageText = (viewportId: string): string | null => {
    const item = dd.items().find((i) => i.id === viewportId);
    if (item === undefined || !isViewport(item)) return null;
    return JSON.stringify([item.payload.html, item.payload.css]);
  };
  let sourceBefore: string | null = null;

  dd.registerTool({
    name: PICK_TOOL,
    title: "Impeccable pick",
    description:
      "Take the verb the user picked on the canvas: answers {pick: {verb, viewportId, element, brief?, at} | null, exit} — element a CSS selector naming the target in the viewport's page, null for the whole page — and clears it (the canvas shows the pick as building). Call it first on any Impeccable request and on every wake-up of a session's watch; then impeccable_verb with the pick's verb, viewport, element and — when present — brief, the user's own words about this round, which outrank the playbook's defaults. exit true means the user ended the session.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { idempotentHint: false, destructiveHint: false },
    run: () => {
      const taken = session.take();
      sourceBefore = taken.pick === null ? null : pageText(taken.pick.viewportId);
      return taken;
    },
  });

  dd.registerTool({
    name: DONE_TOOL,
    title: "Impeccable done",
    description:
      "Tell the canvas the round is complete: every variant landed, or the in-place rework landed, or you stopped. The canvas infers most of this from what lands, but call it at the end of every round anyway — a round that stopped short would otherwise read as still building.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { idempotentHint: true, destructiveHint: false },
    run: () => {
      session.done();
      return { done: true };
    },
  });

  const trackBuilding = (): void => {
    const phase = untrack(session.phase);
    if (phase.kind !== "building") return;
    const { verb, viewportId } = phase.pick;
    if (isVariantsVerb(verb)) {
      let landed = 0;
      let of: number | null = null;
      for (const item of dd.items()) {
        const m = markerOf(item);
        if (m !== null && m.sourceId === viewportId && m.verb === verb) {
          landed += 1;
          of = Math.max(of ?? 0, m.of);
        }
      }
      if (of !== null) session.progress(landed, of);
    } else {
      const now = pageText(viewportId);
      if (now === null) session.done(); // the source is gone
      else if (sourceBefore !== null && now !== sourceBefore) session.done();
    }
  };
  // A variant's title bar says which one it is — `<source> · <verb> n/N`,
  // from the marker and the source's own shown name, which for a page is
  // its meta title (decision #76) — whatever title the agent gave it: the
  // marker is the one truth, and an agent handing a sub-agent a stale base
  // title was the first thing that went wrong.
  const titleVariants = (added: string[]): void => {
    for (const id of added) {
      const item = dd.items().find((i) => i.id === id);
      if (item === undefined || !isViewport(item)) continue;
      const m = markerOf(item);
      if (m === null) continue;
      const source = dd.items().find((i) => i.id === m.sourceId);
      const base =
        source !== undefined && isViewport(source)
          ? (source.payload.meta?.title ?? "Untitled")
          : "Untitled";
      const title = `${base} · ${m.verb} ${m.n}/${m.of}`;
      if (item.payload.meta?.title === title) continue;
      dd.updateItem(id, (working) => {
        if (!isViewport(working)) return;
        working.payload.meta = { ...(working.payload.meta ?? {}), title };
      });
    }
  };
  // A hook handler runs in an effect's apply phase: the document is read
  // there as a snapshot, never tracked.
  dd.on("items", ({ added }) => {
    untrack(() => {
      titleVariants(added);
      trackBuilding();
    });
  });
  dd.on("document", ({ restored }) => {
    if (!restored) untrack(trackBuilding);
  });

  // After the await: a reload keeps a waiting pick whose viewport is still
  // there (an agent may still be watching for it).
  const saved = await dd.storage.get(SESSION_KEY);
  session.restore(saved, (id) => dd.items().some((item) => item.id === id));
}
