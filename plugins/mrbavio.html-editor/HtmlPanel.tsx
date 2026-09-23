import {
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  Show,
  untrack,
} from "solid-js";

import type { DaydreamApi } from "@daydream/plugin-api";

import { createHtmlEditor, type HtmlEditorHandle } from "./htmlEditor";
import { rebase } from "./rebase";
import { classPrefix } from "./styles";

/** Text a save refused, held on screen and kept per page, so a refusal,
 * a page that changed underneath, another page's selection or a hidden
 * dock never loses what was typed. Panel memory, never the document. */
export interface Draft {
  text: string;
  /** Why it is not the page's: the refusal's sentence, or
   * CHANGED_UNDERNEATH. */
  problem: string;
  /** The page's html the typing started from. The next edit of the
   * draft is saved as the change from it, carried onto the page as it is
   * then when the page changed elsewhere (`rebase`). */
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
  /** ⌘Z while typing: what is pending is saved first, so core's undo
   * takes it with the edit burst it joins; text that was never saved (a
   * draft) is dropped instead and the page shown as it is — true then,
   * and the key goes no further. False otherwise, so the key falls
   * through to core's undo. Set by the panel once mounted. */
  undo: () => boolean;
  /** ⌘S while typing: what is pending is saved first, then a draft held
   * because the page changed where it was typed is saved over the page as
   * it is now. Never handles the key (false), so it goes on to core's
   * save. Set by the panel once mounted. */
  saveOver: () => boolean;
  /** By viewport id, of the document loaded when they were held: a
   * page id names a page of one document only, so another load (a page
   * of the same id in it, the same document reopened) must never show
   * them. `load` is `dd.loadVersion()` then. Read through `draftsNow`. */
  drafts: { load: number; pages: Map<string, Draft> };
}

/** The drafts held for the document loaded now: those of an earlier load
 * are dropped on the first read after it. */
export function draftsNow(state: PanelState): Map<string, Draft> {
  const load = untrack(state.dd.loadVersion);
  if (state.drafts.load !== load) state.drafts = { load, pages: new Map() };
  return state.drafts.pages;
}

/** Live save while typing, like the CSS editor's (~150ms). */
export const APPLY_DEBOUNCE_MS = 150;

/** The sentence for text typed where the page changed on the canvas
 * meanwhile (an agent, the CSS editor, a draft finalizing): nothing is
 * written, and the typed text is kept as the page's draft. Typing
 * elsewhere in the page is carried onto the change and saved. */
export const CHANGED_UNDERNEATH =
  "The page's HTML changed on the canvas where you were typing, so nothing was saved. Your text is kept here: ⌘S saves it over the page as it is now, and ⌘Z drops it.";

/** The sentence for a page gone from the canvas mid-save. */
const PAGE_GONE = "The page is no longer on the canvas.";

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
  const element = dd.pageElement(id);
  return element === null
    ? "unmounted"
    : { pageId: element.viewportId, elementId: id };
}

/** A page's stored markup, or null when it is not on the canvas. */
export function pageHtml(dd: DaydreamApi, pageId: string): string | null {
  const page = dd.core
    .viewportItems(dd.document())
    .find((item) => item.id === pageId);
  return page === undefined ? null : page.payload.html;
}

/** The kernel's refusal as the pane shows it: a sentence of its own. */
const sentence = (problem: string): string =>
  problem.charAt(0).toUpperCase() + problem.slice(1) + ".";

/** A save's verdict. Saved: `text` is what the page holds now — the
 * typed text, or the typing carried onto a page that changed elsewhere. */
type Saved = { ok: true; text: string } | { ok: false; problem: string };

