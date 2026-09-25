// What a container query NEEDS and what a declaration list PROVIDES — the
// text half of "a container query with no container to ask"
// (matchLint.ts). Pure, so it is proved under node (containers.test.ts).
//
// `@container` matches against the nearest ANCESTOR that is a query
// container for what the condition asks (css-contain-3 §4.1, css-contain-4
// §5): a SIZE feature (`(width > 400px)`, `(min-width: …)`, `(orientation:
// …)`) needs `container-type: size | inline-size`; `scroll-state(…)` needs
// `container-type: scroll-state`; `style(…)` needs nothing — every element
// is a style container — so a style-only query is never flagged, named or
// not. A named query further needs the satisfying ancestor to carry the
// name, via `container-name` or the shorthand's first half.

import type { CssDeclaration } from "./pageCss";

/** The `<container-name>` a prelude asks for (null for an unnamed query)
 * and the condition after it. The name is the first token after
 * `@container` when it is an ident followed by whitespace — `card (…)`,
 * `card not (…)`. `not (…)` opens a condition, and `style(…)` /
 * `scroll-state(…)` run straight into their parenthesis, so neither reads
 * as a name. */
export function splitContainerPrelude(prelude: string): {
  name: string | null;
  condition: string;
} {
  const rest = prelude.replace(/^@container/i, "").trim();
  const match = /^(-?[a-z_][\w-]*)(?=\s)/i.exec(rest);
  if (match === null || (match[1] as string).toLowerCase() === "not") {
    return { name: null, condition: rest };
  }
  const name = match[1] as string;
  return { name, condition: rest.slice(name.length).trim() };
}

export interface QueryNeeds {
  size: boolean;
  scrollState: boolean;
}

/** Which container-type kinds the condition's features need. Every `(` is
 * classified by what precedes and follows it: `style(` is a style feature
 * (skipped whole, nested parens included), `scroll-state(` a scroll-state
 * one, another `ident(` a general-enclosed unknown (never true, never
 * flagged); a bare `(` followed by `not`, another `(`, or a function is a
 * grouping paren, and a bare `(` followed by anything else — `(width …`,
 * `(min-width: …)`, `(orientation: …)` — is a size feature. */
export function queryNeeds(condition: string): QueryNeeds {
  const needs: QueryNeeds = { size: false, scrollState: false };
  for (let i = 0; i < condition.length; i++) {
    if (condition[i] !== "(") continue;
    const ident = identBefore(condition, i);
    if (ident === "style") {
      i = closingParen(condition, i);
      continue;
    }
    if (ident === "scroll-state") {
      needs.scrollState = true;
      i = closingParen(condition, i);
      continue;
    }
    if (ident !== "") continue;
    const after = condition.slice(i + 1).trimStart();
    if (
      after.startsWith("(") ||
      /^not(?![\w-])/i.test(after) ||
      /^[a-z-]+\(/i.test(after)
    ) {
      continue; // grouping, not a feature of its own
    }
    needs.size = true;
  }
  return needs;
}

function identBefore(text: string, at: number): string {
  let start = at;
  while (start > 0 && /[a-z-]/i.test(text[start - 1] as string)) start--;
  return text.slice(start, at).toLowerCase();
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
}

/** What an element declares about being a query container, gathered from
 * every declaration list that reaches it — its own style, and every rule
 * matching it under any condition, since a lint that cannot know at which
 * width the query is asked must count them all. */
export interface ContainerDeclaration {
  /** `container-type: size | inline-size` — what size features query. */
  size: boolean;
  /** `container-type: scroll-state` — what scroll-state() queries. */
  scrollState: boolean;
  names: Set<string>;
  /** A `var()` in a container declaration: what it types or names is the
   * browser's to say at computed-value time, so it satisfies anything —
   * the lint must never flag a query the browser could match. */
  unknown: boolean;
}

export function emptyContainerDeclaration(): ContainerDeclaration {
  return { size: false, scrollState: false, names: new Set(), unknown: false };
}

/** One declaration list's contribution, merged into `into`. Within one
 * list the type is the cascade's: an `!important` declaration outlasts
 * every normal one, and among the same importance the later wins — an
 * unslashed `container: card` written after a `container-type` resets
 * the type, one written after a `container-type: … !important` does not.
 * Names gather on top: `container-name` and the shorthand's pre-slash
 * half, each a space-separated ident list where `none` names nothing. */
export function mergeContainerDeclaration(
  into: ContainerDeclaration,
  declarations: readonly CssDeclaration[],
): void {
  let type: string[] | null = null;
  let typeImportant = false;
  for (const { property, value, important } of declarations) {
    if (
      property !== "container-name" &&
      property !== "container-type" &&
      property !== "container"
    ) {
      continue;
    }
    if (/var\(/i.test(value)) {
      into.unknown = true;
      continue;
    }
    const slash = value.indexOf("/");
    if (important || !typeImportant) {
      if (property === "container-type") type = typeTokens(value);
      else if (property === "container") {
        type = slash === -1 ? [] : typeTokens(value.slice(slash + 1));
      }
      if (property !== "container-name") typeImportant = important;
    }
    if (property === "container-type") continue;
    const list = property === "container" && slash !== -1 ? value.slice(0, slash) : value;
    for (const ident of list.trim().split(/\s+/)) {
      if (ident !== "" && ident.toLowerCase() !== "none") into.names.add(ident);
    }
  }
  if (type === null) return;
  if (type.includes("size") || type.includes("inline-size")) into.size = true;
  if (type.includes("scroll-state")) into.scrollState = true;
}

/** What an element IS, as the browser computed it — its `container-type`
 * and `container-name` read from a mounted copy — in the same terms: the
 * cascade's answer at that copy's width, `!important`, `var()` and
 * `inherit` resolved. */
export function computedContainer(
  containerType: string,
  containerName: string,
): ContainerDeclaration {
  const type = typeTokens(containerType);
  const names = containerName.trim().split(/\s+/);
  return {
    size: type.includes("size") || type.includes("inline-size"),
    scrollState: type.includes("scroll-state"),
    names: new Set(names.filter((name) => name !== "" && name !== "none")),
    unknown: false,
  };
}

function typeTokens(type: string): string[] {
  return type.trim().toLowerCase().split(/\s+/);
}

/** Whether a container declaration answers a query's needs, and its name
 * when it asks for one. */
export function satisfies(
  declaration: ContainerDeclaration,
  needs: QueryNeeds,
  name: string | null,
): boolean {
  if (declaration.unknown) return true;
  const typed =
    (!needs.size || declaration.size) &&
    (!needs.scrollState || declaration.scrollState);
  return typed && (name === null || declaration.names.has(name));
}
