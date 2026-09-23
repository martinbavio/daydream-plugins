// The rebase of typed text onto a page that changed underneath: the
// typing as one span over the text it started from, carried onto the page
// as it is now when the other change left that span's place alone.
import { describe, expect, test } from "vitest";

import { rebase } from "./rebase";

const BASE = "<h1>Old headline</h1>\n<p>Body copy</p>\n";

describe("rebase", () => {
  test("typing before the other change is carried onto it", () => {
    const typed = BASE.replace("Old headline", "Mine");
    const current = BASE.replace("Body copy", "An agent's copy");
    expect(rebase(BASE, typed, current)).toBe(
      "<h1>Mine</h1>\n<p>An agent's copy</p>\n",
    );
  });

  test("typing after the other change is carried onto it, shifted", () => {
    const typed = BASE.replace("Body copy", "My copy");
    const current = BASE.replace("Old headline", "A much longer headline");
    expect(rebase(BASE, typed, current)).toBe(
      "<h1>A much longer headline</h1>\n<p>My copy</p>\n",
    );
  });

  test("a deletion and an insertion carry as well as a replacement", () => {
    const typed = BASE.replace("<p>Body copy</p>\n", "");
    const current = "<!doctype html>\n" + BASE;
    expect(rebase(BASE, typed, current)).toBe(
      "<!doctype html>\n<h1>Old headline</h1>\n",
    );
  });

  test("typing where the other change is does not merge", () => {
    const typed = BASE.replace("Old headline", "Mine");
    const current = BASE.replace("Old headline", "Theirs");
    expect(rebase(BASE, typed, current)).toBeNull();
  });

  test("typing that overlaps the other change only in part does not merge", () => {
    const typed = BASE.replace(
      "headline</h1>\n<p>Body",
      "HEADLINE</h1>\n<p>BODY",
    );
    const current = BASE.replace("Body copy", "An agent's copy");
    expect(rebase(BASE, typed, current)).toBeNull();
  });

  test("two insertions at the same place do not merge: their order is nobody's to guess", () => {
    const typed = BASE.replace("</p>", " mine</p>");
    const current = BASE.replace("</p>", " theirs</p>");
    expect(rebase(BASE, typed, current)).toBeNull();
  });

  test("typing right up against the other change does not merge", () => {
    const typed = BASE.replace("Old headline", "Old headline!");
    const current = BASE.replace("Old headline", "Old headlinE");
    expect(rebase(BASE, typed, current)).toBeNull();
  });

  test("text typed back to where it started is the page as it is now", () => {
    const current = BASE.replace("Body copy", "An agent's copy");
    expect(rebase(BASE, BASE, current)).toBe(current);
  });

  test("a page that did not change takes the typing as it is", () => {
    const typed = BASE + "<p>More</p>\n";
    expect(rebase(BASE, typed, BASE)).toBe(typed);
  });

  test("typing that makes the other change's text is the page as it is now", () => {
    const current = BASE.replace("Old headline", "Theirs");
    expect(rebase(BASE, current, current)).toBe(current);
  });
});
