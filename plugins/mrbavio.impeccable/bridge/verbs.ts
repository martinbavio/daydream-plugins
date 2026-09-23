// The verbs the plugin carries, and the prompt each becomes: the Daydream
// ADAPTER first (where the agent is, what the target is, what the
// deliverable is, what is out), then Impeccable's own playbook for the
// verb and its craft floor, verbatim. Pure: the file reads and the tab
// call happen in bridge.ts; everything here is testable text.
//
// Impeccable's centre of gravity is source files in a project with a dev
// server — its `live` mode wraps a picked element in source and hot-swaps
// variants over HMR. On the canvas none of that plumbing is needed: the
// selection is the pick, a draft is a variant, and the canvas is the
// preview. So the adapter translates two words the playbooks assume —
// "target" (an element or viewport on the canvas) and the deliverable (a
// draft) — and rules out the steps that name a dev server, a screenshot
// tool, a hook or a file path.

import { variantMarker } from "../variants.ts";

/** How a verb lands: `variants` opens N drafts beside the source, each a
 * different direction; `in-place` reworks the source as an edit draft;
 * `report` lands nothing — the review is the answer. */
export type VerbMode = "variants" | "in-place" | "report";

export interface VerbSpec {
  /** The Impeccable command; `reference/<verb>.md` is its playbook. */
  verb: string;
  /** Sentence case; what a harness shows in its prompt list. */
  title: string;
  description: string;
  mode: VerbMode;
}

/** The verbs. Left out on purpose: `harden` (i18n and error states belong to a running product),
 * `overdrive` and `optimize` (scripts and bundles — a simulated viewport
 * runs neither), and everything that builds, shapes or documents a
 * project (`craft`, `shape`, `init`, `document`, `extract`, `onboard`,
 * `live`). */
export const VERBS: readonly VerbSpec[] = [
  {
    verb: "bolder",
    title: "Impeccable: bolder",
    description:
      "Amplify a safe or bland element: three draft variants beside the source, in the page's own vocabulary.",
    mode: "variants",
  },
  {
    verb: "quieter",
    title: "Impeccable: quieter",
    description:
      "Tone down an aggressive or overstimulating element: three draft variants beside the source.",
    mode: "variants",
  },
  {
    verb: "typeset",
    title: "Impeccable: typeset",
    description:
      "Improve typography — hierarchy, measure, scale, fonts: three draft variants beside the source.",
    mode: "variants",
  },
  {
    verb: "layout",
    title: "Impeccable: layout",
    description:
      "Fix spacing, rhythm and visual hierarchy: three draft variants beside the source.",
    mode: "variants",
  },
  {
    verb: "colorize",
    title: "Impeccable: colorize",
    description:
      "Add strategic colour to a monochrome or dull element: three draft variants beside the source.",
    mode: "variants",
  },
  {
    verb: "delight",
    title: "Impeccable: delight",
    description:
      "Add personality and a memorable touch: three draft variants beside the source.",
    mode: "variants",
  },
  {
    verb: "distill",
    title: "Impeccable: distill",
    description:
      "Strip the target to its essence, removing what does not earn its place; reworked in place.",
    mode: "in-place",
  },
  {
    verb: "polish",
    title: "Impeccable: polish",
    description:
      "A final quality pass — alignment, spacing, consistency, micro-detail; reworked in place.",
    mode: "in-place",
  },
  {
    verb: "clarify",
    title: "Impeccable: clarify",
    description:
      "Improve UX copy, labels and messages in the target; reworked in place.",
    mode: "in-place",
  },
  {
    verb: "animate",
    title: "Impeccable: animate",
    description:
      "Add purposeful CSS motion — transitions and animations only, no scripts; reworked in place.",
    mode: "in-place",
  },
  {
    verb: "adapt",
    title: "Impeccable: adapt",
    description:
      "Adapt the page to another width or context through @media and @container rules; reworked in place.",
    mode: "in-place",
  },
  {
    verb: "critique",
    title: "Impeccable: critique",
    description:
      "A UX design review of the target with scores, Impeccable's detector over the rendered page as evidence; nothing lands.",
    mode: "report",
  },
  {
    verb: "audit",
    title: "Impeccable: audit",
    description:
      "Technical quality checks — accessibility, performance, responsive, anti-patterns — over the rendered page with Impeccable's detector; a scored report, nothing lands.",
    mode: "report",
  },
];

