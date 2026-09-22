// RULE-AGAINST-RULE REDUNDANCY, the pure part (decision #71; the CSS
// author's review after the selectors step landed): a rule's declaration
// that restates, for EVERY element the rule reaches, exactly what the
// next rule beneath it in that element's cascade already sets — the
// declaration decides nothing anywhere, one level up from the
// element-versus-rule redundancy matchLint.ts already reports. Pure and
// DOM-free on purpose: matching is the browser's (matchLint.ts asks the
// mounted document and hands the ranked matches in here), so this file
// can be proved under node from ranked-match literals alone.
//
// WHAT COUNTS. For a rule A and a property p, walk each reached element's
// winner-first list from A downward to the first rule beneath that
// declares p — or anything RELATED to p, since a shorthand and its
// longhands cascade together: `margin-top: 4px` sitting between two
// `margin: 0` rules is exactly what A's line holds off, and removing it
// would change the page. Redundant only when, for every reached element,
// that rule is CERTAIN — unconditional and free of state pseudo-classes,
// so it applies whenever A does — carries p at the identical verbatim
// value, and declares nothing else related to p (a `margin: 0` beside a
// `margin-top: 4px` in the same rule is not the same margin). Any element
// where the next declarer beneath is conditional, a state rule, absent,
// merely related, or different makes A's p genuinely load-bearing
// somewhere, and there is no finding. "Related" is approximate on
// purpose and errs toward related — same first segment (`margin` ↔
// `margin-top`, `border` ↔ `border-top-color`, `font` ↔ `font-size`),
// `all`, and the few groups whose names share no prefix (`inset` and the
// four sides, `gap` and its two, `place-*` with `align-*`/`justify-*`) —
// so a false "related" only withholds a finding, never invents one. A itself is judged only when
// certain by the same test; a rule matching nothing is the dead-rule
// finding's, never this one's; and a rule reaching some element through a
// `::before`-style member styles a box of its own and is left alone
// entirely. What sits ABOVE A is never read here: a nearer rule shadowing
// A's p makes A's line dead, which the necessity lint (removal, re-read)
// reports as such.

/** A rule as the judgment reads it: its selector, the at-rules it sits
 * inside, and its declarations as a map, later wins (pageCss.ts
 * `declarationMap` over a page rule). */
export interface RedundancyRule {
  selector: string;
  conditions?: readonly string[];
  styles: Record<string, string>;
}

/** One rule matching one element, in the element's winner-first list
 * (matchLint.ts's own ranking: specificity descending, then later index
 * first). `pseudo` is present exactly when the matching member ended in
 * a pseudo-element. */
export interface RankedMatch {
  index: number;
  pseudo?: string | undefined;
}

/** A rule declaration redundant everywhere the rule reaches: `restates`
 * names the rule(s) beneath that already set it — one per reached
 * element, deduplicated, ascending. */
export interface RuleRestatement {
  rule: number;
  property: string;
  value: string;
  restates: number[];
}

/** Shorthand families whose member names share no prefix; everything else
 * a shorthand covers shares its first segment. */
const RELATED_GROUPS: readonly (readonly string[])[] = [
  [
    "inset",
    "top",
    "right",
    "bottom",
    "left",
    "inset-block",
    "inset-inline",
    "inset-block-start",
    "inset-block-end",
    "inset-inline-start",
    "inset-inline-end",
  ],
  ["gap", "row-gap", "column-gap"],
  ["place-items", "align-items", "justify-items"],
  ["place-content", "align-content", "justify-content"],
  ["place-self", "align-self", "justify-self"],
];

/** Whether declaring `other` can touch what `property` sets (see the
 * header). A custom property relates to nothing but itself. */
export function relatedProperties(property: string, other: string): boolean {
  if (property === other) return true;
  if (property.startsWith("--") || other.startsWith("--")) return false;
  if (property === "all" || other === "all") return true;
  if (property.split("-")[0] === other.split("-")[0]) return true;
  return RELATED_GROUPS.some(
    (group) => group.includes(property) && group.includes(other),
  );
}

/** Every redundant rule declaration in `sheet`, given each mounted
 * element's ranked matches (`matches`: element → winner-first list, the
 * key only telling the elements apart)
 * and the state-pseudo-class test (statePseudo.ts's `hasStatePseudo`,
 * handed in so this file stays free of any selector reading). */
export function ruleRestatements(
  sheet: readonly RedundancyRule[],
  matches: ReadonlyMap<unknown, readonly RankedMatch[]>,
  hasState: (selector: string) => boolean,
): RuleRestatement[] {
  const out: RuleRestatement[] = [];
  const uncertain = (rule: RedundancyRule): boolean =>
    (rule.conditions !== undefined && rule.conditions.length > 0) ||
    hasState(rule.selector);

  sheet.forEach((rule, index) => {
    if (uncertain(rule)) return;
    // The elements this rule reaches, each with its whole ranked list; a
    // pseudo-element match anywhere takes the rule out of the question.
    const reached: (readonly RankedMatch[])[] = [];
    for (const list of matches.values()) {
      const own = list.find((match) => match.index === index);
      if (own === undefined) continue;
      if (own.pseudo !== undefined) return;
      reached.push(list);
    }
    if (reached.length === 0) return;

    for (const [property, value] of Object.entries(rule.styles)) {
      const beneath = new Set<number>();
      let everywhere = true;
      for (const list of reached) {
        const at = list.findIndex((match) => match.index === index);
        let found: number | null = null;
        for (let k = at + 1; k < list.length; k++) {
          const match = list[k] as RankedMatch;
          if (match.pseudo !== undefined) continue;
          const other = sheet[match.index];
          if (other === undefined) continue;
          const touching = Object.keys(other.styles).filter((name) =>
            relatedProperties(property, name),
          );
          if (touching.length === 0) continue;
          // The first rule beneath that touches p decides: it must BE p,
          // alone among its related names, certain, and identical.
          if (
            touching.length === 1 &&
            touching[0] === property &&
            !uncertain(other) &&
            other.styles[property] === value
          ) {
            found = match.index;
          }
          break;
        }
        if (found === null) {
          everywhere = false;
          break;
        }
        beneath.add(found);
      }
      if (everywhere) {
        out.push({
          rule: index,
          property,
          value,
          restates: [...beneath].sort((a, b) => a - b),
        });
      }
    }
  });
  return out;
}
