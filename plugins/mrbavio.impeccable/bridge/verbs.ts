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
// draft, or the page's own files) — and rules out the steps that name a
// dev server, a screenshot tool or a hook.
//
// A page is a file of the project (decision #78). A rework is an edit
// draft the user watches, which `draft_finalize` writes into the page's
// files after the gates run over it — only what changed, the canvas
// following the files. A variant is a draft copy beside its source, which
// `draft_finalize` writes into the project's `.daydream/variants/`, never
// the site (kernel Phase 9, decision #80): the user accepts it into its
// page or discards it on its title bar, or names it to the agent, who ends
// it as the kernel's own guide says. The deliverable points at that guide
// rather than restating it.

/** What a verb makes: `variants` opens N draft copies beside the source,
 * each a different direction, finalized as variants for the user to
 * accept or discard; `in-place` reworks the source's page in an edit
 * draft, finalized into its files; `report` changes nothing — the review
 * is the answer. */
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
      "Amplify a safe or bland element: three variants beside the source, in the page's own vocabulary.",
    mode: "variants",
  },
  {
    verb: "quieter",
    title: "Impeccable: quieter",
    description:
      "Tone down an aggressive or overstimulating element: three variants beside the source.",
    mode: "variants",
  },
  {
    verb: "typeset",
    title: "Impeccable: typeset",
    description:
      "Improve typography — hierarchy, measure, scale, fonts: three variants beside the source.",
    mode: "variants",
  },
  {
    verb: "layout",
    title: "Impeccable: layout",
    description:
      "Fix spacing, rhythm and visual hierarchy: three variants beside the source.",
    mode: "variants",
  },
  {
    verb: "colorize",
    title: "Impeccable: colorize",
    description:
      "Add strategic colour to a monochrome or dull element: three variants beside the source.",
    mode: "variants",
  },
  {
    verb: "delight",
    title: "Impeccable: delight",
    description:
      "Add personality and a memorable touch: three variants beside the source.",
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
      "A UX design review of the target with scores, Impeccable's detector over the rendered page as evidence; nothing changes.",
    mode: "report",
  },
  {
    verb: "audit",
    title: "Impeccable: audit",
    description:
      "Technical quality checks — accessibility, performance, responsive, anti-patterns — over the rendered page with Impeccable's detector; a scored report, nothing changes.",
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
    /** The page it shows: its path in the project (decision #78), the
     * file an in-place rework is written to. */
    page: string;
    /** A viewport of a VARIANT of that page (kernel Phase 9): the
     * variant's markup in `.daydream/variants/`, which a rework of it is
     * written to instead. Absent for the page's own. */
    variant?: string;
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
  const size =
    v.frame === null
      ? "no frame"
      : v.frame.height === undefined
        ? `${v.frame.width} wide`
        : `${v.frame.width}×${v.frame.height}`;
  const shows =
    v.variant === undefined ? `the page \`${v.page}\`` : `the variant \`${v.variant}\` of the page \`${v.page}\``;
  return `viewport \`${v.id}\` (${shows}, ${size}, at ${v.position.x}, ${v.position.y})`;
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
    ? `TARGET: the whole page of ${where}. Read it with get_viewport {id: "${target.viewport.id}"} — its markup and its sheets.`
    : `TARGET: the element \`${target.selector}\` (a CSS selector naming it alone) inside ${where}. Read it with get_viewport {id: "${target.viewport.id}", element: ${JSON.stringify(target.selector)}} — that element's markup and the selector of each ancestor, not the page; it is the section the playbook calls "the target". The rules that style it are in the page's sheets: get_viewport {id: "${target.viewport.id}"} answers them (and the markup) when you need them. Everything outside the target is the given — it stays as it is.`;
}

/** Where a copy's css, and a variant's own sheet, apply (decision #81):
 * where the variant's accept appends them, which the canvas previews and
 * the gates judge — right after the page's last own stylesheet that
 * applies wherever it is shown, or a `<page>.css` the accept links at the
 * end of the head — so a `<style>` block or a remote sheet after that one
 * wins over them. Said once, for both. */
const WHERE_CSS = `where the variant's accept will append it: right after the page's last own stylesheet that applies wherever it is shown (for a page with none, a \`<page>.css\` linked at the end of its head), so a \`<style>\` block or a remote sheet the page applies after that one still wins over it`;

/** How a COPY of a page styles (the kernel's DraftViewport): its markup
 * is the page's, its own css starts empty, and that css applies where
 * the variant's accept will append it (`WHERE_CSS`). */
