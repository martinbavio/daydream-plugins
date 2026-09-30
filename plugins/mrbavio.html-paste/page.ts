// The page a paste would make (decision #78). A page is an html file of
// the open project, and a viewport shows one by its path: a paste of
// markup is a new page, which Daydream does not write yet. So what a
// paste hands the kernel is the viewport it would place — the pasted
// text as the page, at a 960 frame — and the kernel's answer, today its
// "not yet" refusal (`dd.mutateItems` throws before anything is
// written), is what the paste reports. Phase 6 of the project model makes
// a pasted page a file of the project; the cleaning this plugin ran
// before (the kernel's `dd.cleanPage`, gone in 0.1.44) and the `data:`
// images it stored through the host (`dd.vendorFile`, which refuses) come
// back with it, from git history if they still fit.

import type { CoreApi, DreamItem } from "@daydream/plugin-api";

/** Every pasted viewport's frame width: the frame rule (knowledge/
 * format.md) wants a width and no height, and 960 is the desktop page a
 * copied section was designed for. */
export const VIEWPORT_WIDTH = 960;

/** DOMParser over the whole clipboard text: a fragment gets a synthetic
 * `html`/`body`, a Chrome copy (`<meta charset>` and StartFragment
 * comments around the fragment) parses as the document it claims to be,
 * and a real document keeps its own root, head and title. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** How many elements a page made of `doc` would hold, as the element cap
 * counts them: every one in the head and the body — a `<meta>`, a
 * `<style>` too — and every one in a `<template>`'s content, which is not
 * in the tree and is stored all the same; not the `html`, `head` and
 * `body` every page has. */
export function pastedElements(doc: Document): number {
  const count = (root: ParentNode): number => {
    let n = 0;
    for (const el of root.querySelectorAll("*")) {
      n += 1;
      if (el.localName === "template" && "content" in el) {
        n += count((el as HTMLTemplateElement).content);
      }
    }
    return n;
  };
  return count(doc.head) + count(doc.body);
}

/** Whether the parse produced any element in the body — the difference
 * between markup and text that happens to start with `<`. */
export function hasElements(doc: Document): boolean {
  return doc.body.firstElementChild !== null;
}

/** The viewport a paste of `text` would place at `position`: the pasted
 * text verbatim as the page's markup, 960 wide. Its payload carries a
 * page's text, which is what a viewport cannot hold yet (decision #78):
 * the kernel refuses it by name. */
export function pastedViewport(
  core: CoreApi,
  text: string,
  position: { x: number; y: number },
): DreamItem {
  return {
    id: core.generateId(),
    kind: core.viewportKind,
    position,
    frame: { width: VIEWPORT_WIDTH },
    payload: { html: text },
  };
}
