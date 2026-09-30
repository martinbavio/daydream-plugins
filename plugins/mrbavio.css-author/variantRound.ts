// A VARIANT'S FINALIZE (decision #80): a copy of a page, or a rework of
// a variant, finalized into the project's `.daydream/variants/` — never
// into the site. The gate is handed one viewport, whose `payload.page`
// is the variant's markup (`.daydream/variants/<stem>.<n>.html`), and
// `ctx.page` answers for that path a page AT ITS PAGE'S PATH (the
// kernel's variantPageOf: the candidate renders as if it sat there): the
// variant's markup, every sheet it links as the project holds it, then
// its own sheet, last and read-only. So a variant round is told by the
// page answering another path than the viewport names (`variantRound`);
// the judged viewport carries no `payload.variant` — `lint` never judges
// a variant's viewport (the kernel skips them) — but one that did would
// be told the same way.
//
// What the round may refuse is what the variant CAUSED, since its accept
// writes only that into the site: its own css, appended to the page's
// sheet at the accept, and the markup it changed, spliced into the
// page's file. So at its finalize:
//
// - Its OWN SHEET is judged as the page will read it after the accept:
//   a subject like any editable sheet, its rules last in the cascade
//   (`asEditable`), so a rule restating the initial or the page's rule
//   beneath it, a dead line or a unit-less length in it is refused — the
//   draft's css is that sheet, and the draft is where it is fixed.
// - Its `<STYLE>` BLOCKS are its markup's, which the accept splices into
//   the page: each is a subject too, and one the variant changed or
//   added is judged like its own sheet. One whose text the page's file
//   has in a block of its own is the site's, as it stands.
// - The SITE'S SHEETS (every other sheet of the candidate: the page's
//   files, its `<style>` blocks as the page has them) are advisory at
//   most (`siteClause`): what the lints find there is said, but the
//   round leaves them as they are, so no fix is named. A line of a
//   site's sheet that the variant's own css overrides, dead once the
//   variant is accepted, is said as such (`overriddenClause`): an
//   in-place rework of the page will refuse it then — unless a page not
//   judged links that sheet too, when neither refuses it.
// - Its MARKUP is refused only for what the variant added: a class, or
//   an element's own `style` declaration, the page's file already has
//   on some element (`hadClass`, `hadStyle`) is advisory
//   (`markupClause`) — a JavaScript hook class or an inline style being
//   the page's own, wherever the variant moved or wrapped the element
//   that carries it. Each counts as the page's on as many elements as
//   the page has it on (`keptMarkup`), the element paired with the
//   page's first (`pageTwins`), so a hook copied onto an element of the
//   variant's own is still refused.

import type {
  CoreApi,
  DeepReadonly,
  DreamDocument,
  PageSheet,
} from "@daydream/plugin-api";

import {
  sheetKey,
  sheetName,
  type Page,
  type PageOf,
  type Viewport,
} from "./pageSheets";

/** A variant's finalize, as the lints judge it. */
export interface VariantRound {
  /** The judged viewport's id. */
  viewport: string;
  /** The variant's markup, as the viewport names it. */
  file: string;
  /** The page it is a variant of: the candidate's `path`. */
  page: string;
  /** The candidate as the lints read it: its own sheet editable. */
  candidate: Page;
  /** The candidate's sheets that are the site's (`sheetKey`): every one
   * but the variant's own and the `<style>` blocks it changed or added. */
  site: ReadonlySet<string>;
  /** The site's `<style>` blocks, as the findings name them
   * (`sheetName`). */
  blocks: ReadonlySet<string>;
  /** The variant's own sheet (`sheetKey`). */
  own: string;
  /** Whether class `name` on the element the candidate's stored selector
   * `selector` names is one the page's file already has. */
  hadClass(selector: string, name: string): boolean;
  /** Whether the element's own `property`, with its value, is one the
   * page's file already has on an element. */
  hadStyle(selector: string, property: string): boolean;
}

/**
 * The variant round the gate judges, or null for any other judging (a
 * rework's or a new page's finalize, `lint`): the one viewport whose
 * page (`pageOf`) sits at another path than the viewport names — the
 * variant's own sheet is then the candidate's last sheet named after its
 * markup. Its markup is paired with the page's file as the project
 * holds it (`pageOf(page)`, which at a finalize is the project's for
 * every path but the one judged); a page gone pairs nothing, so every
 * element counts as the variant's.
 */
