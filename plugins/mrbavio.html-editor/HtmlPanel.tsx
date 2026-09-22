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
  ItemTransaction,
  PagePayload,
} from "@daydream/plugin-api";

import { markupProblem } from "./guard";
import { createHtmlEditor, type HtmlEditorHandle } from "./htmlEditor";
import { pageSource, storedElement, type PageSource } from "./pageSource";
import { classPrefix } from "./styles";

/** Text a save refused when the pane had to let go of its page: kept per
 * page so a refusal, another page's selection or a hidden dock never
 * loses what was typed. Panel memory, never the document. */
export interface Draft {
  text: string;
  /** The refusal's sentence. */
  problem: string;
  /** The page's html the text was typed against: a draft of a page that
   * changed since is refused as stale when it is saved. */
  base: string;
}

/** What the entry (index.tsx) shares with the panel: the API, the live
 * editor handle its Escape command acts on, and the drafts that outlive a
 * panel mount (the dock unmounts its panels while hidden). */
export interface PanelState {
  dd: DaydreamApi;
  /** The CodeMirror handle while a page is shown; written here, read by
   * the entry's Escape and ⌘Z commands. */
  editor: HtmlEditorHandle | undefined;
  /** ⌘Z while typing: cancel the open session — the whole of it, it being
   * one undo step — and show the page as it was. False when no session
   * is open, so the key falls through to core's undo. Set by the panel
   * once mounted. */
  undo: () => boolean;
  /** By viewport id. */
  drafts: Map<string, Draft>;
}

/** Live save while typing, like the CSS editor's (~150ms). */
export const APPLY_DEBOUNCE_MS = 150;

/** The sentence for text typed over a page that changed on the canvas
 * meanwhile (an agent, the CSS editor, a draft finalizing): nothing is
 * written, and the page's own text is shown again. */
export const CHANGED_UNDERNEATH =
  "The page's HTML changed on the canvas while you were editing; nothing was saved, and it is shown again.";

/** What the selection points at: the page it is in, and the element
 * (null when the page itself is selected). */
export interface Target {
  pageId: string;
  elementId: string | null;
}

/** The page and element `id` selects; null for nothing or an item that
 * is not a page; "unmounted" for an id that names no item and no mounted
 * element — one from an earlier mount of a page, which an undo over a
 * markup change restores (a page element's id is minted at mount). */
export function targetOf(
  dd: DaydreamApi,
  id: string | null,
): Target | null | "unmounted" {
  if (id === null) return null;
  const item = dd.items().find((candidate) => candidate.id === id);
  if (item !== undefined) {
    return item.kind === "daydream.viewport"
      ? { pageId: id, elementId: null }
      : null;
  }
  const stack = dd.pageStack(id);
  return stack === null
    ? "unmounted"
    : { pageId: stack.viewportId, elementId: id };
}

/** A page's stored markup, or null when it is not on the canvas. */
export function pageHtml(dd: DaydreamApi, pageId: string): string | null {
  const page = dd.core
    .viewportItems(dd.document())
    .find((item) => item.id === pageId);
  return page === undefined ? null : page.payload.html;
}

type Saved = { ok: true } | { ok: false; problem: string; stale: boolean };