export function promptName(verb: string): string {
  return `impeccable-${verb}`;
}

/** The slice of `canvas_state` the adapter reads (Daydream's CanvasState,
 * src/ai/requests.ts; the host hands it over as `unknown`). */
export interface StateSlice {
  viewports: Array<{
    id: string;
    title: string | null;
    frame: { width: number; height?: number } | null;
    position: { x: number; y: number };
  }>;
  selection: {
    /** The canvas's render-time handle, which no tool takes. */
    elementId: string;
    viewportId: string | null;
    itemIds: string[];
    /** An element inside a page: its unique selector in the page's stored
     * markup (decision #76) — what get_viewport `element` and the draft
     * tools take. Absent for an item selected whole. */
    selector?: string;
  } | null;
}

export function stateSlice(raw: unknown): StateSlice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["viewports"])) return null;
  return {
    viewports: r["viewports"] as StateSlice["viewports"],
    selection: (r["selection"] as StateSlice["selection"]) ?? null,
  };
}

export interface Target {
  viewport: StateSlice["viewports"][number];
  /** The element within it as a CSS selector naming it alone in the
   * page, or null when the whole page is the target. */
  selector: string | null;
}

/** The target, from the arguments first and the selection second: a
 * selected element in its viewport (by the selector canvas_state names it
 * with), a selected viewport item, or the one viewport on the canvas.
 * `null` means the prompt has to ask. */
export function resolveTarget(
  state: StateSlice,
  args: { viewport?: string; element?: string },
): Target | null {
  const byId = (id: string | null | undefined) =>
    id == null ? undefined : state.viewports.find((v) => v.id === id);
  if (args.viewport !== undefined) {
    const viewport = byId(args.viewport);
    return viewport === undefined
      ? null
      : { viewport, selector: args.element ?? null };
  }
  const sel = state.selection;
  if (sel !== null) {
    const viewport = byId(sel.viewportId);
    if (viewport !== undefined) {
      // A selected viewport ITEM lists itself in itemIds and carries no
      // selector; an element inside its page lists no item, and carries
      // its selector unless its page is remounting under an edit — then
      // the target is not known, and widening it to the page would rework
      // what the user did not pick.
      if (args.element !== undefined) return { viewport, selector: args.element };
      if (sel.itemIds.includes(viewport.id)) return { viewport, selector: null };
      return sel.selector === undefined ? null : { viewport, selector: sel.selector };
    }
    const item = sel.itemIds.map(byId).find((v) => v !== undefined);
    if (item !== undefined) return { viewport: item, selector: args.element ?? null };
  }
  if (state.viewports.length === 1) {
    return { viewport: state.viewports[0]!, selector: args.element ?? null };
  }
  return null;
}

export interface PromptInput {
  spec: VerbSpec;
  /** `null`: no canvas tab answered. */
  state: StateSlice | null;
  target: Target | null;
  brief?: string;
  variants: number;
  /** `reference/<verb>.md`, verbatim. */
  playbook: string;
  /** `reference/craft-floor.md`, verbatim. */
  craftFloor: string;
  skillVersion: string | null;
  /** Where the installed skill is — the detector's launcher lives under
   * it (`scripts/impeccable`); a report verb names the exact command. */
  skillDir: string;
}

export const DEFAULT_VARIANTS = 3;
/** Canvas gap between a source viewport and its variants, and between
 * variants. */
export const VARIANT_GAP = 48;

function describeViewport(v: StateSlice["viewports"][number]): string {
  const title = v.title === null ? "untitled" : `"${v.title}"`;
  const size =
    v.frame === null
      ? "no frame"
      : v.frame.height === undefined
        ? `${v.frame.width} wide`
        : `${v.frame.width}×${v.frame.height}`;
  return `viewport \`${v.id}\` (${title}, ${size}, at ${v.position.x}, ${v.position.y})`;
}

