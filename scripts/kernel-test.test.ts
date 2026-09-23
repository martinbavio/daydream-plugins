// `kernel-test.mjs --clean <kernel>`: what a `--keep` run left in a
// kernel checkout — its plugin copies, the lockfile they changed — taken
// out, and nothing else. Over a scratch git checkout with the one file the
// script checks a kernel by and a lockfile with nothing to install.
import { spawnSync } from "node:child_process";
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

import { afterEach, describe, expect, test } from "vitest";

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
