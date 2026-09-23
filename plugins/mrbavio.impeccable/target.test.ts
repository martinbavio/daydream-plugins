// Where the caption and the picker are drawn once a pick's anchor is gone
// (target.ts): the element found again by its selector, and that lookup
// made once per document version, never once per draw — a pan draws every
// frame.
import { describe, expect, test, vi } from "vitest";

import type { DaydreamApi, OverlayRect } from "@daydream/plugin-api";

import { createTargetBox, type Target } from "./target";

const box = (x: number): OverlayRect => ({ x, y: 0, width: 10, height: 10 });

/** A `dd` with only what `targetBox` reads: the rects of the ids `rects`
 * holds, `pageFind` answering `found`, and a document version to bump. */
function fakeDd() {
  const rects = new Map<string, OverlayRect>();
  let version = 0;
  const state = { found: "e2" as string | null };
  const pageFind = vi.fn(() => state.found);
  const dd = {
    documentVersion: () => version,
    pageFind,
    geometry: {
      rect: (id: string) => rects.get(id) ?? null,
      itemRect: () => box(0),
    },
  } as unknown as DaydreamApi;
  return {
    dd,
    rects,
    pageFind,
    state,
    bump: () => {
      version++;
    },
  };
}

const gone: Target = { viewportId: "v1", element: ".hero", anchor: "e1" };

describe("targetBox", () => {
  test("the anchor's own box while its mount lives, and no lookup", () => {
    const { dd, rects, pageFind } = fakeDd();
    rects.set("e1", box(1));
    expect(createTargetBox(dd)(gone)).toEqual({ rect: box(1), whole: false });
    expect(pageFind).not.toHaveBeenCalled();
  });

  test("once the anchor is gone, the element found by its selector is kept until the document changes", () => {
    const { dd, rects, pageFind, state, bump } = fakeDd();
    rects.set("e2", box(2));
    const targetBox = createTargetBox(dd);
    for (let draw = 0; draw < 5; draw++) {
      expect(targetBox(gone)).toEqual({ rect: box(2), whole: false });
    }
    expect(pageFind).toHaveBeenCalledTimes(1);

    // A document change may have remounted the page: found again.
    bump();
    state.found = "e3";
    rects.set("e3", box(3));
    expect(targetBox(gone)).toEqual({ rect: box(3), whole: false });
    expect(pageFind).toHaveBeenCalledTimes(2);
  });

  test("a found element whose node is gone is looked for again; nothing found is never kept", () => {
    const { dd, rects, pageFind, state } = fakeDd();
    rects.set("e2", box(2));
    const targetBox = createTargetBox(dd);
    targetBox(gone);
    rects.delete("e2");
    state.found = null;
    // The page is remounting: the viewport's box meanwhile, asked again
    // on every draw until the element is there.
    expect(targetBox(gone)).toEqual({ rect: box(0), whole: true });
    expect(targetBox(gone)).toEqual({ rect: box(0), whole: true });
    expect(pageFind).toHaveBeenCalledTimes(3);
    state.found = "e4";
    rects.set("e4", box(4));
    expect(targetBox(gone)).toEqual({ rect: box(4), whole: false });
  });

  test("another target is looked up for itself", () => {
    const { dd, rects, pageFind } = fakeDd();
    rects.set("e2", box(2));
    const targetBox = createTargetBox(dd);
    targetBox(gone);
    targetBox({ ...gone, element: ".other" });
    expect(pageFind).toHaveBeenCalledTimes(2);
    expect(pageFind).toHaveBeenLastCalledWith("v1", ".other");
  });
});
