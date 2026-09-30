// mrbavio.css-author — the opinion about what a GOOD page of a project is
// (decision #48, "Agent guidance is a plugin's"; decision #48
// P9). Core guarantees a project's document is valid; this plugin judges
// its pages. Every viewport shows a page of the project, its markup and
// its sheets as text (decision #76, #78), and both gates read it through
// the browser: the markup parsed by it, each sheet scanned so each
// declaration is judged as written (pageCss.ts, pageSheets.ts), every
// match and every computed value the browser's.
// The browser part registers the two lints as gates, which core runs on
// MCP `lint` over the open project's pages, and over a draft's page at
// its `draft_finalize`, before its files are written, a blocking finding
// refusing the write (decision #78). Each lint reads, and mounts, the
// page the gate is handed (`ctx.page`, `ctx.mountViewport`: at a
// finalize, the page about to be written; pageMount.ts), and knows the
// project's other pages (`dd.document().pages`): what a lint finds of a
// rule of a sheet a page it did not judge links too is advisory, never a
// refusal (pageSheets.ts `unjudgedLinks`). At a VARIANT's finalize
// (decision #80, variantRound.ts) they refuse only what the variant
// causes: its own sheet is judged as its page will hold it once
// accepted, and what they find in the page's own sheets, or in markup
// the page already has, is advisory. The lints: the
// static lint (staticLint.ts's facts from the texts, a stray `;` that
// drops a rule among them, plus matchLint.ts's match-dependent ones: an
// explicit initial value the page computes without, redundancy — an
// element's own style against a rule, and a rule's against the rule
// beneath it — dead rules, and a container query no ancestor can answer
// — judged by MOUNTING each viewport's page,
// never by reading canvas match facts; see matchLint.ts's header) and
// the necessity lint (necessity.ts, each declaration — an element's own or
// a rule's — cut from the rendered page and restored) — both declaring
// every finding BLOCKING, as decision #43 had them;
// `.daydream/plugins.json` `gates["mrbavio.css-author"]` may soften
// either. Neither gate knows of the other: the runner (src/ai/gates.ts
// dropCovered) is what keeps a declaration the parser dropped (static)
// and therefore dead (necessity) to ONE line — both address it the same
// way, an element's by its unique selector and a rule's by its index among
// the page's rules across its sheets — and it does so once it knows each
// finding's effective severity, so softening one gate in config never
// silently softens the other. The host part (bridge.ts) carries the guidance: the
// procedures resource, and the knowledge corpus through the manifest.

import type {
  DaydreamApi,
  GateContext,
  GateRegistration,
} from "@daydream/plugin-api";

import { matchLint } from "./matchLint";
import { NECESSITY_BUDGET_MS, necessityLint } from "./necessity";
import type { ProjectPaths } from "./pageSheets";
import { staticLint } from "./staticLint";
import { roundPageOf, variantRound, type VariantRound } from "./variantRound";

/** The two gate ids; the runner's dedupe (src/ai/gates.ts) names the same
 * two strings. */
export const STATIC_GATE = "static";
export const NECESSITY_GATE = "necessity";

export default function activate(dd: DaydreamApi): void {
  dd.registerGate({
    id: STATIC_GATE,
    title: "Static lint",
    // matchLint mounts each viewport's page (the live-strategy seam it
    // shares with necessity.ts, pageMount.ts), so the static gate's run is
    // async here too. Each reads a viewport's page through the context,
    // and mounts it through the context too, never `dd.mountViewport`.
    run: async (doc, ctx) => {
      const project = projectPaths(dd);
      const { round, judging } = variantJudging(dd, doc, ctx);
      return [
        ...staticLint(dd.core, doc, judging.page, project, round),
        ...(await matchLint(dd.core, doc, judging, project, round)),
      ];
    },
  });
  dd.registerGate({
    id: NECESSITY_GATE,
    title: "Necessity lint",
    // Its width sweep ends inside the runner's time for a gate.
    run: (doc, ctx) => {
      const { round, judging } = variantJudging(dd, doc, ctx);
      return necessityLint(dd.core, doc, judging, {
        deadline: Date.now() + NECESSITY_BUDGET_MS,
        project: projectPaths(dd),
        round,
      });
    },
  });
}

/** A variant's finalize (variantRound.ts), when the gate is judging one,
 * and the context the lints read it through: the variant's own sheet a
 * subject there, as the page will hold its rules after the accept. */
function variantJudging(
  dd: DaydreamApi,
  doc: Parameters<GateRegistration["run"]>[0],
  ctx: GateContext,
): { round: VariantRound | null; judging: GateContext } {
  const round = variantRound(dd.core, doc, ctx.page);
  return {
    round,
    judging:
      round === null ? ctx : { ...ctx, page: roundPageOf(ctx.page, round) },
  };
}

/** The open project's pages by path: beside the judged document's own,
 * which at a finalize lists the page about to be written alone, the
 * pages a lint must not judge a shared sheet without (pageSheets.ts
 * `unjudgedLinks`). Each is read through the gate's `ctx.page`. */
function projectPaths(dd: DaydreamApi): ProjectPaths {
  return dd.document().pages.map((entry) => entry.path);
}
