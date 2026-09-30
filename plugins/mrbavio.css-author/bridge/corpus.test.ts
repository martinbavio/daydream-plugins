// The plugin's own corpus (knowledge/), the part Node can check: every
// example is a project (decision #78) — ONE page, its markup in the html
// block and the stylesheet it links in the css block, the files it is
// written as — and carries the project's daydream.json in ONE json block,
// the document the core knowledge facility reads (Daydream's
// tools/knowledge/corpus.test.ts, which also holds it to core's reader):
// format 8, one viewport showing the page, and the page listed. Whether
// the page passes the plugin's gates is corpus.browser.test.ts's: the
// lints read the page through a browser.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const EXAMPLES = path.resolve("plugins/mrbavio.css-author/knowledge/examples");

const files = (await readdir(EXAMPLES)).filter((f) => f.endsWith(".md"));

function blocks(text: string, lang: string): string[] {
  return [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map(
    (m) => m[1] as string,
  );
}

describe("css-author examples", () => {
  test("there is at least one, and the index lists every one (the browser test finds them there)", async () => {
    expect(files.length).toBeGreaterThan(0);
    const index = await readFile(path.join(EXAMPLES, "..", "INDEX.md"), "utf8");
    const listed = [...index.matchAll(/\(examples\/([^)]+\.md)\)/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...files].sort());
  });

  test.each(files)(
    "%s: one format 8 project whose one page is the html it shows, linking the css it shows",
    async (file) => {
      const text = await readFile(path.join(EXAMPLES, file), "utf8");
      const json = blocks(text, "json");
      expect(json).toHaveLength(1);
      const dream = JSON.parse(json[0] as string) as {
        version: number;
        pages: { path: string }[];
        canvases: { items: { kind: string; payload: Record<string, unknown> }[] }[];
      };
      expect(dream.version).toBe(8);
      expect(dream.pages).toHaveLength(1);
      const viewports = dream.canvases[0]!.items.filter(
        (item) => item.kind === "daydream.viewport",
      );
      expect(viewports.length).toBeGreaterThan(0);
      for (const viewport of viewports) {
        expect(viewport.payload).toEqual({ page: dream.pages[0]!.path });
      }
      const [html] = blocks(text, "html");
      expect(blocks(text, "html")).toHaveLength(1);
      expect(blocks(text, "css")).toHaveLength(1);
      expect(html).toMatch(/<link rel="stylesheet" href="[^"]+\.css">/);
    },
  );
});
