// A VARIANT'S FINALIZE (decision #80): a copy of a page, or a rework of
// a variant, finalized into the project's `.daydream/variants/` — never
// into the site. The gate is handed one viewport, whose `payload.page`
// is the variant's markup (`.daydream/variants/<stem>.<n>.html`), and
// `ctx.page` answers for that path a page AT ITS PAGE'S PATH (the
// kernel's variantPageOf: the candidate renders as if it sat there): the
// variant's markup, every sheet it links as the project holds it, and its
// own sheet, read-only and marked `variant: true`, listed once where its
// accept will append its rules (decision #81) — right after the page's
// last local sheet that applies wherever it is shown, so a `<style>`
// block or a remote sheet after that one comes after it; for a page with
// no such sheet, where the accept links `<page>.css` (after that file,
// listed read-only, when the project holds one the markup does not link);
// last only where its css lands nowhere. It is found by its mark, never
// by its place. So a variant round is told by the page answering another
// path than the viewport names, and holding a sheet so marked
// (`variantRound`);
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
//   a subject like any editable sheet, its rules where the kernel lists
//   them (`asEditable`), so a rule restating the initial or the page's
//   rule beneath it, a dead line — one a later `<style>` block overrides
//   included — or a unit-less length in it is refused — the draft's css
//   is that sheet, and the draft is where it is fixed.
// - Its `<STYLE>` BLOCKS are its markup's, which the accept splices into
//   the page: each is a subject too, judged RULE BY RULE against the
//   page's blocks (`blockRules`). Every rule — a style rule's own
//   declarations, an at-rule, a face — is read as its text says it:
//   its prelude and those of the rules around it, and its own
//   declarations, space squashed, so re-indenting or splitting a block
//   changes none. The candidate's are paired with the page's in order
//   (the page's links between them kept as they stand): a rule the
//   variant wrote or changed pairs with none of the page's and is judged
//   like its own sheet; one the page has is the site's, as the page
//   writes it (`kept`) or moved among the page's rules (`moved`), said
//   so. A block every rule of which is kept, its text the page's, is the
//   site's whole, as it stands.
// - The SITE'S SHEETS (the page's files — and a file the accept links
//   that the page does not yet, `<page>.css` or one the variant's markup
//   links — and what of its `<style>` blocks the variant keeps) are
//   advisory at most (`siteClause`): what
//   the lints find there is said, but the round leaves them as they are,
//   so no fix is named. A site's line the variant leaves dead once it is
//   accepted is said as such: one its css — or what it writes or moves in
//   the blocks — overrides at a width the lint reads (`overriddenClause`;
//   `sharedClause` when the sheet the accept appends to is linked by
//   pages not judged, so `lint` will refuse it), and a rule that matches
//   an element of the page's markup but none of the variant's
//   (`goneClause`): an in-place rework of the page will refuse it then.
// - Its MARKUP is refused only for what the variant added: a class, or
//   an element's own declaration (property and value), the page's file
//   already has on some element (`hadClass`, `hadStyle`) is advisory
//   (`markupClause`) — a JavaScript hook class or an inline style being
//   the page's own, wherever the variant moved or wrapped the element
//   that carries it. Each counts as the page's on as many elements as
//   the page has it on (`keptMarkup`): the element paired with the
//   page's first (`pageTwins`), then one like an element of the page's
//   that has it, so a hook copied onto an element of the variant's own
//   is refused there, never on the page's.

import type {
  CoreApi,
  CssBlock,
  CssDeclaration,
  DeepReadonly,
  DreamDocument,
  PageSheet,
} from "@daydream/plugin-api";

import { selectorForMatching, type PageRule } from "./pageCss";
import { lintElements } from "./pageDom";
import {
  readSheets,
  sheetKey,
  sheetName,
  type Page,
  type PageOf,
  type Viewport,
} from "./pageSheets";
import { ruleMatcher } from "./ruleMatch";
import { stripStatePseudo } from "./statePseudo";

