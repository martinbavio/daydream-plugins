import type {
  CssDeclaration,
  DaydreamApi,
  ElementId,
  PageStackRule,
  SheetSource,
} from "@daydream/plugin-api";

// Where a drag's CSS goes, and how it gets there. A drag writes the
// page's own text through an editing session (`dd.beginItemTransaction`,
// its `write`; decision #78): the winning declaration replaced in the rule that holds
// it, or a declaration appended to the rule that makes the element a
// grid, or — for an element no editable rule reaches — a new rule for
// its selector. Every frame of the drag is a write of that one rule; the
// release commits them as one undo step, and Escape cancels them all.

/** The rule a drag writes for a set of properties: the one whose
 * declaration wins on the element, with that declaration; or, when none
 * declares them, the rule to append to (`declaration` null); or a place
 * to add a rule; or the reason nothing can be written — the property is
 * set inline, or by a rule this page cannot save, or by a shorthand the
 * drag does not rewrite. */
export type Target =
  | {
      kind: "rule";
      viewportId: string;
      rule: PageStackRule;
      declaration: CssDeclaration | null;
    }
  | { kind: "add"; viewportId: string; sheet: SheetSource; selector: string }
  | { kind: "blocked"; why: "inline" | "readonly" | "shorthand" };

export type WritableTarget = Exclude<Target, { kind: "blocked" }>;

/** The declaration of one of `properties` that wins inside one block of
 * declarations: the last `!important` one, else the last — the kernel's
 * own rule for a rule's block (`dd.pageWinner`), applied here to the
 * block as each write re-reads it. */
function winningIn(
  dd: DaydreamApi,
  declarations: string,
  properties: readonly string[],
): CssDeclaration | null {
  let last: CssDeclaration | null = null;
  let important: CssDeclaration | null = null;
  for (const declaration of dd.core.cssDeclarations(declarations)) {
    if (!properties.includes(declaration.property)) continue;
    if (declaration.important === true) important = declaration;
    else last = declaration;
  }
  return important ?? last;
}

/**
 * The rule to write for `properties`, on the element's stack: the one
 * whose declaration wins on the element, as the kernel decides it
 * (`dd.pageWinner`: importance, the element's own style, the cascade
 * layers as declared, specificity, scope, source). An inline
 * declaration, a rule the page cannot save, or one of `shorthands`
 * blocks the write instead of landing it in a losing rule. When nothing
 * declares them: the most important editable rule that declares
 * `display: grid`, else the first editable rule, else a place to add
 * one. Null for anything not on a page, or a page with nowhere to write.
 */
export function findTarget(
  dd: DaydreamApi,
  elementId: ElementId,
  properties: readonly string[],
  shorthands: readonly string[] = [],
): Target | null {
  const stack = dd.pageStack(elementId);
  if (stack === null) return null;
  const { viewportId } = stack;
  const winner = dd.pageWinner(elementId, properties);
  if (winner !== null) {
    if (winner.rule === null) return { kind: "blocked", why: "inline" };
    if (!winner.rule.editable) return { kind: "blocked", why: "readonly" };
    if (shorthands.includes(winner.declaration.property)) {
      return { kind: "blocked", why: "shorthand" };
    }
    return {
      kind: "rule",
      viewportId,
      rule: winner.rule,
      declaration: winner.declaration,
    };
  }
  const editable = stack.rules.filter(
    (rule) => rule.active && rule.pseudo === undefined && rule.editable,
  );
  const gridRule = editable.find((rule) => {
    const display = winningIn(dd, rule.declarations, ["display"]);
    return display !== null && /grid/i.test(display.value);
  });
  const rule = gridRule ?? editable[0] ?? null;
  if (rule !== null)
    return { kind: "rule", viewportId, rule, declaration: null };
  const sheet = stack.sheets.find((each) => each.editable)?.source ?? null;
  const selector = dd.pageElement(elementId)?.selector ?? null;
  if (sheet === null || selector === null) return null;
  return { kind: "add", viewportId, sheet, selector };
}

/** `declarations` with `property: value` in place of the declaration of
 * that property that wins inside the block — the last `!important` one,
 * else the last, as `findTarget` chose it — its `!important` kept; or
 * appended on a line of its own when the rule has none. */
export function withDeclaration(
  dd: DaydreamApi,
  declarations: string,
  property: string,
  value: string,
): string {
  const winner = winningIn(dd, declarations, [property]);
  const text = `${property}: ${value}${winner?.important === true ? " !important" : ""};`;
  if (winner === null) {
    const kept = declarations.replace(/\s+$/, "");
    if (kept === "") return text;
    // The last declaration may have no `;` (the last of a block need
    // not): without one the new line would be part of its value.
    return `${kept}${kept.endsWith(";") ? "" : ";"}\n${text}`;
  }
  return (
    declarations.slice(0, winner.range[0]) +
    text +
    declarations.slice(winner.range[1])
  );
}

/** One drag's writes to its target rule, as one page transaction: every
 * frame a write, the release a commit — one undo step however long the
 * drag paused — and Escape a cancel, which takes every write back, the
 * rule or sheet an `add` created included, and records no step. */
export interface Writer {
  /** Write `property: value`; a sentence when the kernel refused it. */
  write(property: string, value: string): string | null;
  /** Write the rule's declarations back as they were at the press,
   * inside the session — a newborn pulled back to nothing. */
  reset(): void;
  /** Keep every write as one undo step. */
  commit(): void;
  /** Take every write back, and the step with it. */
  cancel(): void;
}

export function createWriter(dd: DaydreamApi, target: WritableTarget): Writer {
  const { viewportId } = target;
  const session = dd.beginItemTransaction();
  let key = target.kind === "rule" ? target.rule.key : null;
  let expected = target.kind === "rule" ? target.rule.declarations : "";
  const original = expected;
  return {
    write(property, value) {
      if (key === null) {
        if (target.kind !== "add") return "nowhere to write";
        const answer = session.write({
          kind: "add",
          viewportId,
          sheet: target.sheet,
          selector: target.selector,
          declarations: `${property}: ${value};`,
        });
        if (typeof answer === "string") return answer;
        key = answer.key;
        expected = answer.declarations;
        return null;
      }
      const declarations = withDeclaration(dd, expected, property, value);
      if (declarations === expected) return null;
      const answer = session.write({
        kind: "rule",
        viewportId,
        key,
        expected,
        declarations,
      });
      if (typeof answer === "string") return answer;
      key = answer.key;
      expected = answer.declarations;
      return null;
    },
    reset() {
      if (key === null || expected === original) return;
      const answer = session.write({
        kind: "rule",
        viewportId,
        key,
        expected,
        declarations: original,
      });
      if (typeof answer !== "string") {
        key = answer.key;
        expected = answer.declarations;
      }
    },
    commit: () => session.commit(),
    cancel: () => session.cancel(),
  };
}
