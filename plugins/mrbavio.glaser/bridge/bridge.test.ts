import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type {
  DaydreamHostApi,
  HostPromptRegistration,
  HostToolRegistration,
} from "@daydream/plugin-api/host";

import activate, { instructionsText, SESSION_TOOL, VERB_TOOL, watchCommand } from "../bridge.ts";
import { parseVariantMarker, STORAGE_FILE } from "../variants.ts";
import manifest from "../manifest.json" with { type: "json" };
import { candidateSkillDirs, findSkillDir, SKILL_MISSING, skillVersion } from "./skill.ts";
import {
  composePrompt,
  promptName,
  resolveTarget,
  stateSlice,
  variantCount,
  VERBS,
  type StateSlice,
} from "./verbs.ts";

type Build = (args: Record<string, string | undefined>) => Promise<string>;

function fakeHost(
  state: unknown | Error,
): {
  host: DaydreamHostApi;
  prompts: HostPromptRegistration[];
  tools: HostToolRegistration[];
  instructions: () => string | null;
} {
  const prompts: HostPromptRegistration[] = [];
  const tools: HostToolRegistration[] = [];
  let instructions: string | null = null;
  const host: DaydreamHostApi = {
    plugin: {
      id: manifest.id,
      dir: "/nowhere",
      manifest: manifest as DaydreamHostApi["plugin"]["manifest"],
    },
    registerTool: (t) => void tools.push(t as HostToolRegistration),
    registerPrompt: (p) => void prompts.push(p as unknown as HostPromptRegistration),
    registerResource: () => {
      throw new Error("no resources in this slice");
    },
    instructions: (text) => void (instructions = text),
    knowledgeDir: () => {
      throw new Error("no knowledge in this slice");
    },
    tab: {
      state: () => (state instanceof Error ? Promise.reject(state) : Promise.resolve(state)),
      measure: () => Promise.reject(new Error("no tab")),
      lint: () => Promise.reject(new Error("no tab")),
    },
  };
  return { host, prompts, tools, instructions: () => instructions };
}

const pricing = {
  id: "vp_pricing",
  title: "Pricing",
  frame: { width: 960, height: 600 },
  position: { x: 100, y: 40 },
};
const docs = {
  id: "vp_docs",
  title: null,
  frame: { width: 720 },
  position: { x: 0, y: 900 },
};

const state = (selection: StateSlice["selection"], viewports = [pricing, docs]) => ({
  document: { slug: "site", title: "Site" },
  items: [],
  viewports,
  selection,
  drafts: [],
});