/** How what a finding is about is the site's at a variant's finalize: a
 * sheet the round leaves whole (`sheet`), or a rule of a `<style>` block
 * the variant changes that it keeps as the page writes it, in the page's
 * order (`kept`) or moved among the page's rules (`moved`). */
export type SiteHow = "sheet" | "kept" | "moved";

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
  /** The candidate's sheets that are the site's whole (`sheetKey`): its
   * files and remote sheets, and each `<style>` block it keeps whole. */
  site: ReadonlySet<string>;
  /** Of those, the `<style>` blocks, as the findings name them
   * (`sheetName`). */
  blocks: ReadonlySet<string>;
  /** Of the site's sheets, the project files the page lists nowhere, as
   * the findings name them (`sheetName`): the `<page>.css` the accept
   * links, which the kernel lists read-only before the variant's own
   * sheet when the project holds it, judged here as the page's files are
   * (`asEditable`). */
  unlinked: ReadonlySet<string>;
  /** The variant's own sheet (`sheetKey`). */
  own: string;
  /** The sheet the accept appends the variant's css to (`sheetKey`):
   * the project file the kernel lists the variant's own sheet right
   * after — the page's last local sheet that applies wherever it is
   * shown, or the `<page>.css` the accept links — or null where the
   * candidate lists none (a `<page>.css` the accept makes, css that lands
   * nowhere). */
  target: string | null;
  /** That sheet as a finding names it, or null. */
  targetName: string | null;
  /** The candidate's rules (`readSheets` index) in its `<style>` blocks
   * that the variant wrote, changed or moved: with its own sheet, what
   * the page's line would be live without. */
  changed: ReadonlySet<number>;
  /** How a finding about rule `rule` (`readSheets` index) of sheet `key`
   * — or the sheet, with no rule — is the site's, or null when it is the
   * variant's. */
  siteOf(key: string, rule?: number): SiteHow | null;
  /** The same for a block of sheet `key` as `dd.core.cssBlocks` reads
   * it (a face, a rule a stray `;` drops). */
  siteBlock(key: string, block: CssBlock): SiteHow | null;
  /** Whether class `name` on the element the candidate's stored selector
   * `selector` names is one the page's file already has. */
  hadClass(selector: string, name: string): boolean;
  /** Whether the element's own declaration of `property` with `value`
   * (`inlineValue`) is one the page's file already has on an element. */
  hadStyle(selector: string, property: string, value: string): boolean;
  /** Whether the rule, as its sheet writes it, matches an element of the
   * page's markup as the project holds it, some state of it included. */
  matchedOnPage(rule: PageRule): boolean;
}

/** An element's own declaration's value as `hadStyle` asks it: with its
 * `!important`, as the lints quote it. */
export function inlineValue(declaration: CssDeclaration): string {
  return declaration.important
    ? `${declaration.value} !important`
    : declaration.value;
}

