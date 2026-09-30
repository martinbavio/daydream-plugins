// What the HTML pane's browser tests build on (plugin.browser.test.tsx,
// drafts.browser.test.tsx, leave.browser.test.tsx): its saves, recorded.
// Writing a page's file is not yet in the project model (decision #78) —
// `dd.writePage` guards every edit and refuses one that would write, in
// one sentence per kind, writing nothing — so what a test can read of a
// save is what the pane ASKED for and what it was answered. A
// test-support file: no project collects it as a test
// (docs/plugin-authoring.md, Testing a plugin).
import { expect } from "vitest";

import type { DaydreamApi, PageEdit } from "@daydream/plugin-api";

import activate from "./index";

/** What `dd.writePage` answers a save that passes every guard, for now
 * (the kernel's src/core/notYet.ts, which a plugin cannot import). */
export const HTML_NOT_YET =
  /^Saving a page's markup is not yet in the project model/;
export const REMOVE_NOT_YET =
  /^Removing an element is not yet in the project model/;

export interface Save {
  edit: PageEdit;
  answer: string | null;
  /** `dd.loadVersion()` when the pane asked: which load of a project the
   * save was asked in. */
  load: number;
}

/** Every save the pane asked for, in order, since the last `clearSaves`. */
export const saves: Save[] = [];

export function clearSaves(): void {
  saves.length = 0;
}

/** Ask `dd.writePage`, and record the edit and its answer. */
function record(dd: DaydreamApi, edit: PageEdit): string | null {
  const answer = dd.writePage(edit);
  saves.push({
    edit: structuredClone(edit),
    // The pane asks only `html` and `remove` edits, which answer a
    // sentence or null.
    answer: typeof answer === "string" ? answer : null,
    load: dd.loadVersion(),
  });
  return typeof answer === "string" ? answer : null;
}

/** `dd` with its saves recorded; `throwing` stands in for the write
 * while it answers true — a write that throws, never recorded. */
export function recordedApi(
  dd: DaydreamApi,
  throwing: () => boolean = () => false,
): DaydreamApi {
  return {
    ...dd,
    writePage: ((edit: PageEdit) => {
      if (throwing()) throw new Error("the disk is full");
      return record(dd, edit);
    }) as DaydreamApi["writePage"],
  };
}

/** The plugin's entry over a `dd` whose saves are recorded. */
export const recorded = (dd: DaydreamApi): void => activate(recordedApi(dd));

/** The `html` saves asked for. */
export const askedHtml = (): Extract<PageEdit, { kind: "html" }>[] =>
  saves.flatMap((save) => (save.edit.kind === "html" ? [save.edit] : []));

/** The `remove` edits asked for. */
export const askedRemove = (): Extract<PageEdit, { kind: "remove" }>[] =>
  saves.flatMap((save) => (save.edit.kind === "remove" ? [save.edit] : []));

/** The last save asked for is an `html` save of `path`, from the page's
 * html as shown (`expected`) to the typed text (`html`), and it was
 * refused as not yet. */
export function lastAskedHtml(
  path: string,
  expected: string,
  html: string,
): void {
  const save = saves.at(-1);
  expect(save?.edit).toEqual({ kind: "html", path, expected, html });
  expect(save?.answer).toMatch(HTML_NOT_YET);
}
