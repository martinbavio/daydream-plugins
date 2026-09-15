// mrbavio.impeccable's HOST PART: Impeccable's verbs, twice over one
// builder. As a TOOL (`impeccable_verb {verb}`) the agent calls from a
// sentence — "make this card bolder" — since tools are the model's to
// invoke; and as one MCP PROMPT per verb, for a client that picks prompts
// from a menu (Claude Code shows them as /mcp__daydream__impeccable-<verb>,
// its own naming for MCP prompts). Both answer the same text, composed at
// request time: the canvas tab's state (the selection is the target unless
// the arguments name one), the verb's playbook and the craft floor read
// from the Impeccable skill installed on this machine, and the Daydream
// adapter in front of them (bridge/verbs.ts). Nothing is vendored: the
// plugin follows the installed Impeccable.

import { z } from "zod";

import type { DaydreamHostApi } from "@daydream/plugin-api/host";

import {
  candidateSkillDirs,
  findSkillDir,
  readReference,
  SKILL_MISSING,
  skillVersion,
} from "./bridge/skill.ts";
import {
  composePrompt,
  promptName,
  resolveTarget,
  stateSlice,
  variantCount,
  VERBS,
  type VerbSpec,
} from "./bridge/verbs.ts";

export const TOOL_NAME = "impeccable_verb";

interface VerbArgs {
  viewport?: string;
  element?: string;
  brief?: string;
  variants?: string;
}

const TARGET_ARGS = {
  viewport: z
    .string()
    .optional()
    .describe(
      "The viewport item's id (canvas_state lists them). Default: the viewport of the canvas selection, or the only viewport.",
    ),
  element: z
    .string()
    .optional()
    .describe(
      "An element id inside the viewport, when one section is the target. Default: the selected element; the whole page when a viewport item is selected.",
    ),
  brief: z
    .string()
    .optional()
    .describe("What the user said, in their words; it wins over the playbook's defaults."),
  variants: z
    .string()
    .optional()
    .describe("How many draft variants to open (1–6, default 3); ignored by in-place verbs."),
};

/** The instructions section, computed once per activation from what is
 * on the machine — so an agent connecting learns whether the verbs can
 * run before it tries one. */
export function instructionsText(
  manifestText: string,
  skill: { dir: string; version: string | null } | null,
): string {
  if (skill === null) {
    return `${manifestText} NOTE: the Impeccable skill is NOT installed on this machine (looked in ${candidateSkillDirs().join(", ")}); every verb answers with the install line until it is.`;
  }
  const version = skill.version === null ? "" : ` ${skill.version}`;
  return `${manifestText} Impeccable${version} was found at ${skill.dir}.`;
}

export default async function activate(host: DaydreamHostApi): Promise<void> {
  const dir = await findSkillDir();
  const version = dir === null ? null : await skillVersion(dir).catch(() => null);
  host.instructions(
    instructionsText(
      host.plugin.manifest.contributes?.instructions ?? "",
      dir === null ? null : { dir, version },
    ),
  );

  const verbs = VERBS.map((v) => v.verb);
  host.registerTool({
    name: TOOL_NAME,
    title: "Impeccable verb",
    description: `Impeccable's playbook for one design verb over a viewport on the canvas, with the target resolved from the selection and the deliverable spelled out — call it first, then follow it. Verbs: ${verbs.join(", ")}. ${VERBS.filter((v) => v.mode === "variants").length} of them open draft variants beside the source, the rest rework it in place.`,
    inputSchema: {
      verb: z.enum(verbs as [string, ...string[]]).describe("The Impeccable verb."),
      ...TARGET_ARGS,
    },
    annotations: { readOnlyHint: true },
    run: async ({ verb, ...args }) => {
      const spec = VERBS.find((v) => v.verb === verb)!;
      const text = await build(host, spec, args);
      return { text, isError: text === SKILL_MISSING };
    },
  });

  for (const spec of VERBS) {
    host.registerPrompt({
      name: promptName(spec.verb),
      title: spec.title,
      description: spec.description,
      argsSchema: TARGET_ARGS,
      build: (args: VerbArgs) => build(host, spec, args),
    });
  }
}

/** The one text both surfaces answer. */
async function build(
  host: DaydreamHostApi,
  spec: VerbSpec,
  args: VerbArgs,
): Promise<string> {
  // Located per request: the skill may be installed after activation.
  const dir = await findSkillDir();
  if (dir === null) return SKILL_MISSING;
  const [playbook, craftFloor, version, raw] = await Promise.all([
    readReference(dir, spec.verb),
    readReference(dir, "craft-floor"),
    skillVersion(dir).catch(() => null),
    host.tab.state().catch(() => null),
  ]);
  const state = stateSlice(raw);
  return composePrompt({
    spec,
    state,
    target: state === null ? null : resolveTarget(state, args),
    ...(args.brief === undefined ? {} : { brief: args.brief }),
    variants: variantCount(args.variants),
    playbook,
    craftFloor,
    skillVersion: version,
  });
}