function targetSection(input: PromptInput): string {
  const { state, target } = input;
  if (state === null) {
    return "TARGET: no canvas tab answered. Open Daydream (canvas_url), select the element or viewport to work on, and run this prompt again.";
  }
  if (target === null) {
    const list =
      state.viewports.length === 0
        ? "The canvas has no viewport."
        : `Viewports on the canvas: ${state.viewports.map(describeViewport).join("; ")}.`;
    const sel = state.selection;
    if (sel !== null && sel.viewportId !== null && sel.selector === undefined && !sel.itemIds.includes(sel.viewportId)) {
      return `TARGET: an element of viewport \`${sel.viewportId}\` is selected, but the canvas could not name it (its page was remounting). Call canvas_state for its \`selection.selector\` and run the prompt again with the \`viewport\` and \`element\` arguments, or ask the user to select it again.`;
    }
    return `TARGET: nothing is selected and the canvas does not decide it alone. ${list} Ask the user which viewport (and which element inside it) this verb is about, then run the prompt again with the \`viewport\` argument (and \`element\` if one), or have them select it on the canvas.`;
  }
  const where = describeViewport(target.viewport);
  return target.selector === null
    ? `TARGET: the whole page of ${where}. Read it with get_viewport {id: "${target.viewport.id}"} — its two texts, the markup and the css.`
    : `TARGET: the element \`${target.selector}\` (a CSS selector naming it alone) inside ${where}. Read it with get_viewport {id: "${target.viewport.id}", element: ${JSON.stringify(target.selector)}} — that element's markup and the selector of each ancestor, not the page; it is the section the playbook calls "the target". The rules that style it are in the page's one stylesheet: get_viewport {id: "${target.viewport.id}"} answers the css (and the markup) when you need them. Everything outside the target is the given — it stays as it is.`;
}

