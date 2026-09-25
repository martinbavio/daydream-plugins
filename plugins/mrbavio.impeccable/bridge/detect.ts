// The detector, run by the host part (decision #72): the page from
// the tab's own impeccable_html, written to a file, Impeccable's launcher
// over it, the findings back — one call an agent makes, no page through
// the model. Pure over its two seams (the tab call, the process), so a
// test can hand in both.
//
// With an element, the findings are the TARGET's. The detector names no
// element, and it cannot be pointed at a subtree: it judges every element
// of the file, hidden or not (display: none and visibility: hidden leave a
// side tab, a nested card or a bounce easing reported). Nor can the page
// be cut down to the target, since a rule may reach the target through
// its siblings (`.lead + .target`, `:nth-child(2)`). So the whole page is
// scanned, and scanned again with the target taken out (the export's
// baseline); what the first holds that the second does not is the
// target's. A page-wide finding the rest of the page raises too is left
// out with the rest.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  /** The scan's scope: the target, its element count, and how many
   * findings of the whole page were not its own. */
  target?: { selector: string; kept: number; outside: number };
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

/** One scan of `file` by the launcher: its findings, or an error that
 * says why there are none. */
async function scan(run: RunProcess, launcher: string, file: string): Promise<DetectFinding[]> {
  const { code, stdout, stderr } = await run(launcher, ["detect", "--json", "--no-config", file]);
  if (code === 1) {
    throw new Error(`the detector could not scan ${file}: ${stderr.trim() || stdout.trim() || "no output"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`the detector answered no JSON (exit ${code}): ${(stderr || stdout).trim().slice(0, 300)}`);
  }
  return (Array.isArray(parsed) ? parsed : []).filter(
    (f): f is DetectFinding => typeof f === "object" && f !== null && typeof (f as DetectFinding).antipattern === "string",
  );
}

/** A finding as the report shows it — its place in the file is not part
 * of it, since taking the target out moves every line after it. */
const trimmed = ({ antipattern, name, severity, category, snippet }: DetectFinding): DetectFinding => ({
  antipattern,
  name,
  severity,
  category,
  snippet,
});

/** The findings of `page` that `baseline` does not hold, each one
 * matched once: two alike on the page and one in the baseline leave one. */
function added(page: DetectFinding[], baseline: DetectFinding[]): DetectFinding[] {
  const left = new Map<string, number>();
  for (const f of baseline) {
    const key = JSON.stringify(trimmed(f));
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  return page.filter((f) => {
    const key = JSON.stringify(trimmed(f));
    const n = left.get(key) ?? 0;
    if (n === 0) return true;
    left.set(key, n - 1);
    return false;
  });
}

export async function detect(input: {
  viewportId: string;
  element?: string;
  skillDir: string;
  /** The tab's impeccable_html. */
  html: (input: { viewport: string; element?: string; baseline?: boolean }) => Promise<unknown>;
  run?: RunProcess;
  dir?: string;
}): Promise<DetectReport> {
  const answer = (await input.html({
    viewport: input.viewportId,
    ...(input.element === undefined ? {} : { element: input.element, baseline: true }),
  })) as { html?: unknown; baseline?: unknown; target?: { selector: string; kept: number } };
  if (typeof answer.html !== "string") {
    throw new Error("impeccable_html answered no page");
  }
  if (input.element !== undefined && (typeof answer.baseline !== "string" || answer.target === undefined)) {
    throw new Error("impeccable_html answered no page without the target");
  }
  const dir = input.dir ?? (await mkdtemp(path.join(tmpdir(), "impeccable-")));
  const name = `${fileSafe(input.viewportId)}${input.element === undefined ? "" : `-${fileSafe(input.element)}`}`;
  const file = path.join(dir, `${name}.html`);
  await writeFile(file, answer.html, "utf8");
  const launcher = path.join(input.skillDir, "scripts", "impeccable");
  const run = input.run ?? runProcess;
  const page = await scan(run, launcher, file);
  let findings = page;
  let target: DetectReport["target"];
  if (answer.target !== undefined && typeof answer.baseline === "string") {
    const baselineFile = path.join(dir, `${name}.baseline.html`);
    await writeFile(baselineFile, answer.baseline, "utf8");
    try {
      findings = added(page, await scan(run, launcher, baselineFile));
    } finally {
      await rm(baselineFile, { force: true });
    }
    target = { selector: answer.target.selector, kept: answer.target.kept, outside: page.length - findings.length };
  }
  const byRule: Record<string, number> = {};
  for (const f of findings) byRule[f.antipattern] = (byRule[f.antipattern] ?? 0) + 1;
  const sorted = Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1]));
  return {
    viewportId: input.viewportId,
    file,
    ...(target === undefined ? {} : { target }),
    count: findings.length,
    byRule: sorted,
    findings: findings.map(trimmed),
  };
}
