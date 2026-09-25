// A RULE THAT IS CERTAIN: one that applies wherever its selector matches,
// at every width and in every state — so what it sets is what an element
// it reaches gets whenever it reaches it, cascade aside. Every judgment
// that leans on a rule applying asks this one question, here: whether an
// element's own line or a rule's restates it (matchLint.ts,
// ruleRedundancy.ts), whether its restated initial is a candidate
// (initialValues.ts), and whether the necessity lint judges an element's
// line together with it (necessity.ts). Pure, so it is proved under node
// (certain.test.ts).
//
// What gates a rule is an at-rule that holds at one width, in one
// browser or at one moment and not at another — `@media`, `@supports`,
// `@container`, `@starting-style` — and a state pseudo-class, which
// nobody is in during a lint run: in its selector (a nested rule's is
// resolved against its parents, pageCss.ts, so a parent's state is in
// it) or in the roots or limits of an `@scope` around it. `@layer` and
// `@scope` gate nothing by themselves: a layer changes where a rule
// ranks, never whether it applies, and a scope's reach is in the match
// (ruleMatch.ts). Nesting gates nothing either.

import { atKeyword, type PageScope } from "./pageCss";
import { hasStatePseudo } from "./statePseudo";

/** The at-rules that never gate a rule. */
const UNGATED: ReadonlySet<string> = new Set(["layer", "scope"]);

/** Whether the rule applies wherever its selector matches (see the
 * header). A rule written by hand for a test may leave out the at-rules
 * or the scopes it has none of. */
export function isCertain(rule: {
  selector: string;
  conditions?: readonly string[];
  scopes?: readonly PageScope[];
}): boolean {
  if (hasStatePseudo(rule.selector)) return false;
  const gated = (rule.conditions ?? []).some(
    (condition) => !UNGATED.has(atKeyword(condition) ?? ""),
  );
  if (gated) return false;
  return (rule.scopes ?? []).every(
    ({ start, end }) =>
      !hasStatePseudo(start ?? "") && !hasStatePseudo(end ?? ""),
  );
}