const DRAFT_CSS = `The draft's css starts empty and applies ${WHERE_CSS}. Restyle with draft_append {draft, token, css}, the rules that change — at equal specificity they win over the sheets before them — and change a rule in one of the markup's \`<style>\` blocks in place with draft_edit {draft, token, html: {old, new}} (old: the exact stored text, found once).`;

/** How a draft seeded from a VARIANT's viewport styles (kernel Phase 9,
 * decision #80): its markup is the variant's and its css the variant's
 * own sheet, which applies where its accept will append it
 * (`WHERE_CSS`); what it finalizes is written into `.daydream/variants/`,
 * never the site — so a rule of the page's sheets is overridden, never
 * edited in its file. */
const VARIANT_CSS = `The draft starts from the VARIANT: its markup, and the variant's own sheet as its css, which applies ${WHERE_CSS}. Change a rule of it in place with draft_edit {draft, token, css: {old, new}} (old: the exact stored text, found once), add rules with draft_append {draft, token, css}, and change a rule in one of the markup's \`<style>\` blocks with draft_edit {draft, token, html: {old, new}}. The page's own sheets are the site's: override a rule of theirs in the draft's css, never in their files.`;

/** What a rework's css is (the kernel's draft guide): the rules to ADD,
 * which its finalize appends where the format rules say; a rule already
 * in a sheet file is changed in that file. */
const REWORK_CSS = `The draft's css starts empty and holds only the rules to ADD — for what the rework adds, each under a class of its own — which the finalize appends where the page keeps its rules; change a rule in one of the markup's \`<style>\` blocks in place with draft_edit {draft, token, html: {old, new}} (old: the exact stored text, found once). A rule already in a sheet file the page links is not the draft's: change it in that file, after the finalize (step 4).`;

/** How a variant is ended: the kernel's title bar, or the agent as the
 * kernel's own guide says — pointed at, never restated, and who decides
 * left to it (decision #80: said once, there). */
function variantEnd(page: string): string {
  return `Each variant's title bar has Accept, which writes it into ${page}, and Discard; to end one yourself, follow the server's instructions (Core tools, DRAFTS).`;
}

