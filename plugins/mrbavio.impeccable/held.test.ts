// A waiting pick's element followed through edits of its page's text
// (held.ts): where its span goes, and whether the element a selector
// names after an edit is still the one picked.
import { describe, expect, test } from "vitest";

import { follow, followSpan, holdAt, isHeld, type Span } from "./held";

const PAGE = "<main><p>a</p><p>b</p></main>";
/** `<p>b</p>` in PAGE. */
const B: Span = { start: 14, end: 22 };

const spanOf = (html: string, written: string, from = 0): Span => {
  const start = html.indexOf(written, from);
  return { start, end: start + written.length };
};

describe("an element's span through an edit", () => {
  test("an edit after it leaves it; one before it moves it; one inside it grows it", () => {
    expect(PAGE.slice(B.start, B.end)).toBe("<p>b</p>");
    expect(followSpan(PAGE, "<main><p>a</p><p>b</p><p>c</p></main>", B)).toEqual(B);
    const before = "<main><h1>t</h1><p>a</p><p>b</p></main>";
    expect(followSpan(PAGE, before, B)).toEqual(spanOf(before, "<p>b</p>"));
    const inside = '<main><p>a</p><p class="x">bb</p></main>';
    expect(followSpan(PAGE, inside, B)).toEqual(spanOf(inside, '<p class="x">bb</p>'));
    expect(followSpan(PAGE, PAGE, B)).toBe(B);
  });

  test("an edit across one of its edges loses it", () => {
    // `<p>a</p><p>b</p>` rewritten as one paragraph.
    expect(followSpan(PAGE, "<main><p>ab</p></main>", B)).toBeNull();
  });
});

describe("is the element a selector names the held one", () => {
  test("where the held one went: yes; another element: no", () => {
    const held = holdAt(PAGE, B);
    expect(held).toMatchObject({ tag: "p", written: "<p>b</p>" });
    // A paragraph before both: `p:nth-of-type(2)` now names "a".
    const html = "<main><p>new</p><p>a</p><p>b</p></main>";
    const moved = follow(held, html);
    expect(isHeld(moved, html, spanOf(html, "<p>b</p>"))).toBe(true);
    expect(isHeld(moved, html, spanOf(html, "<p>a</p>"))).toBe(false);
  });

  test("an element of another tag is not it, even where it went", () => {
    const held = holdAt(PAGE, B);
    const html = "<main><p>a</p><h2>b</h2></main>";
    const found = spanOf(html, "<h2>b</h2>");
    expect(isHeld(follow(held, html), html, found)).toBe(false);
  });

  test("a twin written beside it: the one written exactly as it was is it", () => {
    // Which of two identical paragraphs is new, the text cannot tell: the
    // edit reads as after the first, so the span stays there, and the
    // selector names the second, written as the held one was.
    const html = "<main><p>a</p><p>b</p><p>b</p></main>";
    const moved = follow(holdAt(PAGE, B), html);
    expect(isHeld(moved, html, spanOf(html, "<p>b</p>", 20))).toBe(true);
  });
});