export function variantRound(
  core: CoreApi,
  doc: DeepReadonly<DreamDocument>,
  pageOf: PageOf,
): VariantRound | null {
  for (const viewport of core.viewportItems(doc)) {
    const judged = pageOf(viewport.payload.page);
    if (judged === undefined || judged.path === viewport.payload.page) continue;
    const file = viewport.payload.page;
    const own = ownSheet(judged, file);
    if (own < 0) continue;
    const candidate = asEditable(judged, own);
    const source = pageOf(judged.path);
    const theirs = siteBlocks(core, candidate, source?.html ?? null);
    const site = new Set(
      candidate.sheets.flatMap((sheet, index) =>
        index === own || ("style" in sheet.source && !theirs.has(index))
          ? []
          : [sheetKey(candidate, index)],
      ),
    );
    const kept = keptMarkup(core, source?.html ?? null, judged.html);
    return {
      viewport: viewport.id,
      file,
      page: judged.path,
      candidate,
      site,
      blocks: new Set([...theirs].map((index) => sheetName(candidate, index))),
      own: sheetKey(candidate, own),
      hadClass: (selector, name) =>
        kept.has(`class\u0000${selector}\u0000${name}`),
      hadStyle: (selector, property) =>
        kept.has(`style\u0000${selector}\u0000${property}`),
    };
  }
  return null;
}

/** The gate's page lookup over a variant round: the candidate, its own
 * sheet editable, for the variant's markup; the rest as `pageOf` answers
 * them. */
export function roundPageOf(
  pageOf: PageOf,
  round: VariantRound | null,
): PageOf {
  if (round === null) return pageOf;
  return (path) => (path === round.file ? round.candidate : pageOf(path));
}

/** Whether `viewport` is the one the round judges. */
export function inRound(
  round: VariantRound | null | undefined,
  viewport: Viewport,
): round is VariantRound {
  return (
    round !== null && round !== undefined && round.viewport === viewport.id
  );
}

/** What a finding about a rule of the site's sheet `sheet` (as
 * `sheetName` names it) adds at a variant's finalize instead of its fix:
 * why `count` findings are not refusals. */
export function siteClause(
  round: VariantRound,
  sheet: string,
  count = 1,
): string {
  const it = count === 1 ? "it is" : "they are";
  if (round.blocks.has(sheet)) {
    return `; ${sheet} is the page's own, which this variant leaves as it is, so ${it} not refused`;
  }
  return `; ${sheet} is a sheet of \`${round.page}\`, the page this variant is of, which a variant round never writes, so ${it} not refused`;
}

/** What a finding about a dead line of the site's sheet `sheet` adds at
 * a variant's finalize when the line is live without the variant's own
 * sheet: the accept appends that sheet's rules to the page's, so the
 * line is dead there after it, which an in-place rework refuses. */
export function overriddenClause(round: VariantRound, sheet: string): string {
  return `; this variant's css overrides it, so once the variant is accepted it is dead in ${sheet}, and an in-place rework of \`${round.page}\` will refuse it until it is removed there — it is not refused here`;
}

/** What a finding about markup the page already has adds at a variant's
 * finalize instead of its fix. */
export function markupClause(round: VariantRound): string {
  return `; \`${round.page}\` already has it, and this variant keeps it rather than adding it, so it is not refused`;
}

/** The candidate's own sheet: the last one, a project file named after
 * the variant's markup (`<stem>.<n>.css` beside it), or -1. */
function ownSheet(page: Page, file: string): number {
  const own = `${file.slice(0, -".html".length)}.css`;
  const last = page.sheets.length - 1;
  const source = page.sheets[last]?.source;
  return source !== undefined && "file" in source && source.file === own
    ? last
    : -1;
}

/** The page with sheet `own` and every `<style>` block subjects of the
 * lints: the kernel lists a variant's own sheet and its blocks
 * read-only, since only a draft of the variant writes them — which is
 * what a finalize's findings are fixed in. */