function deliverableSection(input: PromptInput): string {
  const { spec, target, variants } = input;
  const id = target?.viewport.id ?? "<viewport id>";
  const page = target === null ? "the page's file" : `\`${target.viewport.page}\``;
  /** The variant the target viewport shows, if it shows one. */
  const shown = target?.viewport.variant;
  if (spec.mode === "report") {
    const el = target?.selector ?? null;
    const call = el === null ? `impeccable_detect {viewport: "${id}"}` : `impeccable_detect {viewport: "${id}", element: ${JSON.stringify(el)}}`;
    const scope =
      el === null
        ? ""
        : ` The target is scanned in its page, never cut out of it: the whole page is scanned as it renders, then again with the target taken out, and only the findings the target adds are answered — so every finding is the target's (the detector names text and colours, never elements), and a page-wide one the rest of the page raises too is left out. Judge the target as part of its page — the answer's \`file\` is the whole page, the target marked data-impeccable-target, open it when you need to see — but report on the target.`;
    return [
      `DELIVERABLE: THE REPORT, in chat — nothing changes, on the canvas or in the project. The playbook's evidence step is Impeccable's detector over the RENDERED PAGE, and it is ONE CALL: ${call} — the host exports the page as the canvas renders it, writes it to a file, runs the installed skill's own detector over it and answers the findings (antipattern, severity, snippet) with the file's path. Do not export, write or run anything yourself; do not use npx or a global \`impeccable\`.${scope} Where the playbook says a browser, a screenshot or a URL, that file IS the page; where it names a sub-command to run, name it for the user instead (an Impeccable verb of the same name, picked on the canvas). Where it wants a snapshot persisted, skip it. THE PLAYBOOK'S ISOLATION RULE STANDS HERE, unlike the translation's line on sub-agents below: where it says an assessment must run isolated (critique's Assessment A, the design review, before any detector evidence reaches the judging context), run it as a sub-agent when the user allows them — hand it the target from get_viewport and the playbook, never the findings — and call impeccable_detect only after it answers; without sub-agents, do the design review first, call impeccable_detect after, and open the report with the playbook's DEGRADED banner, exactly as it asks. Write the report the playbook describes, scoped to the target and ordered by what to fix first. Then impeccable_done. Never open a draft or change the page: this verb only judges it.`,
    ].join("\n");
  }
  if (spec.mode === "in-place" && shown !== undefined) {
    return [
      `DELIVERABLE: the target reworked IN PLACE, in the VARIANT this viewport shows — as one edit draft the user watches, then written into the variant's own files by its finalize, never into ${page}.
1. draft_open {from: "${id}"} seeds a draft with the variant and locks its viewport — every selector you read off the viewport names the same element in the draft.
2. Rework the target in the draft: draft_replace {draft, token, target: <its selector>, html: <its reworked markup>} for the markup. ${VARIANT_CSS} Each write answers \`next\`, the token for the one after. When the page itself is the target, the same tools over the sections and rules that change — never the whole page resent to change a few of them.
3. draft_finalize {draft, token}: every gate runs over what it is about to write, and it writes the variant's files (\`${shown}\` and its sheet), nothing of the site; a blocking finding refuses it — fix in the draft what it names and finalize again. Its answer carries the measure report and the advisory findings: read them, do not measure again.
It stays a variant. ${variantEnd(page)} One draft, one rework. Do not open a second viewport. Then impeccable_done.`,
    ].join("\n");
  }
  if (spec.mode === "in-place") {
    return [
      `DELIVERABLE: the target reworked IN PLACE — as one edit draft the user watches, then written into the page's own files by its finalize.
1. draft_open {from: "${id}"} seeds a draft with the viewport's page and locks it — every selector you read off the viewport names the same element in the draft.
2. Rework the target in the draft: draft_replace {draft, token, target: <its selector>, html: <its reworked markup>} for the markup. ${REWORK_CSS} Each write answers \`next\`, the token for the one after. When the page itself is the target, the same tools over the sections and rules that change — never the whole page resent to change a few of them.
3. draft_finalize {draft, token}: every gate runs over the page it is about to write, and it writes back into ${page} only what the draft changed; a blocking finding refuses it — fix what it names where it names it (the draft, or a rule already in a sheet file, in that file) and finalize again. The canvas follows the files. Its answer carries the measure report and the advisory findings: read them, do not measure again.
4. Each rule of a linked sheet the rework changes: change it in that file with your file tools, in place rather than overridden after it, nothing else in the file changed; then lint {viewportIds: ["${id}"]} and fix in the files what a blocking finding names.
One draft, one rework. Do not open a second viewport. Then impeccable_done.`,
    ].join("\n");
  }
  const width = target?.viewport.frame?.width ?? 960;
  const x0 = target?.viewport.position.x ?? 0;
  const y = target?.viewport.position.y ?? 0;
  const positions = Array.from({ length: variants }, (_, i) => {
    const x = x0 + (i + 1) * (width + VARIANT_GAP);
    return `${i + 1} at {x: ${x}, y: ${y}}`;
  }).join(", ");
  const title = target?.viewport.page ?? "Untitled";
  const source =
    shown === undefined
      ? "a copy of the source's page"
      : `a copy of the variant the source shows — a new variant of ${page}`;
  return [
    `DELIVERABLE: ${variants} VARIANTS of the source, each a DRAFT COPY beside it that you finalize into a VARIANT, each a genuinely different direction the playbook allows — not ${variants} intensities of one idea. A copy's finalize writes it into the project's \`.daydream/variants/\`, never the site: ${page} stays as it is. The order of work, for speed on the canvas:
1. Read THE TARGET, not the page: get_viewport {id: "${id}", element: <the target's selector>} answers its markup and the selector of each ancestor; the rules that style it are in the page's sheets (get_viewport {id: "${id}"} answers them) — enough to decide the ${variants} directions, a sentence each. Read the whole page only when the page itself is the target.
2. OPEN ALL ${variants} COPIES FIRST, back to back: draft_open {copyOf: "${id}", position: <its position below>, meta: {title: "${title} · ${spec.verb} n/${variants}"}} — each ${source} beside it, the source untouched, answered without its page (you hold it) but with the draft id and \`next\`, the token for its first write. The title names the copy while it builds. The frames are on the canvas within seconds, building, while the writing happens.
3. WRITE EACH VARIANT: draft_replace {draft, token, target: <the target's selector AS YOU READ IT FROM THE SOURCE — the copy is the source's text, so it names the same element>, html: <the target's markup rewritten for that direction>}. ${shown === undefined ? DRAFT_CSS : VARIANT_CSS} Give an element you add a class of its own so its rules reach it and nothing else; each write answers \`next\`, the token for the one after. Never send the whole page, and never resend a whole sheet to change a few rules.
4. FINALIZE EACH, once written: draft_finalize {draft, token} — the gates run over the copy, and it lands as a variant where the draft stood, answered with its file (\`<page-stem>.<n>.html\`), which its title bar names from then on; a blocking finding refuses it — fix in the draft what it names and finalize again. Every copy of the round is finalized: none is left a draft.
IN PARALLEL when the user allows sub-agents (a harness spawns them only when the user, a CLAUDE.md or a skill asks — ask once if unsure): after step 2, one sub-agent per variant, spawned back to back, the parent writing nothing and waiting for all. Give each sub-agent THIS SCRIPT, in this order, with the values filled in — it sees nothing else you know:
  (a) draft_set {draft: <its draft id>, token: <its token from the open>, outline: [<its direction, a few words>]} — THE VERY FIRST CALL, before reading anything: the copy was opened before the sub-agent existed, and a draft silent for two minutes shows as stalled on the canvas.
  (b) impeccable_verb {verb: "${spec.verb}", viewport: "${id}", element: <the target's selector>, brief: <its direction>} — the playbook.
  (c) Write the target rewritten for its direction, from THE TARGET'S MARKUP AND THE CSS RULES THAT STYLE IT, exactly as stored, which you paste into its instructions (so it reads nothing again).
  (d) draft_replace {draft, token: <the token draft_set answered>, target: <the target's selector>, html: <the rewrite>}, then draft_append for its css (or draft_edit for a rule already in the draft's text) with the \`next\` each answer carries; then draft_finalize {draft, token: <the last next>} — a blocking finding: fix what it names and finalize again — and stop there, answering the variant's file.
The slow part is the writing, so let it happen in three places at once; a variant is a bounded rewrite of one section, which a fast model handles well when your harness lets you pick one for a sub-agent. Without sub-agents, steps 3 and 4 for each variant in turn — and if a copy has waited two minutes for its turn, touch it first the same way.
Positions: ${positions}. When all ${variants} are finalized, report each direction in one line, by its variant's file. ${variantEnd(page)} Then impeccable_done.`,
  ].join("\n");
}

