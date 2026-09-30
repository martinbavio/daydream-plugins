// mrbavio.html-paste — pasting HTML on the canvas (decision #56). The
// first door for existing HTML: a fragment copied from a browser, an
// element from devtools, a snippet from an editor. A paste of markup is a
// new page, and a page is an html file of the open project (decision
// #78), which Daydream does not make yet: the paste is claimed (it is not
// canvas text, so Text never gets it), the kernel is asked to place it and
// refuses it as not yet, and one console line says so. Phase 6 of the
// project model makes a pasted page a file of the project. No panel, no
// command, no toast.

import type { DaydreamApi } from "@daydream/plugin-api";

import { registerHtmlPaste } from "./paste";

export default function activate(dd: DaydreamApi): void {
  registerHtmlPaste(dd);
}
