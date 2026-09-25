// AN EXPLICIT INITIAL VALUE (the static gate's rule 2): which declarations
// restate a property's initial value, the candidates matchLint.ts then
// MEASURES. `position: static` changes nothing where the element would
// have had `static` anyway — but whether it would is the UA sheet's and
// the cascade's to say, not a table's: `<dialog open>` is `position:
// absolute` in Chromium's html.css and `[popover]` `position: fixed` with
// `inset: 0`, a `fieldset` has `min-inline-size: min-content`, an `img`
// or an `hr` clips its overflow, and a page may use any element HTML has
// (decision #76). So a candidate is a finding only once cutting it from
// the mounted page leaves every element it reaches computing what it did
// (matchLint.ts lintRestatedInitials). Pure and DOM-free; the choice
// of candidates is proved over rules the kernel's scan reads
// (initialValues.browser.test.ts).
//
// The table is restricted to NON-INHERITED properties: an inherited one
// (letter-spacing, text-transform, visibility, …) restated at its initial
// under an ancestor that changed it is a real reset, and a line an
// inheriting child reads is not the element's alone to measure.
// `outline-offset: 0` is deliberately absent — the UA sheet sets it on
// focused form controls, a state no lint run is in. An `!important`
// declaration is never judged: it is there to win, which a reset may need
// to.

import type { CssDeclaration } from "@daydream/plugin-api";

import { isCertain } from "./certain";
import type { PageRule } from "./pageCss";

/** Each property the rule judges, and its initial value. */
const INITIAL_VALUES: ReadonlyMap<string, string> = new Map([
  ["position", "static"],
  ["float", "none"],
  ["clear", "none"],
  ["z-index", "auto"],
  ["top", "auto"],
  ["right", "auto"],
  ["bottom", "auto"],
  ["left", "auto"],
  ["inset", "auto"],
  ["flex-direction", "row"],
  ["flex-wrap", "nowrap"],
  ["flex-grow", "0"],
  ["flex-shrink", "1"],
  ["flex-basis", "auto"],
  ["opacity", "1"],
  ["transform", "none"],
  ["max-width", "none"],
  ["max-height", "none"],
  ["min-width", "auto"],
  ["min-height", "auto"],
  ["overflow", "visible"],
  ["box-shadow", "none"],
]);

/** Whether the declaration restates its property's initial value, as
 * written (case and surrounding space aside), and is not `!important`. */
export function restatesInitial(declaration: CssDeclaration): boolean {
  if (declaration.important) return false;
  const initial = INITIAL_VALUES.get(declaration.property);
  return (
    initial !== undefined && declaration.value.toLowerCase() === initial
  );
}

/** The rules' declarations the rule judges, in source order: those that
 * restate an initial in a rule that applies wherever it matches
 * (certain.ts) — where it holds as it does for an element's own style,
 * and one read of the page sees what it does. A rule inside an `@media`,
 * `@container`, `@supports` or `@starting-style`, or under `:hover`,
 * exists to override something under that condition or in that state,
 * and resetting to the initial there is the override, which no single
 * read of the page can see. A nested rule resetting what its parent set
 * is an override the measure sees. */
export function ruleInitialCandidates(
  rules: readonly PageRule[],
): { rule: PageRule; declaration: CssDeclaration }[] {
  return rules.flatMap((rule) =>
    isCertain(rule)
      ? rule.declarations
          .filter(restatesInitial)
          .map((declaration) => ({ rule, declaration }))
      : [],
  );
}