const CONTRACT = `WHERE YOU ARE: Daydream, a design tool where real HTML/CSS is the grain, reached through its MCP server. The server instructions carry the format and the core tools; the dream-author prompt is how a page is authored from nothing. This prompt is a VERB over a viewport that already exists.

TRANSLATION, for the playbook that follows:
- "the codebase", "the file", "the component", "the route": the viewport's PAGE — an html file of the open project and the sheets it links or holds, which get_viewport answers, the way a small static site is an index.html and its styles.css. No Tailwind, no build step, no components, no tokens file beyond the sheets themselves: a rule the playbook wants "in the design system" goes where the page's sheets already keep such things — a custom property on \`:root\`, a class rule.
- "the dev server", "HMR", "screenshots", "the browser", "impeccable live", "impeccable context", "the hook", "impeccable detect", "PRODUCT.md", "DESIGN.md", "surface brief", "snapshot": not here. The canvas renders every draft write at once; the identity of the page is read from the page itself (its fonts, palette, spacing, devices); measure answers geometry when you need numbers. Skip any step that names one of these.
- "sub-agents", "the finish handoff", "hand off to polish": do the work in this session; suggest a next verb in one line if the playbook does.
- WHAT THE PAGE HAS, so you never go looking: valid HTML and valid CSS, all of it — any selector, pseudo-classes and pseudo-elements, nesting, \`@media\`, \`@container\`, \`@supports\`, \`@layer\`, \`@keyframes\` and \`animation\`, \`transition\`, custom properties, \`!important\`, \`style\` attributes, inline \`svg\`, form controls. What would run is never rendered — \`<script>\`, \`embed\`, \`object\`, \`on*\` handlers, \`javascript:\` urls are left out of what the canvas shows — so motion is CSS, never script, and a form renders but never submits. An element is addressed by CSS selector; give each one you add an id or a class of its own, so it can be addressed again. The server instructions carry the full rules; beyond the page's own files, nothing in the project does — do not search it.
- Fonts: a web font is an \`@font-face\` rule in a sheet; an installed one is just a font-family value.
- Images: reference what the page already references; never invent an image URL.

THE GATES run over the page draft_finalize is about to write — a blocking finding refuses it: fix what it names, in the draft or in the sheet file it names, and finalize again; at a variant's finalize only what the variant itself changes is refused, all of it in the draft — and lint runs them over files you wrote directly: fix in the files what a blocking finding names. Never work around a gate, and a declaration the necessity lint calls dead IS dead here whatever the craft floor says about building "by construction".

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
