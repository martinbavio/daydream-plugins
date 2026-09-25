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

/** What a draft holds of the typing. */
interface Typed {
  text: string;
  /** The page's html the typing started from. The next edit of the
   * draft is saved as the change from it, carried onto the page as it is
   * then when the page changed elsewhere (`rebase`). */
  base: string;
}

/** Text a save did not write, held on screen and kept per page, so a
 * refusal, a page that changed underneath, another page's selection or a
 * hidden dock never loses what was typed. Panel memory, never the
 * document. `kind` is what ⌘S goes by: a HELD draft was typed over a page
 * that moved — it changed where the text was typed, or it left the
 * canvas — and ⌘S saves it over the page as it is now; a REFUSED one is
 * text the kernel refused, kept until it is corrected or dropped. A held
 * draft's sentence is read when it is shown (`draftMessage`), from the
 * page as it is then. */
export type Draft =
  | (Typed & { kind: "held" })
  | (Typed & { kind: "refused"; message: string });

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
  /** ⇧⌘Z while typing: right after ⌘Z dropped a draft, with nothing
   * typed or undone since, the draft comes back — true, and the key goes
   * no further. Otherwise what is pending is saved first, never dropped
   * by the restore — a new edit, so core's redo then finds nothing to
   * redo — and the key goes on to core's redo (false). Set by the panel
   * once mounted. */
  redo: () => boolean;
  /** ⌘S while typing: what is pending is saved first, then a held draft
   * is saved over the page as it is now. Never handles the key (false),
   * so it goes on to core's save. Set by the panel once mounted. */
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

/** The sentence for a held draft whose page is back as the typing found
 * it: the page left the canvas mid-save and an undo or a redo brought it
 * back, or the change made under the typing was undone. */
export const PAGE_BACK =
  "The page left the canvas, or changed on it, while you were typing, so nothing was saved; it is back as your typing found it. Your text is kept here: ⌘S saves it over the page, and ⌘Z drops it.";

/** The sentence under a draft, read against the page's html `current`:
 * a refusal's own; for a held draft, whether the page is back as the
 * typing found it (its `base`) or still changed where the text was
 * typed. */
