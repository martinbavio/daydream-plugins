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

import type * as Skill from "./bridge/skill.ts";
import type * as Verbs from "./bridge/verbs.ts";

/** The helpers, imported FRESH on every activation. The host re-imports
 * bridge.ts with a cache-busting query on each reload, but a helper
 * imported statically from bridge/ stays in Node's module cache for the
 * life of the host — so a shipped change to verbs.ts (the verb list,
 * every deliverable) would sit inert until a restart. A dynamic import
 * with its own query is the kernel's trick, applied one level down.
 * (variants.ts, which verbs.ts imports statically, still needs a restart
 * when it changes; it rarely does.) */
async function helpers(): Promise<{ skill: typeof Skill; verbs: typeof Verbs }> {
  const t = Date.now();
  const [skill, verbs] = await Promise.all([
    import(/* @vite-ignore */ `./bridge/skill.ts?t=${t}`) as Promise<typeof Skill>,
    import(/* @vite-ignore */ `./bridge/verbs.ts?t=${t}`) as Promise<typeof Verbs>,
  ]);
  return { skill, verbs };
}

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
 * the wake-up already shows the pick. `file` is ABSOLUTE (the host names
 * it, decisions.md #69), so the agent's working directory never matters. */
export function watchCommand(file: string): string {
  return `f='${file}'; s=$(cksum < "$f" 2>/dev/null); while [ "$(cksum < "$f" 2>/dev/null)" = "$s" ]; do sleep 1; done; cat "$f"`;
}

/** What glaser_session answers: the watch command and the loop. */
export function sessionText(dataFile: string): string {
  return [
    "GLASER SESSION: the user picks verbs on the canvas; you wait, wake, do the verb, wait again. No typing in between.",
    "",
    `THE WATCH — it exits when the plugin's storage file changes, printing it. The path is absolute; run it from anywhere:`,
    "",
    "```sh",
    watchCommand(dataFile),
    "```",
    "",
    "Run it the way your harness runs a long wait: Claude Code — the Bash tool with run_in_background: true (the harness notifies you when it exits; never a foreground call, never a short timeout); Codex — a yielded foreground exec you keep reading until it returns; Cursor — a background terminal with notify; anything else — a foreground call.",
    "",
    "THE LOOP — one state at a time, never two:",
    "1. WAITING: call glaser_pick FIRST — a pick made before you were watching is already in the file, and a watch started now would never wake for it. A pick → step 3. exit → stop. Nothing → start the watch (and nothing else) and tell the user in one line that the session is on and they can pick a verb on the canvas.",
    "2. WOKEN: the watch exited. Call glaser_pick; it answers {pick, exit} and takes the pick (the canvas caption changes from waiting to building). exit true → say the session ended and stop, no watch. pick null → back to 1.",
    "3. WORKING: glaser_verb {verb, viewport, element, brief} from the pick (brief when the pick carries one — the user's words, which outrank the playbook's defaults) and follow it TO THE END — every draft landed, one line per direction, then glaser_done (the canvas stops saying building). THE WATCH DOES NOT RUN DURING THIS STATE: a watch started here waits for a pick the user cannot make while you are still building, and stalls the round.",
    "4. Only when the round is done: back to 1 — start the watch again.",
    "The user adopts a variant from the canvas; nothing for you to do there.",
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
  lookedIn: readonly string[] = [],
): string {
  if (skill === null) {
    return `${manifestText} NOTE: the Impeccable skill is NOT installed on this machine (looked in ${lookedIn.join(", ")}); every verb answers with the install line until it is.`;
  }
  const version = skill.version === null ? "" : ` ${skill.version}`;
  return `${manifestText} Impeccable${version} was found at ${skill.dir}.`;
}

export default async function activate(host: DaydreamHostApi): Promise<void> {
  const { skill, verbs } = await helpers();
  const { candidateSkillDirs, findSkillDir, readReference, SKILL_MISSING, skillVersion } = skill;
  const { composePrompt, promptName, resolveTarget, stateSlice, variantCount, VERBS } = verbs;
  const dir = await findSkillDir();
  const version = dir === null ? null : await skillVersion(dir).catch(() => null);
  host.instructions(
    instructionsText(
      host.plugin.manifest.contributes?.instructions ?? "",
      dir === null ? null : { dir, version },
      candidateSkillDirs(),
    ),
  );

  const verbNames = VERBS.map((v) => v.verb);
  /** The one text both surfaces answer. */
  const build = async (spec: Verbs.VerbSpec, args: VerbArgs): Promise<string> => {
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
      skillDir: dir,
    });
  };

  host.registerTool({
    name: VERB_TOOL,
    title: "Glaser verb",
    description: `The playbook for one design verb over a viewport on the canvas, with the target resolved from the selection (or the arguments) and the deliverable spelled out — call it, then follow it. Verbs: ${verbNames.join(", ")}. ${VERBS.filter((v) => v.mode === "variants").length} of them open draft variants beside the source, ${VERBS.filter((v) => v.mode === "in-place").length} rework it in place, and critique and audit answer a report over the rendered page (glaser_html + Impeccable's detector) and land nothing. After a canvas pick, pass the pick's viewport and element.`,
    inputSchema: {
      verb: z.enum(verbNames as [string, ...string[]]).describe("The verb."),
      ...TARGET_ARGS,
    },
    annotations: { readOnlyHint: true },
    run: async ({ verb, ...args }) => {
      const spec = VERBS.find((v) => v.verb === verb)!;
      const text = await build(spec, args);
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
    run: () => ({ text: sessionText(host.plugin.dataFile) }),
  });

  for (const spec of VERBS) {
    host.registerPrompt({
      name: promptName(spec.verb),
      title: spec.title,
      description: spec.description,
      argsSchema: TARGET_ARGS,
      build: (args: VerbArgs) => build(spec, args),
    });
  }
}

