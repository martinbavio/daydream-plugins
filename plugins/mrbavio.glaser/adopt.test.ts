import { describe, expect, test } from "vitest";

import type { DreamElement, DreamItem, DreamViewport } from "@daydream/plugin-api";

import { adoptInto, roundOf } from "./adopt";
import { parseVariantMarker, sessionState, variantMarker } from "./variants";

const page = (id: string, color: string): DreamElement => ({
  id: `html_${id}`,
  tag: "html",
  styles: {},
  children: [
    { id: `body_${id}`, tag: "body", styles: { background: color }, children: [] },
  ],
});

const viewport = (
  id: string,
  color: string,
  meta?: DreamViewport["payload"]["meta"],
  fonts?: DreamViewport["payload"]["fonts"],
): DreamViewport => ({
  id,
  kind: "daydream.viewport",
  position: { x: 0, y: 0 },
  frame: { width: 960, height: 600 },
  payload: { root: page(id, color), ...(meta === undefined ? {} : { meta }), ...(fonts === undefined ? {} : { fonts }) },
});

const notes = (verb: string, n: number, of: number, source: string, why = "Because.") =>
  `${variantMarker({ verb, n, of, sourceId: source })}\n\n${why}`;

function fan(): DreamItem[] {
  return [
    viewport("src", "white", { title: "Pricing", notes: "The source's own notes.", sourceUrl: "https://x" }),
    viewport("v1", "red", { title: "Pricing · bolder 1/3", notes: notes("bolder", 1, 3, "src") }),
    viewport("v2", "blue", { title: "Pricing · bolder 2/3", notes: notes("bolder", 2, 3, "src") }, [
      { "font-family": "Fraunces", src: "url(https://f/x.woff2)" },
    ]),
    viewport("v3", "green", { title: "Pricing · bolder 3/3", notes: notes("bolder", 3, 3, "src") }),
    viewport("q1", "gray", { title: "Pricing · quieter 1/3", notes: notes("quieter", 1, 3, "src") }),
    viewport("other", "black", { title: "Docs" }),
  ];
}

describe("variants", () => {
  test("the marker round-trips and tolerates a notes body after it", () => {
    const line = variantMarker({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    expect(line).toBe("Glaser typeset · variant 2 of 3 of vp_1");
    expect(parseVariantMarker(line)).toEqual({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    expect(parseVariantMarker(`${line}\n\nA serif display face.`)).toEqual({ verb: "typeset", n: 2, of: 3, sourceId: "vp_1" });
    expect(parseVariantMarker("A serif display face.\n" + line)).toBeNull();
    expect(parseVariantMarker(undefined)).toBeNull();
    expect(parseVariantMarker("")).toBeNull();
  });

  test("sessionState reads what the page saved and nothing else", () => {
    expect(sessionState(undefined)).toEqual({ seq: 0, pick: null, exit: false });
    expect(sessionState({ seq: 4, exit: true, pick: { verb: "bolder", viewportId: "v", elementId: null, at: 1 } })).toEqual({
      seq: 4,
      exit: true,
      pick: { verb: "bolder", viewportId: "v", elementId: null, at: 1 },
    });
    expect(sessionState({ seq: "x", pick: { verb: 1 } }).pick).toBeNull();
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

  test("adopting keeps the source's envelope and meta, takes the variant's page and fonts, drops the round", () => {
    const items = fan();
    expect(adoptInto(items, "v2")).toBe(true);
    expect(items.map((i) => i.id)).toEqual(["src", "q1", "other"]);
    const src = items[0] as DreamViewport;
    expect(src.position).toEqual({ x: 0, y: 0 });
    expect(src.payload.meta).toEqual({ title: "Pricing", notes: "The source's own notes.", sourceUrl: "https://x" });
    expect(src.payload.root.children[0]!.styles["background"]).toBe("blue");
    expect(src.payload.fonts).toEqual([{ "font-family": "Fraunces", src: "url(https://f/x.woff2)" }]);
  });

  test("a variant without fonts clears the source's", () => {
    const items = fan();
    (items[0] as DreamViewport).payload.fonts = [{ "font-family": "Old", src: "url(https://f/o.woff2)" }];
    adoptInto(items, "v1");
    expect((items[0] as DreamViewport).payload.fonts).toBeUndefined();
    expect(adoptInto(items, "v1")).toBe(false); // gone now
    expect(items.length).toBe(3);
  });
});
