// A page file's line breaks kept as written under the editor's `\n`s
// (lineBreaks.ts); the editor wiring is the browser tests'
// (plugin.browser.test.tsx, "a CRLF page").
import { describe, expect, test } from "vitest";

import {
  editorOffset,
  fileOffset,
  joinBreaks,
  spliceBreaks,
  splitBreaks,
} from "./lineBreaks";

describe("splitBreaks and joinBreaks", () => {
  test("every break is kept as written, and put back", () => {
    for (const file of ["a\r\nb\r\nc", "a\nb\rc\r\nd", "one line", "", "\r\n\r\n", "a\r"]) {
      const { text, breaks, eol } = splitBreaks(file);
      expect(text.includes("\r")).toBe(false);
      expect(joinBreaks(text, breaks, eol)).toBe(file);
    }
  });

  test("a typed break is written as the file writes most of its own; `\\n` in a file of one line", () => {
    expect(splitBreaks("a\r\nb\r\nc\nd").eol).toBe("\r\n");
    expect(splitBreaks("a\nb\r\nc").eol).toBe("\n");
    expect(splitBreaks("a\rb").eol).toBe("\r");
    expect(splitBreaks("a").eol).toBe("\n");
    expect(joinBreaks("a\nb\nc", ["\r\n"], "\r\n")).toBe("a\r\nb\r\nc");
  });
});

describe("spliceBreaks", () => {
  test("an edit changes only the breaks it removes or types", () => {
    // Lines a, b, c, d: breaks \r\n, \n, \r. A change joining b and c
    // (removing break 1) and typing two breaks at the end of d.
    expect(
      spliceBreaks(
        ["\r\n", "\n", "\r"],
        [
          { at: 1, removed: 1, added: 0 },
          { at: 3, removed: 0, added: 2 },
        ],
        "\r\n",
      ),
    ).toEqual(["\r\n", "\r", "\r\n", "\r\n"]);
  });
});

describe("fileOffset and editorOffset", () => {
  const file = "a\r\nbc\nd\r\ne";
  const { text, breaks } = splitBreaks(file);

  test("each character of the editor's text is the same one of the file's", () => {
    for (let at = 0; at <= text.length; at++) {
      const f = fileOffset(text, breaks, at);
      if (at < text.length && text[at] !== "\n") expect(file[f]).toBe(text[at]);
      expect(editorOffset(text, breaks, f)).toBe(at);
    }
  });

  test("a place inside a `\\r\\n` is the break's start; past the end is the end", () => {
    expect(editorOffset(text, breaks, 2)).toBe(1);
    expect(editorOffset(text, breaks, file.length + 5)).toBe(text.length);
  });
});