/**
 * The variant round the gate judges, or null for any other judging (a
 * rework's or a new page's finalize, `lint`): the one viewport whose
 * page (`pageOf`) sits at another path than the viewport names and lists
 * the variant's own sheet (`variant: true`). Its markup is paired with the page's file as the project
 * holds it (`pageOf(page)`, which at a finalize is the project's for
 * every path but the one judged); a page gone pairs nothing, so every
 * element and rule counts as the variant's.
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
    const own = ownSheet(judged);
    if (own < 0) continue;
    const source = pageOf(judged.path);
    const unlinked = unlinkedSheets(judged, own, source);
    const candidate = asEditable(judged, own, unlinked);
    const parsed = source === undefined ? null : core.parsePage(source.html);
    const rules = blockRules(core, candidate, own, pageSheetsOf(source, parsed));
    const site = new Set(
      candidate.sheets.flatMap((sheet, index) =>
        index === own || ("style" in sheet.source && !rules.whole.has(index))
          ? []
          : [sheetKey(candidate, index)],
      ),
    );
    const kept = keptMarkup(core, parsed, judged.html);
    const target = acceptTarget(candidate, own);
    const key = (sheet: string, at: number): string => `${sheet}\u0000${at}`;
    return {
      viewport: viewport.id,
      file,
      page: judged.path,
      candidate,
      site,
      blocks: new Set(
        [...rules.whole].map((index) => sheetName(candidate, index)),
      ),
      unlinked: new Set(
        [...unlinked].map((index) => sheetName(candidate, index)),
      ),
      own: sheetKey(candidate, own),
      target: target < 0 ? null : sheetKey(candidate, target),
      targetName: target < 0 ? null : sheetName(candidate, target),
      changed: rules.changed,
      siteOf: (sheet, rule) =>
        site.has(sheet)
          ? "sheet"
          : rule === undefined
            ? null
            : (rules.byRule.get(rule) ?? null),
      siteBlock: (sheet, block) =>
        site.has(sheet)
          ? "sheet"
          : (rules.byBlock.get(key(sheet, block.range[0])) ?? null),
      hadClass: (selector, name) =>
        kept.has(`class\u0000${selector}\u0000${name}`),
      hadStyle: (selector, property, value) =>
        kept.has(`style\u0000${selector}\u0000${property}\u0000${squash(value)}`) ||
        // A url the mounted copy routed is not the value the page's file
        // writes: such a line is the page's by its property.
        (ROUTED.test(value) &&
          kept.has(`url\u0000${selector}\u0000${property}`)),
      matchedOnPage: onPage(parsed),
    };
  }
  return null;
}

const ROUTED = /url\(/i;

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

/** What a finding about what the round keeps of sheet `sheet` (as
 * `sheetName` names it) adds at a variant's finalize instead of its fix:
 * why `count` findings are not refusals — the sheet left whole, or a
 * rule of a block the variant changes, kept or moved (`SiteHow`). */
export function siteClause(
  round: VariantRound,
  sheet: string,
  count = 1,
  how: SiteHow = "sheet",
): string {
  const one = count === 1;
  const it = one ? "it is" : "they are";
  if (how === "kept") {
    return `; ${one ? "that is the page's own rule" : "those are the page's own rules"}, which this variant keeps as the page writes ${one ? "it" : "them"}, so ${it} not refused`;
  }
  if (how === "moved") {
    return `; ${one ? "that is the page's own rule" : "those are the page's own rules"}, which this variant keeps as the page writes ${one ? "it" : "them"} but moves among the page's rules, which can change what ${one ? "it overrides" : "they override"} or ${one ? "leaves" : "leave"} dead, so ${it} not refused here — once the variant is accepted, an in-place rework of \`${round.page}\` judges ${one ? "it" : "them"} where ${one ? "it then sits" : "they then sit"}`;
  }
  if (round.blocks.has(sheet)) {
    return `; ${sheet} is the page's own, which this variant leaves as it is, so ${it} not refused`;
  }
  if (round.unlinked.has(sheet)) {
    return `; ${sheet} is a sheet of the project that \`${round.page}\` does not link yet — this variant's accept links it — which a variant round never writes, so ${it} not refused`;
  }
  return `; ${sheet} is a sheet of \`${round.page}\`, the page this variant is of, which a variant round never writes, so ${it} not refused`;
}

/** What a finding about a dead line of the site's sheet `sheet` adds at
 * a variant's finalize when the line is live without what the variant
 * adds to the cascade — its own sheet, and what it writes or moves in
 * the `<style>` blocks (`changed`): the accept writes those into the
 * page, so the line is dead there after it, which an in-place rework
 * refuses. */
export function overriddenClause(round: VariantRound, sheet: string): string {
  const what =
    round.changed.size === 0
      ? "this variant's css overrides it"
      : "this variant's css, or what it writes or moves in the page's `<style>` blocks, overrides it";
  return `; ${what}, so once the variant is accepted it is dead in ${sheet}, and an in-place rework of \`${round.page}\` will refuse it until it is removed there — it is not refused here`;
}

