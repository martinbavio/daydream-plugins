// mrbavio.html-editor — the HTML pane as a plugin (decision #58): the
// page's markup AS TEXT (decision #76), the `html` the file holds, in
// CodeMirror — the page the selection is in, with the selected element's
// span marked, and the element the caret is in selected on the canvas.
// Saved live as you type through `dd.writePage`, whose verdict is the
// kernel's: what a landing would take out is refused by name, and so is
// a save over a page that changed underneath. With it, a person can
// change a page's structure — edit a headline, add an element, change a
// tag or an attribute — the way they would in a file. Delete and
// Backspace on an inner element remove that element alone, cut out of
// the text where it was written (core's own Delete removes the whole item
// when the page is selected; the `html`, `head` and `body` stay, since a
// page has them).
//
// NOT here, on purpose: in-place text editing on the canvas. Nor a
// resizer: the dock's width and the split between this pane and the CSS
// editor above it are the dock's own chrome (decision #59).
//
// Everything it knows about the app arrives through `dd`; the entry
// registers its three commands and the panel.

import type { DaydreamApi } from "@daydream/plugin-api";

import createHtmlPanel, { type Draft, type PanelState } from "./HtmlPanel";
import { classPrefix, css } from "./styles";

export const BLUR_COMMAND = "mrbavio.html-editor.blur";
export const UNDO_COMMAND = "mrbavio.html-editor.undo";
export const DELETE_COMMAND = "mrbavio.html-editor.delete-element";

/** The elements a page always has: selected, Delete leaves them. */
const SKELETON: ReadonlySet<string> = new Set(["html", "head", "body"]);

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
    drafts: new Map<string, Draft>(),
  };

  // The editor's key, a router command in EDITOR scope, applying only
  // while the editor has focus: Escape blurs it, which saves what is
  // pending through the editor's blur handler — unless the completion
  // popup is open, when the command steps aside (false) so CodeMirror's
  // own Escape closes it and the field stays focused. No apply key: the
  // pane saves as you type.
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
  // ⌘Z while typing: what is pending is saved first, so core's undo takes
  // it with the rest of its edit burst — the command declines and the key
  // reaches core's undo. Text the page never held (a refused draft) is
  // dropped instead, and the pane shows the page as it is.
  dd.registerCommand({
    id: UNDO_COMMAND,
    title: "Undo the typing",
    scope: "editor",
    when: editorFocused,
    run: () => state.undo(),
  });
  dd.bindShortcut(UNDO_COMMAND, "Mod+Z");

  // Delete / Backspace removes the selected INNER element of a page — the
  // kernel's `remove` edit, its span cut from where it was written — and
  // selects its parent. The `when` is exact: an element inside a page —
  // not the page itself, whose selection is item-level and core's
  // `core.delete-item` (which removes the item), and not the `html`,
  // `head` or `body`, which a page keeps — with no item selection, and
  // never while typing.
  const innerSelection = (): { id: string; parentId: string } | null => {
    const id = dd.selection();
    if (id === null || dd.itemSelection().length > 0) return null;
    const element = dd.pageElement(id);
    const node = dd.geometry.node(id);
    if (element === null || element.parentId === null) return null;
    if (node === undefined || SKELETON.has(node.localName)) return null;
    return { id, parentId: element.parentId };
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
      // The parent first, while its id is this mount's: the write
      // remounts the page, and the canvas carries the selection by its
      // place — the parent's is unchanged by the removal. A refusal puts
      // the selection back.
      dd.select(target.parentId);
      if (dd.writePage({ kind: "remove", elementId: target.id }) === null) {
        return;
      }
      dd.select(target.id);
      return false;
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
    // The panel's CSS, mounted by the kernel in the plugin layer
    // (decision #71) — never a <style> of the panel's own.
    styles: css(classPrefix(dd.plugin.id)),
    render: () => createHtmlPanel(state),
  });
}
