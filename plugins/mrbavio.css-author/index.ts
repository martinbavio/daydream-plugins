// mrbavio.css-author — the opinion about what a GOOD .dream document is
// (decision #48, "Agent guidance is a plugin's"; decision #48
// P9). Core guarantees a landed document is valid; this plugin judges it.
// Every viewport is a page, its markup and its css as text (decision
// #76), and both gates read it through the browser: the markup parsed by
// it, the css scanned so each declaration is judged as written
// (pageCss.ts), every match and every computed value the browser's.
// The browser part registers the two lints as gates on every landing path
// — the static lint (staticLint.ts's facts from the texts, plus
// matchLint.ts's match-dependent ones: redundancy — an element's own
// style against a rule, and a rule's against the rule beneath it — dead
// rules, and a container query no ancestor can answer — judged by
// MOUNTING the incoming page, never by reading canvas match facts, since
// a gate's document is not on the canvas; see matchLint.ts's header) and
// the necessity lint (necessity.ts, each declaration — an element's own or
// a rule's — cut from the rendered page and restored) — both declaring
// every finding BLOCKING, as decision #43 had them;
// `.daydream/plugins.json` `gates["mrbavio.css-author"]` may soften
// either. Neither gate knows of the other: the runner (src/ai/gates.ts
// dropCovered) is what keeps a declaration the parser dropped (static)
// and therefore dead (necessity) to ONE line — both address it the same
// way, an element's by its unique selector and a rule's by its index among
// the page's rules — and it does so once it knows each finding's
// effective severity, so softening one gate in config never silently
// softens the other. The host part (bridge.ts) carries the guidance: the
// procedures resource, and the knowledge corpus through the manifest.

import type { DaydreamApi, DreamDocument } from "@daydream/plugin-api";

import { matchLint } from "./matchLint";
import { necessityLint } from "./necessity";
import { staticLint } from "./staticLint";

/** The two gate ids; the runner's dedupe (src/ai/gates.ts) names the same
 * two strings. */
export const STATIC_GATE = "static";
export const NECESSITY_GATE = "necessity";

export default function activate(dd: DaydreamApi): void {
  dd.registerGate({
    id: STATIC_GATE,
    title: "Static lint",
    // matchLint mounts the document (necessity.ts's own live-strategy
    // seam), so the static gate's run is async here too.
    run: async (doc) => [
      ...staticLint(dd.core, doc as DreamDocument),
      ...(await matchLint(dd, doc as DreamDocument)),
    ],
  });
  dd.registerGate({
    id: NECESSITY_GATE,
    title: "Necessity lint",
    run: (doc) => necessityLint(dd, doc as DreamDocument),
  });
}
