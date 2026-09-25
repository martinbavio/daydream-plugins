// A page's markup as the lints read it (pageDom.ts): the page's own
// sheet in a mounted copy, and the pairing that names a mounted copy's
// nodes by their twins in the stored markup — the copy being the kernel's
// own mount (`dd.mountViewport`). Real Chromium only.
import { afterAll, describe, expect, test } from "vitest";

import { createPageItem, createTestKernel } from "@daydream/plugin-testing";

import { mountedStyle, storedNames } from "./pageDom";

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
  const stored = kernel.dd.core.parsePage(page.payload.html);
  const mount = await kernel.dd.mountViewport(page, { bare: true });
  try {
    const nameOf = storedNames(kernel.dd.core, stored, mount.document());
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

  test("what the mount adds to the head, and a noscript's content, leave the pairing one for one", async () => {
    const { stored, names } = await namesOf(
      [
        "<!doctype html><html><head><noscript><style>p { color: red }</style></noscript></head><body>",
        "<noscript><p>no script</p></noscript><p>one</p><p>two</p>",
        "</body></html>",
      ].join(""),
      "p",
    );
    expect(names.map((name) => named(stored, name))).toEqual(
      Array.from(stored.querySelectorAll("p")),
    );
  });
});

describe("mountedStyle", () => {
  test("the page's own sheet in a lint's mount is the one the live face writes — never a noscript's or a template's before it, nor the motion pin after it — and holds the page's css alone", async () => {
    const page = createPageItem(
      {
        html: [
          "<!doctype html><html><head>",
          "<noscript><style>.noscript { color: red }</style></noscript>",
          "<template><style>.template { color: red }</style></template>",
          '</head><body><div class="page"></div></body></html>',
        ].join(""),
        css: ".page { color: blue }",
      },
      { id: "v1", frame: { width: 600 } },
    );
    const mount = await kernel.dd.mountViewport(page, {
      still: true,
      bare: true,
    });
    try {
      expect(mountedStyle(mount.document())?.textContent).toBe(
        ".page { color: blue }",
      );
    } finally {
      mount.dispose();
    }
  });
});
