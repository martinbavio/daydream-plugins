// mbavio.html-paste — pasting HTML on the canvas lands it as a viewport
// (decisions.md #56). The first door for existing HTML: a fragment copied
// from a browser, an element from devtools, a snippet from an editor.
// Works against the model AS IT IS, downgrading what it cannot hold and
// saying what it lost, so the steps after it can be judged by the same
// pastes. No panel, no command, no toast: one paste hook and one console
// line.

import type { DaydreamApi } from "@daydream/plugin-api";

import { registerHtmlPaste } from "./paste";

export default function activate(dd: DaydreamApi): void {
  registerHtmlPaste(dd);
}
