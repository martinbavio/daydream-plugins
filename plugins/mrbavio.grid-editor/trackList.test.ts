import { describe, expect, test } from "vitest";

import {
  formatLength,
  gapShorthand,
  insertAt,
  insertEqual,
  type Insertion,
  type InsertRefusal,
  type Trade,
  type TradeRefusal,
  parseGapShorthand,
  parseTrackList,
  removeTrack,
  scaleLength,
  tradeAcross,
  writeTrackList,
} from "./trackList";

describe("parseTrackList", () => {
  test("reads lengths, keywords and line names, tracks in order", () => {
    const list = parseTrackList("[a] 200px 1fr [b] auto minmax(0, 1fr)")!;
    expect(list.tracks.map((t) => t.text)).toEqual([
      "200px",
      "1fr",
      "auto",
      "minmax(0, 1fr)",
    ]);
    expect(list.tracks[0]!.length).toEqual({ value: 200, unit: "px" });
    expect(list.tracks[1]!.length).toEqual({ value: 1, unit: "fr" });
    expect(list.tracks[2]!.length).toBeNull();
    expect(list.tracks[3]!.length).toBeNull();
  });

  test("expands an integer repeat() into its tracks", () => {
    const list = parseTrackList("repeat(3, 1fr) 80px")!;
    expect(list.tracks.map((t) => t.text)).toEqual([
      "1fr",
      "1fr",
      "1fr",
      "80px",
    ]);
    const named = parseTrackList("repeat(2, [c] 1fr 2fr)")!;
    expect(named.tracks.map((t) => t.text)).toEqual([
      "1fr",
      "2fr",
      "1fr",
      "2fr",
    ]);
  });

  test("reads a minified list, names touching tracks", () => {
    const list = parseTrackList("[a]1fr[b c]2fr[d]")!;
    expect(list.segments.length).toBe(5);
    expect(list.tracks.map((t) => t.text)).toEqual(["1fr", "2fr"]);
  });

  test("leaves alone what one drag cannot map onto resolved sizes", () => {
    expect(parseTrackList("none")).toBeNull();
    expect(parseTrackList("subgrid")).toBeNull();
    expect(parseTrackList("repeat(auto-fill, minmax(12rem, 1fr))")).toBeNull();
    expect(parseTrackList("var(--cols)")).toBeNull();
    expect(parseTrackList("1fr var(--w)")).toBeNull();
    expect(parseTrackList("")).toBeNull();
  });
});

describe("writeTrackList", () => {
  test("rewrites only the edited tracks and keeps names", () => {
    const list = parseTrackList("[a] 1fr 2fr [b] 1fr")!;
    expect(writeTrackList(list, new Map([[1, "1.5fr"]]))).toBe(
      "[a] 1fr 1.5fr [b] 1fr",
    );
  });

  test("keeps a repeat() verbatim until an edit enters it, then expands it", () => {
    const list = parseTrackList("repeat(3, 1fr) 80px")!;
    expect(writeTrackList(list, new Map([[3, "100px"]]))).toBe(
      "repeat(3, 1fr) 100px",
    );
    expect(writeTrackList(list, new Map([[1, "1.4fr"]]))).toBe(
      "1fr 1.4fr 1fr 80px",
    );
  });
});

describe("scaleLength and formatLength", () => {
  test("keeps the unit and scales by the px ratio", () => {
    expect(scaleLength("1fr", 220, 264)).toBe("1.2fr");
    expect(scaleLength("10rem", 160, 176)).toBe("11rem");
    expect(scaleLength("200px", 200, 212.34)).toBe("212.3px");
    expect(scaleLength("25%", 240, 120)).toBe("12.5%");
  });

  test("falls back to px for a non-length or a zero-sized value", () => {
    expect(scaleLength("auto", 240, 200)).toBe("200px");
    expect(scaleLength("minmax(0, 1fr)", 240, 200)).toBe("200px");
    expect(scaleLength("1fr", 0, 40)).toBe("40px");
    expect(formatLength(1.005, "fr")).toBe("1fr");
    expect(formatLength(0, "px")).toBe("0px");
  });
});

