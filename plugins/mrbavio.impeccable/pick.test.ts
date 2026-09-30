import { describe, expect, test } from "vitest";

import { sessionState } from "./pick";

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
    // Anything the file holds beside the pick's own fields is read past.
    expect(sessionState({ seq: 1, pick: { verb: "bolder", viewportId: "v", element: null, round: "k3x9q2", at: 1 } }).pick).toEqual({
      verb: "bolder",
      viewportId: "v",
      element: null,
      at: 1,
    });
    // A pick with no element field names nothing: not read back.
    expect(sessionState({ seq: 2, pick: { verb: "bolder", viewportId: "v", elementId: "el_1", at: 1 } }).pick).toBeNull();
  });
});
