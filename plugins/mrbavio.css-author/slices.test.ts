import { beforeEach, describe, expect, test } from "vitest";

import { pause, SLICE_MS } from "./slices";

/** Spends `ms` of this task, as a long synchronous read does. */
function spend(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // busy
  }
}

/** Whether `pause()` has settled after only the microtasks that were
 * already queued: true for a call that returned at once, false for one
 * that waits for the event loop. */
async function settlesAtOnce(): Promise<boolean> {
  let settled = false;
  void pause().then(() => {
    settled = true;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return settled;
}

// The clock is the module's: begin each test just after a turn.
beforeEach(async () => {
  spend(SLICE_MS + 4);
  await pause();
});

describe("pause", () => {
  test("costs nothing while the slice is not spent", async () => {
    expect(await settlesAtOnce()).toBe(true);
  });

  test("waits for the event loop once the slice is spent", async () => {
    spend(SLICE_MS + 4);
    expect(await settlesAtOnce()).toBe(false);
  });

  test("many short calls add up: it is the time since the last turn that counts", async () => {
    // Three calls, 3ms apart: none is over a slice alone, the third is
    // over one together with the two before it.
    spend(3);
    expect(await settlesAtOnce()).toBe(true);
    spend(3);
    expect(await settlesAtOnce()).toBe(true);
    spend(3);
    expect(await settlesAtOnce()).toBe(false);
  });

  test("a new slice begins after a turn", async () => {
    spend(SLICE_MS + 4);
    await pause();
    expect(await settlesAtOnce()).toBe(true);
  });
});