/** The same for a line of a sheet `pages` not judged link too, when the
 * accept appends the variant's css to a sheet they link (`target`): the
 * line is then overridden wherever that css reaches, and `lint` refuses
 * a line dead on every page linking its sheet. */
export function sharedClause(
  round: VariantRound,
  sheet: string,
  pages: readonly string[],
): string {
  const one = new Set(pages).size === 1;
  const named = [...new Set(pages)].map((path) => `\`${path}\``);
  const list =
    named.length < 2
      ? named.join("")
      : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `; this variant's css overrides it, and the accept appends that css to ${round.targetName ?? sheet}, which ${list} ${one ? "links" : "link"} too, so once the variant is accepted it can be dead in ${sheet} on every page that links it, which \`lint\` refuses until it is removed — it is not refused here`;
}

/** What a finding about a rule of the site's sheet `sheet` that matches
 * nothing in the variant — or a line of one — adds when the page's
 * markup has an element it matches: the variant removes or changes that
 * element, so after the accept the rule is dead in the page. */
export function goneClause(
  round: VariantRound,
  sheet: string,
  line = false,
): string {
  return `; \`${round.page}\` has an element ${line ? "its rule" : "it"} matches, which this variant removes or changes, so once the variant is accepted ${line ? "it changes nothing" : "it matches nothing"} there, and an in-place rework of \`${round.page}\` will refuse it until it is removed from ${sheet} — it is not refused here`;
}

/** What a finding about markup the page already has adds at a variant's
 * finalize instead of its fix. */
export function markupClause(round: VariantRound): string {
  return `; \`${round.page}\` already has it, and this variant keeps it rather than adding it, so it is not refused`;
}

/** The candidate's own sheet: the one the kernel marks `variant: true`,
 * wherever it lists it (decision #81), or -1. */
function ownSheet(page: Page): number {
  return page.sheets.findIndex((sheet) => sheet.variant === true);
}

/** The page with sheet `own`, every `<style>` block and the sheets
 * `unlinked` subjects of the lints: the kernel lists a variant's own
 * sheet and its blocks read-only, since only a draft of the variant
 * writes them — which is what a finalize's findings are fixed in — and a
 * `<page>.css` its accept links read-only, since the page does not link
 * it yet; once accepted it is the page's, so it is judged as the page's
 * other files are, its findings advisory (`siteClause`). */
function asEditable(
  page: Page,
  own: number,
  unlinked: ReadonlySet<number>,
): Page {
  const sheets = page.sheets.map((sheet, index): DeepReadonly<PageSheet> => {
    if (index !== own && !unlinked.has(index) && !("style" in sheet.source)) {
      return sheet;
    }
    // Its text and source alone: no `unwritable` sentence, no `error` —
    // and the variant's own still marked as the kernel marks it.
    return {
      source: sheet.source,
      text: sheet.text,
      readOnly: false,
      ...(index === own ? { variant: true as const } : {}),
    };
  });
  return { ...page, sheets };
}

/** The candidate's sheet (by index) the accept appends the variant's
 * css to, or -1: the kernel lists the variant's own sheet (`own`) right
 * after it (core/sheetLanding.ts landedSheets) — after the listing of the
 * page's last local sheet that applies wherever it is shown, or after the
 * `<page>.css` the accept links when the project holds it — so it is the
 * listing before `own` when that is a project file. None for css that
 * lands nowhere (its own sheet is then last, after whatever the page
 * lists), and none when the sheet before it is a `<style>` block or a
 * remote sheet: the accept links a `<page>.css` the project does not
 * hold yet. */
function acceptTarget(candidate: Page, own: number): number {
  if (own <= 0 || candidate.sheets[own]!.text.trim() === "") return -1;
  return "file" in candidate.sheets[own - 1]!.source ? own - 1 : -1;
}

