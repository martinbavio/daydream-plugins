// The plugin's own corpus (knowledge/), the part Node can check: every
// example carries ONE document — the json block the core knowledge
// facility reads (Daydream's tools/knowledge/corpus.test.ts, which also
// runs it through the format gate) — as format 7, every viewport a page;
// and the page's markup and css the example shows for reading, in its
// html and css blocks, are exactly the texts that document carries, so
// the prose and the document never drift. Whether the page passes the
// plugin's gates is corpus.browser.test.ts's: the lints read the page
// through a browser.
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
    "%s: one format 7 document whose pages are the html and css it shows",
    async (file) => {
      const text = await readFile(path.join(EXAMPLES, file), "utf8");
      const json = blocks(text, "json");
      expect(json).toHaveLength(1);
      const dream = JSON.parse(json[0] as string) as {
        version: number;
        items: { kind: string; payload: Record<string, unknown> }[];
      };
      expect(dream.version).toBe(7);
      const pages = dream.items
        .filter((item) => item.kind === "daydream.viewport")
        .map((item) => item.payload);
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        expect(typeof page["html"]).toBe("string");
        expect(typeof page["css"]).toBe("string");
        for (const v6 of ["root", "sheet", "fonts"]) expect(page).not.toHaveProperty(v6);
      }
      expect(blocks(text, "html")).toEqual(pages.map((page) => page["html"]));
      expect(blocks(text, "css")).toEqual(pages.map((page) => page["css"]));
    },
  );
});