describe("tradeAcross", () => {
  test("two shares trade shares and keep their sum", () => {
    const list = parseTrackList("1fr 2fr 1fr")!;
    const trade = traded(tradeAcross(list, [220, 440, 220], 0, 44));
    expect(trade).toEqual({
      list: "1.2fr 1.8fr 1fr",
      first: "1.2fr",
      second: "1.8fr",
      collapsed: null,
    });
  });

  test("a fixed length beside a share is written alone", () => {
    const list = parseTrackList("200px 1fr")!;
    expect(traded(tradeAcross(list, [200, 600], 0, 40)).list).toBe("240px 1fr");
    const other = parseTrackList("1fr 200px")!;
    expect(traded(tradeAcross(other, [600, 200], 0, 40)).list).toBe(
      "1fr 160px",
    );
  });

  test("two fixed lengths trade px in their own units", () => {
    const list = parseTrackList("10rem 20rem")!;
    expect(traded(tradeAcross(list, [160, 320], 0, 16)).list).toBe(
      "11rem 19rem",
    );
  });

  test("a lone share beside auto writes the auto in px; two autos become px", () => {
    // The one share takes all the free space, so scaling it moves
    // nothing: the auto gets the number.
    const list = parseTrackList("1fr auto")!;
    expect(traded(tradeAcross(list, [300, 100], 0, 30)).list).toBe("1fr 70px");
    const autos = parseTrackList("auto auto")!;
    expect(traded(tradeAcross(autos, [300, 100], 0, -50)).list).toBe(
      "250px 150px",
    );
  });

  test("never takes a track below zero, and refuses an implicit boundary", () => {
    const list = parseTrackList("1fr 1fr")!;
    expect(traded(tradeAcross(list, [100, 100], 0, 500)).list).toBe("2fr 0fr");
    expect(tradeAcross(list, [100, 100, 100], 1, 10)).toBeNull();
  });
});

describe("gap shorthand", () => {
  test("reads one or two values and writes them back", () => {
    expect(parseGapShorthand("16px")).toEqual({ row: "16px", column: "16px" });
    expect(parseGapShorthand("1rem 2rem")).toEqual({
      row: "1rem",
      column: "2rem",
    });
    expect(parseGapShorthand("1px 2px 3px")).toBeNull();
    expect(gapShorthand("16px", "16px")).toBe("16px");
    expect(gapShorthand("16px", "24px")).toBe("16px 24px");
  });
});

/** The trade a drag made — a refusal or an implicit boundary fails the
 * test. */
const traded = (result: Trade | TradeRefusal | null): Trade => {
  if (result === null) throw new Error("implicit boundary");
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result;
};

/** The insertion a pull made — a refusal fails the test. */
const born = (result: Insertion | InsertRefusal): Insertion => {
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result;
};