/** The candidate's project files (by index) but its own sheet that the
 * page (`source`) lists nowhere: the `<page>.css` its accept links. None
 * with no page. */
function unlinkedSheets(
  candidate: Page,
  own: number,
  source: Page | undefined,
): Set<number> {
  if (source === undefined) return new Set();
  const listed = new Set(
    source.sheets.flatMap((sheet) =>
      "file" in sheet.source ? [sheet.source.file] : [],
    ),
  );
  return new Set(
    candidate.sheets.flatMap((sheet, index) =>
      index !== own && "file" in sheet.source && !listed.has(sheet.source.file)
        ? [index]
        : [],
    ),
  );
}

/** What of the candidate's `<style>` blocks is the site's (see the
 * header): the blocks kept whole (by index), how each rule of the rest is
 * the page's (by `readSheets` index, and by block — its sheet's key and
 * where it starts), and the rules the variant wrote, changed or moved. */
interface BlockRules {
  whole: Set<number>;
  byRule: Map<number, SiteHow>;
  byBlock: Map<string, SiteHow>;
  changed: Set<number>;
}

/** One rule of a sheet as `blockRules` pairs it: its text as read (see
 * the header), and where it is — null for a sheet that is not a
 * `<style>` block, which stands for itself. */
interface Unit {
  text: string;
  sheet: number;
  block: CssBlock | null;
}

/**
 * The candidate's `<style>` blocks (its own sheet aside) paired with the
 * page's, rule by rule (see the header): each sheet as its units in
 * order — a link as one, a block as each rule it holds at any depth —
 * paired in order (`aligned`), then a unit left over paired with one of
 * the page's left over whose text it has, as moved. None when there is
 * no page: every rule is the variant's.
 */
function blockRules(
  core: CoreApi,
  candidate: Page,
  own: number,
  source: readonly DeepReadonly<PageSheet>[],
): BlockRules {
  const out: BlockRules = {
    whole: new Set(),
    byRule: new Map(),
    byBlock: new Map(),
    changed: new Set(),
  };
  const read = readSheets(core, candidate);
  const within = new Map<string, number>();
  const ours = units(candidate.sheets, (sheet) => read.blocks[sheet]!, within, own);
  const theirs = units(source, (sheet) => core.cssBlocks(source[sheet]!.text), within);
  const how = new Map<Unit, SiteHow>();
  const pairedTheirs = new Set<number>();
  for (const [i, j] of aligned(
    theirs.map((unit) => unit.text),
    ours.map((unit) => unit.text),
  )) {
    how.set(ours[j]!, "kept");
    pairedTheirs.add(i);
  }
  const left = new Map<string, number>();
  theirs.forEach((unit, i) => {
    if (!pairedTheirs.has(i)) left.set(unit.text, (left.get(unit.text) ?? 0) + 1);
  });
  for (const unit of ours) {
    if (how.has(unit)) continue;
    const count = left.get(unit.text) ?? 0;
    if (count === 0) continue;
    left.set(unit.text, count - 1);
    how.set(unit, "moved");
  }
  // Each block's units, and each rule's by its declarations, which
  // `sheetRules` hands the rule as the block holds them.
  const byDeclarations = new Map<readonly CssDeclaration[], SiteHow | null>();
  const blockTexts = source.flatMap((sheet) =>
    "style" in sheet.source ? [sheet.text] : [],
  );
  const allKept = new Map<number, boolean>();
  for (const unit of ours) {
    if (unit.block === null) continue;
    const said = how.get(unit) ?? null;
    byDeclarations.set(unit.block.declarations, said);
    allKept.set(unit.sheet, (allKept.get(unit.sheet) ?? true) && said === "kept");
    if (said !== null) {
      out.byBlock.set(
        `${sheetKey(candidate, unit.sheet)}\u0000${unit.block.range[0]}`,
        said,
      );
    }
  }
  // Whole: every rule kept in order, and the text the page's block of
  // the same number has — so a block the page has elsewhere, or that an
  // insertion renumbered, is never said to be left as it is.
  candidate.sheets.forEach((sheet, index) => {
    const source = sheet.source;
    if (index === own || !("style" in source)) return;
    if ((allKept.get(index) ?? true) && blockTexts[source.style] === sheet.text) {
      out.whole.add(index);
    }
  });
  for (const rule of read.rules) {
    const sheet = candidate.sheets[rule.sheet]!;
    if (rule.sheet === own || !("style" in sheet.source)) continue;
    const said = byDeclarations.get(rule.declarations) ?? null;
    if (said !== null) out.byRule.set(rule.index, said);
    if (said !== "kept") out.changed.add(rule.index);
  }
  return out;
}

