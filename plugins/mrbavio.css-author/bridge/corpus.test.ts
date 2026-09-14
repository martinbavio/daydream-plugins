// The plugin's own corpus (knowledge/): every example's document passes the
// plugin's static lint — the gate the example is meant to model. The
// format gate and the committed INDEX.md are the core knowledge facility's
// to check (tools/knowledge/corpus.test.ts, over every plugin's folder);
// this file is what the plugin can assert with nothing but its own code.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { DreamDocument, DreamElement } from "@daydream/plugin-api";
import { coreApi } from "@daydream/plugin-testing";

import { staticLint } from "../staticLint.ts";

const EXAMPLES = path.resolve("plugins/mrbavio.css-author/knowledge/examples");

const files = (await readdir(EXAMPLES)).filter((f) => f.endsWith(".md"));

describe("css-author examples", () => {
  test("there is at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)("%s: its document passes the static lint", async (file) => {
    const text = await readFile(path.join(EXAMPLES, file), "utf8");
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(blocks).toHaveLength(1);
    const dream = JSON.parse(blocks[0]![1]!) as DreamDocument;
    // A gate gets a VALIDATED document (every element with a style map and
    // a children list); an example is written by hand and may leave the
    // empty ones out, so they are filled in here as the validator would.
    for (const item of dream.items) {
      if (item.kind === "daydream.viewport") {
        fill((item as { payload: { root: DreamElement } }).payload.root);
      }
    }
    expect(staticLint(coreApi(), dream)).toEqual([]);
  });
});

function fill(el: DreamElement): void {
  el.styles ??= {};
  el.children ??= [];
  for (const child of el.children) fill(child);
}
