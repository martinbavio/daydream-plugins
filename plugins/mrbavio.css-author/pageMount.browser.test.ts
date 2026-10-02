// readWithoutReloading's read may give the event loop a turn (slices.ts
// `pause`): the cut stays in until the read has ended, and is put back
// after it, and after one that throws.

import { afterEach, describe, expect, test } from "vitest";

import { readWithoutReloading } from "./pageMount";

const made: Element[] = [];
afterEach(() => {
  for (const el of made.splice(0)) el.remove();
});

function box(style: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("style", style);
  document.body.append(el);
  made.push(el);
  return el;
}

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("readWithoutReloading", () => {
  test("a read that waits for the event loop still reads the page cut, and it is put back after", async () => {
    const el = box("color: red; margin: 0");
    const seen = await readWithoutReloading(
      document,
      [],
      [],
      new Map([[el, [[0, 11] as const]]]),
      async () => {
        const before = el.getAttribute("style");
        await turn();
        return [before, el.getAttribute("style")];
      },
    );
    expect(seen).toEqual([" margin: 0", " margin: 0"]);
    expect(el.getAttribute("style")).toBe("color: red; margin: 0");
  });

  test("a read that throws leaves the page as it was", async () => {
    const el = box("color: red; margin: 0");
    await expect(
      readWithoutReloading(
        document,
        [],
        [],
        new Map([[el, [[0, 11] as const]]]),
        async () => {
          await turn();
          throw new Error("read failed");
        },
      ),
    ).rejects.toThrow("read failed");
    expect(el.getAttribute("style")).toBe("color: red; margin: 0");
  });
});
