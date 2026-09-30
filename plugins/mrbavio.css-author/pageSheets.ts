// A PAGE AND ITS SHEETS AS THE LINTS READ THEM (decision #78). A viewport
// shows a page of the project by its path (`viewport.payload.page`), and
// a gate reads that page through its context (`ctx.page`): the markup,
// and every stylesheet the markup names, in document order — the files
// it links, its `<style>` blocks and the remote sheets it links, a
// superset of what applies. Every lint reads a page's rules the same way
// (`readSheets`): each sheet scanned once, its rules numbered on across
// the sheets in the page's order, so a finding's `rule` is the same count
// in every gate and the runner keys one declaration one way.
//
// A READ-ONLY SHEET — a remote one (`{url}`: its text as the host
// fetched it, or empty with an `error` when it could not be), or a file
// of the project the host would never write (`unwritable`: a link, bytes
// that are not UTF-8) — is never the subject of a finding, since no edit
// through Daydream lands in it; but its rules are the page's for
// everything else: what an element matches, what a rule restates, which
// classes a rule names.
//
// A finding names the sheet a rule is written in (`sheetName`), so an
// agent knows which file to edit: the project file, the page's `<style>`
// block, or the remote url.
//
// A MOUNTED copy (`dd.mountViewport`) holds one `<style>` per LIVE sheet,
// in cascade order — never a disabled one, its text the face's own (its
// `@import`s out, its urls routed, under its `media`). `writtenRules`
// pairs each with the page sheet it renders, by its rules' selectors and
// declarations, so a lint that reads the copy names and numbers a rule
// as the page's text has it; a copy it cannot pair is never a finding's
// subject. DOM-free.

import type {
  CoreApi,
  CssBlock,
  DeepReadonly,
  DreamDocument,
  DreamPage,
  DreamViewport,
} from "@daydream/plugin-api";

import { sheetRules, type PageRule } from "./pageCss";

/** A page of the project as a gate reads it. */
export type Page = DeepReadonly<DreamPage>;

/** A viewport of the document a gate judges. */
export type Viewport = DeepReadonly<DreamViewport>;

/** How a lint finds a viewport's page: the gate's `ctx.page`. */
export type PageOf = (path: string) => Page | undefined;

/** One viewport and the page it shows. */
export interface Shown {
  viewport: Viewport;
  page: Page;
}

/** The document's viewports in canvas order, each with its page, and
 * those whose page the project does not hold — which no lint can read,
 * and which the static lint reports once (staticLint.ts). */
export function shownPages(
  core: CoreApi,
  doc: DeepReadonly<DreamDocument>,
  pageOf: PageOf,
): { shown: Shown[]; missing: Viewport[] } {
  const shown: Shown[] = [];
  const missing: Viewport[] = [];
  for (const viewport of core.viewportItems(doc)) {
    const page = pageOf(viewport.payload.page);
    if (page === undefined) missing.push(viewport);
    else shown.push({ viewport, page });
  }
  return { shown, missing };
}

/** A page's sheets read once: each one's blocks, in the page's order,
 * and every style rule across them (pageCss.ts `sheetRules`). */
export interface ReadSheets {
  blocks: CssBlock[][];
  rules: PageRule[];
}

export function readSheets(core: CoreApi, page: Page): ReadSheets {
  const blocks = page.sheets.map((sheet) => core.cssBlocks(sheet.text));
  return { blocks, rules: sheetRules(blocks) };
}

/** Whether a finding may be about sheet `sheet` of the page: any sheet
 * but a read-only one (a remote sheet, an unwritable file). */
export function editable(page: Page, sheet: number): boolean {
  return page.sheets[sheet]?.readOnly === false;
}

/** What a finding calls sheet `sheet` of the page: the project file, the
 * page's `<style>` block (counted from 1, in document order), or the
 * remote url — in backticks. */
export function sheetName(page: Page, sheet: number): string {
  const source = page.sheets[sheet]?.source;
  if (source === undefined) return unpairedName(page);
  if ("file" in source) return `\`${source.file}\``;
  if ("style" in source) {
    return `\`<style>\` block ${source.style + 1} of \`${page.path}\``;
  }
  return `\`${source.url}\``;
}

/** What identifies sheet `sheet` of a page across pages: a project file
 * or a url by what it names — the same text wherever it is linked — and
 * a `<style>` block by its page and its place there. */
