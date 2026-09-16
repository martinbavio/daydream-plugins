import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { detect, type RunProcess } from "./detect.ts";

const FINDINGS = [
  { antipattern: "low-contrast", name: "Low contrast text", severity: "warning", category: "quality", snippet: "3.5:1 (need 4.5:1) — text #767676 on #1b2515", description: "long", file: "/x", line: 0 },
  { antipattern: "tiny-text", name: "Tiny text", severity: "warning", category: "quality", snippet: "10px body text", file: "/x", line: 0 },
  { antipattern: "tiny-text", name: "Tiny text", severity: "warning", category: "quality", snippet: "10px body text", file: "/x", line: 0 },
];

describe("impeccable_detect's core", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "impeccable-detect-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("exports through the tab, writes the page, runs the skill's launcher with --json, answers the findings tallied and trimmed", async () => {
    const calls: unknown[] = [];
    const run: RunProcess = async (file, args) => {
      calls.push([file, args]);
      return { code: 2, stdout: JSON.stringify(FINDINGS), stderr: "" };
    };
    const report = await detect({
      viewportId: "vp1",
      element: "el9",
      skillDir: "/skill",
      dir,
      run,
      html: async (input) => {
        calls.push(input);
        return { viewportId: "vp1", html: "<!doctype html><html></html>", bytes: 29, target: { id: "el9", kept: 3, pruned: 7 } };
      },
    });
    expect(calls[0]).toEqual({ viewport: "vp1", element: "el9" });
    const file = path.join(dir, "vp1-el9.html");
    expect(calls[1]).toEqual(["/skill/scripts/impeccable", ["detect", "--json", "--no-config", file]]);
    expect(await readFile(file, "utf8")).toBe("<!doctype html><html></html>");
    expect(report).toEqual({
      viewportId: "vp1",
      file,
      target: { id: "el9", kept: 3, pruned: 7 },
      count: 3,
      byRule: { "tiny-text": 2, "low-contrast": 1 },
      findings: FINDINGS.map(({ antipattern, name, severity, category, snippet }) => ({ antipattern, name, severity, category, snippet })),
    });
  });

  test("a clean page is zero findings; a scan that could not run is an error with the detector's words; no page is an error", async () => {
    const html = async () => ({ html: "<html></html>" });
    const clean = await detect({ viewportId: "vp1", skillDir: "/s", dir, html, run: async () => ({ code: 0, stdout: "[]", stderr: "" }) });
    expect(clean).toMatchObject({ count: 0, byRule: {}, findings: [], file: path.join(dir, "vp1.html") });
    expect(clean.target).toBeUndefined();
    await expect(
      detect({ viewportId: "vp1", skillDir: "/s", dir, html, run: async () => ({ code: 1, stdout: "", stderr: "launcher: no binary" }) }),
    ).rejects.toThrow(/could not scan .*launcher: no binary/);
    await expect(
      detect({ viewportId: "vp1", skillDir: "/s", dir, html, run: async () => ({ code: 2, stdout: "not json", stderr: "" }) }),
    ).rejects.toThrow(/answered no JSON/);
    await expect(detect({ viewportId: "vp1", skillDir: "/s", dir, html: async () => ({}), run: async () => ({ code: 0, stdout: "[]", stderr: "" }) })).rejects.toThrow(/no page/);
  });
});
