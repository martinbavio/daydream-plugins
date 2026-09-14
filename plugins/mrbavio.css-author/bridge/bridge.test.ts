import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type {
  DaydreamHostApi,
  HostPromptRegistration,
  HostResourceRegistration,
  HostToolRegistration,
} from "@daydream/plugin-api/host";

import activate, { PROCEDURES_RESOURCE_URI } from "../bridge.ts";
import { bodyOf } from "./body.ts";

interface Recorded {
  tools: HostToolRegistration[];
  prompts: HostPromptRegistration[];
  resources: HostResourceRegistration[];
  instructions: string | null;
  knowledge: string | null;
}

function fakeHost(dir: string): { host: DaydreamHostApi; got: Recorded } {
  const got: Recorded = {
    tools: [],
    prompts: [],
    resources: [],
    instructions: null,
    knowledge: null,
  };
  const host: DaydreamHostApi = {
    plugin: {
      id: "mrbavio.css-author",
      dir,
      manifest: {
        id: "mrbavio.css-author",
        name: "CSS author",
        version: "0",
        minCore: "0.1.0",
      },
    },
    registerTool: (t) => void got.tools.push(t as HostToolRegistration),
    registerPrompt: (p) =>
      void got.prompts.push(p as unknown as HostPromptRegistration),
    registerResource: (r) => void got.resources.push(r),
    instructions: (text) => void (got.instructions = text),
    knowledgeDir: (rel) => void (got.knowledge = rel),
    tab: {
      state: () => Promise.reject(new Error("no tab")),
      measure: () => Promise.reject(new Error("no tab")),
      lint: () => Promise.reject(new Error("no tab")),
    },
  };
  return { host, got };
}

describe("css-author host part", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "daydream-css-author-"));
    await mkdir(path.join(dir, "knowledge"));
    await writeFile(
      path.join(dir, "knowledge", "procedures.md"),
      "---\ntopic: procedures\ntier: procedure\n---\n\n## 1. Flow first\n",
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("registers the procedures resource and nothing else — the dream-author prompt is Daydream's own; instructions and knowledge stay the manifest's", async () => {
    const { host, got } = fakeHost(dir);
    activate(host);
    expect(got.tools).toEqual([]);
    expect(got.prompts).toEqual([]);
    expect(got.resources.map((r) => [r.name, r.uri, r.mimeType])).toEqual([
      ["procedures", PROCEDURES_RESOURCE_URI, "text/markdown"],
    ]);
    expect(got.instructions).toBeNull();
    expect(got.knowledge).toBeNull();
    // Read at request time, frontmatter stripped.
    expect(await got.resources[0]!.read()).toBe("## 1. Flow first");
    await writeFile(
      path.join(dir, "knowledge", "procedures.md"),
      "## 1. Flow later\n",
    );
    expect(await got.resources[0]!.read()).toBe("## 1. Flow later");
  });

  test("bodyOf strips a frontmatter fence and tolerates none", () => {
    expect(bodyOf("---\ntopic: x\n---\n\n## 1\n")).toBe("## 1");
    expect(bodyOf("## 1\n")).toBe("## 1");
    expect(bodyOf("---\nunterminated\n")).toBe("---\nunterminated");
  });
});
