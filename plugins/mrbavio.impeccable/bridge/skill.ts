// Where the installed Impeccable skill is, and how its files are read. The
// plugin never vendors Impeccable: each prompt reads the verb's playbook
// and the craft floor from the skill on THIS machine at request time, so
// the plugin follows whatever version `npx impeccable install` (or
// `npx skills add pbakaus/impeccable`) put there, and an update to the
// skill needs no plugin change.

import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

/** The folders a skill install lands in, in the order they are tried: the
 * served project's own, then the two user-level roots
 * (`~/.claude/skills/impeccable` is usually a link to the first). An
 * explicit IMPECCABLE_SKILL_DIR is the ONLY candidate: a pin that fell
 * through to another install would run a version the user did not
 * choose. */
export function candidateSkillDirs(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  home: string = homedir(),
): string[] {
  const override = env["IMPECCABLE_SKILL_DIR"];
  if (override !== undefined && override.trim() !== "") return [override];
  const dirs: string[] = [];
  dirs.push(path.join(cwd, ".agents", "skills", "impeccable"));
  dirs.push(path.join(home, ".agents", "skills", "impeccable"));
  dirs.push(path.join(home, ".claude", "skills", "impeccable"));
  return dirs;
}

/** The first candidate holding a SKILL.md, or null when none does. */
export async function findSkillDir(
  candidates: string[] = candidateSkillDirs(),
): Promise<string | null> {
  for (const dir of candidates) {
    try {
      await access(path.join(dir, "SKILL.md"));
      return dir;
    } catch {
      // not here
    }
  }
  return null;
}

/** The skill's version as SKILL.md's frontmatter states it, or null. */
export async function skillVersion(dir: string): Promise<string | null> {
  const text = await readFile(path.join(dir, "SKILL.md"), "utf8");
  const match = /^\s*version:\s*(\S+)\s*$/m.exec(text);
  return match?.[1] ?? null;
}

/** One file under the skill's reference/ folder, verbatim. */
export function readReference(dir: string, name: string): Promise<string> {
  return readFile(path.join(dir, "reference", `${name}.md`), "utf8");
}

/** What a prompt says when the skill is not on this machine: the one
 * install line, then stop — a verb without its playbook is not
 * Impeccable. */
export const SKILL_MISSING = `Impeccable is not installed on this machine, so this verb has no playbook to follow. Tell the user: install it with \`npx impeccable install\` (or \`npx skills add pbakaus/impeccable\`), or point the plugin at a checkout with IMPECCABLE_SKILL_DIR, then run the prompt again. Do not improvise the verb from memory.`;
