// The page a paste makes (decision #78). A page is an html file of the
// open project, and a viewport shows one by its path: a paste of markup
// is a new page, the pasted text written as a new file of the project
// through `dd.createPage` (paste.ts), at a 960 frame. The kernel names
// the file, downloads the remote media it names into `assets/` and
// writes every other byte as sent — nothing is cleaned or folded: what
// would run is the render walk's to leave off the mount, as for every
// page. What is here is the parse the claiming reads and the cap counts.

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
