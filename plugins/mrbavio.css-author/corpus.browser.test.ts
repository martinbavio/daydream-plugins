// The plugin's own corpus (knowledge/) against its own gates: every
// example's document passes the static gate (the static lint and the
// match lint) and the necessity gate — the gates the example is meant to
// model. Real Chromium, since the lints read a page through the browser;
// the files are read through the test runner (`commands.readFile`, paths
// from the checkout's root), found by the committed knowledge/INDEX.md, which
// bridge/corpus.test.ts holds to list every example. What Node can check
// of the same files — one format 7 document whose pages are the html and
// css the example shows — is bridge/corpus.test.ts's; the format gate and
// the index's currency are the core knowledge facility's
// (tools/knowledge/corpus.test.ts in Daydream).
import { afterAll, describe, expect, test } from "vitest";
import { commands } from "vitest/browser";

import type { DreamDocument } from "@daydream/plugin-api";
import {
  coreApi,
  createTestKernel,
  documentFrom,
} from "@daydream/plugin-testing";

import { matchLint } from "./matchLint";
import { necessityLint } from "./necessity";
import { staticLint } from "./staticLint";

/** Where the corpus is, from the root the tests run in (the checkout's). */
const KNOWLEDGE = "plugins/mrbavio.css-author/knowledge";

const index = await commands.readFile(`${KNOWLEDGE}/INDEX.md`);
const examples = await Promise.all(
  [...index.matchAll(/\((examples\/[^)]+\.md)\)/g)].map(
    async (match) =>
      [match[1]!, await commands.readFile(`${KNOWLEDGE}/${match[1]!}`)] as const,
  ),
);

const kernel = createTestKernel();
afterAll(() => kernel.dispose());

/** The example's document, validated as a landing validates it (item
 * ids filled in) before any gate sees it. */
function documentOf(text: string): DreamDocument {
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  expect(blocks).toHaveLength(1);
  const result = documentFrom(JSON.parse(blocks[0]![1]!));
  if (!result.ok) throw new Error(result.error);
  return result.doc;
}

describe("css-author examples", () => {
  test("there is at least one", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  test.each(examples)("%s: its page passes both gates", async (_file, text) => {
    const dream = documentOf(text);
    expect(staticLint(coreApi(), dream)).toEqual([]);
    expect(await matchLint(kernel.dd, dream)).toEqual([]);
    expect(await necessityLint(kernel.dd, dream)).toEqual([]);
  });
});
