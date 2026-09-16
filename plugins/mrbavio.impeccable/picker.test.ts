import { describe, expect, test } from "vitest";

import { matchEntries, parseQuery } from "./pickerQuery";
import { sessionState } from "./variants";

const entries = ["bolder", "quieter", "layout", "delight", "end session"].map((id) => ({ id, title: id }));
const ids = (q: string) => matchEntries(entries, q).map((e) => e.id);

describe("the picker's line: first word the verb, the rest the brief", () => {
  test("parseQuery splits on the first space and trims", () => {
    expect(parseQuery("")).toEqual({ head: "", brief: "" });
    expect(parseQuery("bold")).toEqual({ head: "bold", brief: "" });
    expect(parseQuery("bolder ")).toEqual({ head: "bolder", brief: "" });
    expect(parseQuery("  bolder  keep the photo, louder CTA ")).toEqual({ head: "bolder", brief: "keep the photo, louder CTA" });
  });

  test("matching narrows on the first word only; an exact verb pins the list to itself", () => {
    expect(ids("")).toEqual(["bolder", "quieter", "layout", "delight", "end session"]);
    expect(ids("l")).toEqual(["bolder", "layout", "delight"]);
    expect(ids("lay")).toEqual(["layout"]);
    expect(ids("bolder keep the photo")).toEqual(["bolder"]);
    expect(ids("BOLDER anything at all")).toEqual(["bolder"]);
    // "end" alone still finds "end session"; the brief after it is ignored by the match.
    expect(ids("end")).toEqual(["end session"]);
    expect(ids("zzz")).toEqual([]);
  });

  test("a pick carries its brief, or none", () => {
    expect(sessionState({ seq: 1, exit: false, pick: { verb: "bolder", viewportId: "v", elementId: null, brief: "louder", at: 1 } }).pick).toEqual({
      verb: "bolder", viewportId: "v", elementId: null, brief: "louder", at: 1,
    });
    expect(sessionState({ seq: 1, exit: false, pick: { verb: "bolder", viewportId: "v", elementId: null, brief: 3, at: 1 } }).pick).toBeNull();
  });
});
