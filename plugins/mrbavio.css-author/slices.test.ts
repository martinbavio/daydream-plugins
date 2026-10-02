import { describe, expect, test } from "vitest";

import { SLICE_MS, slicer } from "./slices";

/** Spends `ms` of this task, as a long synchronous read does. */
function spend(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // busy
  }
}

/** Whether `pause` has settled after only the microtasks that were
 * already queued: true for a call that returned at once, false for one
 * that waits for the event loop. */
async function settlesAtOnce(pause: () => Promise<void>): Promise<boolean> {
  let settled = false;
  void pause().then(() => {
    settled = true;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return settled;
}

describe("slicer", () => {
  test("a pause costs nothing while the slice is not spent", async () => {
    const pause = slicer();
    expect(await settlesAtOnce(pause)).toBe(true);
  });

  test("a pause waits for the event loop once the slice is spent", async () => {
    const pause = slicer();
    spend(SLICE_MS + 4);
    expect(await settlesAtOnce(pause)).toBe(false);
  });

  test("what was queued before the pause runs before it returns", async () => {
    const pause = slicer();
    let ran = false;
    setTimeout(() => {
      ran = true;
    }, 0);
    spend(SLICE_MS + 4);
    await pause();
    // A timer is a task like any other: the turn the pause gave let the
    // loop reach it, or the pause waited for something else.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toBe(true);
  });

  test("a new slice begins after a turn", async () => {
    const pause = slicer();
    spend(SLICE_MS + 4);
    await pause();
    expect(await settlesAtOnce(pause)).toBe(true);
  });
});