function deliverableSection(input: PromptInput): string {
  const { spec, target, variants } = input;
  const id = target?.viewport.id ?? "<viewport id>";
  if (spec.mode === "report") {
    const el = target?.selector ?? null;
    const call = el === null ? `impeccable_detect {viewport: "${id}"}` : `impeccable_detect {viewport: "${id}", element: ${JSON.stringify(el)}}`;
    const scope =
      el === null
        ? ""
        : ` The target is scanned in its page, never cut out of it: the whole page is scanned as it renders, then again with the target taken out, and only the findings the target adds are answered — so every finding is the target's (the detector names text and colours, never elements), and a page-wide one the rest of the page raises too is left out. Judge the target as part of its page — the answer's \`file\` is the whole page, the target marked data-impeccable-target, open it when you need to see — but report on the target.`;
    return [
      `DELIVERABLE: THE REPORT, in chat — nothing lands on the canvas. The playbook's evidence step is Impeccable's detector over the RENDERED PAGE, and it is ONE CALL: ${call} — the host exports the page as the canvas renders it, writes it to a file, runs the installed skill's own detector over it and answers the findings (antipattern, severity, snippet) with the file's path. Do not export, write or run anything yourself; do not use npx or a global \`impeccable\`.${scope} Where the playbook says a browser, a screenshot or a URL, that file IS the page; where it names a sub-command to run, name it for the user instead (an Impeccable verb of the same name, picked on the canvas). Where it wants a snapshot persisted, skip it. THE PLAYBOOK'S ISOLATION RULE STANDS HERE, unlike the translation's line on sub-agents below: where it says an assessment must run isolated (critique's Assessment A, the design review, before any detector evidence reaches the judging context), run it as a sub-agent when the user allows them — hand it the target from get_viewport and the playbook, never the findings — and call impeccable_detect only after it answers; without sub-agents, do the design review first, call impeccable_detect after, and open the report with the playbook's DEGRADED banner, exactly as it asks. Write the report the playbook describes, scoped to the target and ordered by what to fix first. Then impeccable_done. Never open a draft or change the page: this verb only judges it.`,
    ].join("\n");
  }
  if (spec.mode === "in-place") {
    return [
      `DELIVERABLE: the target reworked IN PLACE, as one edit draft the user watches. draft_open {from: "${id}"} seeds a draft with the viewport's page, its text verbatim, and locks it — every selector you read off the viewport names the same element in the draft. Rework the target: draft_replace {draft, token, target: <its selector>, html: <its reworked markup>} for the markup, draft_edit {draft, token, css: {old, new}} to change the rules that style it (old: the exact stored text, found once), draft_append {draft, token, css} for rules it did not have; each write answers \`next\`, the token for the one after. When the page itself is the target, the same tools over the sections and rules that change — never the whole css resent to change a few rules. draft_finalize lands it in place as one undo step. One draft, one finalize. Do not open a second viewport and do not use replace_viewport or ingest.`,
    ].join("\n");
  }
  const width = target?.viewport.frame?.width ?? 960;
  const x0 = target?.viewport.position.x ?? 0;
  const y = target?.viewport.position.y ?? 0;
  const positions = Array.from({ length: variants }, (_, i) => {
    const x = x0 + (i + 1) * (width + VARIANT_GAP);
    return `${i + 1} at {x: ${x}, y: ${y}}`;
  }).join(", ");
  const title = target?.viewport.title ?? "Untitled";
  const marker = variantMarker({ verb: spec.verb, n: "n", of: variants, sourceId: id });
  return [
    `DELIVERABLE: ${variants} VARIANTS of the source, each a new draft viewport beside it, each a genuinely different direction the playbook allows — not ${variants} intensities of one idea. The order of work, for speed on the canvas:
1. Read THE TARGET, not the page: get_viewport {id: "${id}", element: <the target's selector>} answers its markup and the selector of each ancestor; the rules that style it are in the page's css (get_viewport {id: "${id}"} answers it) — enough to decide the ${variants} directions, a sentence each. Read the whole page only when the page itself is the target.
2. OPEN ALL ${variants} COPIES FIRST, back to back: draft_open {copyOf: "${id}", position: <its position below>, meta: {title: "${title} · ${spec.verb} n/${variants}", notes: <marker line, blank line, the direction>}} — each a copy of the source's page beside it, its text verbatim, the source untouched, answered without its page (you hold it) but with the draft id and \`next\`, the token for its first write. The frames are on the canvas within seconds, building, while the writing happens.
3. WRITE EACH VARIANT AND LAND IT ON ITS OWN: draft_replace {draft, token, target: <the target's selector AS YOU READ IT FROM THE SOURCE — the copy is the source's text, so it names the same element>, html: <the target's markup rewritten for that direction>}, and for its styling draft_edit {draft, token, css: {old, new}} (old: the exact stored text of what changes, found once) or draft_append {draft, token, css} for new rules — give an element you add a class of its own so its rules reach it and nothing else; each write answers \`next\`, the token for the one after. Then draft_finalize IMMEDIATELY — the canvas shows a draft as building until its own finalize lands it, so a finalize held back reads as work still going on. Never hold finalizes for the end; never send the whole page, and never resend the whole css to change a few rules.
IN PARALLEL when the user allows sub-agents (a harness spawns them only when the user, a CLAUDE.md or a skill asks — ask once if unsure): after step 2, one sub-agent per variant, spawned back to back, the parent writing nothing and waiting for all. Give each sub-agent THIS SCRIPT, in this order, with the values filled in — it sees nothing else you know:
  (a) draft_set {draft: <its draft id>, token: <its token from the open>, outline: [<its direction, a few words>]} — THE VERY FIRST CALL, before reading anything: the copy was opened before the sub-agent existed, and a draft silent for two minutes shows as stalled on the canvas.
  (b) impeccable_verb {verb: "${spec.verb}", viewport: "${id}", element: <the target's selector>, brief: <its direction>} — the playbook.
  (c) Write the target rewritten for its direction, from THE TARGET'S MARKUP AND THE CSS RULES THAT STYLE IT, exactly as stored, which you paste into its instructions (so it reads nothing again).
  (d) draft_replace {draft, token: <the token draft_set answered>, target: <the target's selector>, html: <the rewrite>}, then draft_edit or draft_append for its css with the \`next\` each answer carries, then draft_finalize IMMEDIATELY.
The slow part is the writing, so let it happen in three places at once; a variant is a bounded rewrite of one section, which a fast model handles well when your harness lets you pick one for a sub-agent. Without sub-agents, step 3 for each variant in turn, each to its finalize before the next replace — and if a copy has waited two minutes for its turn, touch it first the same way.
The notes' FIRST LINE is exactly \`${marker}\`; the canvas reads it to know the round, the user reads the rest while choosing. Positions: ${positions}. When all ${variants} are on the canvas, report each direction in one line and call impeccable_done; the user adopts one from the canvas (adopt, in a variant's title bar) or deletes the losers — do not remove anything.`,
  ].join("\n");
}