describe("insertAt", () => {
  const sizes = [220, 440, 220];

  test("pulls a share out of the neighbour the drag points at, in its unit", () => {
    const list = parseTrackList("1fr 2fr 1fr")!;
    // Line 1 pulled right by 110px: carved from the 2fr.
    const right = born(insertAt(list, sizes, 1, 110));
    expect(right.list).toBe("1fr 0.5fr 1.5fr 1fr");
    expect(right.born).toBe("0.5fr");
    expect(right.donor).toBe("1.5fr");
    expect(right.line).toBe(2);
    // Line 1 pulled left by 110px: carved from the 1fr before it.
    const left = born(insertAt(list, sizes, 1, -110));
    expect(left.list).toBe("0.5fr 0.5fr 2fr 1fr");
    expect(left.line).toBe(1);
  });

  test("pulls a new track in from either edge, and never outward", () => {
    const list = parseTrackList("1fr 2fr 1fr")!;
    expect(born(insertAt(list, sizes, 0, 55)).list).toBe(
      "0.25fr 0.75fr 2fr 1fr",
    );
    expect(born(insertAt(list, sizes, 3, -55)).list).toBe(
      "1fr 2fr 0.75fr 0.25fr",
    );
    expect(insertAt(list, sizes, 0, -55)).toEqual({ refused: "outward" });
    expect(insertAt(list, sizes, 3, 55)).toEqual({ refused: "outward" });
    expect(insertAt(list, sizes, 1, 0.2)).toEqual({ refused: "still" });
  });

  test("keeps a fixed length's unit, writes px beside auto, and clamps at the donor", () => {
    const px = parseTrackList("240px 1fr")!;
    expect(born(insertAt(px, [240, 640], 1, -72)).list).toBe("168px 72px 1fr");
    const auto = parseTrackList("auto 1fr")!;
    expect(born(insertAt(auto, [300, 580], 1, -60)).list).toBe("auto 60px 1fr");
    const clamped = born(insertAt(px, [240, 640], 1, -900));
    expect(clamped.list).toBe("0px 240px 1fr");
  });

  test("the band that stays keeps the line name", () => {
    const list = parseTrackList("[a] 1fr [b] 2fr [c]")!;
    expect(born(insertAt(list, sizes, 1, 110)).list).toBe(
      "[a] 1fr [b] 0.5fr 1.5fr [c]",
    );
    expect(born(insertAt(list, sizes, 1, -110)).list).toBe(
      "[a] 0.5fr 0.5fr [b] 2fr [c]",
    );
    expect(born(insertAt(list, sizes, 2, -110)).list).toBe(
      "[a] 1fr [b] 1.5fr 0.5fr [c]",
    );
  });

  test("expands a repeat() the newborn enters, and leaves one it only borders", () => {
    const list = parseTrackList("repeat(3, 1fr) 80px")!;
    expect(born(insertAt(list, [220, 220, 220, 80], 1, 55)).list).toBe(
      "1fr 0.25fr 0.75fr 1fr 80px",
    );
    expect(born(insertAt(list, [220, 220, 220, 80], 3, 20)).list).toBe(
      "repeat(3, 1fr) 20px 60px",
    );
  });

  test("does not carve from an implicit track, and writes px from a closed one", () => {
    const list = parseTrackList("1fr 2fr")!;
    expect(insertAt(list, [220, 440, 220], 2, 40)).toEqual({
      refused: "implicit",
    });
    const closed = parseTrackList("0fr 1fr")!;
    expect(born(insertAt(closed, [90, 300], 1, -40)).list).toBe("0fr 40px 1fr");
    expect(born(insertAt(list, [220, 440, 220], 2, -40)).list).toBe(
      "1fr 1.82fr 0.18fr",
    );
  });
});

describe("insertEqual", () => {
  test("adds a twin of the track before the line, or the first at the start", () => {
    const list = parseTrackList("1fr 2fr 1fr")!;
    expect(insertEqual(list, 2)).toEqual({
      list: "1fr 2fr 2fr 1fr",
      text: "2fr",
    });
    expect(insertEqual(list, 0)).toEqual({
      list: "1fr 1fr 2fr 1fr",
      text: "1fr",
    });
    expect(insertEqual(list, 3)!.list).toBe("1fr 2fr 1fr 1fr");
    expect(insertEqual(list, 4)).toBeNull();
  });

  test("grows a one-track repeat() instead of expanding it", () => {
    expect(insertEqual(parseTrackList("repeat(3, 1fr)")!, 1)!.list).toBe(
      "repeat(4, 1fr)",
    );
    expect(insertEqual(parseTrackList("repeat(3, 1fr) 80px")!, 3)!.list).toBe(
      "repeat(4, 1fr) 80px",
    );
    expect(insertEqual(parseTrackList("repeat(3, 1fr) 80px")!, 4)!.list).toBe(
      "repeat(3, 1fr) 80px 80px",
    );
    expect(insertEqual(parseTrackList("repeat(2, 1fr 2fr)")!, 1)!.list).toBe(
      "1fr 1fr 2fr 1fr 2fr",
    );
  });

  test("keeps the twin beside its original, names in place", () => {
    expect(insertEqual(parseTrackList("[a] 1fr [b] 2fr")!, 1)!.list).toBe(
      "[a] 1fr 1fr [b] 2fr",
    );
    expect(insertEqual(parseTrackList("[a] 1fr [b] 2fr")!, 0)!.list).toBe(
      "[a] 1fr 1fr [b] 2fr",
    );
  });
});

