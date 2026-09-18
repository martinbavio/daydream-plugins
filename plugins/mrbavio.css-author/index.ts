// mrbavio.css-author — the opinion about what a GOOD .dream document is
// (decision #48, "Agent guidance is a plugin's"; decision #48
// P9). Core guarantees a landed document is valid; this plugin judges it.
// The browser part registers the two lints as gates on every landing path
// — the static lint (staticLint.ts's JSON-only facts, plus matchLint.ts's
// match-dependent ones: redundancy — an element's against a rule, and a
// rule's against the rule beneath it — dead rules, a rule's own
// container-query-without-container, decision #71 plan phase 9 —
// judged by MOUNTING the incoming document, never by reading canvas match
// facts, since a gate's document is not on the canvas; see matchLint.ts's
// header) and the necessity lint (necessity.ts, each declaration — an
// element's or a rule's — removed in the rendered page and restored) —
// both declaring every finding BLOCKING, as decision #43 had them;
// `.daydream/plugins.json` `gates["mrbavio.css-author"]` may soften
// either. Neither gate knows of the other: the runner (src/ai/gates.ts
// dropCovered) is what keeps a declaration the parser dropped (static)
// and therefore dead (necessity) to ONE line — and it does so once it
// knows each finding's effective severity, so softening one gate in
// config never silently softens the other. The host part (bridge.ts)
// carries the guidance: the dream-author prompt, the procedures resource
// and the knowledge corpus.

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