/**
 * The HTML pane (decision #76): the page's `html` AS TEXT, the way the
 * file holds it, in CodeMirror — the page the selection is in, whatever
 * is selected in it. Nothing between the editor and the file turns the
 * page into a model and back: what is typed is what is stored.
 *
 * Saved LIVE, after a short debounce, into an item transaction, so the
 * whole typing session is ONE undo step, committed when the editor is
 * left: blur, Escape, another page selected, the dock hiding. Every save
 * is GUARDED — what a page can never hold (guard.ts) is refused with a
 * sentence and nothing written — and REFUSED WHEN STALE: text typed over
 * a page whose html changed since the editor showed it is never written,
 * and the page's own text is shown again. Text refused when the pane lets
 * go of its page waits as that page's draft and comes back with it.
 *
 * Each save rewrites the markup, so the page REMOUNTS and its elements
 * get new ids; the canvas carries the selection by its place. The pane
 * follows the SELECTED ELEMENT into the text: its span is marked, and
 * scrolled into view when the selection moves while the editor is not
 * being typed in (pageSource.ts maps the mounted element to where it was
 * written).
 *
 * The editor text is rewritten on a page change, an undo or redo, a
 * blur, and whenever the page's html changes while nothing typed is
 * pending — a minimal span change, so the caret maps through.
 *
 * A factory, not a `<Component>`: the panel's `render` (index.tsx) calls
 * it under the dock's owner, and `state` is a plain object shared with
 * the entry — never a reactive props proxy.
 */
