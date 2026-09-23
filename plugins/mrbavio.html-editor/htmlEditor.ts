/**
 * The HTML pane's CodeMirror 6 editor: HTML syntax colours and tag
 * completion from @codemirror/lang-html, bracket pairing, line wrapping,
 * and the selected element's span marked in the text. Framework-free and
 * imperative: HtmlPanel mounts it in a ref and owns every policy decision
 * (when to save, what to mark).
 *
 * Three boundaries, the first two the CSS editor's own:
 * - Store→editor writes go through setText, a minimal span change tagged
 *   with an annotation, so the caret maps through instead of being
 *   clobbered by a whole-string swap.
 * - Editor→panel notifications (onDocChanged) skip those tagged
 *   transactions — a sync must never read as an edit — and are
 *   microtask-deferred, because CodeMirror forbids dispatching from
 *   inside an update.
 * - The caret reaches the panel (onCaret) only when the person moved it
 *   — a click, an arrow key: CodeMirror's `select` user events — and
 *   once a frame, as the CSS editor's caret line does. A sync mapping it
 *   and a mark revealing it are no user event, so a canvas selection
 *   shown in the text never echoes back as a caret move.
 *
 * Deliberately absent: CodeMirror's history. The store's burst-based
 * history is the only undo model; the command router handles ⌘Z at
 * window capture phase, so CodeMirror never sees it. Escape (blur) is a
 * router command the plugin entry registers over this handle; this
 * module does not bind it, and drops defaultKeymap's own Escape so it
 * cannot be claimed inside the view.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { Annotation, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { diffSpan } from "./rebase";

export interface HtmlEditorOptions {
  parent: HTMLElement;
  doc: string;
  /** The document changed through an actual edit (typing, paste — never
   * a setText sync). Deferred to a microtask. */
  onDocChanged: () => void;
  /** The person moved the caret to `offset` (a click, a key — never a
   * sync or a mark). Deferred to the next frame, the last move of the
   * frame only. */
  onCaret: (offset: number) => void;
  /** The editor lost focus. */
  onBlur: () => void;
}

export interface HtmlEditorHandle {
  hasFocus: () => boolean;
  text: () => string;
  /** Sync the document to `text` via a minimal span change (no-op when
   * equal). The selection maps through; onDocChanged stays silent. */
  setText: (text: string) => void;
  /** Mark `range` of the text as the selected element's (null: none).
   * `reveal` scrolls it into view and puts the caret at its start — for a
   * selection made on the canvas, never under a caret being typed at. The
   * mark maps through edits until the next call. */
  setMark: (
    range: { from: number; to: number } | null,
    reveal: boolean,
  ) => void;
  /** Whether the completion popup is showing — CodeMirror's own Escape
   * closes it, so the panel's blur-on-Escape command steps aside then. */
  completionOpen: () => boolean;
  focus: () => void;
  blur: () => void;
  destroy: () => void;
}

/** Tags transactions produced by setText — store syncs, not user edits. */
const storeSync = Annotation.define<boolean>();

/** The selected element's span: set by setMark, mapped through edits. */
const setMarkEffect = StateEffect.define<{ from: number; to: number } | null>();
const selectedMark = Decoration.mark({ class: "cm-dd-selected-element" });
const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setMarkEffect)) continue;
      const range = effect.value;
      next =
        range === null || range.from >= range.to
          ? Decoration.none
          : Decoration.set([selectedMark.range(range.from, range.to)]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** defaultKeymap bindings the pane's model cannot honour: Escape is the
 * router's blur. */
const DROPPED_BINDINGS = new Set(["Escape"]);

// Quiet dark theme over the panel's --panel-* tokens (styles.ts defines
// them on the panel root; the editor inherits them as a descendant).
const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "11px",
      color: "var(--panel-text)",
      backgroundColor: "transparent",
    },
    ".cm-scroller": {
      fontFamily: "var(--panel-mono)",
      lineHeight: "16px",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "8px 0",
      caretColor: "var(--panel-bright)",
    },
    ".cm-line": { padding: "0 8px 0 6px" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--panel-bright)" },
    ".cm-selectionBackground": { backgroundColor: "var(--panel-chrome)" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "#2d3a49" },
    ".cm-activeLine": { backgroundColor: "#ffffff08" },
    ".cm-dd-selected-element": { backgroundColor: "#8fb4dc1a" },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "var(--panel-chrome)",
      outline: "none",
    },
    ".cm-tooltip": {
      backgroundColor: "#1c1c20",
      border: "1px solid var(--panel-chrome)",
      color: "var(--panel-text)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--panel-mono)",
      fontSize: "11px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--panel-chrome)",
      color: "var(--panel-bright)",
    },
  },
  { dark: true },
);

