import { describe, expect, test } from "vitest";
import { textPayloadProblem } from "./model";

describe("the text kind's payload rules", () => {
  const problem = (payload: unknown): string | null =>
    textPayloadProblem(payload, "items[0].payload");

  test("preserves meaningful plain text exactly", () => {
    expect(problem({ text: "  Hello\n🙂  " })).toBeNull();
  });

  test("rejects missing, non-string and whitespace-only content", () => {
    expect(problem(undefined)).toBe("items[0].payload is not a text payload");
    expect(problem({ text: 7 })).toBe(
      "items[0].payload.text must be a non-empty string",
    );
    expect(problem({ text: " \n\t " })).toBe(
      "items[0].payload.text must be a non-empty string",
    );
    expect(problem({ text: "Hello", color: "red" })).toBe(
      "items[0].payload may only contain text and fontSize",
    );
  });

  test("allows persisted font size but rejects non-positive or non-finite sizes", () => {
    expect(problem({ text: "Hello", fontSize: 40 })).toBeNull();
    for (const fontSize of [0, -1, NaN, Infinity, "24px", null]) {
      expect(problem({ text: "Hello", fontSize })).toBe(
        "items[0].payload.fontSize must be a positive finite number",
      );
    }
  });
});