describe("glaser host part", () => {
  let skill = "";
  const saved = process.env["IMPECCABLE_SKILL_DIR"];
  beforeEach(async () => {
    skill = await mkdtemp(path.join(tmpdir(), "impeccable-skill-"));
    await mkdir(path.join(skill, "reference"));
    await writeFile(
      path.join(skill, "SKILL.md"),
      "---\nname: impeccable\nmetadata:\n  version: 9.9.9\n---\n\nThe skill.\n",
    );
    await writeFile(path.join(skill, "reference", "craft-floor.md"), "# Craft floor\n\nNo glow shadows.\n");
    for (const { verb } of VERBS) {
      await writeFile(path.join(skill, "reference", `${verb}.md`), `> Additional context needed\n\nThe ${verb} playbook.\n`);
    }
    process.env["IMPECCABLE_SKILL_DIR"] = skill;
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env["IMPECCABLE_SKILL_DIR"];
    else process.env["IMPECCABLE_SKILL_DIR"] = saved;
    await rm(skill, { recursive: true, force: true });
  });

  test("registers the verb tool and one prompt per verb, every name declared in the manifest, and the instructions say where the skill is", async () => {
    const { host, prompts, tools, instructions } = fakeHost(state(null));
    await activate(host);
    // The browser part registers glaser_pick; the host part these two.
    expect(tools.map((t) => t.name)).toEqual([VERB_TOOL, SESSION_TOOL]);
    expect(manifest.contributes.tools).toEqual([VERB_TOOL, SESSION_TOOL, "glaser_pick", "glaser_done"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(prompts.map((p) => p.name)).toEqual(VERBS.map((v) => promptName(v.verb)));
    expect(new Set(prompts.map((p) => p.name))).toEqual(new Set(manifest.contributes.prompts));
    expect(prompts.every((p) => /^glaser-[a-z]+$/.test(p.name))).toBe(true);
    expect(instructions()).toContain(manifest.contributes.instructions);
    expect(instructions()).toContain(`Impeccable 9.9.9 was found at ${skill}`);
  });

  test("a selected element is the target; the playbook and the craft floor follow the adapter", async () => {
    const { host, prompts } = fakeHost(
      state({ elementId: "el_card", viewportId: "vp_pricing", itemIds: [] }),
    );
    await activate(host);
    const bolder = prompts.find((p) => p.name === "glaser-bolder")!;
    const text = await (bolder.build as Build)({});
    expect(text.startsWith("# Glaser: bolder (Impeccable 9.9.9)")).toBe(true);
    expect(text).toContain('TARGET: element `el_card` inside viewport `vp_pricing` ("Pricing", 960×600, at 100, 40)');
    expect(text).toContain('get_viewport {id: "vp_pricing"}');
    // Variants land beside the source, one frame plus a gap apart.
    expect(text).toContain("3 VARIANTS");
    expect(text).toContain("1 at {x: 1108, y: 40}, 2 at {x: 2116, y: 40}, 3 at {x: 3124, y: 40}");
    expect(text).toContain('"Pricing · bolder n/3"');
    // The notes marker the canvas reads back, as the adopt command parses it.
    expect(text).toContain("`Glaser bolder · variant n of 3 of vp_pricing`");
    expect(parseVariantMarker("Glaser bolder · variant 2 of 3 of vp_pricing\n\nA denser card.")).toEqual({ verb: "bolder", n: 2, of: 3, sourceId: "vp_pricing" });
    expect(text).not.toContain("draft_open {from:");
    // A variant is a copy plus one replace (decisions.md #68), fanned out
    // to sub-agents where the harness has them.
    expect(text).toContain('draft_open {copyOf: "vp_pricing"');
    expect(text).toContain("OPEN ALL 3 COPIES FIRST");
    expect(text).toContain("draft_finalize IMMEDIATELY");
    expect(text).toContain("Never hold finalizes for the end");
    expect(text).toContain("THE TARGET ELEMENT'S JSON");
    expect(text).toContain("a fast model handles well");
    expect(text).toContain("IN PARALLEL");
    expect(text).toContain("writes its own rewrite");
    expect(text).toContain("never send the whole page");
    // Then Impeccable's own text, verbatim, in order.
    const playbook = text.indexOf("# Impeccable's playbook: bolder");
    const floor = text.indexOf("# Impeccable's craft floor");
    expect(playbook).toBeGreaterThan(text.indexOf("THE GATES"));
    expect(floor).toBeGreaterThan(playbook);
    expect(text).toContain("The bolder playbook.");
    expect(text).toContain("No glow shadows.");
  });

  test("the tool answers the same text as the prompt, from a sentence's worth of arguments", async () => {
    const { host, prompts, tools } = fakeHost(
      state({ elementId: "el_card", viewportId: "vp_pricing", itemIds: [] }),
    );
    await activate(host);
    const run = tools[0]!.run as (args: Record<string, string | undefined>) => Promise<{ text: string; isError?: boolean }>;
    const viaTool = await run({ verb: "quieter", brief: "less shouty" });
    const viaPrompt = await (prompts.find((p) => p.name === "glaser-quieter")!.build as Build)({ brief: "less shouty" });
    expect(viaTool.text).toBe(viaPrompt);
    expect(viaTool.isError).toBe(false);
    expect(viaTool.text).toContain("# Glaser: quieter");
    // The verb is an enum of the same list the prompts cover.
    const verb = (tools[0]!.inputSchema as unknown as { verb: { options: string[] } }).verb;
    expect(verb.options).toEqual(VERBS.map((v) => v.verb));
  });

  test("a selected viewport item is the whole page; an in-place verb reworks it as an edit draft", async () => {
    const { host, prompts } = fakeHost(
      state({ elementId: "html_root", viewportId: "vp_pricing", itemIds: ["vp_pricing"] }),
    );
    await activate(host);
    const polish = prompts.find((p) => p.name === "glaser-polish")!;
    const text = await (polish.build as Build)({ brief: "the footer feels crowded" });
    expect(text).toContain("TARGET: the whole page of viewport `vp_pricing`");
    expect(text).toContain('draft_open {from: "vp_pricing"}');
    expect(text).toContain("IN PLACE");
    expect(text).not.toContain("VARIANTS");
    expect(text).toContain("THE USER'S BRIEF (it wins over the playbook's defaults): the footer feels crowded");
  });

  test("arguments override the selection; variants is clamped", async () => {
    const { host, prompts } = fakeHost(
      state({ elementId: "el_card", viewportId: "vp_pricing", itemIds: [] }),
    );
    await activate(host);
    const typeset = prompts.find((p) => p.name === "glaser-typeset")!;
    const text = await (typeset.build as Build)({ viewport: "vp_docs", element: "el_h1", variants: "2" });
    expect(text).toContain("TARGET: element `el_h1` inside viewport `vp_docs` (untitled, 720 wide, at 0, 900)");
    expect(text).toContain("2 VARIANTS");
    expect(text).toContain("1 at {x: 768, y: 900}, 2 at {x: 1536, y: 900}");
    expect(text).toContain('"Untitled · typeset n/2"');
    expect(variantCount("0")).toBe(3);
    expect(variantCount("7")).toBe(3);
    expect(variantCount("x")).toBe(3);
    expect(variantCount(undefined)).toBe(3);
    expect(variantCount("4")).toBe(4);
  });

  test("nothing selected: the one viewport is the target; several make the prompt ask", async () => {
    const one = fakeHost(state(null, [pricing]));
    await activate(one.host);
    const alone = await (one.prompts[0]!.build as Build)({});
    expect(alone).toContain("TARGET: the whole page of viewport `vp_pricing`");

    const two = fakeHost(state(null));
    await activate(two.host);
    const asks = await (two.prompts[0]!.build as Build)({});
    expect(asks).toContain("TARGET: nothing is selected and the canvas does not decide it alone.");
    expect(asks).toContain("viewport `vp_pricing`");
    expect(asks).toContain("viewport `vp_docs`");
    // An unknown viewport argument asks too, rather than guessing.
    expect(await (two.prompts[0]!.build as Build)({ viewport: "vp_gone" })).toContain(
      "TARGET: nothing is selected",
    );
  });

  test("no canvas tab: the prompt says so and still carries the playbook", async () => {
    const { host, prompts } = fakeHost(new Error("no tab"));
    await activate(host);
    const text = await (prompts[0]!.build as Build)({});
    expect(text).toContain("TARGET: no canvas tab answered.");
    expect(text).toContain("The bolder playbook.");
  });

  test("the skill missing: the instructions say so at activation and every prompt answers the install line", async () => {
    await rm(skill, { recursive: true, force: true });
    const { host, prompts, tools, instructions } = fakeHost(state(null));
    await activate(host);
    expect(instructions()).toContain("NOT installed on this machine");
    expect(await (prompts[0]!.build as Build)({})).toBe(SKILL_MISSING);
    const run = tools[0]!.run as (args: Record<string, string>) => Promise<{ text: string; isError?: boolean }>;
    expect(await run({ verb: "bolder" })).toEqual({ text: SKILL_MISSING, isError: true });
    // Installed after activation: the next request finds it.
    await mkdir(path.join(skill, "reference"), { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "---\nmetadata:\n  version: 1.0.0\n---\n");
    await writeFile(path.join(skill, "reference", "craft-floor.md"), "floor");
    await writeFile(path.join(skill, "reference", "bolder.md"), "later playbook");
    expect(await (prompts[0]!.build as Build)({})).toContain("later playbook");
  });

  test("the skill is looked for in the project, then the user's roots; an override is the only candidate", async () => {
    expect(candidateSkillDirs({}, "/proj", "/home/me")).toEqual([
      "/proj/.agents/skills/impeccable",
      "/home/me/.agents/skills/impeccable",
      "/home/me/.claude/skills/impeccable",
    ]);
    expect(candidateSkillDirs({ IMPECCABLE_SKILL_DIR: "/x" }, "/proj", "/home/me")).toEqual(["/x"]);
    expect(await findSkillDir(["/nope", skill])).toBe(skill);
    expect(await findSkillDir(["/nope"])).toBeNull();
    expect(await skillVersion(skill)).toBe("9.9.9");
  });

  test("glaser_session answers the watch over the storage file and the loop", async () => {
    const { host, tools } = fakeHost(state(null));
    await activate(host);
    const session = tools.find((t) => t.name === SESSION_TOOL)!;
    const { text } = await (session.run as () => Promise<{ text: string }>)();
    expect(text).toContain(watchCommand());
    expect(watchCommand()).toContain(STORAGE_FILE);
    expect(watchCommand()).toMatch(/cksum/);
    expect(text).toContain("glaser_pick");
    expect(text).toContain("START THE WATCH AGAIN");
    expect(text).toContain("glaser_done");
  });

  test("instructionsText and stateSlice are plain", () => {
    expect(instructionsText("Base.", null)).toMatch(/^Base\. NOTE: the Impeccable skill is NOT installed/);
    expect(instructionsText("Base.", { dir: "/s", version: null })).toBe("Base. Impeccable was found at /s.");
    expect(stateSlice(null)).toBeNull();
    expect(stateSlice({ items: [] })).toBeNull();
    expect(stateSlice({ viewports: [] })).toEqual({ viewports: [], selection: null });
  });

  test("resolveTarget: an element argument on a selected page narrows it", () => {
    const s: StateSlice = {
      viewports: [pricing],
      selection: { elementId: "html_root", viewportId: "vp_pricing", itemIds: ["vp_pricing"] },
    };
    expect(resolveTarget(s, {})).toEqual({ viewport: pricing, elementId: null });
    expect(resolveTarget(s, { element: "el_x" })).toEqual({ viewport: pricing, elementId: "el_x" });
  });

  test("composePrompt without a brief has no brief section", () => {
    const text = composePrompt({
      spec: VERBS[0]!,
      state: { viewports: [pricing], selection: null },
      target: { viewport: pricing, elementId: null },
      variants: 3,
      playbook: "p",
      craftFloor: "f",
      skillVersion: null,
    });
    expect(text.startsWith("# Glaser: bolder\n")).toBe(true);
    expect(text).not.toContain("THE USER'S BRIEF");
  });
});
