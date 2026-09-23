// `kernel-test.mjs --clean <kernel>`: what a `--keep` run left in a
// kernel checkout — its plugin copies, the lockfile they changed — taken
// out, and nothing else. Over a scratch git checkout with the one file the
// script checks a kernel by and a lockfile with nothing to install.
import { spawn, spawnSync } from "node:child_process";
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

  test("with nothing left behind it touches nothing, not even a changed lockfile", () => {
    const k = scratchKernel();
    writeFileSync(path.join(k, "pnpm-lock.yaml"), LOCK + "# the user's\n");
    const r = run(k, "--clean");
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(path.join(k, "pnpm-lock.yaml"), "utf8")).toBe(
      LOCK + "# the user's\n",
    );
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

/** A `pnpm` that logs each call to `log` and does nothing — but hangs in
 * `exec vitest`, as a long test run does — first on PATH. */
function fakePnpm(): { env: NodeJS.ProcessEnv; calls: () => string[] } {
  const bin = path.join(kernel, ".bin-fake");
  const log = path.join(kernel, ".pnpm-calls");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "pnpm"),
    [
      "#!/bin/sh",
      'echo "$*" >> "$FAKE_PNPM_LOG"',
      'case "$*" in',
      '  "exec vitest"*) exec sleep 5 ;;',
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
