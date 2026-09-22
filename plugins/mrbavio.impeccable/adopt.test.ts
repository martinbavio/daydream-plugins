import { describe, expect, test } from "vitest";

import type { DreamItem, DreamPage } from "@daydream/plugin-api";

import { adoptInto, roundOf } from "./adopt";
import { droppedLegacyPick, parseVariantMarker, sessionState, variantMarker } from "./variants";

/** A page (decision #76): its markup and its stylesheet, verbatim. */
const viewport = (
  id: string,
  color: string,
  meta?: DreamPage["payload"]["meta"],
  css = "",
): DreamPage => ({
  id,
  kind: "daydream.viewport",
  position: { x: 0, y: 0 },
  frame: { width: 960, height: 600 },
  payload: {
    html: `<!doctype html><html><head></head><body class="${id}"></body></html>`,
    css: `${css}body { background: ${color}; }\n`,
    ...(meta === undefined ? {} : { meta }),
  },
});

const notes = (verb: string, n: number, of: number, source: string, why = "Because.") =>
  `${variantMarker({ verb, n, of, sourceId: source })}\n\n${why}`;

const FRAUNCES = '@font-face { font-family: "Fraunces"; src: url(assets/x.woff2); }\n';

function fan(): DreamItem[] {
  return [
    viewport("src", "white", { title: "Pricing", notes: "The source's own notes.", sourceUrl: "https://x" }),
    viewport("v1", "red", { title: "Pricing · bolder 1/3", notes: notes("bolder", 1, 3, "src") }),
    viewport("v2", "blue", { title: "Pricing · bolder 2/3", notes: notes("bolder", 2, 3, "src") }, FRAUNCES),
    viewport("v3", "green", { title: "Pricing · bolder 3/3", notes: notes("bolder", 3, 3, "src") }),
    viewport("q1", "gray", { title: "Pricing · quieter 1/3", notes: notes("quieter", 1, 3, "src") }),
    viewport("other", "black", { title: "Docs" }),
  ];
}

describe("variants", () => {
  test("the marker round-trips and tolerates a notes body after it", () => {
    const line = variantMarker({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    expect(line).toBe("Impeccable typeset · variant 2 of 3 of vp_1");
    expect(parseVariantMarker(line)).toEqual({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    expect(parseVariantMarker(`${line}\n\nA serif display face.`)).toEqual({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    // The older spelling still reads: variants landed before the rename.
    expect(parseVariantMarker("Glaser typeset · variant 2 of 3 of vp_1")).toEqual({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    expect(parseVariantMarker("A serif display face.\n" + line)).toBeNull();
    expect(parseVariantMarker(undefined)).toBeNull();
    expect(parseVariantMarker("")).toBeNull();
  });

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

describe("adopt", () => {
  test("a variant's round is its source and every sibling of the same verb", () => {
    const round = roundOf(fan(), "v2")!;
    expect(round.source.id).toBe("src");
    expect(round.variants.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
    expect(roundOf(fan(), "q1")!.variants.map((v) => v.id)).toEqual(["q1"]);
    expect(roundOf(fan(), "src")).toBeNull(); // not a variant
    expect(roundOf(fan(), "other")).toBeNull();
    expect(roundOf(fan(), "nope")).toBeNull();
    // A source that is gone: nothing to adopt into.
    expect(roundOf(fan().filter((i) => i.id !== "src"), "v2")).toBeNull();
  });

  test("adopting keeps the source's envelope and meta — its title is its name — takes the variant's page, fonts included, and drops the round", () => {
    const items = fan();
    const chosen = items[2] as DreamPage;
    expect(adoptInto(items, "v2")).toBe(true);
    expect(items.map((i) => i.id)).toEqual(["src", "q1", "other"]);
    const src = items[0] as DreamPage;
    expect(src.position).toEqual({ x: 0, y: 0 });
    expect(src.frame).toEqual({ width: 960, height: 600 });
    expect(src.payload).toEqual({
      html: chosen.payload.html,
      css: chosen.payload.css,
      meta: { title: "Pricing", notes: "The source's own notes.", sourceUrl: "https://x" },
    });
    // A web font is an @font-face rule in the css: it comes with the page.
    expect(src.payload.css).toContain('font-family: "Fraunces"');
  });

  test("a source without meta takes none from the variant; adopting twice finds nothing", () => {
    const items = fan();
    delete (items[0] as DreamPage).payload.meta;
    (items[0] as DreamPage).payload.css = FRAUNCES + (items[0] as DreamPage).payload.css;
    adoptInto(items, "v1");
    const src = items[0] as DreamPage;
    expect(src.payload.meta).toBeUndefined();
    expect("meta" in src.payload).toBe(false);
    expect(src.payload.css).toBe("body { background: red; }\n"); // the source's own font went with its css
    expect(adoptInto(items, "v1")).toBe(false); // gone now
    expect(items.length).toBe(3);
  });
});