function asEditable(page: Page, own: number): Page {
  const sheets = page.sheets.map((sheet, index): DeepReadonly<PageSheet> => {
    if (index !== own && !("style" in sheet.source)) return sheet;
    // Its text and source alone: no `unwritable` sentence, no `error`.
    return { source: sheet.source, text: sheet.text, readOnly: false };
  });
  return { ...page, sheets };
}

/** The candidate's `<style>` blocks (by index) that are the site's as it
 * stands: each whose text a `<style>` of the page's markup (`source`, as
 * the project holds it) has, one of the page's for one of the
 * variant's, so a block the variant inserted before another moves none
 * of the page's. None when there is no page. */
function siteBlocks(
  core: CoreApi,
  candidate: Page,
  source: string | null,
): Set<number> {
  const theirs = new Map<string, number>();
  if (source !== null) {
    const styles = core.parsePage(source).getElementsByTagName("style");
    for (const style of Array.from(styles)) {
      const text = style.textContent ?? "";
      theirs.set(text, (theirs.get(text) ?? 0) + 1);
    }
  }
  const out = new Set<number>();
  candidate.sheets.forEach((sheet, index) => {
    const left = theirs.get(sheet.text) ?? 0;
    if (!("style" in sheet.source) || left === 0) return;
    theirs.set(sheet.text, left - 1);
    out.add(index);
  });
  return out;
}

/**
 * What of the variant's markup the page's file already has, keyed by the
 * variant element's stored selector (`dd.core.uniqueSelector` over
 * `dd.core.parsePage`, as every lint names an element): each class
 * (`class␀<selector>␀<name>`) and each own declaration's property with
 * its value (`style␀<selector>␀<property>`) the page has on some
 * element — wherever the variant put the element, wrapped or moved —
 * each on as many of the variant's elements as the page has it on: the
 * elements paired with one of the page's that has it (`pageTwins`)
 * first, then the rest in tree order. So what the variant ADDED — a
 * class or a declaration the page has nowhere, or once more than the
 * page has it — is not kept. Empty when there is no page.
 */
function keptMarkup(
  core: CoreApi,
  source: string | null,
  variant: string,
): Set<string> {
  const kept = new Set<string>();
  if (source === null) return kept;
  const page = core.parsePage(source);
  const ours = core.parsePage(variant);
  const twins = pageTwins(page.documentElement, ours.documentElement);
  /** What an element carries, as keys without its selector. */
  const carried = (el: Element): string[] => [
    ...new Set(
      (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => `class\u0000${name}`),
    ),
    ...Array.from(
      lastValues(core, el),
      ([property, value]) => `style\u0000${property}\u0000${value}`,
    ),
  ];
  const left = new Map<string, number>();
  for (const el of Array.from(page.getElementsByTagName("*"))) {
    for (const key of carried(el)) left.set(key, (left.get(key) ?? 0) + 1);
  }
  const mine = Array.from(ours.getElementsByTagName("*"));
  const names = new Map<Element, string>();
  const take = (el: Element, key: string): void => {
    const count = left.get(key) ?? 0;
    if (count === 0) return;
    left.set(key, count - 1);
    let selector = names.get(el);
    if (selector === undefined) {
      selector = core.uniqueSelector(el, ours);
      names.set(el, selector);
    }
    // A declaration's key drops its value: the lints ask by property.
    const [kind, name] = key.split("\u0000");
    kept.add(`${kind}\u0000${selector}\u0000${name}`);
  };
  /** What each element took as its twin's, not taken again. */
  const paired = new Map<Element, Set<string>>();
  for (const el of mine) {
    const twin = twins.get(el);
    if (twin === undefined) continue;
    const theirs = new Set(carried(twin));
    const taken = new Set(carried(el).filter((key) => theirs.has(key)));
    paired.set(el, taken);
    for (const key of taken) take(el, key);
  }
  for (const el of mine) {
    const taken = paired.get(el);
    for (const key of carried(el)) if (taken?.has(key) !== true) take(el, key);
  }
  return kept;
}

/** An element's own declarations, each property's last value. */
function lastValues(core: CoreApi, el: Element): Map<string, string> {
  return new Map(
    core
      .cssDeclarations(el.getAttribute("style") ?? "")
      .map((declaration) => [declaration.property, declaration.value]),
  );
}

