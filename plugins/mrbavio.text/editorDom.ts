/** Chromium's terminal placeholder is not part of the stored plain text. */
export function editableText(
  editor: HTMLElement,
  terminalSentinel: boolean,
): string {
  const text = editor.innerText;
  return terminalSentinel && text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function placeCaret(
  editor: HTMLElement,
  caret: "end" | { clientX: number; clientY: number },
  terminalSentinel = false,
): void {
  const selection = window.getSelection();
  if (selection === null) return;
  selection.removeAllRanges();
  if (caret !== "end") {
    const position = document.caretPositionFromPoint?.(
      caret.clientX,
      caret.clientY,
    );
    if (position != null && editor.contains(position.offsetNode)) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      selection.addRange(range);
      return;
    }
  }
  const range = document.createRange();
  if (terminalSentinel && editor.lastChild?.nodeType === Node.TEXT_NODE) {
    const tail = editor.lastChild;
    range.setStart(tail, Math.max(0, (tail.textContent?.length ?? 1) - 1));
  } else {
    range.selectNodeContents(editor);
  }
  range.collapse(false);
  selection.addRange(range);
}
