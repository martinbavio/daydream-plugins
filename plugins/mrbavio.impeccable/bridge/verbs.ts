// The verbs this plugin carries, and the prompt each becomes: the Daydream
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

/** How a verb lands: `variants` opens N drafts beside the source, each a
 * different direction; `in-place` reworks the source as an edit draft. */
export type VerbMode = "variants" | "in-place";

export interface VerbSpec {
  /** The Impeccable command; `reference/<verb>.md` is its playbook. */
  verb: string;
  /** Sentence case; what a harness shows in its prompt list. */
  title: string;
  description: string;
  mode: VerbMode;
}

/** The verbs of the first slice. Left out on purpose: `critique` and
 * `audit` (both require the detector, which the plugin wires in its next
 * slice), `harden` (i18n and error states belong to a running product),
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
      "Adapt the page to another width or context through @media layers; reworked in place.",
    mode: "in-place",
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
    elementId: string;
    viewportId: string | null;
    itemIds: string[];
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
  /** The element within it, or null when the whole page is the target. */
  elementId: string | null;
}

/** The target, from the arguments first and the selection second: a
 * selected element in its viewport, a selected viewport item, or the one
 * viewport on the canvas. `null` means the prompt has to ask. */
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
      : { viewport, elementId: args.element ?? null };
  }
  const sel = state.selection;
  if (sel !== null) {
    const viewport = byId(sel.viewportId);
    if (viewport !== undefined) {
      // A selected viewport ITEM lists itself in itemIds with its root as
      // the element; an element inside it lists no item.
      const isRoot = sel.itemIds.includes(viewport.id);
      return {
        viewport,
        elementId: args.element ?? (isRoot ? null : sel.elementId),
      };
    }
    const item = sel.itemIds.map(byId).find((v) => v !== undefined);
    if (item !== undefined) return { viewport: item, elementId: args.element ?? null };
  }
  if (state.viewports.length === 1) {
    return { viewport: state.viewports[0]!, elementId: args.element ?? null };
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
    return `TARGET: nothing is selected and the canvas does not decide it alone. ${list} Ask the user which viewport (and which element inside it) this verb is about, then run the prompt again with the \`viewport\` argument (and \`element\` if one), or have them select it on the canvas.`;
  }
  const where = describeViewport(target.viewport);
  return target.elementId === null
    ? `TARGET: the whole page of ${where}. Read it with get_viewport {id: "${target.viewport.id}"}.`
    : `TARGET: element \`${target.elementId}\` inside ${where}. Read the page with get_viewport {id: "${target.viewport.id}"} and find the element by id in its tree; it is the section the playbook calls "the target". Everything outside it is the given — it stays as it is.`;
}

function deliverableSection(input: PromptInput): string {
  const { spec, target, variants } = input;
  const id = target?.viewport.id ?? "<viewport id>";
  if (spec.mode === "in-place") {
    return [
      `DELIVERABLE: the target reworked IN PLACE, as one edit draft the user watches. draft_open {from: "${id}"} seeds a draft from the viewport and locks it; draft_replace the target subtree (or draft_set the root's styles when the page itself is the target) with the reworked version; draft_finalize lands it in place as one undo step. One draft, one finalize. Do not open a second viewport and do not use replace_viewport or ingest.`,
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
  return [
    `DELIVERABLE: ${variants} VARIANTS of the source, each a new draft viewport beside it, each a genuinely different direction the playbook allows — not three intensities of one idea. For variant n: draft_open with the source's frame, fonts and meta (meta.title "${title} · ${spec.verb} n/${variants}"), the source's whole root with the target rewritten for that direction, and position ${positions}; then draft_finalize. The source stays untouched. Open and finalize them one after another so the user sees each land. When all ${variants} are on the canvas, report each direction in one line; the user adopts one by hand (or deletes the losers) — do not remove anything.`,
  ].join("\n");
}

const CONTRACT = `WHERE YOU ARE: Daydream, a design tool where real HTML/CSS is the grain, reached through its MCP server. The server instructions carry the document format; the dream-author prompt is how a viewport is authored from nothing. This prompt is a VERB over a viewport that already exists.

TRANSLATION, for the playbook that follows:
- "the codebase", "the file", "the component", "the route": the viewport's JSON from get_viewport — an element tree whose every style is a verbatim CSS declaration in the element's \`styles\` map, with conditional layers holding \`@media\` / \`@container\` blocks. No classes, no Tailwind, no tokens file, no components: a rule the playbook wants "in the design system" is a declaration on the elements that need it (or a custom property on the root, read with var()).
- "the dev server", "HMR", "screenshots", "the browser", "impeccable live", "impeccable context", "the hook", "impeccable detect", "PRODUCT.md", "DESIGN.md", "surface brief", "snapshot": not here. The canvas renders every draft piece as it lands; the identity of the page is read from the page itself (its fonts, palette, spacing, devices); measure {} answers geometry when you need numbers. Skip any step that names one of these.
- "sub-agents", "the finish handoff", "hand off to polish": do the work in this session; suggest a next verb in one line if the playbook does.
- Scripts do not run in a viewport: motion is CSS transitions and animations; states are :hover / :focus-visible / :active in the element's state layers.
- Fonts: a web font is a \`fonts\` entry on the viewport payload (family, src, weight, display); an installed one is just a font-family value.
- Images: reference what the page already references; never invent an image URL.

THE GATES judge every landing: the format gate always, and whatever other gates are enabled (the CSS author's static and necessity lints, when it is on). A blocking finding leaves the draft on the canvas for you to fix and finalize again; never work around a gate, and a declaration the necessity lint calls dead IS dead here whatever the craft floor says about building "by construction".

Refinement preserves: the target's content, its claims, what drives an action, and everything outside the target. Do not add copy or claims; ask before replacing factual text.`;

/** The prompt's one user message. */
export function composePrompt(input: PromptInput): string {
  const { spec, brief, skillVersion } = input;
  const version = skillVersion === null ? "" : ` (Impeccable ${skillVersion})`;
  const sections = [
    `# impeccable ${spec.verb}${version}`,
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
