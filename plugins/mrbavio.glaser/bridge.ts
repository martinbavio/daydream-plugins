// mrbavio.glaser's HOST PART: the verbs, and the session. A verb is
// Impeccable's playbook (impeccable.style) over a viewport on the canvas,
// answered twice over one builder: as the TOOL glaser_verb an agent calls
// from a sentence — tools are the model's to invoke — and as one MCP
// PROMPT per verb for a client that picks prompts from a menu. Both are
// composed at request time: the canvas tab's state (the selection is the
// target unless the arguments name one), the verb's playbook and the
// craft floor read from the Impeccable skill installed on this machine,
// and the Daydream adapter in front of them (bridge/verbs.ts). Nothing is
// vendored: the plugin follows the installed Impeccable.
//
// The SESSION is how a pick made on the canvas reaches the agent with no
// typing. The browser part writes the pick through dd.storage, which the
// host saves to `.daydream/plugin-data/mrbavio.glaser.json` at once; an
// agent watches that file with a shell loop its harness runs as a long
// wait, wakes when it changes, takes the pick (glaser_pick, a browser
// tool) and does the verb. glaser_session answers the watch command and
// the loop — the same shape as Impeccable's own live poll, with the canvas
// as the overlay and the storage file as the journal.

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
import { STORAGE_FILE } from "./variants.ts";

export const VERB_TOOL = "glaser_verb";
export const SESSION_TOOL = "glaser_session";

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

/** The shell loop that exits when the storage file's contents change (or
 * appear): a checksum compared once a second — POSIX, no fswatch, and
 * immune to a filesystem's one-second mtime. Prints the file on exit so
 * the wake-up already shows the pick. */
export function watchCommand(file: string = STORAGE_FILE): string {
  return `f='${file}'; s=$(cksum < "$f" 2>/dev/null); while [ "$(cksum < "$f" 2>/dev/null)" = "$s" ]; do sleep 1; done; cat "$f"`;
}

/** What glaser_session answers: the watch command and the loop. */
export function sessionText(): string {
  return [
    "GLASER SESSION: the user picks verbs on the canvas; you wait, wake, do the verb, wait again. No typing in between.",
    "",
    `THE WATCH — run from the project Daydream serves (the folder holding .mcp.json and .daydream/); it exits when \`${STORAGE_FILE}\` changes, printing it:`,
    "",
    "```sh",
    watchCommand(),
    "```",
    "",
    "Run it the way your harness runs a long wait: Claude Code — a background task (the harness notifies you when it exits; never a short timeout); Codex — a yielded foreground exec you keep reading until it returns; Cursor — a background terminal with notify; anything else — a foreground call.",
    "",
    "THE LOOP:",
    "1. Start the watch. Tell the user in one line that the session is on and they can pick a verb on the canvas.",
    "2. On wake-up: glaser_pick. It answers {pick, exit} and takes the pick (the canvas caption changes from waiting to building).",
    "3. exit true → say the session ended; stop. pick null → step 1. Otherwise glaser_verb {verb, viewport, element} from the pick, follow it to the end (drafts landed, one line per direction), then glaser_done (the canvas stops saying building), then step 1 — START THE WATCH AGAIN before anything else.",
    "4. The user adopts a variant from the canvas; nothing for you to do there.",
    "",
    "Chat is overhead during a session: one line when the session starts, one line per round, one when it ends. Never run a verb the user did not pick.",
  ].join("\n");
}

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
    name: VERB_TOOL,
    title: "Glaser verb",
    description: `The playbook for one design verb over a viewport on the canvas, with the target resolved from the selection (or the arguments) and the deliverable spelled out — call it, then follow it. Verbs: ${verbs.join(", ")}. ${VERBS.filter((v) => v.mode === "variants").length} of them open draft variants beside the source, the rest rework it in place. After a canvas pick, pass the pick's viewport and element.`,
    inputSchema: {
      verb: z.enum(verbs as [string, ...string[]]).describe("The verb."),
      ...TARGET_ARGS,
    },
    annotations: { readOnlyHint: true },
    run: async ({ verb, ...args }) => {
      const spec = VERBS.find((v) => v.verb === verb)!;
      const text = await build(host, spec, args);
      return { text, isError: text === SKILL_MISSING };
    },
  });

  host.registerTool({
    name: SESSION_TOOL,
    title: "Glaser session",
    description:
      "Start a Glaser session: answers the watch command that wakes you when the user picks a verb on the canvas, and the loop to run — wait, glaser_pick, glaser_verb, wait again. Call it when the user asks for a session; then run the watch.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    run: () => ({ text: sessionText() }),
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
