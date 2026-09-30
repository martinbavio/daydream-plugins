// The plugin's own corpus (knowledge/) against its own gates: every
// example's project passes the static gate (the static lint and the
// match lint) and the necessity gate — the gates the example is meant to
// model. Real Chromium, since the lints read a page through the browser;
// the files are read through the test runner (`commands.readFile`, paths
// from the checkout's root), found by the committed knowledge/INDEX.md, which
// bridge/corpus.test.ts holds to list every example. What Node can check
// of the same files — one format 8 project whose page is the html the
// example shows, linking the css it shows — is bridge/corpus.test.ts's;
// core's reading of the document and the index's currency are the core
// knowledge facility's (tools/knowledge/corpus.test.ts in Daydream).
import { afterAll, describe, expect, test } from "vitest";
import { commands } from "vitest/browser";

import type { DreamPage } from "@daydream/plugin-api";
import {
  coreApi,
  createTestKernel,
  documentFrom,
} from "@daydream/plugin-testing";

import { matchLint } from "./matchLint";
import { necessityLint } from "./necessity";
import { staticLint } from "./staticLint";
import { pagesOf } from "./testPages";

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

/** The one fenced block of `lang` in the example. */
function blockOf(text: string, lang: string): string {
  const blocks = [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))];
  expect(blocks).toHaveLength(1);
  return blocks[0]![1]!;
}

/** The example as the project it is: its `daydream.json`, read as core
 * reads a project's, and its one page, whose markup links the stylesheet
 * the example shows — the page's one sheet, as the host would read it. */
function projectOf(text: string) {
  const result = documentFrom(JSON.parse(blockOf(text, "json")));
  if (!result.ok) throw new Error(result.error);
  const html = blockOf(text, "html");
  const href = /<link rel="stylesheet" href="([^"]+)">/.exec(html)![1]!;
  const page: DreamPage = {
    path: result.doc.pages[0]!.path,
    html,
    sheets: [{ source: { file: href }, text: blockOf(text, "css"), readOnly: false }],
  };
  return {
    project: null,
    stored: true,
    document: result.doc,
    pages: [page],
  };
}

describe("css-author examples", () => {
  test("there is at least one", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  test.each(examples)("%s: its page passes both gates", async (_file, text) => {
    const project = projectOf(text);
    kernel.store.loadProject(project);
    const pages = pagesOf(project);
    expect(staticLint(coreApi(), project.document, pages)).toEqual([]);
    expect(await matchLint(kernel.dd, project.document, pages)).toEqual([]);
    expect(await necessityLint(kernel.dd, project.document, pages)).toEqual([]);
  });
});
