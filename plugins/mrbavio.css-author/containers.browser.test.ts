// What a container query needs and what declarations provide
// (containers.ts), the declarations read by the kernel's scan (so run from
// a Daydream checkout). Which ELEMENTS are a query's
// ancestors is the browser's, and matchLint.browser.test.ts's.
import { describe, expect, test } from "vitest";

import { coreApi } from "@daydream/plugin-testing";

import {
  emptyContainerDeclaration,
  mergeContainerDeclaration,
  queryNeeds,
  satisfies,
  splitContainerPrelude,
} from "./containers";

function declared(...lists: string[]) {
  const out = emptyContainerDeclaration();
  for (const list of lists) mergeContainerDeclaration(out, coreApi().cssDeclarations(list));
  return out;
}

const SIZE = { size: true, scrollState: false };

describe("mergeContainerDeclaration and importance", () => {
  test("an !important container-type outlasts a later normal shorthand that would reset it; a later !important one does not", () => {
    expect(
      satisfies(declared("container-type: inline-size !important; container: card"), SIZE, "card"),
    ).toBe(true);
    expect(
      satisfies(declared("container-type: inline-size !important; container: card / normal !important"), SIZE, null),
    ).toBe(false);
    expect(satisfies(declared("container-type: inline-size; container: card"), SIZE, null)).toBe(false);
  });
});

describe("splitContainerPrelude and queryNeeds", () => {
  test("a name is the first ident followed by whitespace; not, style( and scroll-state( are not names", () => {
    expect(splitContainerPrelude("@container card (width > 400px)")).toEqual({
      name: "card",
      condition: "(width > 400px)",
    });
    expect(splitContainerPrelude("@container (width > 400px)").name).toBeNull();
    expect(splitContainerPrelude("@container not (width > 400px)").name).toBeNull();
    expect(splitContainerPrelude("@container style(--x: 1)").name).toBeNull();
    expect(splitContainerPrelude("@container card style(--x: 1)").name).toBe("card");
  });

  test("size features in every spelling need a size container; style() needs nothing; scroll-state() a scroll-state one", () => {
    for (const condition of [
      "(min-width: 400px)",
      "(orientation: landscape)",
      "not (width > 400px)",
      "((width > 400px) or (height > 200px))",
      "(width > 400px) and style(--x: 1)",
    ]) {
      expect(queryNeeds(condition), condition).toEqual(SIZE);
    }
    for (const condition of [
      "style(--theme: dark)",
      "(style(--a: 1) and style(--b: calc(1 + 2)))",
      "not style(--theme: dark)",
    ]) {
      expect(queryNeeds(condition), condition).toEqual({ size: false, scrollState: false });
    }
    expect(queryNeeds("scroll-state(stuck: top)")).toEqual({ size: false, scrollState: true });
  });
});

describe("what declarations provide", () => {
  test("container-type size or inline-size; the shorthand's slashed half", () => {
    expect(declared("container-type: inline-size").size).toBe(true);
    expect(declared("container-type: size").size).toBe(true);
    expect(declared("container: grid / size").size).toBe(true);
    expect(declared("container-type: normal").size).toBe(false);
  });

  test("an unslashed shorthand names only, and resets a type written before it", () => {
    expect(declared("container: grid").size).toBe(false);
    expect(declared("container-type: inline-size; container: grid").size).toBe(false);
    expect([...declared("container: grid").names]).toEqual(["grid"]);
  });

  test("names come from container-name and the shorthand's first half; none names nothing", () => {
    expect([...declared("container-name: a b", "container: c / size").names]).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(declared("container-name: none").names.size).toBe(0);
  });

  test("scroll-state, alone or with a size type", () => {
    expect(declared("container-type: scroll-state").scrollState).toBe(true);
    expect(declared("container: sticky / size scroll-state").scrollState).toBe(true);
  });

  test("any list counts: a type from one and a name from another both reach the element", () => {
    const both = declared("container-type: inline-size", "container-name: card");
    expect(satisfies(both, SIZE, "card")).toBe(true);
    expect(satisfies(both, SIZE, "other")).toBe(false);
  });

  test("a var() leaves it to the browser, and satisfies anything", () => {
    expect(satisfies(declared("container: var(--c)"), SIZE, "card")).toBe(true);
  });
});