// Muted markup palette: tags cool, attribute names dim, values green,
// text in the panel's own grey — desaturated to sit beside the chrome.
const highlight = HighlightStyle.define([
  { tag: tags.tagName, color: "#8fb4dc" },
  { tag: tags.angleBracket, color: "var(--panel-dim)" },
  { tag: tags.attributeName, color: "#93b8a2" },
  { tag: tags.attributeValue, color: "#a3b88a" },
  { tag: tags.string, color: "#a3b88a" },
  { tag: tags.comment, color: "var(--panel-muted)" },
  { tag: tags.invalid, color: "var(--panel-amber)" },
]);

export function createHtmlEditor(options: HtmlEditorOptions): HtmlEditorHandle {
  let destroyed = false;
  let caretFrame: number | null = null;

  const view: EditorView = new EditorView({
    parent: options.parent,
    doc: options.doc,
    extensions: [
      html({ matchClosingTags: true, autoCloseTags: true }),
      syntaxHighlighting(highlight),
      autocompletion({ icons: false }),
      closeBrackets(),
      bracketMatching(),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      markField,
      theme,
      EditorView.contentAttributes.of({
        "aria-label": "HTML source",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const userEdit = update.transactions.some(
          (tr) => tr.docChanged && tr.annotation(storeSync) === undefined,
        );
        if (!userEdit) return;
        queueMicrotask(() => {
          if (!destroyed) options.onDocChanged();
        });
      }),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet) return;
        if (!update.transactions.some((tr) => tr.isUserEvent("select"))) {
          return;
        }
        const offset = update.state.selection.main.head;
        if (caretFrame !== null) cancelAnimationFrame(caretFrame);
        caretFrame = requestAnimationFrame(() => {
          caretFrame = null;
          if (!destroyed) options.onCaret(offset);
        });
      }),
      EditorView.domEventHandlers({
        blur: () => {
          if (!destroyed) options.onBlur();
        },
      }),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap.filter(
          (binding) => !DROPPED_BINDINGS.has(binding.key ?? ""),
        ),
        indentWithTab,
      ]),
    ],
  });

  return {
    // Not view.hasFocus, which also requires the WINDOW to be focused: a
    // caret-holding editor behind an unfocused window still counts, or
    // the sync effect would rewrite it under the caret.
    hasFocus: () => !destroyed && view.root.activeElement === view.contentDOM,
    text: () => view.state.doc.toString(),
    setText: (text) => {
      if (destroyed) return;
      const change = diffSpan(view.state.doc.toString(), text);
      if (change === null) return;
      view.dispatch({ changes: change, annotations: storeSync.of(true) });
    },
    setMark: (range, reveal) => {
      if (destroyed) return;
      const length = view.state.doc.length;
      const mark =
        range === null
          ? null
          : {
              from: Math.min(range.from, length),
              to: Math.min(range.to, length),
            };
      const revealed = reveal && mark !== null;
      view.dispatch({
        effects: revealed
          ? [
              setMarkEffect.of(mark),
              EditorView.scrollIntoView(mark.from, { y: "center" }),
            ]
          : setMarkEffect.of(mark),
        ...(revealed ? { selection: { anchor: mark.from } } : {}),
      });
    },
    completionOpen: () =>
      !destroyed && completionStatus(view.state) === "active",
    focus: () => {
      if (!destroyed) view.focus();
    },
    blur: () => {
      if (!destroyed) view.contentDOM.blur();
    },
    destroy: () => {
      destroyed = true;
      if (caretFrame !== null) cancelAnimationFrame(caretFrame);
      view.destroy();
    },
  };
}