/** The page's sheets in its markup's order (`parsed`, the page's file as
 * the project holds it): each `<style>` element's text as a block, each
 * stylesheet link as the next of the page's sheets that is not a block,
 * in order, and any of those left after. Its `<style>` blocks are read
 * from the markup, as the kernel reads a variant's. None with no page. */
function pageSheetsOf(
  source: Page | undefined,
  parsed: Document | null,
): DeepReadonly<PageSheet>[] {
  if (source === undefined || parsed === null) return [];
  const linked = source.sheets.filter((sheet) => !("style" in sheet.source));
  const out: DeepReadonly<PageSheet>[] = [];
  let next = 0;
  let style = 0;
  for (const el of Array.from(parsed.querySelectorAll("style, link"))) {
    if (el.localName === "style") {
      out.push({ source: { style: style++ }, text: el.textContent ?? "", readOnly: false });
    } else if (/(?:^|\s)stylesheet(?:\s|$)/i.test(el.getAttribute("rel") ?? "")) {
      const sheet = linked[next++];
      if (sheet !== undefined) out.push(sheet);
    }
  }
  return [...out, ...linked.slice(next)];
}

/** Each sheet of `sheets` but `skip` as its units, in order: a link as
 * one, naming what it links, and a `<style>` block as every block it
 * holds, a block before those inside it (`blocksOf`, its sheet's blocks
 * as `dd.core.cssBlocks` reads them), walked with an explicit stack. A
 * unit's text is what the rules around it are, as an id `within` holds
 * (so a deep nesting costs no text per level), then its own prelude and
 * declarations, space squashed. */
function units(
  sheets: readonly DeepReadonly<PageSheet>[],
  blocksOf: (sheet: number) => readonly CssBlock[],
  within: Map<string, number>,
  skip = -1,
): Unit[] {
  const out: Unit[] = [];
  const idOf = (text: string): number => {
    let id = within.get(text);
    if (id === undefined) {
      id = within.size;
      within.set(text, id);
    }
    return id;
  };
  sheets.forEach((sheet, index) => {
    if (index === skip) return;
    const source = sheet.source;
    if (!("style" in source)) {
      const name = "file" in source ? `file ${source.file}` : `url ${source.url}`;
      out.push({ text: `\u0003${name}`, sheet: index, block: null });
      return;
    }
    const stack: { block: CssBlock; around: number }[] = blocksOf(index)
      .map((block) => ({ block, around: -1 }))
      .reverse();
    while (stack.length > 0) {
      const { block, around } = stack.pop()!;
      const prelude = squash(block.prelude);
      const body = block.statement
        ? ";"
        : block.declarations
            .map(
              (d) => `${d.property}:${squash(d.value)}${d.important ? "!" : ""}`,
            )
            .join(";");
      out.push({ text: `${around}\u0001${prelude}\u0001${body}`, sheet: index, block });
      const inner = idOf(`${around}\u0002${prelude}`);
      for (let k = block.children.length - 1; k >= 0; k--) {
        stack.push({ block: block.children[k]!, around: inner });
      }
    }
  });
  return out;
}