export default function createHtmlPanel(state: PanelState) {
  const { dd, drafts } = state;
  const p = classPrefix(dd.plugin.id);

  // The selection's page and element. The page's stack is read untracked:
  // which page an element is in holds for as long as it is selected. Two
  // selections keep the page last shown, while it is on the canvas: one
  // naming no mounted element — an undo over a markup change restores an
  // id from an earlier mount — asked again at every geometry change,
  // which a mount is; and nothing, while the editor holds the caret — the
  // kernel pruning that dangling id on the next write, never a gesture,
  // since a click anywhere else takes the caret first.
  let resolved: Target | null = null;
  const holdingCaret = (): boolean => state.editor?.hasFocus() === true;
  const target = createMemo<Target | null>(() => {
    const id = dd.selection();
    const read = untrack(() => targetOf(dd, id));
    const keep = read === "unmounted" || (id === null && untrack(holdingCaret));
    if (!keep) {
      resolved = read;
      return read;
    }
    if (id !== null) dd.geometry.version();
    const kept = resolved;
    if (kept === null || untrack(() => pageHtml(dd, kept.pageId)) === null) {
      return null;
    }
    // The same object while nothing changes, so a pan does not re-run
    // the sync.
    if (kept.elementId !== id)
      resolved = { pageId: kept.pageId, elementId: id };
    return resolved;
  });
  const pageId = createMemo(() => target()?.pageId ?? null);
  // The page's stored markup; tracks the field, so an outside write re-runs
  // the sync effect.
  const html = createMemo<string | null>(() => {
    const id = pageId();
    return id === null ? null : pageHtml(dd, id);
  });

  // A refusal, shown under the editor until the next save or page.
  const [message, setMessage] = createSignal<string | null>(null);

  const editor = (): HtmlEditorHandle | undefined => state.editor;
  const setEditor = (handle: HtmlEditorHandle | undefined): void => {
    state.editor = handle;
  };
  let host: HTMLDivElement | undefined;

  // Whether the editor holds text not yet saved. Only dirty text is
  // saved: an untouched editor whose page moved under it (an agent's
  // edit) must never write it back.
  let dirty = false;
  // The page's html as the editor was last synced to it or last wrote
  // it. A page whose html is something else when a save comes changed
  // underneath, and the save is refused.
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

  const stored = (id: string): string | null => untrack(() => pageHtml(dd, id));

  // The last text read for its elements' places: a mark follows every
  // selection, and the text changes far less often.
  let source: PageSource | null = null;
  const sourceOf = (text: string): PageSource => {
    if (source?.html !== text) source = pageSource(text);
    return source;
  };

  const openSession = (): ItemTransaction =>
    dd.beginItemTransaction({
      onInterrupted: () => {
        session = null;
      },
    });

  /**
   * Save `text` as page `id`'s markup, into the session (opened on the
   * first write) — unless it is what the page holds already. Refused,
   * nothing written: the page is gone, it changed since the editor last
   * synced (stale), the guard refuses the text, or the kernel's
   * validation does. Untracked: called from the debounce, blur, the sync
   * effect's apply phase and the disposal only.
   */
  const saveText = (id: string, text: string): Saved => {
    const current = stored(id);
    if (current === null) {
      return {
        ok: false,
        problem: "The page is no longer on the canvas.",
        stale: false,
      };
    }
    if (current === text) return { ok: true };
    if (current !== synced) {
      return { ok: false, problem: CHANGED_UNDERNEATH, stale: true };
    }
    const problem = markupProblem(text);
    if (problem !== null) return { ok: false, problem, stale: false };
    const write = (item: { payload: unknown }): void => {
      (item.payload as PagePayload).html = text;
    };
    // What the write makes the page hold, set first: the page remounts
    // inside the write, and the sync effect may run before it returns.
    const before = { synced, dirty };
    synced = text;
    dirty = false;
    try {
      session ??= openSession();
      if (!session.update(id, write)) {
        // The kernel ended the session between two edits: start another.
        session = openSession();
        session.update(id, write);
      }
    } catch (error) {
      ({ synced, dirty } = before);
      return {
        ok: false,
        problem: error instanceof Error ? error.message : String(error),
        stale: false,
      };
    }
    return { ok: true };
  };

  /** Save the editor's dirty text to page `id` now. Saved: the text is
   * the page's. Refused: the sentence under it, the text kept. Stale:
   * the sentence, and the page's own text shown again. */
  const saveEditor = (id: string): Saved => {
    const ed = editor();
    if (ed === undefined || !dirty) return { ok: true };
    const text = ed.text();
    const result = saveText(id, text);
    if (result.ok) {
      synced = text;
      dirty = false;
      setMessage(null);
      mark(ed, false);
    } else if (result.stale) {
      drafts.delete(id);
      synced = stored(id) ?? "";
      dirty = false;
      ed.setText(synced);
      setMessage(result.problem);
      mark(ed, false);
    } else {
      setMessage(result.problem);
    }
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

  /** Leave page `id`: save what is pending, commit the session, and keep
   * what was refused as the page's draft. */
  const leave = (id: string): void => {
    clearDebounce();
    const ed = editor();
    const result = saveEditor(id);
    if (!result.ok && !result.stale && ed !== undefined) {
      drafts.set(id, {
        text: ed.text(),
        problem: result.problem,
        base: synced,
      });
    } else {
      drafts.delete(id);
    }
    session?.commit();
    session = null;
  };

  /** Show page `id`: its draft when it has one, else its text. */
  const showPage = (ed: HtmlEditorHandle, id: string, text: string): void => {
    const draft = drafts.get(id);
    if (draft === undefined) {
      synced = text;
      ed.setText(text);
      dirty = false;
      setMessage(null);
    } else {
      synced = draft.base;
      ed.setText(draft.text);
      dirty = true;
      setMessage(draft.problem);
    }
  };

  /**
   * Mark the selected element's span in the text; `reveal` scrolls to it
   * unless the editor is being typed in. Only while the editor holds the
   * page's text as stored — the mount is of that text — otherwise the
   * last mark stays, mapped through the typing.
   */
  function mark(ed: HtmlEditorHandle, reveal: boolean): void {
    if (dirty) return;
    const t = untrack(target);
    const node =
      t === null || t.elementId === null
        ? undefined
        : dd.geometry.node(t.elementId);
    if (node === undefined || ed.text() !== synced) {
      ed.setMark(null, false);
      return;
    }
    const read = sourceOf(synced);
    const el = storedElement(read.parsed, node);
    const range = el === null ? null : read.rangeOf(el);
    ed.setMark(
      range === null ? null : { from: range.start, to: range.end },
      reveal && !ed.hasFocus(),
    );
  }

  // The panel unmounting — the dock hidden (⌘\), the plugin unloading —
  // mid-session: leave the page the way blur would, after the disposal
  // has run (never a write inside it).
  onSettled(() => () => {
    clearDebounce();
    const ed = editor();
    const id = untrack(pageId);
    if (ed !== undefined && id !== null && (dirty || session !== null)) {
      const text = ed.text();
      const pending = dirty;
      queueMicrotask(() => {
        if (pending) {
          const result = saveText(id, text);
          if (!result.ok && !result.stale) {
            drafts.set(id, { text, problem: result.problem, base: synced });
          }
        }
        session?.commit();
        session = null;
      });
    }
    ed?.destroy();
    setEditor(undefined);
  });

  // Store → editor sync. A forced re-sync happens on a page change (after
  // leaving the previous page), on blur (handleBlur) and on undo/redo —
  // even mid-focus — through historyVersion, which only undo, redo and a
  // load bump; a restore drops what was typed (the edit belonged to the
  // state just reverted; the kernel ended the session) and keeps a
  // refused draft (it was never part of any state). Otherwise the text
  // follows the page whenever nothing typed is pending.
  let lastPage: string | null | undefined;
  let lastElement: string | null | undefined;
  let lastHistory: number | undefined;

  createEffect(
    () => ({
      t: target(),
      text: html(),
      history: dd.historyVersion(),
    }),
    ({ t, text, history }) => {
      const page = t?.pageId ?? null;
      const element = t?.elementId ?? null;
      const pageChanged = lastPage !== undefined && page !== lastPage;
      const selectionChanged = element !== lastElement;
      const restored = lastHistory !== undefined && history !== lastHistory;
      const previous = lastPage;
      lastPage = page;
      lastElement = element;
      lastHistory = history;

      untrack(() => {
        const ed = editor();
        if (restored) {
          clearDebounce();
          session = null;
          dirty = false;
        } else if (pageChanged && previous) {
          leave(previous);
        }
        if (page === null || text === null) {
          ed?.destroy();
          setEditor(undefined);
          setMessage(null);
          return;
        }
        if (ed === undefined) return;
        if (restored || pageChanged) {
          showPage(ed, page, text);
        } else if (!dirty && text !== synced) {
          synced = text;
          ed.setText(text);
        }
        mark(ed, selectionChanged || pageChanged || restored);
      });
    },
  );

  // A real edit: save after the debounce, to the page the text belonged
  // to — a flush after another page was selected is dropped, the page
  // change having already left this one.
  const handleDocChanged = (): void => {
    dirty = true;
    const id = untrack(pageId);
    if (id === null) return;
    clearDebounce();
    debounce = setTimeout(() => {
      debounce = null;
      if (untrack(pageId) !== id) return;
      saveEditor(id);
    }, APPLY_DEBOUNCE_MS);
  };

  const handleBlur = (): void => {
    // A blur the <Show> fires while unmounting the editor (the page was
    // removed, or the selection cleared) is not a gesture: the page-change
    // path and the disposal above already have it.
    if (host === undefined || !host.isConnected) return;
    const ed = editor();
    const id = untrack(pageId);
    if (ed === undefined || id === null) return;
    leave(id);
    if (!dirty) {
      showPage(ed, id, stored(id) ?? "");
      mark(ed, false);
    }
  };

  const attachEditor = (el: HTMLDivElement): void => {
    host = el;
    editor()?.destroy();
    const id = untrack(pageId);
    const text = id === null ? "" : (stored(id) ?? "");
    const draft = id === null ? undefined : drafts.get(id);
    synced = draft?.base ?? text;
    dirty = draft !== undefined;
    if (draft !== undefined) setMessage(draft.problem);
    const handle = createHtmlEditor({
      parent: el,
      doc: draft?.text ?? text,
      onDocChanged: handleDocChanged,
      onBlur: handleBlur,
    });
    setEditor(handle);
    // The selected element's node is read after the render, never
    // inside it (decision #33).
    queueMicrotask(() => {
      if (editor() === handle) mark(handle, true);
    });
  };

  return (
    <div class={`${p}-panel`}>
      <Show
        when={html() !== null}
        fallback={
          <p class={`${p}-empty`}>
            Select a page, or an element in one, to edit its HTML.
          </p>
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
