// Which `@font-face` blocks are faces (pageCss.ts fontFaceBlocks), held to
// Chromium's own parse: at the top of a sheet and inside a group rule
// they are, and one nested in a style rule is dropped. Run from a Daydream
// checkout (`pnpm test:kernel`, README.md), in its browser.
import { afterEach, describe, expect, test } from "vitest";

import { coreApi } from "@daydream/plugin-testing";

import { fontFaceBlocks } from "./pageCss";

const styles: HTMLStyleElement[] = [];
afterEach(() => {
  for (const style of styles.splice(0)) style.remove();
});

describe("fontFaceBlocks", () => {
  test("finds the faces the browser declares, and none it drops", () => {
    const css = `@font-face { font-family: A; src: local(Arial) }
@supports (display: grid) { @font-face { font-family: B; src: local(Arial) } }
.x { @font-face { font-family: C; src: local(Arial) } color: red }
@media all { .y { @font-face { font-family: D; src: local(Arial) } } }
@layer l { @font-face { font-family: E; src: local(Arial) } }
@scope (.s) { @font-face { font-family: F; src: local(Arial) } }`;
    const before = new Set(Array.from(document.fonts, (face) => face));
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    styles.push(style);
    const declared = Array.from(document.fonts)
      .filter((face) => !before.has(face))
      .map((face) => face.family);
    const found = fontFaceBlocks(coreApi().cssBlocks(css)).map(
      ({ block }) => block.declarations.find((d) => d.property === "font-family")!.value,
    );
    expect(declared).toEqual(["A", "B", "E", "F"]);
    expect(found).toEqual(declared);
  });
});