/**
 * Each element of the variant's tree (`mine`) paired with the page's
 * element it is the copy of (`theirs`): the two roots, then, level by
 * level, each pair's children — first by the longest run in order whose
 * start tags are alike (name and attributes), then, between those, by
 * name alone, so an element whose attributes the variant changed still
 * pairs and its children with it. An element the variant added pairs
 * with nothing, and none of what it holds does either.
 */
export function pageTwins(
  theirs: Element,
  mine: Element,
): Map<Element, Element> {
  const out = new Map<Element, Element>();
  const pending: [Element, Element][] = [[theirs, mine]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    if (a.localName !== b.localName) continue;
    out.set(b, a);
    const as = Array.from(a.children);
    const bs = Array.from(b.children);
    for (const [i, j] of childPairs(as, bs)) pending.push([as[i]!, bs[j]!]);
  }
  return out;
}

/** The children paired: in order, alike start tags first, then names in
 * the gaps between those. */
function childPairs(
  as: readonly Element[],
  bs: readonly Element[],
): [number, number][] {
  const out: [number, number][] = [];
  const anchors = inOrder(as, bs, sameStartTag);
  let i = 0;
  let j = 0;
  for (const [ai, bj] of [
    ...anchors,
    [as.length, bs.length] as [number, number],
  ]) {
    const gap = inOrder(
      as.slice(i, ai),
      bs.slice(j, bj),
      (x, y) => x.localName === y.localName,
    );
    for (const [gi, gj] of gap) out.push([i + gi, j + gj]);
    if (ai < as.length) out.push([ai, bj]);
    i = ai + 1;
    j = bj + 1;
  }
  return out;
}

/** Past this many cells, a sibling list is paired by its common ends
 * alone rather than a full longest common subsequence. */
const PAIRING_CELLS = 250_000;

/** The longest run of pairs, in order on both sides, that `same` holds
 * for; for lists too long to compare whole, the common head and tail. */
function inOrder<T>(
  as: readonly T[],
  bs: readonly T[],
  same: (a: T, b: T) => boolean,
): [number, number][] {
  if (as.length === 0 || bs.length === 0) return [];
  if (as.length * bs.length > PAIRING_CELLS) return commonEnds(as, bs, same);
  const n = as.length;
  const m = bs.length;
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (x: number, y: number): number => x * (m + 1) + y;
  for (let x = n - 1; x >= 0; x--) {
    for (let y = m - 1; y >= 0; y--) {
      table[at(x, y)] = same(as[x]!, bs[y]!)
        ? table[at(x + 1, y + 1)]! + 1
        : Math.max(table[at(x + 1, y)]!, table[at(x, y + 1)]!);
    }
  }
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  while (x < n && y < m) {
    if (
      same(as[x]!, bs[y]!) &&
      table[at(x, y)] === table[at(x + 1, y + 1)]! + 1
    ) {
      out.push([x++, y++]);
    } else if (table[at(x + 1, y)]! >= table[at(x, y + 1)]!) {
      x++;
    } else {
      y++;
    }
  }
  return out;
}

function commonEnds<T>(
  as: readonly T[],
  bs: readonly T[],
  same: (a: T, b: T) => boolean,
): [number, number][] {
  const out: [number, number][] = [];
  let head = 0;
  while (head < as.length && head < bs.length && same(as[head]!, bs[head]!)) {
    out.push([head, head]);
    head++;
  }
  const tail: [number, number][] = [];
  let x = as.length - 1;
  let y = bs.length - 1;
  while (x >= head && y >= head && same(as[x]!, bs[y]!)) tail.push([x--, y--]);
  return [...out, ...tail.reverse()];
}

/** The same element name and attributes, each with the same value. */
function sameStartTag(a: Element, b: Element): boolean {
  if (
    a.localName !== b.localName ||
    a.attributes.length !== b.attributes.length
  ) {
    return false;
  }
  for (const attribute of Array.from(a.attributes)) {
    if (
      b.getAttributeNS(attribute.namespaceURI, attribute.localName) !==
      attribute.value
    ) {
      return false;
    }
  }
  return true;
}
