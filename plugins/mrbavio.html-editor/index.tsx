// mrbavio.html-editor — the HTML pane as a plugin (decisions.md #58): the
// selected element's subtree as source, STRUCTURE ONLY — tag, attributes,
// text, children; never a style, a class or an id — in CodeMirror, applied
// LIVE as you type through an item transaction that commits as one undo
// step when the editor is left, identities kept by
// content-tag-and-position matching (reconcile.ts). With it, a
// person can change a viewport's TREE: edit a headline, delete an
// element, add one, change a tag or an attribute — what only an agent
// could do before. Delete and Backspace on an inner element remove that
// element alone (core's own Delete removes the whole item when a root is
// selected; the body stays, since a page has one).
//
// NOT here, on purpose: in-place text editing on the canvas. The plugin
// API has no element double-click hook, and adding one is a kernel
// decision for a later task — the pane is where text is edited today.
// Nor a resizer: the dock's width and the split between this pane and the
// CSS editor above it are the dock's own chrome (decisions.md #59).
//
// Everything it knows about the app arrives through `dd`; the entry
// registers its three commands and the panel.

import type { DaydreamApi, ElementId } from "@daydream/plugin-api";

import { removeElement, type ViewportPayload } from "./edit";
import createHtmlPanel, { type Draft, type PanelState } from "./HtmlPanel";

export const BLUR_COMMAND = "mrbavio.html-editor.blur";
export const UNDO_COMMAND = "mrbavio.html-editor.undo";
export const DELETE_COMMAND = "mrbavio.html-editor.delete-element";

/** A key typed into a text field or a plugin's own editor: the router
 * already routes those to editor scope, so a canvas-scope command never
 * sees them; the check stays as the command's own promise. */
function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    target.closest("[data-dd-editable]") !== null
  );
}

export default function activate(dd: DaydreamApi): void {
  const state: PanelState = {
    dd,
    editor: undefined,
    undo: () => false,
    // Drafts outlive a panel mount: the dock unmounts its panels while
    // hidden (⌘\), and typed text must come back with it.
    drafts: new Map<ElementId, Draft>(),
  };

  // The editor's key, a router command in EDITOR scope, applying only
  // while the editor has focus: Escape blurs it, which commits the typing
  // session through the editor's blur handler — unless the completion
  // popup is open, when the command steps aside (false) so CodeMirror's
  // own Escape closes it and the field stays focused. No apply key: the
  // pane applies as you type.
  const editorFocused = (): boolean => state.editor?.hasFocus() === true;
  dd.registerCommand({
    id: BLUR_COMMAND,
    title: "Leave the HTML editor",
    scope: "editor",
    when: editorFocused,
    run: () => {
      const editor = state.editor;
      if (editor === undefined || editor.completionOpen()) return false;
      editor.blur();
    },
  });
  dd.bindShortcut(BLUR_COMMAND, "Escape");
  // ⌘Z while typing: the open session is one undo step, so undoing it
  // means cancelling it — the pane shows the element as it was. With no
  // session open the command declines and the key reaches core's undo.
  dd.registerCommand({
    id: UNDO_COMMAND,
    title: "Undo the typing session",
    scope: "editor",
    when: editorFocused,
    run: () => state.undo(),
  });
  dd.bindShortcut(UNDO_COMMAND, "Mod+Z");

  // Delete / Backspace removes the selected INNER element from its parent
  // — one undo step — and selects the parent. The `when` is exact: an
  // element below the skeleton — not a viewport root, whose selection is
  // item-level and core's `core.delete-item` (which removes the item),
  // and not the body, which a page keeps — with no item selection, and
  // never while typing.
  const innerSelection = (): { id: string; parentId: string } | null => {
    const id = dd.selection();
    if (id === null || dd.itemSelection().length > 0) return null;
    const doc = dd.document();
    const parent = dd.core.findParent(doc, id);
    if (parent === undefined) return null;
    if (dd.core.findParent(doc, parent.id) === undefined) return null;
    return { id, parentId: parent.id };
  };
  dd.registerCommand({
    id: DELETE_COMMAND,
    title: "Delete the element",
    scope: "canvas",
    when: (ctx) =>
      !isEditableTarget(ctx.event?.target) && innerSelection() !== null,
    run: () => {
      const target = innerSelection();
      if (target === null) return false;
      const viewport = dd.core.findViewport(dd.document(), target.id);
      if (viewport === undefined) return false;
      dd.updateItem(viewport.id, (item) => {
        removeElement(item.payload as ViewportPayload, target.id);
      });
      state.drafts.delete(target.id);
      dd.select(target.parentId);
    },
  });
  dd.bindShortcut(DELETE_COMMAND, "Delete");
  dd.bindShortcut(DELETE_COMMAND, "Backspace");

  dd.registerPanel({
    id: "html-editor",
    title: "HTML",
    ariaLabel: "HTML editor",
    // A third of the dock's spare height by default, under the CSS
    // editor's two thirds; the dock's divider moves the split.
    grow: 1,
    render: () => createHtmlPanel(state),
  });
}