/**
 * The HTML pane (decision #76): the page's `html` AS TEXT, the way the
 * file holds it, in CodeMirror — the page the selection is in, whatever
 * is selected in it. Nothing between the editor and the file turns the
 * page into a model and back: what is typed is what is stored.
 *
 * Saved LIVE, after a short debounce, through `dd.writePage`'s `html`
 * edit, whose verdict is the kernel's: it refuses, by name, whatever a
 * landing would take out of the text (a `<script>`, an `on*`, a url a
 * page cannot reach through, a `<style>`), and refuses a save over a page
 * whose html is no longer the one the editor showed. Every save is an
 * undo step, and saves in quick succession join one — the kernel's edit
 * burst, so a typing session is one undo step for as long as no pause
 * outlasts the burst.
 *
 * A REFUSED text is never lost: it stays on screen as the page's DRAFT
 * with the sentence under it, and comes back with the page when another
 * one was selected in between. Text typed over a page that changed on
 * the canvas meanwhile is saved as a change: the typing, from the text it
 * started from, carried onto the page as it is now when the other change
 * is elsewhere. Where the two meet it is kept as the draft instead, with
 * a note: nothing is written over the other change unless ⌘S, pressed in
 * the editor, asks for it, and ⌘Z drops it.
 *
 * Each save rewrites the markup, so the page REMOUNTS and its elements
 * get new ids; the canvas carries the selection by its place. The pane
 * and the canvas follow each other through the kernel's replay of the
 * mount: the SELECTED ELEMENT is marked where it was written
 * (`dd.pageSource`), and scrolled to when the selection moves while the
 * editor is not being typed in; the CARET, moved by the person in text
 * that is the page's as stored, selects the element it is in
 * (`dd.pageElementAt`). Neither echoes: the mark never moves a focused
 * caret, and only the person's own caret moves select.
 *
 * The editor text is rewritten on a page change, an undo or redo, a
 * blur, and whenever the page's html changes while nothing typed is
 * pending or held — a minimal span change, so the caret maps through.
 *
 * A factory, not a `<Component>`: the panel's `render` (index.tsx) calls
 * it under the dock's owner, and `state` is a plain object shared with
 * the entry — never a reactive props proxy.
 */
