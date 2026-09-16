// mrbavio.impeccable — design verbs on the canvas. The BROWSER PART is the
// session's canvas side: the picker (⌘P on a selection, decisions.md #67:
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

import { createSignal, onCleanup, untrack } from "solid-js";

import type { DaydreamApi } from "@daydream/plugin-api";

import { adoptInto, markerOf, roundOf } from "./adopt";
import { VERBS as VERB_SPECS } from "./bridge/verbs";
import createCaption from "./Caption";
import createPicker, { type PickerEntry } from "./Picker";
import { createSession, SESSION_KEY } from "./session";
import { css } from "./styles";

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
  const style = document.createElement("style");
  style.dataset["impeccableStyles"] = "";
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
    choose: (id: string, brief: string) => {
      const t = pickerTarget();
      setPickerTarget(null);
      if (t === null) return;
      if (id === END_SESSION) session.end();
      else session.pick(id, t.viewportId, t.elementId, brief);
    },
  };

  dd.registerCommand({
    id: `${ID}.pick`,
    title: "Impeccable: pick a verb",
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
    render: () =>
      createCaption(dd, session, (verb) =>
        modeOf(verb) === "report" ? "reviewing" : "building",
      ),
  });
  dd.registerOverlay({
    id: "picker",
    slot: "overlay.interactive",
    render: () => createPicker(dd, entries, picker),
  });

  // The viewport as one standalone HTML page, for a judge that reads
  // HTML — Impeccable's detector (the critique and audit verbs). The
  // kernel renders it: a live mount, its document read once, disposed.
  // Asset paths are made absolute to this host so the file stands alone.
  dd.registerTool({
    name: HTML_TOOL,
    title: "Impeccable HTML",
    description:
      "One viewport as a standalone HTML file — the page exactly as the canvas renders it, styles and fonts inline — for Impeccable's detector: write it to a file and run `impeccable detect --json <file>`. With `element`, the page is PRUNED to that element: its subtree and its ancestors (the cascade it inherits from), every ancestor's other children removed — so every finding over the file is the target's; the subtree also carries data-impeccable-target=\"\". Answers {viewportId, html, bytes, target?: {id, kept, pruned}}. Reads only.",
    inputSchema: {
      type: "object",
      properties: {
        viewport: { type: "string", description: "A viewport id from canvas_state" },
        element: {
          type: "string",
          description: "An element id inside it: the target to mark, subtree included",
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
        let target: { id: string; kept: number; pruned: number } | undefined;
        if (element !== undefined) {
          const node = doc.querySelector(`[data-dream-id="${CSS.escape(element)}"]`);
          if (node === null) throw new Error(`no element with id "${element}" in viewport "${id}"`);
          // PRUNE the page to the target: its subtree, its ancestors (the
          // cascade the detector's contrast and size rules read — inherited
          // colour and font, the backgrounds behind it), and nothing else
          // — every ancestor's other children go. The detector reports no
          // element, only text and colours, so a page holding nothing but
          // the target is the one way a finding is the target's for sure.
          const subtree = [node, ...node.querySelectorAll("*")];
          for (const n of subtree) n.setAttribute("data-impeccable-target", "");
          let pruned = 0;
          for (let el: Element | null = node.parentElement; el !== null; el = el.parentElement) {
            for (const child of [...el.children]) {
              if (child === node || child.contains(node) || child.tagName === "HEAD") continue;
              child.remove();
              pruned += 1;
            }
          }
          target = { id: element, kept: subtree.length, pruned };
        }
        const html = `<!doctype html>\n${doc.documentElement.outerHTML}`.replace(
          /(src|href)="\/assets\//g,
          `$1="${window.location.origin}/assets/`,
        );
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
  // An IN-PLACE round lands as one change to the source's page: the root
  // as text, compared before and after — a move or a rename elsewhere is
  // not it.
  const rootText = (viewportId: string): string | null => {
    const item = dd.items().find((i) => i.id === viewportId);
    return item === undefined ? null : JSON.stringify((item as { payload: { root: unknown } }).payload.root);
  };
  let sourceBefore: string | null = null;

  dd.registerTool({
    name: PICK_TOOL,
    title: "Impeccable pick",
    description:
      "Take the verb the user picked on the canvas: answers {pick: {verb, viewportId, elementId, brief?, at} | null, exit} and clears it (the canvas shows the pick as building). Call it first on any Impeccable request and on every wake-up of a session's watch; then impeccable_verb with the pick's verb, viewport, element and — when present — brief, the user's own words about this round, which outrank the playbook's defaults. exit true means the user ended the session.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { idempotentHint: false, destructiveHint: false },
    run: () => {
      const taken = session.take();
      sourceBefore = taken.pick === null ? null : rootText(taken.pick.viewportId);
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
      const now = rootText(viewportId);
      if (now === null) session.done(); // the source is gone
      else if (sourceBefore !== null && now !== sourceBefore) session.done();
    }
  };
  // A variant's title bar says which one it is — `<source> · <verb> n/N`,
  // from the marker and the source's own shown name — whatever title the
  // agent gave it: the marker is the one truth, and an agent handing a
  // sub-agent a stale base title was the first thing that went wrong.
  const shownTitle = (vp: { payload: { root: { label?: string }; meta?: { title?: string } } }): string =>
    vp.payload.root.label ?? vp.payload.meta?.title ?? "Untitled";
  const titleVariants = (added: string[]): void => {
    for (const id of added) {
      const item = dd.items().find((i) => i.id === id);
      if (item === undefined) continue;
      const m = markerOf(item);
      if (m === null) continue;
      type VP = { payload: { root: { label?: string }; meta?: { title?: string } } };
      const source = dd.items().find((i) => i.id === m.sourceId) as VP | undefined;
      const base = source === undefined ? "Untitled" : shownTitle(source);
      const title = `${base} · ${m.verb} ${m.n}/${m.of}`;
      const vp = item as VP;
      if (vp.payload.root.label === title && vp.payload.meta?.title === title) continue;
      dd.updateItem(id, (working) => {
        const w = working as unknown as VP;
        w.payload.root.label = title;
        w.payload.meta = { ...(w.payload.meta ?? {}), title };
      });
    }
  };
  dd.on("items", ({ added }) => {
    titleVariants(added);
    trackBuilding();
  });
  dd.on("document", ({ restored }) => {
    if (!restored) trackBuilding();
  });

  // After the await: a reload keeps a waiting pick whose viewport is still
  // there (an agent may still be watching for it).
  const saved = await dd.storage.get(SESSION_KEY);
  session.restore(saved, (id) => dd.items().some((item) => item.id === id));
}
