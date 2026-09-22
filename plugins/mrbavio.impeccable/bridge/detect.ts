// The detector, run by the host part (decision #72): the page from
// the tab's own impeccable_html, written to a file, Impeccable's launcher
// over it, the findings back — one call an agent makes, no page through
// the model. Pure over its two seams (the tab call, the process), so a
// test can hand in both.

import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface DetectFinding {
  antipattern: string;
  name: string;
  severity: string;
  category: string;
  snippet: string;
  description?: string;
}

export interface DetectReport {
  viewportId: string;
  /** The page the detector read, kept for the agent to open. */
  file: string;
  /** The export's scope: the target and what was pruned around it. */
  target?: { selector: string; kept: number; pruned: number };
  count: number;
  /** Findings by antipattern id, most frequent first. */
  byRule: Record<string, number>;
  findings: DetectFinding[];
}

export type RunProcess = (
  file: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** execFile as a promise that never rejects on a non-zero exit — the
 * detector exits 2 WITH findings, 0 without, 1 when it could not scan. */
export const runProcess: RunProcess = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code =
        error === null
          ? 0
          : typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** A name as a file-name part: an element is a CSS selector (decision
 * #76), which may hold `>`, spaces, `#`, `:` and `/` — each run of
 * anything but letters, digits, `_` and `-` becomes one `_`, and the
 * whole is kept short. Only the reader's eye depends on it: the file
 * lives in its own fresh directory. */
export function fileSafe(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (safe === "" ? "element" : safe).slice(0, 80);
}

export async function detect(input: {
  viewportId: string;
  element?: string;
  skillDir: string;
  /** The tab's impeccable_html. */
  html: (input: { viewport: string; element?: string }) => Promise<unknown>;
  run?: RunProcess;
  dir?: string;
}): Promise<DetectReport> {
  const answer = (await input.html({
    viewport: input.viewportId,
    ...(input.element === undefined ? {} : { element: input.element }),
  })) as { html?: unknown; target?: DetectReport["target"] };
  if (typeof answer.html !== "string") {
    throw new Error("impeccable_html answered no page");
  }
  const dir = input.dir ?? (await mkdtemp(path.join(tmpdir(), "impeccable-")));
  const file = path.join(
    dir,
    `${fileSafe(input.viewportId)}${input.element === undefined ? "" : `-${fileSafe(input.element)}`}.html`,
  );
  await writeFile(file, answer.html, "utf8");
  const launcher = path.join(input.skillDir, "scripts", "impeccable");
  const { code, stdout, stderr } = await (input.run ?? runProcess)(launcher, ["detect", "--json", "--no-config", file]);
  if (code === 1) {
    throw new Error(`the detector could not scan ${file}: ${stderr.trim() || stdout.trim() || "no output"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`the detector answered no JSON (exit ${code}): ${(stderr || stdout).trim().slice(0, 300)}`);
  }
  const findings = (Array.isArray(parsed) ? parsed : []).filter(
    (f): f is DetectFinding => typeof f === "object" && f !== null && typeof (f as DetectFinding).antipattern === "string",
  );
  const byRule: Record<string, number> = {};
  for (const f of findings) byRule[f.antipattern] = (byRule[f.antipattern] ?? 0) + 1;
  const sorted = Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1]));
  return {
    viewportId: input.viewportId,
    file,
    ...(answer.target === undefined ? {} : { target: answer.target }),
    count: findings.length,
    byRule: sorted,
    findings: findings.map(({ antipattern, name, severity, category, snippet }) => ({ antipattern, name, severity, category, snippet })),
  };
}