export function draftMessage(draft: Draft, current: string | null): string {
  if (draft.kind === "refused") return draft.message;
  return current === draft.base ? PAGE_BACK : CHANGED_UNDERNEATH;
}

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
 * typed text, or the typing carried onto a page that changed elsewhere.
 * Not saved: held (the page moved) or refused (the kernel's sentence). */
type Saved =
  | { ok: true; text: string }
  | { ok: false; kind: "held" }
  | { ok: false; kind: "refused"; message: string };

/** The selection resolved (`target`), and the target it last resolved to
 * (`last`): what a selection naming no mounted element, or none while
 * the editor holds the caret, keeps showing. */
interface Resolution {
  target: Target | null;
  last: Target | null;
}

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
 * is elsewhere. Where the two meet it is HELD as the draft instead, with
 * a note: nothing is written over the other change unless ⌘S, pressed in
 * the editor, asks for it. ⌘Z drops a draft, and ⇧⌘Z straight after
 * brings it back — the editor keeps no history of its own, so a draft
 * is everything typed since the last save.
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
  // selections keep the page last resolved, while it is on the canvas —
  // carried in the memo's own value (`last`), never beside it: one
  // naming no mounted element — an undo over a markup change restores an
  // id from an earlier mount — asked again at every geometry change,
  // which a mount is; and nothing, while the editor holds the caret — the
  // kernel pruning that dangling id on the next write, never a gesture,
  // since a click anywhere else takes the caret first.
  const holdingCaret = (): boolean => state.editor?.hasFocus() === true;
  const resolution = createMemo<Resolution>((previous) => {
    const last = previous?.last ?? null;
    const id = dd.selection();
    const read = untrack(() => targetOf(dd, id));
    const keep = read === "unmounted" || (id === null && untrack(holdingCaret));
    if (!keep) return { target: read, last: read };
    if (id !== null) dd.geometry.version();
    if (last === null || untrack(() => pageHtml(dd, last.pageId)) === null) {
      return { target: null, last };
    }
    // The same object while nothing changes, so a pan does not re-run
    // what follows the target.
    const kept =
      last.elementId === id ? last : { pageId: last.pageId, elementId: id };
    return { target: kept, last: kept };
  });
  const target = createMemo(() => resolution().target);
  const pageId = createMemo(() => target()?.pageId ?? null);
  // The page's stored markup; tracks the field, so an outside write
  // reaches the editor.
  const html = createMemo<string | null>(() => {
    const id = pageId();
    return id === null ? null : pageHtml(dd, id);
  });
  // The page the editor is open on: the selection's, while it is on the
  // canvas.
  const openPage = createMemo(() => (html() === null ? null : pageId()));

  // A draft's sentence, shown under the editor until the next save or
  // page.
  const [message, setMessage] = createSignal<string | null>(null);

  const editor = (): HtmlEditorHandle | undefined => state.editor;
  const setEditor = (handle: HtmlEditorHandle | undefined): void => {
    state.editor = handle;
  };
  let host: HTMLDivElement | undefined;

  // The page whose text the editor holds (showPage), null with no editor:
  // what is typed belongs to it, whatever is selected by the time it is
  // saved.
  let shown: string | null = null;
  // Whether the editor holds text typed since the last save or refusal.
  // Only dirty text is saved: an untouched editor whose page moved under
  // it (an agent's edit) must never write it back.
  let dirty = false;
  // The page's html as the editor was last synced to it, last wrote it,
  // or holds its draft against. A page whose html is something else when
  // a save comes changed underneath, and the save is refused.
  let synced = "";
  // `dd.historyVersion()` when the editor was last shown its page: typing
  // pending across an undo, a redo or a load belongs to the state they
  // reverted, and is dropped, never saved.
  let syncedHistory = -1;
  // The text a write of the editor's is putting on the page, while it
  // runs (write): the page's html is that before `synced` is.
  let writing: string | null = null;
  // The draft ⌘Z last dropped, for ⇧⌘Z to bring back: cleared by typing,
  // by any other ⌘Z or ⇧⌘Z, and by an undo, a redo or a load.
  let dropped: { id: string; load: number; draft: Draft } | null = null;
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
   * typing — `synced` → `text` — carried onto it (`rebase`). Not saved,
   * nothing written: held when the page is gone or changed where the text
   * was typed, refused when the kernel refuses the text. Untracked: called
   * from the debounce, blur, a command and the disposal only.
   */
  const saveText = (id: string, text: string): Saved => {
    const current = stored(id);
    if (current === null) return { ok: false, kind: "held" };
    const base = synced;
    // Text that is the page's already comes back as the page's: written as
    // nothing, but synced, so the typing that follows starts from it.
    const next = rebase(base, text, current);
    if (next === null) return { ok: false, kind: "held" };
    return write(id, current, next, base);
  };

  /**
   * Write `next` over page `id`, whose html is `current`. `synced` is
   * set to it only once the write has landed; while it runs, `writing`
   * names it: the page remounts inside the write, and what follows the
   * page's html may run before it returns — it must take the page's new
   * text for the editor's own, not an outside change. A refusal, or a
   * write that throws, sets it to `base`, so the typing stays a change
   * from the text it started from and is kept as a draft, never lost.
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
    let problem: string | null;
    writing = next;
    try {
      problem = dd.writePage({
        kind: "html",
        viewportId: id,
        expected: current,
        html: next,
      });
    } catch (error) {
      problem = `the page could not be saved: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      writing = null;
    }
    if (problem !== null) {
      synced = base;
      return { ok: false, kind: "refused", message: sentence(problem) };
    }
    synced = next;
    return { ok: true, text: next };
  };

  /** The draft a save of `text` that did not write leaves, held against
   * the text the typing started from. */
  const draftOf = (
    text: string,
    unsaved: Exclude<Saved, { ok: true }>,
  ): Draft =>
    unsaved.kind === "held"
      ? { kind: "held", text, base: synced }
      : { kind: "refused", text, base: synced, message: unsaved.message };

  /** Save the editor's dirty text to page `id` now. Saved: the text is
   * the page's. Not saved: it stays on screen, held as the page's draft,
   * the sentence under it. Typed before an undo, a redo or a load
   * re-showed the page: dropped, as the restore drops it. */
  const saveEditor = (id: string): void => {
    const ed = editor();
    if (ed === undefined || !dirty) return;
    dirty = false;
    if (untrack(dd.historyVersion) !== syncedHistory) return;
    const text = ed.text();
    settle(ed, id, text, saveText(id, text));
  };

  /** The editor after a save of `text`. Saved: the draft goes, and the
   * editor shows what the page holds — the typing carried onto another
   * change, maybe (a span change, so the caret maps through). Not saved:
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
      setMessage(draftMessage(draft, stored(id)));
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
    const draft = drafts().get(id);
    if (draft === undefined) {
      dropped = null;
      return false;
    }
    // Text the page never held: undoing it is dropping it — all of it,
    // everything typed since the last save, so it is kept for ⇧⌘Z.
    drafts().delete(id);
    dropped = { id, load: untrack(dd.loadVersion), draft };
    showPage(ed, id);
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
    if (draft?.kind !== "held" || current === null) return false;
    // Asked for: the typed text over the page as it is now. The kernel's
    // verdict on the text still holds; a refusal keeps the draft.
    settle(ed, id, draft.text, write(id, current, draft.text, draft.base));
    return false;
  };

  state.redo = (): boolean => {
    const ed = editor();
    const id = untrack(pageId);
    if (id === null) return false;
    leave(id);
    const back = dropped;
    dropped = null;
    if (
      ed === undefined ||
      back === null ||
      back.id !== id ||
      back.load !== untrack(dd.loadVersion) ||
      drafts().has(id)
    ) {
      return false;
    }
    // The ⌘Z that dropped it, undone: the draft is back, its sentence
    // read against the page as it is now.
    drafts().set(id, back.draft);
    showPage(ed, id);
    mark(ed, false);
    return true;
  };

  /** Leave page `id`: save what is pending; one not saved is held as the
   * page's draft. */
  const leave = (id: string): void => {
    clearDebounce();
    saveEditor(id);
  };

  /** Page `id`'s draft, unless the page holds a held draft's text now —
   * it came back with it, or it was written there meanwhile: then there
   * is nothing to keep, and the draft goes. */
  const draftOn = (id: string): Draft | undefined => {
    const draft = drafts().get(id);
    if (draft?.kind === "held" && stored(id) === draft.text) {
      drafts().delete(id);
      return undefined;
    }
    return draft;
  };

  /** Show page `id` in the editor, nothing typed pending: its draft with
   * its sentence when it has one, else its text as stored. */
  function showPage(ed: HtmlEditorHandle, id: string): void {
    const draft = draftOn(id);
    const text = stored(id) ?? "";
    dirty = false;
    shown = id;
    synced = draft?.base ?? text;
    syncedHistory = untrack(dd.historyVersion);
    ed.setText(draft?.text ?? text);
    setMessage(draft === undefined ? null : draftMessage(draft, stored(id)));
  }

  /**
   * Mark the selected element's span in the text; `reveal` scrolls to it
   * unless the editor is being typed in. Only while the editor holds the
   * selected page's text as stored — the mount is of that text —
   * otherwise the last mark stays, mapped through the typing.
   */
  function mark(ed: HtmlEditorHandle, reveal: boolean): void {
    if (dirty) return;
    const t = untrack(target);
    const range =
      t === null ||
      t.elementId === null ||
      t.pageId !== shown ||
      ed.text() !== synced
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
  // has run (never a write inside it). Only into the state the typing
  // belongs to: a load or an undo, a redo, before the save runs — the
  // same document reopened, a page of the same id — drops it, as the
  // restore drops what is pending while the panel is up.
  onSettled(() => () => {
    clearDebounce();
    const ed = editor();
    const id = shown;
    const load = untrack(dd.loadVersion);
    const history = untrack(dd.historyVersion);
    if (ed !== undefined && id !== null && dirty && history === syncedHistory) {
      const text = ed.text();
      queueMicrotask(() => {
        if (untrack(dd.loadVersion) !== load || untrack(dd.historyVersion) !== history) return;
        const result = saveText(id, text);
        if (!result.ok) drafts().set(id, draftOf(text, result));
      });
    }
    ed?.destroy();
    setEditor(undefined);
    shown = null;
  });

  // Store → editor sync, in four parts, each reading `shown` rather than
  // the order they run in.
  //
  // The page the editor is open on. Another one: what was typed in the
  // page left is saved to it (or held as its draft), then the new one is
  // shown. None: the editor goes. A page the editor already shows — the
  // first run, the editor just mounted (attachEditor) — is left as it is.
  createEffect(
    () => openPage(),
    (page) => {
      untrack(() => {
        if (shown !== null && shown !== page) leave(shown);
        const ed = editor();
        if (page === null) {
          ed?.destroy();
          setEditor(undefined);
          shown = null;
          setMessage(null);
          return;
        }
        if (ed === undefined || shown === page) return;
        showPage(ed, page);
        mark(ed, true);
      });
    },
  );

  // An undo, a redo or a load — historyVersion, which only they bump —
  // re-shows the page, even mid-focus: what was pending is dropped (the
  // edit belonged to the state just reverted) and a draft is kept (it was
  // never part of any state), read against the page restored.
  createEffect(
    () => dd.historyVersion(),
    (_version, previous) => {
      if (previous === undefined) return;
      untrack(() => {
        clearDebounce();
        dirty = false;
        dropped = null;
        const ed = editor();
        const page = openPage();
        if (ed === undefined || page === null || page !== shown) return;
        showPage(ed, page);
        mark(ed, true);
      });
    },
  );

  // The page's html changed: the editor follows it while nothing typed
  // is pending or held — an agent's edit, the CSS editor's — and the mark
  // is read again either way, since a save remounts the page.
  createEffect(
    () => html(),
    (text) => {
      untrack(() => {
        const ed = editor();
        const page = openPage();
        if (ed === undefined || text === null || page === null) return;
        if (page !== shown) return;
        if (!dirty && !drafts().has(page) && text !== synced && text !== writing) {
          showPage(ed, page);
        }
        mark(ed, false);
      });
    },
  );

  // The selection moved: its element is marked, and scrolled to unless
  // the editor is being typed in.
  createEffect(
    () => target(),
    () => {
      untrack(() => {
        const ed = editor();
        if (ed !== undefined) mark(ed, true);
      });
    },
  );

  // A real edit: save after the debounce, to the page the text belonged
  // to — a flush after another page was selected is dropped, the page
  // change having already left this one.
  const handleDocChanged = (): void => {
    dirty = true;
    dropped = null;
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
      showPage(ed, id);
      mark(ed, false);
    }
  };

  const attachEditor = (el: HTMLDivElement): void => {
    host = el;
    editor()?.destroy();
    const handle = createHtmlEditor({
      parent: el,
      doc: "",
      onDocChanged: handleDocChanged,
      onCaret: handleCaret,
      onBlur: handleBlur,
    });
    setEditor(handle);
    const id = untrack(openPage);
    if (id !== null) showPage(handle, id);
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
