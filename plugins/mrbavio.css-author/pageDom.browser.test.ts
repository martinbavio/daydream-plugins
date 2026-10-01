// A page's markup as the lints read it (pageDom.ts): the page's live
// sheets in a mounted copy, and the pairing that names a mounted copy's
// nodes by their twins in the stored markup — the copy being the kernel's
// own mount (`dd.mountViewport`), of a page of the open project. Real
// Chromium only.
import { afterAll, describe, expect, test } from "vitest";

import {
  createPageItem,
  createTestKernel,
  testProject,
  type TestPage,
} from "@daydream/plugin-testing";

import { mountedStyles, storedNames } from "./pageDom";
import { withSheets } from "./testPages.test-support";

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

/** Open a project of that one page, and mount its viewport bare. */
function mountBare(page: TestPage) {
  kernel.store.loadProject(testProject([page]));
  return kernel.dd.mountViewport(page.item, { still: true, bare: true });
}

/** Name every `selector` node of the page's mounted copy as the lints
 * do, beside the stored markup's parse. */
async function namesOf(
  html: string,
  selector: string,
): Promise<{ stored: Document; names: string[] }> {
  const page = createPageItem({ html }, { id: "v1", frame: { width: 600 } });
  const stored = kernel.dd.core.parsePage(page.page.html);
  const mount = await mountBare(page);
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
    // Its handler is removed, its urls pointed at where the project
    // serves them: the same element for all that.
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

  test("what the mount adds to the head, and a noscript's content, which the mount leaves out, leave the pairing one for one", async () => {
    const { stored, names } = await namesOf(
      [
        "<!doctype html><html><head><noscript><style>p { color: red }</style></noscript></head><body>",
        "<noscript><p>no script</p></noscript><p>one</p><p>two</p>",
        "</body></html>",
      ].join(""),
      "p",
    );
    expect(names.map((name) => named(stored, name))).toEqual(
      Array.from(stored.querySelectorAll("body > p")),
    );
  });
});

describe("mountedStyles", () => {
  test("a lint's mount holds one `<style>` per live sheet the live face writes, in cascade order — never a template's, nor the motion pin — each holding its sheet's text alone", async () => {
    const own = ".own { color: green }";
    const page = withSheets(
      createPageItem(
        {
          html: [
            "<!doctype html><html><head>",
            `<style>${own}</style>`,
            "<template><style>.template { color: red }</style></template>",
            '<link rel="stylesheet" href="v1.css">',
            '<link rel="stylesheet" href="off.css" disabled>',
            '</head><body><div class="page own"></div></body></html>',
          ].join(""),
        },
        { id: "v1", frame: { width: 600 } },
      ),
      [
        { source: { style: 0 }, text: own, readOnly: false },
        { source: { file: "v1.css" }, text: ".page { color: blue }", readOnly: false },
        { source: { file: "off.css" }, text: ".page { color: red }", readOnly: false },
      ],
    );
    const mount = await mountBare(page);
    try {
      expect(
        mountedStyles(mount.document()).map((style) => style.textContent),
      ).toEqual([own, ".page { color: blue }"]);
    } finally {
      mount.dispose();
    }
  });
});
