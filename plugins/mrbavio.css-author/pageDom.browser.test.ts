// A page's markup as the lints read it (pageDom.ts): the css the stored
// markup's `<style>` blocks fold into, as the kernel folds them, and the
// pairing that names a mounted copy's nodes by their twins in the stored
// markup — the copy being the kernel's own mount (`dd.mountViewport`),
// with the safety walk's removals in it. Real Chromium only.
import { afterAll, describe, expect, test } from "vitest";

import { createPageItem, createTestKernel } from "@daydream/plugin-testing";

import { parsePage, storedNames } from "./pageDom";

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

/** Name every `selector` node of the page's mounted copy as the lints
 * do, beside the stored markup's parse. */
async function namesOf(
  html: string,
  selector: string,
): Promise<{ stored: Document; names: string[] }> {
  const page = createPageItem(
    { html, css: "" },
    { id: "v1", frame: { width: 600 } },
  );
  const stored = parsePage(page.payload).doc;
  const mount = await kernel.dd.mountViewport(page);
  try {
    const nameOf = storedNames(stored, mount.document());
    return {
      stored,
      names: Array.from(mount.document().querySelectorAll(selector), nameOf),
    };
  } finally {
    mount.dispose();
  }
}

/** The one element of `stored` that `name` selects. */
function named(stored: Document, name: string): Element {
  const found = stored.querySelectorAll(name);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("storedNames", () => {
  test("a kept SVG animation is named as itself, not as a removed one before it that looked the same by tag, id and class", async () => {
    // The walk removes a `<set>` that animates a url; the one beside it,
    // animating paint, stays.
    const { stored, names } = await namesOf(
      [
        "<!doctype html><html><head></head><body><svg>",
        '<rect><set attributeName="href" to="#x" class="a"></set>',
        '<set attributeName="fill" to="red" class="a"></set></rect>',
        "</svg></body></html>",
      ].join(""),
      "set",
    );
    expect(names).toHaveLength(1);
    expect(named(stored, names[0]!)).toBe(stored.querySelectorAll("set")[1]);
  });

  test("an element whose attributes the walk and the mount changed is still its stored twin", async () => {
    // Its handler is removed, its asset urls pointed at the document's
    // route: the same element for all that.
    const { stored, names } = await namesOf(
      [
        "<!doctype html><html><head></head><body>",
        '<img class="a" alt="one">',
        '<img class="a" alt="two" src="assets/a.png" onclick="x()" style="background: url(assets/a.png)">',
        "</body></html>",
      ].join(""),
      "img",
    );
    const imgs = stored.querySelectorAll("img");
    expect(names.map((name) => named(stored, name))).toEqual([
      imgs[0],
      imgs[1],
    ]);
  });
});

describe("parsePage", () => {
  test("a <style media> folds into the css under its @media, as the kernel folds it", () => {
    const { css } = parsePage({
      html: [
        "<!doctype html><html><head>",
        '<style media="print">.a { color: red }</style>',
        '<style media="all">.b { color: blue }</style>',
        "<style>.c { color: green }</style>",
        "</head><body></body></html>",
      ].join(""),
      css: ".page { margin: 0 }",
    });
    expect(css).toBe(
      [
        ".page { margin: 0 }",
        "@media print {\n.a { color: red }\n}",
        ".b { color: blue }",
        ".c { color: green }",
      ].join("\n"),
    );
  });

  test("a <style media> whose sheet does not close its own blocks folds as the kernel folds it: as the browser reads it", async () => {
    // A stray `}` would close the `@media` early and apply what follows
    // everywhere; an unclosed block, comment or string would swallow the
    // `@media`'s own `}`. The kernel's landing is the reference.
    for (const sheet of [
      ".a { color: red } } .b { color: blue }",
      ".a { color: red",
      ".a { color: red } /* open",
      '.a { content: "open }',
    ]) {
      const page = {
        html: `<!doctype html><html><head><style media="print">${sheet}</style></head><body></body></html>`,
        css: ".page { margin: 0 }",
      };
      expect(parsePage(page).css).toBe(
        (await kernel.dd.cleanPage(page)).css,
      );
    }
  });
});
