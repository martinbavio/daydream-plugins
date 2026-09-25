// Blocks and declarations as `dd.core.cssBlocks` and
// `dd.core.cssDeclarations` hand them, written by hand, so a test of what
// this plugin makes of them runs under node, with no kernel: the scan is
// the kernel's, tested there and, as the lints read it, in
// pageCss.kernel.test.ts. Plain text only — a list is split at each `;`
// and a declaration at its first `:`, which no string, comment or bracket
// written here holds — and every range points nowhere, `[0, 0]`.

import type { CssBlock, CssDeclaration } from "@daydream/plugin-api";

/** `a: b; c: d !important` as declarations: a custom property's name as
 * written, any other lower-cased. */
export function decls(text: string): CssDeclaration[] {
  return text
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const colon = part.indexOf(":");
      const name = part.slice(0, colon).trim();
      let value = part.slice(colon + 1).trim();
      const important = /!\s*important$/i.test(value);
      if (important) value = value.replace(/!\s*important$/i, "").trim();
      return {
        property: name.startsWith("--") ? name : name.toLowerCase(),
        value,
        important,
        range: [0, 0],
      };
    });
}

/** A rule with a block — a style rule or an at-rule — its own
 * declarations, and the blocks nested in it. */
export function block(
  prelude: string,
  declarations = "",
  children: CssBlock[] = [],
): CssBlock {
  return {
    prelude,
    range: [0, 0],
    statement: false,
    declarations: decls(declarations),
    children,
  };
}

/** A statement at-rule (`@import url(x.css)`, `@layer a, b`). */
export function statement(prelude: string): CssBlock {
  return { prelude, range: [0, 0], statement: true, declarations: [], children: [] };
}
