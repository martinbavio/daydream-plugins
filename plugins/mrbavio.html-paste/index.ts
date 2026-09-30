// mrbavio.html-paste — pasting HTML on the canvas (decision #56). The
// first door for existing HTML: a fragment copied from a browser, an
// element from devtools, a snippet from an editor. A paste of markup is a
// new page, and a page is an html file of the open project (decision
// #78): the paste writes the pasted text as a new file through
// `dd.createPage`, which names it, downloads its remote media into
// `assets/` and places it, and the paste selects it. No panel, no
// command, no toast.

import type { DaydreamApi } from "@daydream/plugin-api";

import { registerHtmlPaste } from "./paste";

export default function activate(dd: DaydreamApi): void {
  registerHtmlPaste(dd);
}
