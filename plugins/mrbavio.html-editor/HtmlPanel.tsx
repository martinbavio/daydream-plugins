import {
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  Show,
  untrack,
} from "solid-js";

import type {
  DaydreamApi,
  DeepReadonly,
  DreamElement,
  ElementId,
  ItemTransaction,
} from "@daydream/plugin-api";

import { replaceSubtree, sameElement, type ViewportPayload } from "./edit";
import { parseHtml, type PaneLevel } from "./htmlDom";
import { createHtmlEditor, type HtmlEditorHandle } from "./htmlEditor";
import { reconcile } from "./reconcile";
import { serializeElement } from "./serialize";
import { classPrefix, css } from "./styles";

/** Text the pane could not apply when it had to let go of the element:
 * kept per element so a refusal, a re-targeting or a hidden dock never
 * loses what was typed. Panel memory, never the document. */
export interface Draft {
  text: string;
  /** The refusal's sentence. */
  problem: string;
}

/** What the entry (index.tsx) shares with the panel: the API, the live
 * editor handle its Escape command acts on, and the drafts that outlive a
 * panel mount (the dock unmounts its panels while hidden). */
export interface PanelState {
  dd: DaydreamApi;
  /** The CodeMirror handle while an element is selected; written here,
   * read by the entry's Escape and ⌘Z commands. */
  editor: HtmlEditorHandle | undefined;
  /** ⌘Z while typing: cancel the open session — the whole of it, it being
   * one undo step — and show the element as it was. False when no
   * session is open, so the key falls through to core's undo. Set by the
   * panel once mounted. */
  undo: () => boolean;
  drafts: Map<ElementId, Draft>;
}

type Element = DeepReadonly<DreamElement>;

/** Live apply while typing, like the CSS editor's (~150ms). */
export const APPLY_DEBOUNCE_MS = 150;

/** The sentence for text whose element changed on the canvas meanwhile
 * (an agent, a draft finalizing): shown once, then the next edit
 * overwrites on purpose. */
export const CHANGED_UNDERNEATH =
  "This element changed on the canvas while you were editing. Keep typing to overwrite it, or undo your edit to see the new structure.";

/**
 * The HTML pane (decisions.md #58): the selected element's subtree as
 * source, STRUCTURE ONLY, in CodeMirror, applied LIVE as the CSS editor
 * is — every edit, after a short debounce, parses the text with the
 * browser, refuses what the format would refuse (the sentence under the
 * editor, nothing written), matches identities by content, tag and
 * position (reconcile.ts) and writes the subtree through an item
 * transaction, so the whole typing session is ONE undo step, committed
 * when the editor is left: blur, Escape, a selection change, the dock
 * hiding. The store stays the single source of truth; the editor is
 * uncontrolled while focused and re-synced on selection change, blur,
 * undo and redo. Text still refused when the pane lets go of the element
 * waits as the element's draft and comes back with it.
 *
 * A factory, not a `<Component>`: the panel's `render` (index.tsx) calls
 * it under the dock's owner, and `state` is a plain object shared with
 * the entry — never a reactive props proxy.
 */