const CONTRACT = `WHERE YOU ARE: Daydream, a design tool where real HTML/CSS is the grain, reached through its MCP server. The server instructions carry the document format; the dream-author prompt is how a viewport is authored from nothing. This prompt is a VERB over a viewport that already exists.

TRANSLATION, for the playbook that follows:
- "the codebase", "the file", "the component", "the route": the viewport's PAGE from get_viewport — two texts, \`html\` (a whole HTML document) and \`css\` (its one stylesheet), stored verbatim, the way a small static site is an index.html and a styles.css. No Tailwind, no build step, no components, no tokens file beyond the css itself: a rule the playbook wants "in the design system" goes in the css the way the css already does it — a custom property on \`:root\`, a class rule.
- "the dev server", "HMR", "screenshots", "the browser", "impeccable live", "impeccable context", "the hook", "impeccable detect", "PRODUCT.md", "DESIGN.md", "surface brief", "snapshot": not here. The canvas renders every draft piece as it lands; the identity of the page is read from the page itself (its fonts, palette, spacing, devices); measure {} answers geometry when you need numbers. Skip any step that names one of these.
- "sub-agents", "the finish handoff", "hand off to polish": do the work in this session; suggest a next verb in one line if the playbook does.
- WHAT THE PAGE HAS, so you never go looking: valid HTML and valid CSS, all of it — any selector, pseudo-classes and pseudo-elements, nesting, \`@media\`, \`@container\`, \`@supports\`, \`@layer\`, \`@keyframes\` and \`animation\`, \`transition\`, custom properties, \`!important\`, \`style\` attributes, inline \`svg\`, form controls. What would run is removed at landing — \`<script>\`, \`embed\`, \`object\`, \`on*\` handlers, \`javascript:\` urls — so motion is CSS, never script, and a form renders but never submits. An element is addressed by CSS selector; give each one you add an id or a class of its own, so it can be addressed again. The server instructions carry the full rules; nothing in a repository does — do not search one.
- Fonts: a web font is an \`@font-face\` rule in the css (a remote \`src\` is vendored locally at landing); an installed one is just a font-family value.
- Images: reference what the page already references; never invent an image URL.

THE GATES judge every landing: the format gate always, and whatever other gates are enabled (the CSS author's static and necessity lints, when it is on). A blocking finding leaves the draft on the canvas for you to fix and finalize again; never work around a gate, and a declaration the necessity lint calls dead IS dead here whatever the craft floor says about building "by construction".

Refinement preserves: the target's content, its claims, what drives an action, and everything outside the target. Do not add copy or claims; ask before replacing factual text.`;

/** The prompt's one user message. */
export function composePrompt(input: PromptInput): string {
  const { spec, brief, skillVersion } = input;
  const version = skillVersion === null ? "" : ` (Impeccable ${skillVersion})`;
  const sections = [
    `# Impeccable: ${spec.verb}${version}`,
    targetSection(input),
    deliverableSection(input),
    brief === undefined || brief.trim() === ""
      ? null
      : `THE USER'S BRIEF (it wins over the playbook's defaults): ${brief.trim()}`,
    CONTRACT,
    `---\n\n# Impeccable's playbook: ${spec.verb}\n\n${input.playbook.trim()}`,
    `---\n\n# Impeccable's craft floor (read before the first edit)\n\n${input.craftFloor.trim()}`,
  ];
  return sections.filter((s): s is string => s !== null).join("\n\n");
}

/** `variants` as a prompt argument: a small positive integer, or the
 * default. */
export function variantCount(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_VARIANTS;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : DEFAULT_VARIANTS;
}