export function sheetKey(page: Page, sheet: number): string {
  const source = page.sheets[sheet]!.source;
  if ("file" in source) return `file\u0000${source.file}`;
  if ("url" in source) return `url\u0000${source.url}`;
  return `style\u0000${page.path}\u0000${source.style}`;
}

/** What a finding calls a mounted sheet no sheet of the page renders. */
function unpairedName(page: Page): string {
  return `a stylesheet of \`${page.path}\` with no file`;
}

/** How a finding addresses and names a rule a mounted copy holds. */
export interface WrittenRule {
  /** The finding's `rule`: the rule's position among the page's rules
   * (`readSheets`). A rule of a mounted sheet no page sheet renders is
   * numbered after all of those. */
  rule: number;
  /** The rule as the page's text writes it — what the finding quotes;
   * the copy's own for a sheet with no pair. */
  written: PageRule;
  /** The sheet it is written in (`sheetName`). */
  sheet: string;
  /** That sheet across pages (`sheetKey`): a sheet several pages link is
   * one key. A mounted sheet with no pair has a key of its own. */
  key: string;
  /** Its position among its sheet's rules: with `key`, the rule wherever
   * the sheet is linked, whatever the page numbers it. */
  at: number;
  /** Whether a finding may be about it: not a read-only sheet's. */
  editable: boolean;
}

/**
 * Each rule of each mounted sheet (`mounted`, the copy's `<style>`s in
 * cascade order, each read on its own), as the page writes it. Each is
 * paired with the first page sheet not yet paired whose rules have its
 * rules' shape, looking on from the last pair first (the copy's order is
 * the page's, a sheet that is not live skipped), then back: first the
 * whole shape — each rule's prelude and its declarations' properties and
 * values in order, a value the copy may have routed (one naming a
 * `url(`) matched by its property alone — so two sheets alike but for
 * their values (a light sheet and its alternate dark one) pair as
 * written; then, for a copy the face wrote otherwise (a remote sheet the
 * safety walk serialised again), each rule's prelude and declaration
 * count. A mounted sheet with no pair — a copy that is not the page's
 * text — is read as the copy holds it, named as a sheet of the page with
 * no file, and never a finding's subject: no edit could name what to
 * change.
 */
export function writtenRules(
  page: Page,
  read: ReadSheets,
  mounted: readonly (readonly PageRule[])[],
): WrittenRule[][] {
  const bySheet = read.blocks.map((_, sheet) =>
    read.rules.filter((rule) => rule.sheet === sheet),
  );
  const paired = new Set<number>();
  let next = 0;
  let extra = read.rules.length;
  return mounted.map((rules, copy) => {
    const pair = (same: Same): number => {
      const fits = (sheet: number): boolean =>
        !paired.has(sheet) && same(bySheet[sheet]!, rules);
      for (let s = next; s < bySheet.length; s++) if (fits(s)) return s;
      for (let s = 0; s < next; s++) if (fits(s)) return s;
      return -1;
    };
    let sheet = pair(sameRules);
    if (sheet < 0) sheet = pair(sameShape);
    if (sheet < 0) {
      return rules.map((rule, k) => ({
        rule: extra++,
        written: rule,
        sheet: unpairedName(page),
        key: `copy\u0000${page.path}\u0000${copy}`,
        at: k,
        editable: false,
      }));
    }
    paired.add(sheet);
    next = sheet + 1;
    const own = bySheet[sheet]!;
    return rules.map((_, k) => ({
      rule: own[k]!.index,
      written: own[k]!,
      sheet: sheetName(page, sheet),
      key: sheetKey(page, sheet),
      at: k,
      editable: editable(page, sheet),
    }));
  });
}

type Same = (a: readonly PageRule[], b: readonly PageRule[]) => boolean;

/** Each rule's prelude and declaration count, in order. */
function sameShape(a: readonly PageRule[], b: readonly PageRule[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (rule, i) =>
        rule.prelude === b[i]!.prelude &&
        rule.declarations.length === b[i]!.declarations.length,
    )
  );
}

/** `sameShape`, and each declaration's property and value: a value
 * naming a `url(` (which the copy routes) by its property alone. */
function sameRules(a: readonly PageRule[], b: readonly PageRule[]): boolean {
  return (
    sameShape(a, b) &&
    a.every((rule, i) =>
      rule.declarations.every((declaration, k) => {
        const other = b[i]!.declarations[k]!;
        if (declaration.property !== other.property) return false;
        return (
          declaration.value === other.value ||
          (ROUTED.test(declaration.value) && ROUTED.test(other.value))
        );
      }),
    )
  );
}

const ROUTED = /url\(/i;