/** Runs of white space as one space, the ends trimmed. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Past this many cells, the units between the common head and tail are
 * paired in order greedily rather than by a longest common subsequence. */
const UNIT_CELLS = 4_000_000;

/** The longest run of equal texts in order on both sides (`inOrder`),
 * the common head and tail first taken as they are, so an edit in the
 * middle of a long page costs what the middle does; a middle too long to
 * compare whole is paired greedily, each of `bs` with the next equal one
 * of `as` (`greedy`). */
function aligned(as: readonly string[], bs: readonly string[]): [number, number][] {
  let head = 0;
  while (head < as.length && head < bs.length && as[head] === bs[head]) head++;
  let tail = 0;
  while (
    tail < as.length - head &&
    tail < bs.length - head &&
    as[as.length - 1 - tail] === bs[bs.length - 1 - tail]
  ) {
    tail++;
  }
  const out: [number, number][] = [];
  for (let k = 0; k < head; k++) out.push([k, k]);
  const ma = as.slice(head, as.length - tail);
  const mb = bs.slice(head, bs.length - tail);
  const middle =
    ma.length * mb.length > UNIT_CELLS
      ? greedy(ma, mb)
      : inOrder(ma, mb, (a, b) => a === b, UNIT_CELLS);
  for (const [i, j] of middle) out.push([head + i, head + j]);
  for (let k = tail; k > 0; k--) out.push([as.length - k, bs.length - k]);
  return out;
}

/** Pairs in order on both sides: each of `bs` with the first equal one of
 * `as` after the last paired. */
function greedy(as: readonly string[], bs: readonly string[]): [number, number][] {
  const at = new Map<string, number[]>();
  as.forEach((text, i) => (at.get(text) ?? at.set(text, []).get(text)!).push(i));
  const next = new Map<string, number>();
  const out: [number, number][] = [];
  let last = -1;
  bs.forEach((text, j) => {
    const list = at.get(text);
    if (list === undefined) return;
    let k = next.get(text) ?? 0;
    while (k < list.length && list[k]! <= last) k++;
    next.set(text, k);
    if (k === list.length) return;
    last = list[k]!;
    next.set(text, k + 1);
    out.push([last, j]);
  });
  return out;
}

/** Whether a rule, as its sheet writes it, matches an element of the
 * page's markup (`parsed`) — its states stripped too, as a dead rule is
 * judged (matchLint.ts) — or never, with no page. */
function onPage(parsed: Document | null): (rule: PageRule) => boolean {
  if (parsed === null) return () => false;
  let elements: Element[] | null = null;
  let match: ReturnType<typeof ruleMatcher> | null = null;
  return (rule) => {
    elements ??= lintElements(parsed);
    match ??= ruleMatcher(parsed);
    const selectors = [
      selectorForMatching(rule.selector),
      selectorForMatching(stripStatePseudo(rule.selector)),
    ];
    return selectors.some(
      (selector) =>
        selector.trim() !== "" &&
        elements!.some((el) => match!(el, selector, rule.scopes)),
    );
  };
}

/**
 * What of the variant's markup the page's file (`page`, parsed) already
 * has, keyed by the variant element's stored selector
 * (`dd.core.uniqueSelector` over `dd.core.parsePage`, as every lint names
 * an element): each class (`class␀<selector>␀<name>`) and each own
 * declaration, property and value (`style␀<selector>␀<property>␀<value>`,
 * and `url␀<selector>␀<property>` for a value naming a url, which a
 * mounted copy routes), the page has on some element — wherever the
 * variant put the element, wrapped or moved — each on as many of the
 * variant's elements as the page has it on. Handed out, of each element's
 * keys the page has: first to the elements paired with one of the page's
 * that has it (`pageTwins`); then to one whose start tag is alike to one
 * of the page's elements that has it, then one of the same name; then to
 * the rest in tree order. So what the variant ADDED — a class or a
 * declaration the page has nowhere, or once more than the page has it —
 * is not kept, and is the copy least like the page's element that has it.
 * Empty when there is no page.
 */