export default function createHtmlPanel(state: PanelState) {
  const { dd, drafts } = state;
  const p = classPrefix(dd.plugin.id);

  // The selection. A selected viewport selects its root, so "the
  // viewport root of the selected item" is this same read.
  const selected = createMemo<Element | null>(() => {
    const id = dd.selection();
    if (id === null) return null;
    return dd.core.findElement(dd.document(), id) ?? null;
  });

  // The store face: the subtree as HTML. The recursive read through the
  // store proxy tracks every tag, attribute, text and child list, so an
  // outside edit (an agent, undo) re-runs the sync effect.
  const face = createMemo(() => {
    const el = selected();
    return el === null ? "" : serializeElement(el);
  });

  // A refusal, shown under the editor while the text stays refused.
  const [message, setMessage] = createSignal<string | null>(null);

  const editor = (): HtmlEditorHandle | undefined => state.editor;
  const setEditor = (handle: HtmlEditorHandle | undefined): void => {
    state.editor = handle;
  };
  let host: HTMLDivElement | undefined;

  // Whether the editor holds text not yet applied (typed since the last
  // apply or sync). Only dirty text is applied: an untouched editor whose
  // face moved under it (an agent's edit) must never write it back.
  let dirty = false;
  // The face the editor was last synced to or last wrote. A face that
  // moved since — the element changed on the canvas while the user typed
  // — is refused once with a sentence rather than overwritten unseen.
  let synced = "";
  // The typing session's transaction: opened by the first write, one undo
  // step for everything until it is left. Ended by the kernel on an
  // outside write, an undo, a redo or a load (onInterrupted).
  let session: ItemTransaction | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const clearDebounce = (): void => {
    if (debounce !== null) {
      clearTimeout(debounce);
      debounce = null;
    }
  };

  /** Where the pane's element sits, for the parser's skeleton handling:
   * the skeleton elements by TAG, since an older root may be a div. */
  const levelOf = (el: Element): PaneLevel =>
    el.tag === "html" ? "root" : el.tag === "body" ? "body" : "fragment";

  /** The face of `id` now — the selected element's is `face()`, but the
   * element being LEFT on a selection change is no longer selected. */
  const faceOf = (id: ElementId): string => {
    const el = dd.core.findElement(dd.document(), id);
    return el === undefined ? "" : serializeElement(el);
  };

  /** Applied: the id the pane's element has now — its own when it
   * survived, its replacement's when the text replaced it. */
  type Applied = { ok: true; id: ElementId } | { ok: false; problem: string };

  /**
   * Parse `text` as the subtree of `id` and write it into the session
   * (opened on the first write) — unless nothing would change. A refusal
   * — the parser's, or the kernel's validation — changes nothing and
   * comes back as a sentence. Untracked store reads: called from the
   * debounce, blur, the sync effect's apply phase and the disposal only.
   */
  const applyText = (id: ElementId, text: string): Applied => {
    const doc = dd.document();
    const stored = dd.core.findElement(doc, id);
    const viewport = dd.core.findViewport(doc, id);
    if (stored === undefined || viewport === undefined) {
      return { ok: false, problem: "The element is no longer on the canvas." };
    }
    const parsed = parseHtml(text, levelOf(stored), dd.core);
    if (!parsed.ok) return parsed;
    const { element } = reconcile(stored, parsed.element, dd.core.generateId);
    if (sameElement(stored, element)) return { ok: true, id };
    const write = (item: { payload: unknown }): void => {
      replaceSubtree(item.payload as ViewportPayload, id, element);
    };
    try {
      session ??= dd.beginItemTransaction({
        onInterrupted: () => {
          session = null;
        },
      });
      if (!session.update(viewport.id, write)) {
        // The kernel ended the session between two edits: start another.
        session = dd.beginItemTransaction({
          onInterrupted: () => {
            session = null;
          },
        });
        session.update(viewport.id, write);
      }
    } catch (error) {
      return {
        ok: false,
        problem: error instanceof Error ? error.message : String(error),
      };
    }
    return { ok: true, id: element.id };
  };

  /** Apply the editor's dirty text to `id` now. Applied: the text is on
   * the canvas and stays the user's. Refused: the sentence under it.
   * Changed underneath: refused once. */
  const applyEditor = (id: ElementId): Applied => {
    const ed = editor();
    if (ed === undefined || !dirty) return { ok: true, id };
    const current = faceOf(id);
    let result: Applied;
    if (current !== synced) {
      synced = current;
      result = { ok: false, problem: CHANGED_UNDERNEATH };
    } else {
      result = applyText(id, ed.text());
      if (result.ok) synced = faceOf(result.id);
    }
    if (result.ok) dirty = false;
    setMessage(result.ok ? null : result.problem);
    // The text's root is another element now — a wrapper around the
    // selected one, or its replacement: the pane follows what it shows.
    if (result.ok && result.id !== id) dd.select(result.id);
    return result;
  };

  state.undo = (): boolean => {
    if (session === null) return false;
    clearDebounce();
    // Cancel restores the session's starting snapshot and bumps the
    // history version, which the sync effect below reads as a restore.
    session.cancel();
    session = null;
    return true;
  };

  /** Leave the element: apply what is pending, commit the session, and
   * keep what was refused as the element's draft. */
  const leave = (id: ElementId): void => {
    clearDebounce();
    const ed = editor();
    const result = applyEditor(id);
    if (!result.ok && ed !== undefined) {
      drafts.set(id, { text: ed.text(), problem: result.problem });
    } else {
      drafts.delete(id);
    }
    session?.commit();
    session = null;
  };

  /** Show `id` in the editor: its draft when it has one, else the face. */
  const showElement = (ed: HtmlEditorHandle, id: ElementId, text: string) => {
    const draft = drafts.get(id);
    synced = text;
    if (draft === undefined) {
      ed.setText(text);
      dirty = false;
      setMessage(null);
    } else {
      ed.setText(draft.text);
      dirty = true;
      setMessage(draft.problem);
    }
  };

  // The panel unmounting — the dock hidden (⌘\), the plugin unloading —
  // mid-session: leave the element the way blur would, after the disposal
  // has run (never a write inside it).
  onSettled(() => () => {
    clearDebounce();
    const ed = editor();
    const id = untrack(dd.selection);
    if (ed !== undefined && id !== null && (dirty || session !== null)) {
      const text = ed.text();
      const pending = dirty;
      queueMicrotask(() => {
        if (pending) {
          const result = applyText(id, text);
          if (!result.ok) drafts.set(id, { text, problem: result.problem });
        }
        session?.commit();
        session = null;
      });
    }
    ed?.destroy();
    setEditor(undefined);
  });

  // Store → editor sync. Uncontrolled while focused: ordinary store
  // changes never rewrite the text under the caret. A forced re-sync
  // happens on a selection change (after leaving the previous element),
  // on blur (handleBlur) and on undo/redo — even mid-focus — through
  // historyVersion, which only undo, redo and a load bump; a restore
  // drops what was typed (the edit belonged to the state just reverted;
  // the kernel ended the session) and keeps a refused draft (it was never
  // part of any state).
  let lastSelectedId: ElementId | null | undefined;
  let lastHistoryVersion: number | undefined;

  createEffect(
    () => ({
      id: dd.selection(),
      historyVersion: dd.historyVersion(),
      text: face(),
    }),
    ({ id, historyVersion, text }) => {
      const selectionChanged =
        lastSelectedId !== undefined && id !== lastSelectedId;
      const restored =
        lastHistoryVersion !== undefined &&
        historyVersion !== lastHistoryVersion;
      const previous = lastSelectedId;
      lastSelectedId = id;
      lastHistoryVersion = historyVersion;

      untrack(() => {
        const ed = editor();
        if (restored) {
          clearDebounce();
          session = null;
          dirty = false;
        } else if (selectionChanged && ed !== undefined && previous) {
          leave(previous);
        }
        if (id === null) {
          ed?.destroy();
          setEditor(undefined);
          setMessage(null);
          return;
        }
        if (ed === undefined) return;
        if (restored || selectionChanged || !ed.hasFocus()) {
          showElement(ed, id, text);
        }
      });
    },
  );

  // A real edit: apply after the debounce, to the element the text
  // belonged to — a flush after the selection moved on is dropped, the
  // selection-change path having already left that element.
  const handleDocChanged = (): void => {
    dirty = true;
    const id = untrack(dd.selection);
    if (id === null) return;
    clearDebounce();
    debounce = setTimeout(() => {
      debounce = null;
      if (untrack(dd.selection) !== id) return;
      applyEditor(id);
    }, APPLY_DEBOUNCE_MS);
  };

  const handleBlur = (): void => {
    // A blur the <Show> fires while unmounting the editor (the element
    // was removed, or the selection cleared) is not a gesture: the
    // selection-change path and the disposal above already have it.
    if (host === undefined || !host.isConnected) return;
    const ed = editor();
    const id = untrack(dd.selection);
    if (ed === undefined || id === null) return;
    leave(id);
    if (!dirty) showElement(ed, id, untrack(face));
  };

  const attachEditor = (el: HTMLDivElement): void => {
    host = el;
    editor()?.destroy();
    const id = untrack(dd.selection);
    const draft = id === null ? undefined : drafts.get(id);
    synced = untrack(face);
    dirty = draft !== undefined;
    setEditor(
      createHtmlEditor({
        parent: el,
        doc: draft?.text ?? synced,
        onDocChanged: handleDocChanged,
        onBlur: handleBlur,
      }),
    );
  };

  return (
    <div class={`${p}-panel`}>
      <style>{css(p)}</style>
      <Show
        when={selected()}
        fallback={
          <p class={`${p}-empty`}>Select an element to edit its HTML.</p>
        }
      >
        <div class={`${p}-editor`}>
          {/* data-dd-editable: keys typed in the CodeMirror view resolve
              in the router's editor scope. */}
          <div
            class={`${p}-editor-host`}
            data-dd-editable=""
            ref={attachEditor}
          />
        </div>
        <Show when={message()}>
          {(text) => (
            <p class={`${p}-message`} role="status">
              {text()}
            </p>
          )}
        </Show>
      </Show>
    </div>
  );
}
