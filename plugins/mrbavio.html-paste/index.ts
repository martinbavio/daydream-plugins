// mrbavio.html-paste — pasting HTML on the canvas lands it as a viewport
// (decision #56). The first door for existing HTML: a fragment copied
// from a browser, an element from devtools, a snippet from an editor.
// Since format 7 (decision #76) a viewport is a page, its markup and its
// stylesheet as text, so the paste lands what was pasted, cleaned by the
// kernel as every landing is (`dd.cleanPage`): what could run cut out,
// the `<style>` text folded into the css, the rest as the html, and one
// console line saying what the cleaning did. No panel, no command, no
// toast.

import type { DaydreamApi } from "@daydream/plugin-api";

import { registerHtmlPaste } from "./paste";

export default function activate(dd: DaydreamApi): void {
  registerHtmlPaste(dd);
}