function keptMarkup(
  core: CoreApi,
  page: Document | null,
  variant: string,
): Set<string> {
  const kept = new Set<string>();
  if (page === null) return kept;
  const ours = core.parsePage(variant);
  const twins = pageTwins(page.documentElement, ours.documentElement);
  /** What an element carries, as keys without its selector: a class
   * once, a declaration as often as it is written. */
  const carried = (el: Element): string[] => [
    ...new Set(
      (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => `class\u0000${name}`),
    ),
    ...core
      .cssDeclarations(el.getAttribute("style") ?? "")
      .map(
        (declaration) =>
          `style\u0000${declaration.property}\u0000${squash(inlineValue(declaration))}`,
      ),
  ];
  const left = new Map<string, number>();
  /** Of the page's elements carrying each key: their start tags
   * (`startTag`) and their names. */
  const tags = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  for (const el of Array.from(page.getElementsByTagName("*"))) {
    for (const key of carried(el)) {
      left.set(key, (left.get(key) ?? 0) + 1);
      (tags.get(key) ?? tags.set(key, new Set()).get(key)!).add(startTag(el));
      (names.get(key) ?? names.set(key, new Set()).get(key)!).add(el.localName);
    }
  }
  const mine = Array.from(ours.getElementsByTagName("*"));
  const selectors = new Map<Element, string>();
  const take = (el: Element, key: string): boolean => {
    const count = left.get(key) ?? 0;
    if (count === 0) return false;
    left.set(key, count - 1);
    let selector = selectors.get(el);
    if (selector === undefined) {
      selector = core.uniqueSelector(el, ours);
      selectors.set(el, selector);
    }
    const [kind, name, value] = key.split("\u0000") as [string, string, string?];
    kept.add(`${kind}\u0000${selector}\u0000${name}${value === undefined ? "" : `\u0000${value}`}`);
    if (kind === "style" && ROUTED.test(value ?? "")) {
      kept.add(`url\u0000${selector}\u0000${name}`);
    }
    return true;
  };
  /** Each element's keys not handed out yet. */
  const pending = new Map<Element, string[]>();
  for (const el of mine) {
    const keys = carried(el);
    const twin = twins.get(el);
    if (twin !== undefined) {
      const theirs = carried(twin);
      for (let k = keys.length - 1; k >= 0; k--) {
        const at = theirs.indexOf(keys[k]!);
        if (at < 0) continue;
        theirs.splice(at, 1);
        if (take(el, keys[k]!)) keys.splice(k, 1);
      }
    }
    pending.set(el, keys);
  }
  const passes: ((el: Element, key: string) => boolean)[] = [
    (el, key) => tags.get(key)?.has(startTag(el)) === true,
    (el, key) => names.get(key)?.has(el.localName) === true,
    () => true,
  ];
  for (const fits of passes) {
    for (const el of mine) {
      const keys = pending.get(el)!;
      for (let k = 0; k < keys.length; k++) {
        if (fits(el, keys[k]!) && take(el, keys[k]!)) keys.splice(k--, 1);
      }
    }
  }
  return kept;
}

/** An element's start tag as one text: its name and its attributes,
 * each with its value, in name order — alike where `sameStartTag` is. */
function startTag(el: Element): string {
  return [
    el.localName,
    ...Array.from(el.attributes, (a) => `${a.namespaceURI ?? ""} ${a.localName}=${a.value}`).sort(),
  ].join("\u0000");
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
 * for; for lists of more than `cells` pairs to compare, the common head
 * and tail. */
function inOrder<T>(
  as: readonly T[],
  bs: readonly T[],
  same: (a: T, b: T) => boolean,
  cells = PAIRING_CELLS,
): [number, number][] {
  if (as.length === 0 || bs.length === 0) return [];
  if (as.length * bs.length > cells) return commonEnds(as, bs, same);
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
