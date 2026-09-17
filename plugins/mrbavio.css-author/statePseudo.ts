// A rule's STATE pseudo-classes (decisions.md #71, plan phase 9): in a
// rule, `:hover` and its kin belong to the selector, never a condition
// (that is what tells a rule's `:hover` apart from an element's `&:hover`
// layer). Both the dead-rule finding (matchLint.ts) and the necessity
// lint (necessity.ts) need to tell a state-carrying selector apart from
// an ordinary one: nobody hovers or focuses a lint run, so a selector
// that matches only WITH a state active would read as matching nothing —
// the dead-rule check re-asks the state-stripped selector before calling
// it dead, and necessity skips a state selector's declarations outright
// (their liveliness is a browsing-mode question, decisions.md #53, not
// this lint's). One table, so the two lints can never drift on what
// counts as a state pseudo-class.
const STATE_PSEUDO_NAMES = [
  "focus-visible",
  "focus-within",
  "hover",
  "active",
  "focus",
] as const;

// Longest names first in the alternation, so `:focus-visible` never reads
// as a bare `:focus` followed by leftover text — a regex tries
// alternatives in order and a shorter prefix would otherwise win.
const PATTERN = STATE_PSEUDO_NAMES.join("|");

/** Non-global, so repeated `.test()` calls never trip over a shared
 * `lastIndex` (the classic footgun of a `g`-flagged regex reused by
 * `.test()`). */
const STATE_PSEUDO_TEST = new RegExp(`:(?:${PATTERN})(?![\\w-])`, "i");

/** Whether the selector carries a state pseudo-class at all — the
 * question the dead-rule and necessity lints ask before doing the more
 * expensive state-aware work. */
export function hasStatePseudo(selector: string): boolean {
  return STATE_PSEUDO_TEST.test(selector);
}

/** The selector with every state pseudo-class removed — what the
 * dead-rule finding re-asks the browser to match once the plain
 * `dd.ruleMatches` reads empty, since a `.card:hover` that would match
 * SOME element once hovered is not a rule that matches nothing
 * (decisions.md #71, plan phase 9). A fresh regex literal per call, so
 * this function is safe to call from a loop without lastIndex state. */
export function stripStatePseudo(selector: string): string {
  return selector.replace(new RegExp(`:(?:${PATTERN})(?![\\w-])`, "gi"), "");
}
