import { describe, expect, test } from "vitest";

import { droppedLegacyPick, sessionState } from "./pick";

describe("the session's storage", () => {
  test("sessionState reads what the page saved and nothing else", () => {
    expect(sessionState(undefined)).toEqual({ seq: 0, pick: null, exit: false });
    expect(sessionState({ seq: 4, exit: true, pick: { verb: "bolder", viewportId: "v", element: null, at: 1 } })).toEqual({
      seq: 4,
      exit: true,
      pick: { verb: "bolder", viewportId: "v", element: null, at: 1 },
    });
    expect(sessionState({ seq: 1, pick: { verb: "bolder", viewportId: "v", element: "#card", at: 1 } }).pick).toEqual({
      verb: "bolder",
      viewportId: "v",
      element: "#card",
      at: 1,
    });
    expect(sessionState({ seq: "x", pick: { verb: 1 } }).pick).toBeNull();
    // A pick an older version saved with its round: the round is read
    // past, since nothing counts a round now.
    expect(sessionState({ seq: 1, pick: { verb: "bolder", viewportId: "v", element: null, round: "k3x9q2", at: 1 } }).pick).toEqual({
      verb: "bolder",
      viewportId: "v",
      element: null,
      at: 1,
    });
    // A pick saved before pages named its element by its id in the tree,
    // which no page has: it is not read back, and the canvas is told so.
    const legacy = { seq: 2, pick: { verb: "bolder", viewportId: "v", elementId: "el_1", at: 1 } };
    expect(sessionState(legacy).pick).toBeNull();
    expect(droppedLegacyPick(legacy)).toBe(true);
    // One for the whole page loses nothing: read back as a page's.
    const whole = { seq: 2, pick: { verb: "bolder", viewportId: "v", elementId: null, at: 1 } };
    expect(sessionState(whole).pick).toEqual({ verb: "bolder", viewportId: "v", element: null, at: 1 });
    expect(droppedLegacyPick(whole)).toBe(false);
    expect(droppedLegacyPick({ seq: 1, pick: { verb: "bolder", viewportId: "v", element: "#card", at: 1 } })).toBe(false);
    expect(droppedLegacyPick(undefined)).toBe(false);
  });
});
