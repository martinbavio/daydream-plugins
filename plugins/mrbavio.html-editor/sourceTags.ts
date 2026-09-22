// WHERE A PAGE'S TAGS WERE WRITTEN (decision #76). A page's markup is
// text, and the editor shows that text; to point at an element in it the
// editor needs the element's place in the source. The HTML parser keeps
// no source positions, so the text is TOKENIZED here — a tokenizer, not a
// parser: it knows comments, doctypes, raw text (a `<style>`'s css is not
// markup, except in SVG) and quoted attribute values, which is what is
// needed to find where each tag was written. Pairing a tag with the
// element the parser made from it is the browser's job (pageSource.ts);
// what the tokenizer cannot model, that pairing catches.
//
// The kernel reads the same text the same way to splice an element's
// `style` (its src/canvas/pageStack.ts `startTags`); this is the plugin's
// own copy, since a plugin never imports the kernel's source.
//
// Pure: no DOM, so it runs in node.

/** A start tag as written: its lower-cased name, where it starts (the
 * `<`), where its name ends, where it ends (past its `>`), and whether it
 * closed itself (`<br/>`, `<path />`). */
export interface SourceTag {
  name: string;
  start: number;
  nameEnd: number;
  end: number;
  selfClosing: boolean;
}

/** Whose content the tokenizer reads as text up to its own end tag —
 * outside SVG and MathML, where these names are ordinary elements. */
const RAW_TEXT: ReadonlySet<string> = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "textarea",
  "title",
]);

/** Every start tag in the text, in the order written. */
export function startTags(html: string): SourceTag[] {
  const tags: SourceTag[] = [];
  let foreign = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      i = commentEnd(html, lt);
      continue;
    }
    if (foreign > 0 && html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const closing = html[lt + 1] === "/";
    const nameStart = closing ? lt + 2 : lt + 1;
    if (!/[A-Za-z]/.test(html[nameStart] ?? "")) {
      i = lt + 1;
      continue;
    }
    const tag = scanTag(html, nameStart);
    i = tag.end;
    const foreignRoot = tag.name === "svg" || tag.name === "math";
    if (closing) {
      if (foreignRoot && foreign > 0) foreign--;
      continue;
    }
    tags.push({ ...tag, start: lt });
    if (foreignRoot && !tag.selfClosing) foreign++;
    if (foreign === 0 && tag.name === "plaintext") break;
    if (foreign === 0 && RAW_TEXT.has(tag.name)) {
      const close = rawTextClose(html, tag.name, i);
      i = close ?? html.length;
    }
  }
  return tags;
}

/** Where a comment starting at `lt` ends, as the tokenizer reads one:
 * `<!-->` and `<!--->` are whole (empty) comments. */
function commentEnd(html: string, lt: number): number {
  if (html.startsWith("<!-->", lt)) return lt + 5;
  if (html.startsWith("<!--->", lt)) return lt + 6;
  const end = html.indexOf("-->", lt + 4);
  return end === -1 ? html.length : end + 3;
}

/** Where the end tag `</name` closing raw text begins, searching from
 * `from`, or null when the text never closes it. */
function rawTextClose(html: string, name: string, from: number): number | null {
  const close = new RegExp(`</${name}[\\s/>]`, "i").exec(html.slice(from));
  return close === null ? null : from + close.index;
}

/** The tag whose name starts at `from`, read to its closing `>`. */
function scanTag(html: string, from: number): Omit<SourceTag, "start"> {
  let j = from;
  while (j < html.length && !/[\s/>]/.test(html[j]!)) j++;
  const name = html.slice(from, j).toLowerCase();
  const nameEnd = j;
  let selfClosing = false;
  while (j < html.length) {
    const ch = html[j]!;
    if (/\s/.test(ch)) {
      j++;
      continue;
    }
    if (ch === "/") {
      selfClosing = html[j + 1] === ">";
      j++;
      continue;
    }
    if (ch === ">") return { name, nameEnd, end: j + 1, selfClosing };
    selfClosing = false;
    // A name runs to a space, a slash, a `>` or an `=` — its first
    // character may itself be an `=`.
    j++;
    while (j < html.length && !/[\s/>=]/.test(html[j]!)) j++;
    let k = j;
    while (k < html.length && /\s/.test(html[k]!)) k++;
    if (html[k] !== "=") continue;
    k++;
    while (k < html.length && /\s/.test(html[k]!)) k++;
    const quote = html[k];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, k + 1);
      j = close === -1 ? html.length : close + 1;
      continue;
    }
    while (k < html.length && !/[\s>]/.test(html[k]!)) k++;
    j = k;
  }
  return { name, nameEnd, end: html.length, selfClosing };
}

/** The elements HTML gives no content and no end tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Where the element whose start tag is `tag` ends in the text: past its
 * own end tag, found after `inner` (where its last child ends, or its
 * start tag when it has none) and before `bound` (where the next tag
 * outside it starts). An element written without its end tag — a `<p>`
 * or an `<li>` the next one closes — ends at the first end tag of any
 * kind in that span (its parent's), or else at `bound`, with the
 * whitespace before either left outside it. A void element, or one that
 * closed itself, ends with its start tag.
 */
export function elementEnd(
  html: string,
  tag: SourceTag,
  inner: number,
  bound: number,
): number {
  if (tag.selfClosing || VOID_ELEMENTS.has(tag.name)) return tag.end;
  const span = html.slice(inner, bound);
  const own = new RegExp(`</${escapeRegExp(tag.name)}[\\s/>]`, "i").exec(span);
  if (own !== null) {
    const close = html.indexOf(">", inner + own.index);
    return close === -1 || close >= bound ? bound : close + 1;
  }
  const other = /<\/[A-Za-z]/.exec(span);
  let end = other === null ? bound : inner + other.index;
  while (end > inner && /\s/.test(html[end - 1]!)) end--;
  return end;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
