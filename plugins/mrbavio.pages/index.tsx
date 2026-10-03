// mrbavio.pages — the project's pages, and putting them on the canvas. A
// project is a folder and its html files are its pages (decision #78);
// `daydream.json` lists every one Daydream has seen, and a page whose
// viewports were all removed stays listed and off the canvas. This panel
// is the way back: every page by path and title, its name dragged onto
// the canvas landing a viewport exactly where it is let go, a click on it
// selecting its viewport (again, the next one), and New page making an
// empty page through the kernel.
//
// NOT here, because the plugin API has no door for them: renaming, moving
// or deleting a page's file, and bringing a selected viewport into view.

import type { DaydreamApi } from "@daydream/plugin-api";

import createPagesPanel from "./PagesPanel";
import { registerDrop } from "./place";
import { classPrefix, css } from "./styles";

export default function activate(dd: DaydreamApi): void {
  registerDrop(dd);
  dd.registerPanel({
    id: "pages",
    title: "Pages",
    styles: css(classPrefix(dd.plugin.id)),
    render: (context) => createPagesPanel(dd, context),
  });
}
