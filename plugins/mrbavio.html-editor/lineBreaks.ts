/**
 * A page file's LINE BREAKS, kept as written while CodeMirror edits its
 * text. CodeMirror holds every break as one `\n` (a `\r\n` and a lone `\r`
 * included), and its text and offsets are that text's; the page's file
 * is the author's, and a save writes it as typed (decision #78). So the
 * editor keeps each break of the file as the file writes it, in order,
 * and puts them back: an edit changes only the breaks it removes or
 * types, a typed one written as the file writes most of its own. Offsets
 * go between the two texts the same way: the kernel's (`dd.pageSource`,
 * `dd.pageElementAt`) are the file's.
 *
 * DOM-free, and free of CodeMirror: htmlEditor.ts hands in what a
 * transaction changed, by line.
 */

const BREAK = /\r\n?|\n/g;

/** A text as the editor holds it, and its breaks as the file writes them. */
export interface Broken {
  /** The text, each break a `\n`. */
  text: string;
  /** Each break of the file, in order: `\r\n`, `\r` or `\n`. */
  breaks: string[];
  /** The break a typed one is written as: the file's most common (the
   * first of those tied), `\n` for a file of one line. */
  eol: string;
}

export function splitBreaks(file: string): Broken {
  const breaks = file.match(BREAK) ?? [];
  const counts = new Map<string, number>();
  let eol = "\n";
  let most = 0;
  for (const each of breaks) {
    const count = (counts.get(each) ?? 0) + 1;
    counts.set(each, count);
    if (count > most) {
      most = count;
      eol = each;
    }
  }
  return { text: file.replace(BREAK, "\n"), breaks, eol };
}

/** The file's text for the editor's `text`: each `\n` the break it
 * stands for, one past the kept ones the file's `eol`. */
export function joinBreaks(
  text: string,
  breaks: readonly string[],
  eol: string,
): string {
  const lines = text.split("\n");
  let out = lines[0]!;
  for (let i = 1; i < lines.length; i++) out += (breaks[i - 1] ?? eol) + lines[i]!;
  return out;
}

/** One change of the editor's text, by line: the breaks from index
 * `at` on (the break ending line `at + 1`), `removed` of them, replaced
 * by `added` typed ones. */
export interface BreakEdit {
  at: number;
  removed: number;
  added: number;
}

/** The breaks after `edits`, each by the lines of the text before any of
 * them (a transaction's changes), in order. */
export function spliceBreaks(
  breaks: readonly string[],
  edits: readonly BreakEdit[],
  eol: string,
): string[] {
  const out = breaks.slice();
  for (let k = edits.length - 1; k >= 0; k--) {
    const { at, removed, added } = edits[k]!;
    out.splice(at, removed, ...new Array<string>(added).fill(eol));
  }
  return out;
}

/** The file's offset for the editor's offset `at` in `text`: one more
 * for each `\r\n` before it. */
export function fileOffset(
  text: string,
  breaks: readonly string[],
  at: number,
): number {
  let shift = 0;
  let line = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < at; i = text.indexOf("\n", i + 1)) {
    if (breaks[line] === "\r\n") shift++;
    line++;
  }
  return at + shift;
}

/** The editor's offset for the file's offset `at`: the inverse of
 * `fileOffset`, a place inside a `\r\n` taken to the break's start. */
export function editorOffset(
  text: string,
  breaks: readonly string[],
  at: number,
): number {
  let shift = 0;
  let line = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    // The break at editor offset `i` starts at file offset `i + shift`.
    if (i + shift >= at) break;
    const wide = breaks[line] === "\r\n";
    if (wide && i + shift + 1 === at) return i;
    if (wide) shift++;
    line++;
  }
  return Math.min(at - shift, text.length);
}