describe("removeTrack", () => {
  test("drops the track and merges the names it stood between", () => {
    expect(removeTrack(parseTrackList("1fr 2fr 1fr")!, 1)).toBe("1fr 1fr");
    expect(removeTrack(parseTrackList("[a] 1fr [b] 2fr [c]")!, 0)).toBe(
      "[a b] 2fr [c]",
    );
    expect(removeTrack(parseTrackList("1fr")!, 0)).toBe("none");
    expect(removeTrack(parseTrackList("[a] 1fr [b]")!, 0)).toBe("none");
    expect(removeTrack(parseTrackList("[a] repeat(1, 1fr) [b]")!, 0)).toBe(
      "none",
    );
    expect(removeTrack(parseTrackList("1fr 2fr")!, 2)).toBeNull();
  });

  test("shrinks a one-track repeat(), down to a plain track", () => {
    expect(removeTrack(parseTrackList("repeat(3, 1fr)")!, 1)).toBe(
      "repeat(2, 1fr)",
    );
    expect(removeTrack(parseTrackList("repeat(2, 1fr) 80px")!, 0)).toBe(
      "1fr 80px",
    );
    expect(removeTrack(parseTrackList("repeat(2, 1fr 2fr)")!, 1)).toBe(
      "1fr 1fr 2fr",
    );
  });
});

describe("tradeAcross across the pair", () => {
  test("a closed share opens again, priced like its neighbour", () => {
    const list = parseTrackList("0fr 1fr")!;
    expect(traded(tradeAcross(list, [0, 300], 0, 80)).list).toBe(
      "0.27fr 0.73fr",
    );
    // With the min-content floor a closed track keeps: approximate, but
    // opening.
    expect(traded(tradeAcross(list, [90, 300], 0, 80)).list).toBe(
      "0.44fr 0.56fr",
    );
  });

  test("two shares keep their sum exactly, whatever the rounding", () => {
    const list = parseTrackList("1fr 2fr 1fr")!;
    for (const delta of [73, 101.7, -33.3]) {
      const trade = traded(tradeAcross(list, [220, 440, 220], 0, delta));
      expect(
        Number.parseFloat(trade.first) + Number.parseFloat(trade.second),
      ).toBe(3);
    }
  });

  test("a grid's only share beside auto writes the auto in px", () => {
    expect(
      traded(tradeAcross(parseTrackList("1fr auto")!, [300, 200], 0, 50)).list,
    ).toBe("1fr 150px");
    expect(
      traded(tradeAcross(parseTrackList("auto 1fr")!, [200, 300], 0, 50)).list,
    ).toBe("250px 1fr");
    // Beside other shares, the share is scaled as before.
    expect(
      traded(
        tradeAcross(parseTrackList("1fr auto 1fr")!, [300, 200, 300], 0, 30),
      ).list,
    ).toBe("1.1fr auto 1fr");
  });
});

describe("tradeAcross refusing a lossy rewrite", () => {
  test("a function a px rewrite would throw away is refused by name", () => {
    expect(
      tradeAcross(
        parseTrackList("minmax(100px, 1fr) auto 1fr")!,
        [300, 200, 300],
        0,
        20,
      ),
    ).toEqual({ refused: "minmax" });
    expect(
      tradeAcross(
        parseTrackList("fit-content(200px) auto")!,
        [200, 300],
        0,
        20,
      ),
    ).toEqual({ refused: "fit-content" });
    expect(
      tradeAcross(parseTrackList("1fr minmax(0, 200px)")!, [300, 200], 0, 20),
    ).toEqual({ refused: "minmax" });
    // The grid's only share beside a function would write the function
    // in px: refused too. With another share, the function is kept and
    // the share written.
    expect(
      tradeAcross(parseTrackList("minmax(0, 1fr) 1fr")!, [300, 300], 0, 30),
    ).toEqual({ refused: "minmax" });
    expect(
      traded(
        tradeAcross(
          parseTrackList("minmax(0, 1fr) 1fr 1fr")!,
          [300, 300, 300],
          0,
          30,
        ),
      ).list,
    ).toBe("minmax(0, 1fr) 0.9fr 1fr");
  });
});

describe("tradeAcross at the clamp", () => {
  test("names the track a drag closed, and a zero drag changes nothing", () => {
    const list = parseTrackList("repeat(3, 1fr)")!;
    const closed = traded(tradeAcross(list, [220, 220, 220], 0, -220));
    expect(closed.list).toBe("0fr 2fr 1fr");
    expect(closed.collapsed).toBe(0);
    const still = traded(tradeAcross(list, [220, 220, 220], 0, 0));
    expect(still.list).toBe("repeat(3, 1fr)");
    expect(still.collapsed).toBeNull();
  });
});
