// `kernel-test.mjs` over a scratch git checkout with the one file the
// script checks a kernel by and a lockfile with nothing to install, and a
// fake `pnpm` where a step must not really run: `--clean` takes out what a
// `--keep` run left — its plugin copies, the lockfile they changed — and
// nothing else; a signal stops the run and still cleans up; the command
// line refuses what it does not know; the lock tells a run in progress
// from a killed one's leftovers; and marked copies of kernel code are
// checked against the kernel (scripts/mirrors.mjs).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "kernel-test.mjs",
);
const repo = path.join(path.dirname(script), "..");

const LOCK = [
  "lockfileVersion: '9.0'",
  "",
  "settings:",
  "  autoInstallPeers: true",
  "  excludeLinksFromLockfile: false",
  "",
  "importers:",
  "",
  "  .: {}",
  "",
].join("\n");

let kernel = "";
afterEach(() => {
  if (kernel !== "") rmSync(kernel, { recursive: true, force: true });
  kernel = "";
});

const git = (...args: string[]): void => {
  const r = spawnSync("git", args, { cwd: kernel, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
};

/** A kernel checkout with a plugin of its own, committed. */
function scratchKernel(): string {
  kernel = mkdtempSync(path.join(tmpdir(), "kernel-test-"));
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(kernel, file)), { recursive: true });
    writeFileSync(path.join(kernel, file), text);
  };
  write("package.json", '{ "name": "kernel", "private": true }\n');
  write("pnpm-lock.yaml", LOCK);
  write("packages/plugin-testing/package.json", '{ "name": "t" }\n');
  write("plugins/daydream.own/manifest.json", "{}\n");
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "k");
  return kernel;
}

const run = (...args: string[]) =>
  spawnSync("node", [script, ...args], { encoding: "utf8" });

describe("kernel-test --clean", () => {
  test("removes the copies a --keep run left and restores the lockfile; the kernel's own plugins stay", () => {
    const k = scratchKernel();
    // What `--keep` leaves: a copy carrying the script's mark, and the
    // lockfile its install changed.
    mkdirSync(path.join(k, "plugins", "mrbavio.notes"));
    writeFileSync(
      path.join(k, "plugins", "mrbavio.notes", "manifest.json"),
      "{}\n",
    );
    writeFileSync(
      path.join(k, "plugins", "mrbavio.notes", ".kernel-test-copy"),
      "",
    );
    writeFileSync(path.join(k, "pnpm-lock.yaml"), LOCK + "# changed\n");

    const r = run(k, "--clean");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(path.join(k, "plugins", "mrbavio.notes"))).toBe(false);
    expect(existsSync(path.join(k, "plugins", "daydream.own"))).toBe(true);
    expect(readFileSync(path.join(k, "pnpm-lock.yaml"), "utf8")).toBe(LOCK);
  });

  test("with nothing left behind it touches nothing, and says a changed lockfile is not its to restore", () => {
    const k = scratchKernel();
    expect(run(k, "--clean").status).toBe(0);
    writeFileSync(path.join(k, "pnpm-lock.yaml"), LOCK + "# the user's\n");
    const r = run(k, "--clean");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("pnpm-lock.yaml");
    expect(readFileSync(path.join(k, "pnpm-lock.yaml"), "utf8")).toBe(
      LOCK + "# the user's\n",
    );
  });

  test("a lockfile edited after the --keep run left it is refused, and nothing is removed", () => {
    const k = scratchKernel();
    // The --keep run records the lockfile it left in its marks.
    const kept = LOCK + "# changed by the install\n";
    const copy = path.join(k, "plugins", "mrbavio.notes");
    mkdirSync(copy);
    writeFileSync(
      path.join(copy, ".kernel-test-copy"),
      createHash("sha256").update(kept).digest("hex"),
    );
    writeFileSync(path.join(k, "pnpm-lock.yaml"), kept + "# the user's\n");
    const r = run(k, "--clean");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("pnpm-lock.yaml");
    expect(existsSync(copy)).toBe(true);
    expect(readFileSync(path.join(k, "pnpm-lock.yaml"), "utf8")).toBe(kept + "# the user's\n");
    // As the run left it, it is restored.
    writeFileSync(path.join(k, "pnpm-lock.yaml"), kept);
    expect(run(k, "--clean").status).toBe(0);
    expect(existsSync(copy)).toBe(false);
    expect(readFileSync(path.join(k, "pnpm-lock.yaml"), "utf8")).toBe(LOCK);
  });

  test("a reinstall that fails is reported, with a failing exit", () => {
    const k = scratchKernel();
    const pnpm = fakePnpm({ failReinstall: true });
    const copy = path.join(k, "plugins", "mrbavio.notes");
    mkdirSync(copy);
    writeFileSync(path.join(copy, ".kernel-test-copy"), "");
    const r = spawnSync("node", [script, k, "--clean"], { encoding: "utf8", env: pnpm.env });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/failed.*pnpm install/);
    expect(r.stdout).not.toContain("cleaned up");
  });

  test("a copy that failed partway carries the mark, so --clean finds it", () => {
    const k = scratchKernel();
    const pnpm = fakePnpm();
    // A plugin folder with a file no copy can read.
    const broken = path.join(k, ".src", "mrbavio.broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(path.join(broken, "manifest.json"), "{}\n");
    writeFileSync(path.join(broken, "package.json"), '{ "name": "b" }\n');
    writeFileSync(path.join(broken, "unreadable"), "x", { mode: 0o000 });
    const r = spawnSync("node", [script, k, broken, "--keep"], { encoding: "utf8", env: pnpm.env });
    expect(r.status).toBe(1);
    const copy = path.join(k, "plugins", "mrbavio.broken");
    expect(existsSync(path.join(copy, ".kernel-test-copy"))).toBe(true);
    const clean = spawnSync("node", [script, k, "--clean"], { encoding: "utf8", env: pnpm.env });
    expect(clean.status, clean.stderr).toBe(0);
    expect(existsSync(copy)).toBe(false);
  });

  test("a run over a --keep run's copies stops and names --clean", () => {
    const k = scratchKernel();
    mkdirSync(path.join(k, "plugins", "mrbavio.notes"));
    writeFileSync(
      path.join(k, "plugins", "mrbavio.notes", ".kernel-test-copy"),
      "",
    );
    const notes = path.join(
      path.dirname(script),
      "..",
      "plugins",
      "mrbavio.notes",
    );
    const r = run(k, notes);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--clean");
  });
});

