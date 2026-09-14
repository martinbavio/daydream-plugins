/**
 * Minimal formatter for `meta.notes` strings — the markdown-ish subset the
 * dream-author convention actually uses: paragraphs separated by blank
 * lines, numbered lists ("1. …" lines with hard-wrapped continuations), and
 * **bold** spans (handled at render time, see boldSegments). No dependency,
 * no HTML parsing — pure string → block structure.
 */

export type NotesBlock =
  { type: "paragraph"; text: string } | { type: "list"; items: string[] };

const LIST_ITEM = /^\d+\.\s+/;

/** Join hard-wrapped source lines back into one flowing string. */
function unwrap(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

/** Split a notes string into paragraph and ordered-list blocks. */
export function parseNotes(notes: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  for (const raw of notes.split(/\n\s*\n/)) {
    const lines = raw.split("\n");
    if (unwrap(lines) === "") continue;
    if (!LIST_ITEM.test(lines[0]?.trim() ?? "")) {
      blocks.push({ type: "paragraph", text: unwrap(lines) });
      continue;
    }
    // Ordered list: a new item per "N. " line; other lines are hard-wrapped
    // continuations of the current item.
    const items: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (LIST_ITEM.test(line.trim())) {
        if (current.length > 0) items.push(unwrap(current));
        current = [line.trim().replace(LIST_ITEM, "")];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) items.push(unwrap(current));
    blocks.push({ type: "list", items });
  }
  return blocks;
}

/**
 * Split text on `**` markers: odd-indexed segments are the bold ones.
 * An unpaired trailing marker just yields a final odd segment — rendered
 * bold, never lost.
 */
export function boldSegments(text: string): string[] {
  return text.split("**");
}
