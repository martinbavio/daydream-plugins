import { describe, expect, test } from "vitest";

import { boldSegments, parseNotes } from "./notesFormat";

describe("parseNotes", () => {
  test("splits blank-line-separated paragraphs and unwraps hard breaks", () => {
    const blocks = parseNotes(
      "**What this teaches.** One thing\nwrapped hard.\n\nSecond paragraph.",
    );
    expect(blocks).toEqual([
      {
        type: "paragraph",
        text: "**What this teaches.** One thing wrapped hard.",
      },
      { type: "paragraph", text: "Second paragraph." },
    ]);
  });

  test("parses numbered lists with hard-wrapped continuations", () => {
    const blocks = parseNotes(
      "**Try this.**\n\n1. First experiment\n   continued line.\n2. Second.",
    );
    expect(blocks[1]).toEqual({
      type: "list",
      items: ["First experiment continued line.", "Second."],
    });
  });

  test("drops empty blocks", () => {
    expect(parseNotes("\n\n  \n\nOnly one.")).toEqual([
      { type: "paragraph", text: "Only one." },
    ]);
  });

  test("boldSegments marks odd segments as bold", () => {
    expect(boldSegments("**Bold.** plain **again**")).toEqual([
      "",
      "Bold.",
      " plain ",
      "again",
      "",
    ]);
  });
});