/** A `pnpm` that logs each call and does nothing — but `exec vitest`
 * hangs, as a long test run does, or with `vitest` prints that and
 * passes; and with `failReinstall` the clean-up's reinstall fails — first
 * on PATH. */
function fakePnpm({ failReinstall = false, vitest = "" } = {}): { env: NodeJS.ProcessEnv; calls: () => string[] } {
  const bin = path.join(kernel, ".bin-fake");
  const log = path.join(kernel, ".pnpm-calls");
  mkdirSync(bin);
  writeFileSync(path.join(kernel, ".vitest-out"), vitest);
  writeFileSync(
    path.join(bin, "pnpm"),
    [
      "#!/bin/sh",
      'echo "$*" >> "$FAKE_PNPM_LOG"',
      'case "$*" in',
      vitest === ""
        ? '  "exec vitest"*) exec sleep 5 ;;'
        : `  "exec vitest"*) cat "${path.join(kernel, ".vitest-out")}"; exit 0 ;;`,
      `  "install --frozen-lockfile --silent") exit ${failReinstall ? 1 : 0} ;;`,
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return {
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env["PATH"]}`, FAKE_PNPM_LOG: log },
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []),
  };
}

describe("kernel-test stopped by a signal", () => {
  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s stops the step running, runs no step after it, and still cleans up", async (signal, code) => {
    const k = scratchKernel();
    const pnpm = fakePnpm();
    const child = spawn("node", [script, k, path.join(repo, "plugins", "mrbavio.notes")], {
      env: pnpm.env,
      stdio: "pipe",
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
    await vi.waitFor(() => expect(pnpm.calls().some((c) => c.startsWith("exec vitest"))).toBe(true), {
      timeout: 5000,
    });
    const started = Date.now();
    child.kill(signal);
    expect(await exited, out).toBe(code);
    // The hanging step was stopped, not waited out.
    expect(Date.now() - started).toBeLessThan(4000);
    const calls = pnpm.calls();
    expect(calls.some((c) => c.startsWith("exec eslint") || c.startsWith("exec tsc"))).toBe(false);
    expect(calls.at(-1)).toBe("install --frozen-lockfile --silent");
    expect(existsSync(path.join(k, "plugins", "mrbavio.notes"))).toBe(false);
    expect(readFileSync(path.join(k, "pnpm-lock.yaml"), "utf8")).toBe(LOCK);
  }, 15000);
});

describe("kernel-test's Solid warnings", () => {
  test.each(["STRICT_READ_UNTRACKED", "FLUSH_IN_EFFECT_CALLBACK"])("a %s warning in the browser tests fails the run, counted once each", (code) => {
    const k = scratchKernel();
    const warning = `[vite] (client) [console.warn] [${code}] the message`;
    const pnpm = fakePnpm({
      vitest: [warning, warning, `[${code}] repair guide: node_modules/solid-js/skills/…`, " Tests  3 passed (3)", ""].join("\n"),
    });
    const r = spawnSync("node", [script, k, path.join(repo, "plugins", "mrbavio.notes")], {
      encoding: "utf8",
      env: pnpm.env,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`FAIL ${code} warnings \\(2\\)`));
    expect(r.stdout).toMatch(/ok {3}vitest/);
  });
});

describe("kernel-test's plugin paths", () => {
  test("a path with no manifest.json stops the run before anything is installed, and names the path", () => {
    const k = scratchKernel();
    const mistyped = path.join(repo, "plugins", "mrbavio.htmleditor");
    const r = run(k, mistyped, path.join(repo, "plugins", "mrbavio.notes"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mrbavio.htmleditor");
    expect(r.stdout).not.toContain("pnpm install");
    expect(existsSync(path.join(k, "plugins", "mrbavio.notes"))).toBe(false);
  });
});

describe("kernel-test's command line", () => {
  test("an unknown flag stops the run before anything is touched", () => {
    const k = scratchKernel();
    const pnpm = fakePnpm();
    const r = spawnSync("node", [script, k, path.join(repo, "plugins", "mrbavio.notes"), "--kepe"], {
      encoding: "utf8",
      env: pnpm.env,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown flag: --kepe");
    expect(pnpm.calls()).toEqual([]);
    expect(existsSync(path.join(k, ".kernel-test.lock"))).toBe(false);
  });

  test("--clean with a plugin folder is refused, and nothing is removed", () => {
    const k = scratchKernel();
    const copy = path.join(k, "plugins", "mrbavio.notes");
    mkdirSync(copy);
    writeFileSync(path.join(copy, ".kernel-test-copy"), "");
    const r = run(k, "--clean", path.join(repo, "plugins", "mrbavio.notes"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--clean takes the kernel checkout alone");
    expect(existsSync(copy)).toBe(true);
  });
});

/** A lock as a run writes it, held by `pid`. */
function writeLock(k: string, pid: number, started = Date.now()): string {
  const lock = path.join(k, ".kernel-test.lock");
  writeFileSync(lock, JSON.stringify({ pid, started }) + "\n");
  return lock;
}

describe("kernel-test's lock", () => {
  test("a run in progress is named as one, never as leftovers, and --clean leaves its copies alone", () => {
    const k = scratchKernel();
    // The running run's copy, marked as every copy is.
    const copy = path.join(k, "plugins", "mrbavio.notes");
    mkdirSync(copy);
    writeFileSync(path.join(copy, ".kernel-test-copy"), "");
    const lock = writeLock(k, process.pid);

    const r = run(k, path.join(repo, "plugins", "mrbavio.notes"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`another kernel-test run (pid ${process.pid}`);
    expect(r.stderr).toContain("in progress");
    expect(r.stderr).not.toContain("--clean");

    const clean = run(k, "--clean");
    expect(clean.status).toBe(2);
    expect(clean.stderr).toContain("in progress");
    expect(existsSync(copy)).toBe(true);
    expect(existsSync(lock)).toBe(true);
  });

  test("the lock of a run that was killed is a leftover: a run names --clean, which removes it with the copies", () => {
    const k = scratchKernel();
    const pnpm = fakePnpm();
    const dead = spawnSync("node", ["-e", ""]).pid;
    const lock = writeLock(k, dead, Date.now() - 60_000);
    const copy = path.join(k, "plugins", "mrbavio.notes");
    mkdirSync(copy);
    writeFileSync(path.join(copy, ".kernel-test-copy"), "");

    const r = spawnSync("node", [script, k, path.join(repo, "plugins", "mrbavio.notes")], {
      encoding: "utf8",
      env: pnpm.env,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a run that stopped");
    expect(r.stderr).toContain("--clean");

    const clean = spawnSync("node", [script, k, "--clean"], { encoding: "utf8", env: pnpm.env });
    expect(clean.status, clean.stderr).toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(copy)).toBe(false);
  });
});

describe("kernel-test's mirrors", () => {
  const KERNEL_FILE = [
    "/** Doubled. */",
    "export function twice(value: number): number {",
    "  // As written in the kernel.",
    "  return value * 2;",
    "}",
    "",
    "function shout(",
    "  text: string,",
    "): string {",
    '  return text.toUpperCase() + "!";',
    "}",
    "",
  ].join("\n");

  /** A kernel with `src/render/thing.ts`, and a plugin whose copies.ts
   * holds `source`; every step the run spawns passes. */
  function mirrorRun(source: string) {
    const k = scratchKernel();
    mkdirSync(path.join(k, "src", "render"), { recursive: true });
    writeFileSync(path.join(k, "src", "render", "thing.ts"), KERNEL_FILE);
    const plugin = path.join(k, ".src", "mrbavio.copies");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(path.join(plugin, "manifest.json"), "{}\n");
    writeFileSync(path.join(plugin, "package.json"), '{ "name": "c" }\n');
    writeFileSync(path.join(plugin, "copies.ts"), source);
    const pnpm = fakePnpm({ vitest: " Tests  1 passed (1)\n" });
    const r = spawnSync("node", [script, k, plugin], { encoding: "utf8", env: pnpm.env });
    // The run's lock goes with it.
    expect(existsSync(path.join(k, ".kernel-test.lock"))).toBe(false);
    return r;
  }

  test("an exact copy formatted and commented otherwise passes; one that differs fails, pointing at the line in each file", () => {
    const r = mirrorRun(
      [
        "// mirrors: src/render/thing.ts twice",
        "/** The kernel's, to the letter. */",
        "export function twice(value: number): number { return value * 2; }",
        "",
        "/* mirrors-exact: render/thing.ts#shout() */",
        "function shout(text: string): string {",
        '  return text.toUpperCase() + "?";',
        "}",
        "",
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAIL mirrors \(2 marked\) \(1\)/);
    expect(r.stdout).toMatch(/ok {3}vitest/);
    expect(r.stderr).toContain(
      "mrbavio.copies/copies.ts:5: shout differs from the kernel's shout (src/render/thing.ts:7)",
    );
    expect(r.stderr).toContain("from src/render/thing.ts:10");
    expect(r.stderr).toContain("and  mrbavio.copies/copies.ts:7");
    expect(r.stderr).not.toContain("twice differs");
  });

  test("an adapted copy is never compared: a kernel function changed since its recorded hash is reported, and so is one with none, and the run passes", () => {
    const r = mirrorRun(
      [
        "// mirrors-adapted: src/render/thing.ts twice 000000000000",
        "export function twice(value: number) { return value + value; }",
        "",
        "// Mirrors-adapted: src/render/thing.ts shout",
        'export const shout = (text: string) => text + "!";',
        "",
      ].join("\n"),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/ok {3}mirrors \(2 marked\)/);
    expect(r.stdout).toMatch(
      /copies\.ts:1: the kernel's twice \(src\/render\/thing\.ts:2\) changed since the copy was adapted \(000000000000, now [0-9a-f]{12}\)/,
    );
    expect(r.stdout).toMatch(
      /copies\.ts:4: shout is adapted from src\/render\/thing\.ts:7, whose hash is [0-9a-f]{12}/,
    );
  });

  test("a marker naming what the kernel does not have fails", () => {
    const r = mirrorRun(
      [
        "// mirrors: src/render/thing.ts thrice",
        "export function thrice(value: number) { return value * 3; }",
        "// mirrors: src/render/gone.ts twice",
        "export function twice(value: number) { return value * 2; }",
        "",
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "copies.ts:1: mirrors src/render/thing.ts thrice, which the kernel does not have",
    );
    expect(r.stderr).toContain(
      "copies.ts:3: mirrors src/render/gone.ts twice, which the kernel does not have (no such file)",
    );
  });
});
