// The static lint's rule 5 over the kernel's scan (`dd.core.cssBlocks`):
// where a stray `;` lands in a prelude is the scan's to say, read as
// Chromium's parser reads it (the kernel's cssBlocks.browser.test.ts
// holds the scan to the browser's parse), and this is what the lint makes
// of it — one finding per stray `;` that drops a rule, none where a `;`
// drops nothing. The sentences themselves are staticLint.rules.test.ts's.
// It needs the kernel's code, so it runs from a Daydream checkout
// (`pnpm test:kernel`, README.md), under node.
import { describe, expect, test } from "vitest";

import type { Finding } from "@daydream/plugin-api";
import { coreApi } from "@daydream/plugin-testing";

import { pageRules } from "./pageCss";
import { lintStrayDelimiters } from "./staticLint";

const core = coreApi();

function strays(css: string): string[] {
  const out: Finding[] = [];
  lintStrayDelimiters(css, core.cssBlocks(css), "`v1.css`", out);
  return out.map((finding) => finding.message);
}

const drops = (before: string, rule: string, where = "", line = 1): string =>
  `the stray \`;\` before \`${before}\`${where} on line ${line} of \`v1.css\` makes the browser drop ${rule}; remove it`;

describe("a stray `;` that drops a rule, over the kernel's scan", () => {
  test("at the sheet's top level", () => {
    expect(strays(".a { color: red } ; .b { color: blue } .c { color: green }")).toEqual([
      drops(".b", "the rule `.b`"),
    ]);
    expect(strays(".a {\n  color: red;\n};\n\n.b { color: blue }")).toEqual([
      drops(".b", "the rule `.b`", "", 3),
    ]);
  });

  test("inside a @media block, a statement after the `;` dropped with the rule", () => {
    expect(strays("@media all {\n  .a { color: red }\n  ; .b { color: blue }\n}")).toEqual([
      drops(".b", "the rule `.b`", " in `@media all`", 3),
    ]);
    expect(strays("@media all { ; @layer q; .c { color: green } .d { color: red } }")).toEqual([
      drops("@layer q; .c", "`@layer q` and the rule `.c`", " in `@media all`"),
    ]);
  });

  test("inside @layer, @supports, @container and @starting-style blocks", () => {
    expect(
      strays(
        [
          "@layer x { ; .b { color: blue } .c { color: green } }",
          "@supports (display: grid) { ; .b { color: blue } }",
          "@container (width > 0px) { ;; .b { color: blue } }",
          "@starting-style { ; .b { opacity: 0 } }",
          "@layer a { @media all { .a;b { color: red } .c { color: red } } }",
        ].join("\n"),
      ),
    ).toEqual([
      drops(".b", "the rule `.b`", " in `@layer x`"),
      drops(".b", "the rule `.b`", " in `@supports (display: grid)`", 2),
      drops(".b", "the rule `.b`", " in `@container (width > 0px)`", 3).replace("stray `;`", "stray `;;`"),
      drops(".b", "the rule `.b`", " in `@starting-style`", 4),
      "the stray `;` after `.a` in `@layer a › @media all` on line 5 of `v1.css` makes the browser drop the rule `.a;b` whole; remove the `;`, and `.a` too if it is a leftover",
    ]);
  });

  test("inside @keyframes, a keyframe after one is dropped", () => {
    expect(strays("@keyframes k { ; from { top: 0 } to { top: 1px } }")).toEqual([
      drops("from", "the keyframe `from`", " in `@keyframes k`"),
    ]);
  });

  test("a trailing `;` with no rule after it drops nothing", () => {
    expect(strays(".a { color: red } ;")).toEqual([]);
    expect(strays("@media all { .a { color: red } ; }")).toEqual([]);
    expect(strays("@layer a, b; .a { color: red };")).toEqual([]);
  });

  test("a `;` inside a string, a comment or an attribute selector, or escaped, is none", () => {
    expect(
      strays(
        [
          '.a[data-x=";"] { color: red }',
          ".a /* ; */ .b { color: red }",
          "/* ; */ .c { color: red }",
          '.d { content: ";"; background: url(data:image/png;base64,AAAA) }',
          "[title='a;b'] { color: red }",
          ".e\\;f { color: red }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("among an @scope's own declarations a `;` ends one, or nothing", () => {
    expect(
      strays("@scope (.r) { ; .b { color: blue } color: red; .c { color: red }; }"),
    ).toEqual([]);
  });

  test("nested in a style rule a `;` ends a declaration, or nothing", () => {
    expect(
      strays(
        [
          ".p { ; .b { color: blue } }",
          ".p { color: red; .b { color: blue }; .c { color: red } }",
          ".p { @media all { ; .b { color: blue } .c { color: red } } }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("the rule it drops is none of the page's rules, so no other walk judges it", () => {
    expect(
      pageRules(core.cssBlocks(".a { color: red } ; .b { width: 100 } @media all { ; .c { color: red } .d { color: red } }")).map(
        (rule) => rule.prelude,
      ),
    ).toEqual([".a", ".d"]);
  });
});