export default function createHtmlPanel(state: PanelState) {
  const { dd } = state;
  const drafts = (): Map<string, Draft> => draftsNow(state);
  const p = classPrefix(dd.plugin.id);

  // The selection's page and element. The page is read untracked: which
  // page an element is in holds for as long as it is selected. Two
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

  // Whether the editor holds text typed since the last save or refusal.
  // Only dirty text is saved: an untouched editor whose page moved under
  // it (an agent's edit) must never write it back.
  let dirty = false;
  // The page's html as the editor was last synced to it, last wrote it,
  // or holds its draft against. A page whose html is something else when
  // a save comes changed underneath, and the save is refused.
  let synced = "";
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const clearDebounce = (): void => {
    if (debounce !== null) {
      clearTimeout(debounce);
      debounce = null;
    }
  };

  const stored = (id: string): string | null => untrack(() => pageHtml(dd, id));

  /**
   * Save `text` as page `id`'s markup, unless it is what the page holds
   * already. A page that changed since the editor last synced gets the
   * typing — `synced` → `text` — carried onto it (`rebase`). Refused,
   * nothing written: the page is gone, it changed where the text was
   * typed, or the kernel refuses the text. Untracked: called from
   * the debounce, blur, a command and the disposal only.
   */
  const saveText = (id: string, text: string): Saved => {
    const current = stored(id);
    if (current === null) return { ok: false, problem: PAGE_GONE };
    if (current === text) return { ok: true, text };
    const base = synced;
    const next = current === base ? text : rebase(base, text, current);
    if (next === null) return { ok: false, problem: CHANGED_UNDERNEATH };
    return write(id, current, next, base);
  };

  /**
   * Write `next` over page `id`, whose html is `current`. `synced` is set
   * before the write: the page remounts inside it, and the sync effect may
   * run before it returns. A refusal puts it back to `base`, so the typing
   * stays a change from the text it started from.
   */
  const write = (
    id: string,
    current: string,
    next: string,
    base: string,
  ): Saved => {
    if (next === current) {
      synced = current;
      return { ok: true, text: current };
    }
    synced = next;
    const problem = dd.writePage({
      kind: "html",
      viewportId: id,
      expected: current,
      html: next,
    });
    if (problem === null) return { ok: true, text: next };
    synced = base;
    return { ok: false, problem: sentence(problem) };
  };

  /** The draft a refused save of `text` leaves, held against the text the
   * typing started from. */
  const draftOf = (text: string, refused: Saved): Draft => ({
    text,
    problem: refused.ok ? "" : refused.problem,
    base: synced,
  });

  /** Save the editor's dirty text to page `id` now. Saved: the text is
   * the page's. Refused or stale: it stays on screen, held as the page's
   * draft, the sentence under it. */
  const saveEditor = (id: string): void => {
    const ed = editor();
    if (ed === undefined || !dirty) return;
    const text = ed.text();
    dirty = false;
    settle(ed, id, text, saveText(id, text));
  };

  /** The editor after a save of `text`. Saved: the draft goes, and the
   * editor shows what the page holds — the typing carried onto another
   * change, maybe (a span change, so the caret maps through). Refused:
   * the text is held as the page's draft, the sentence under it. */
  const settle = (
    ed: HtmlEditorHandle,
    id: string,
    text: string,
    result: Saved,
  ): void => {
    if (!result.ok) {
      const draft = draftOf(text, result);
      drafts().set(id, draft);
      setMessage(draft.problem);
      return;
    }
    drafts().delete(id);
    setMessage(null);
    if (ed.text() !== result.text) ed.setText(result.text);
    mark(ed, false);
  };

  state.undo = (): boolean => {
    const ed = editor();
    const id = untrack(pageId);
    if (ed === undefined || id === null) return false;
    clearDebounce();
    saveEditor(id);
    if (!drafts().has(id)) return false;
    // Text the page never held: undoing it is dropping it.
    drafts().delete(id);
    showPage(ed, id, stored(id) ?? "");
    mark(ed, false);
    return true;
  };

  state.saveOver = (): boolean => {
    const ed = editor();
    const id = untrack(pageId);
    if (ed === undefined || id === null) return false;
    clearDebounce();
    saveEditor(id);
    const draft = drafts().get(id);
    const current = stored(id);
    if (draft?.problem !== CHANGED_UNDERNEATH || current === null) return false;
    // Asked for: the typed text over the page as it is now. The kernel's
    // verdict on the text still holds; a refusal keeps the draft.
    settle(ed, id, draft.text, write(id, current, draft.text, draft.base));
    return false;
  };

  /** Leave page `id`: save what is pending; a refusal is held as the
   * page's draft. */
  const leave = (id: string): void => {
    clearDebounce();
    saveEditor(id);
  };

  /** Show page `id`: its draft when it has one, else its text. */
  function showPage(ed: HtmlEditorHandle, id: string, text: string): void {
    const draft = drafts().get(id);
    dirty = false;
    synced = draft?.base ?? text;
    ed.setText(draft?.text ?? text);
    setMessage(draft?.problem ?? null);
  }

  /**
   * Mark the selected element's span in the text; `reveal` scrolls to it
   * unless the editor is being typed in. Only while the editor holds the
   * page's text as stored — the mount is of that text — otherwise the
   * last mark stays, mapped through the typing.
   */
  function mark(ed: HtmlEditorHandle, reveal: boolean): void {
    if (dirty) return;
    const t = untrack(target);
    const range =
      t === null || t.elementId === null || ed.text() !== synced
        ? null
        : dd.pageSource(t.elementId);
    ed.setMark(
      range === null || range.viewportId !== t?.pageId
        ? null
        : { from: range.start, to: range.end },
      reveal && !ed.hasFocus(),
    );
  }

  // The panel unmounting — the dock hidden (⌘\), the plugin unloading —
  // mid-edit: save what is pending the way blur would, after the disposal
  // has run (never a write inside it).
  onSettled(() => () => {
    clearDebounce();
    const ed = editor();
    const id = untrack(pageId);
    if (ed !== undefined && id !== null && dirty) {
      const text = ed.text();
      queueMicrotask(() => {
        const result = saveText(id, text);
        if (!result.ok) drafts().set(id, draftOf(text, result));
      });
    }
    ed?.destroy();
    setEditor(undefined);
  });

  // Store → editor sync. A forced re-sync happens on a page change (after
  // leaving the previous page), on blur (handleBlur) and on undo/redo —
  // even mid-focus — through historyVersion, which only undo, redo and a
  // load bump; a restore drops what was pending (the edit belonged to the
  // state just reverted) and keeps a draft (it was never part of any
  // state). Otherwise the text follows the page whenever nothing typed is
  // pending or held.
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
        } else if (!dirty && !drafts().has(page) && text !== synced) {
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

  // The person moved the caret: select the element it is in. Only over
  // the page's text as stored — the offsets are that text's — and never
  // for a place in no element (the doctype, a comment outside <html>),
  // which leaves the selection where it is.
  const handleCaret = (offset: number): void => {
    const ed = editor();
    const id = untrack(pageId);
    if (ed === undefined || id === null || dirty || !ed.hasFocus()) return;
    if (ed.text() !== synced || stored(id) !== synced) return;
    const element = dd.pageElementAt(id, offset);
    if (element !== null && element !== untrack(dd.selection)) {
      dd.select(element);
    }
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
    if (!drafts().has(id)) {
      showPage(ed, id, stored(id) ?? "");
      mark(ed, false);
    }
  };

  const attachEditor = (el: HTMLDivElement): void => {
    host = el;
    editor()?.destroy();
    const id = untrack(pageId);
    const text = id === null ? "" : (stored(id) ?? "");
    const draft = id === null ? undefined : drafts().get(id);
    synced = draft?.base ?? text;
    dirty = false;
    if (draft !== undefined) setMessage(draft.problem);
    const handle = createHtmlEditor({
      parent: el,
      doc: draft?.text ?? text,
      onDocChanged: handleDocChanged,
      onCaret: handleCaret,
      onBlur: handleBlur,
    });
    setEditor(handle);
    // The selected element's place is read after the render, never
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
