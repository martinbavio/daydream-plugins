#!/usr/bin/env node
// `node scripts/kernel-test.mjs <kernel-checkout> [plugins/<id> ...]`
//
// Runs this repository's plugins against a Daydream kernel checkout: the
// browser tests (which mount the kernel's shell harness and reach into its
// src/), the kernel's boundary lint and its typecheck. A plugin's github
// pins cannot reach the kernel's source, so each plugin folder is copied
// into <kernel>/plugins/<id>/ with `@daydream/plugin-api` and
// `@daydream/plugin-testing` pointed at `workspace:*`, the kernel installs,
// and the kernel's own vitest/eslint/tsc run over the copies. Every copy
// of kernel code a plugin marks (`// mirrors: <kernel path> <function>`)
// is checked against the kernel first (scripts/mirrors.mjs).
//
// Afterwards — pass or fail, or on Ctrl-C or SIGTERM — the copies are
// deleted, the kernel's pnpm-lock.yaml is restored and the kernel
// reinstalled, so the checkout is left as it was found. A signal is passed
// to the step running and no later step starts. The kernel checkout should
// be at the commit the plugins pin (the one pnpm-workspace.yaml's catalog
// names).
//
// While it runs, a lock in the checkout (`.kernel-test.lock`: the run's
// pid and start time) tells a second run that one is in progress, so it
// stops rather than take the first one's copies for leftovers. A lock
// whose process is gone is a leftover of a run that was killed.
//
// Flags: --no-lint, --no-typecheck, --keep (leave the copies and the
// changed lockfile for inspection: each copy carries a `.kernel-test-copy`
// mark, written before anything is copied into it and holding the
// lockfile the run left, and a later run refuses to start until they are
// gone). Any other flag is refused.
//
// `node scripts/kernel-test.mjs <kernel-checkout> --clean` removes what a
// --keep run or a killed run left — every marked copy under
// <kernel>/plugins/, the lockfile restored, the kernel reinstalled, a dead
// run's lock — and touches nothing when there is none. It takes no plugin
// folders: the copies share one lockfile, so it cannot restore some and
// not others. It refuses while a run is in progress, and never resets a
// lockfile the run did not leave: one changed with no copies there, or
// changed since the --keep run, is refused. A clean-up that fails says so
// and exits 1.
//
// Exit status: 0 when everything passed, 1 when a step failed, 2 when the
// run was refused before it started, 130 or 143 when a signal stopped it.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { checkMirrors } from "./mirrors.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = [
  "usage: kernel-test.mjs <kernel-checkout> [plugins/<id> ...] [--no-lint] [--no-typecheck] [--keep]",
  "       kernel-test.mjs <kernel-checkout> --clean",
].join("\n");
const RUN_FLAGS = new Set(["--no-lint", "--no-typecheck", "--keep"]);

// The mark a copy carries, so a --keep run's copies are told from the
// kernel's own plugins.
const MARK = ".kernel-test-copy";
// The lock a run holds in the kernel checkout while it runs.
const LOCK = ".kernel-test.lock";
const WORKSPACE = ["@daydream/plugin-api", "@daydream/plugin-testing"];
// Ctrl-C reaches the step's process too, from the terminal; SIGTERM
// reaches this one alone. Either way the step is stopped, no later step
// starts, and the clean-up runs.
const EXIT_ON = { SIGINT: 130, SIGTERM: 143 };
const STOPPED = Symbol("stopped");

/** A run that does not start: what to say, and the exit status. */
class Refused extends Error {
  constructor(message, status = 2) {
    super(message);
    this.status = status;
  }
}

/** The command line, or Refused: no kernel, a flag this script does not
 * know, or `--clean` with anything beside the kernel. */
function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const [kernelArg, ...given] = argv.filter((a) => !a.startsWith("-"));
  const unknown = [...flags].filter((f) => f !== "--clean" && !RUN_FLAGS.has(f));
  if (unknown.length > 0) {
    throw new Refused(`unknown flag: ${unknown.join(", ")}\n${USAGE}`);
  }
  if (kernelArg === undefined) throw new Refused(USAGE);
  const clean = flags.has("--clean");
  if (clean && (given.length > 0 || flags.size > 1)) {
    throw new Refused(
      `--clean takes the kernel checkout alone: it removes every copy a --keep run left and restores the one lockfile they share, so it cannot clean some plugins and not others\n${USAGE}`,
    );
  }
  return {
    kernelArg,
    kernel: path.resolve(kernelArg),
    given: given.map((d) => path.resolve(d)),
    clean,
    keep: flags.has("--keep"),
    lint: !flags.has("--no-lint"),
    typecheck: !flags.has("--no-typecheck"),
  };
}

/** The kernel checkout at `dir`, or Refused when it is not one: where
 * its plugins and lockfile are, and what a run left in it. */
function kernelCheckout(dir) {
  if (!existsSync(path.join(dir, "packages", "plugin-testing", "package.json"))) {
    throw new Refused(`${dir}: not a Daydream checkout (no packages/plugin-testing)`);
  }
  const plugins = path.join(dir, "plugins");
  const lockfile = path.join(dir, "pnpm-lock.yaml");
  return {
    dir,
    plugins,
    lock: path.join(dir, LOCK),
    /** The copies a run left: every folder under plugins/ with the mark. */
    leftovers: () =>
      existsSync(plugins)
        ? readdirSync(plugins)
            .map((name) => path.join(plugins, name))
            .filter((copy) => existsSync(path.join(copy, MARK)))
        : [],
    /** Whether the lockfile differs from the checkout's HEAD. */
    lockfileChanged: () =>
      spawnSync("git", ["status", "--porcelain", "--", "pnpm-lock.yaml"], {
        cwd: dir,
        encoding: "utf8",
      }).stdout.trim() !== "",
    lockfileHash: () =>
      createHash("sha256").update(readFileSync(lockfile)).digest("hex"),
  };
}

/** Whether the run that wrote `holder` is still running: its pid is
 * alive and did not start after the lock was taken (a pid the system
 * handed to a later process is another process). Unsure — `ps` gives
 * nothing readable — it is taken for alive. */
function isRunning(holder) {
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return false;
  }
  const ps = spawnSync("ps", ["-o", "lstart=", "-p", String(holder.pid)], {
    encoding: "utf8",
  });
  const since = Date.parse(ps.stdout?.trim() ?? "");
  // `ps` gives a start to the second.
  return Number.isNaN(since) || since <= holder.started + 1000;
}

const describeHolder = (holder) =>
  holder === null
    ? "a run whose lock cannot be read"
    : `pid ${holder.pid}, started ${new Date(holder.started).toLocaleString()}`;

/**
 * Take the kernel's lock for this process. Answers `release` when it is
 * taken; otherwise who holds it and whether that run is still running.
 * The lock is written whole under a name of its own and then linked into
 * place, so a second run never reads one half written.
 */
function takeLock(k) {
  const mine = { pid: process.pid, started: Date.now() };
  const draft = `${k.lock}.${process.pid}`;
  writeFileSync(draft, JSON.stringify(mine) + "\n");
  try {
    linkSync(draft, k.lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(k.lock, "utf8"));
    } catch {
      // Unreadable: no run of this script wrote it so; a leftover.
    }
    const valid = Number.isInteger(holder?.pid) && Number.isFinite(holder?.started);
    return { holder: valid ? holder : null, running: valid && isRunning(holder) };
  } finally {
    rmSync(draft, { force: true });
  }
  return {
    release: () => {
      try {
        if (JSON.parse(readFileSync(k.lock, "utf8")).pid === process.pid) {
          rmSync(k.lock, { force: true });
        }
      } catch {
        // Gone already.
      }
    },
  };
}

const inProgress = (k, holder) =>
  `another kernel-test run (${describeHolder(holder)}) is in progress in ${k.dir}; wait for it to finish`;

/** Put the kernel back as it was found: the copies removed, the lockfile
 * restored, node_modules relinked without the copies. Answers what
 * failed, empty when nothing did. */
function restore(k, dirs) {
  const failed = [];
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      failed.push(`removing ${dir}: ${error.message}`);
    }
  }
  const steps = [
    ["git", ["checkout", "--", "pnpm-lock.yaml"]],
    ["pnpm", ["install", "--frozen-lockfile", "--silent"]],
  ];
  for (const [cmd, argv] of steps) {
    const r = spawnSync(cmd, argv, { cwd: k.dir, stdio: "inherit" });
    if (r.status !== 0) failed.push(`${cmd} ${argv.join(" ")}`);
  }
  return failed;
}

/** `--clean`: what a --keep run or a killed run left, taken out. Answers
 * the exit status. */
function clean(opts, k) {
  let lock = takeLock(k);
  if (lock.release === undefined) {
    if (lock.running) throw new Refused(inProgress(k, lock.holder));
    // A killed run's lock: its own leftover, and this run's to take.
    console.log(`removed the lock of a run that stopped (${describeHolder(lock.holder)})`);
    rmSync(k.lock, { force: true });
    lock = takeLock(k);
    if (lock.release === undefined) throw new Refused(inProgress(k, lock.holder));
  }
  try {
    const leftovers = k.leftovers();
    const changed = k.lockfileChanged();
    if (leftovers.length === 0) {
      if (changed) {
        throw new Refused(
          `${k.dir}: pnpm-lock.yaml has changes, and no copies a --keep run left: they are not this script's, so --clean leaves them`,
        );
      }
      console.log(`${k.plugins}: no copies left by a --keep run`);
      return 0;
    }
    // The lockfile a --keep run left is in its marks; a mark still empty
    // is a run that stopped before its clean-up, and that run started from
    // a clean lockfile.
    const left = new Set(
      leftovers
        .map((dir) => readFileSync(path.join(dir, MARK), "utf8").trim())
        .filter((hash) => hash !== ""),
    );
    if (changed && left.size > 0 && !left.has(k.lockfileHash())) {
      throw new Refused(
        `${k.dir}: pnpm-lock.yaml changed after the --keep run left it; keep what you need of it and restore it (git checkout -- pnpm-lock.yaml), then --clean again`,
      );
    }
    const failed = restore(k, leftovers);
    if (failed.length > 0) throw new Refused(`clean-up failed: ${failed.join("; ")}`, 1);
    console.log(
      `cleaned up: removed ${leftovers.map((dir) => path.basename(dir)).join(", ")}; pnpm-lock.yaml restored`,
    );
    return 0;
  } finally {
    lock.release();
  }
}

/** What a run will copy, checked before anything is written: nothing a
 * run left, a clean lockfile, plugin folders only, none of the kernel's
 * own ids. Warns when the kernel is not at the commit the plugins pin. */
function preflight(opts, k) {
  const leftovers = k.leftovers();
  if (leftovers.length > 0) {
    throw new Refused(
      `${k.plugins} holds copies a --keep run or a stopped run left (${leftovers.map((dir) => path.basename(dir)).join(", ")}); \`pnpm test:kernel ${opts.kernelArg} --clean\` removes them and restores the lockfile`,
    );
  }
  // The kernel must start clean where this script writes: its lockfile,
  // and no plugin folder of the same id (never clobber the kernel's own).
  if (k.lockfileChanged()) {
    throw new Refused(`${k.dir}: pnpm-lock.yaml has local changes; commit or restore them first`);
  }
  const pinSha = /"?@daydream\/plugin-api"?\s*:\s*\S*#([0-9a-f]{7,40})/.exec(
    readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"),
  )?.[1];
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: k.dir,
    encoding: "utf8",
  }).stdout.trim();
  if (pinSha !== undefined && !head.startsWith(pinSha)) {
    console.warn(`warning: kernel is at ${head.slice(0, 10)}, the plugins pin ${pinSha.slice(0, 10)}`);
  }

  const isPlugin = (dir) => existsSync(path.join(dir, "manifest.json"));
  // A folder named on the command line is a plugin or a mistake: dropping
  // it quietly would run whatever is left — or, with nothing left, the
  // kernel's own suite — and report a pass for tests that never ran.
  const notPlugins = opts.given.filter((d) => !isPlugin(d));
  if (notPlugins.length > 0) {
    throw new Refused(`not a plugin folder (no manifest.json): ${notPlugins.join(", ")}`);
  }
  const folders = (
    opts.given.length > 0
      ? opts.given
      : readdirSync(path.join(root, "plugins")).map((n) => path.join(root, "plugins", n))
  ).filter(isPlugin);
  if (folders.length === 0) {
    throw new Refused(`no plugin folders under ${path.join(root, "plugins")}`);
  }
  const ids = folders.map((dir) => path.basename(dir));
  for (const id of ids) {
    if (existsSync(path.join(k.plugins, id))) {
      throw new Refused(
        `${k.plugins}/${id} already exists; remove it first (this script never overwrites the kernel's plugins)`,
      );
    }
  }
  return { folders, ids, copies: ids.map((id) => path.join(k.plugins, id)) };
}

/** The steps a run spawns, one at a time, each stopped by a signal the
 * run receives; once one has, no later step starts. */
function stepper(k) {
  const state = { child: null, stoppedBy: null };
  const handlers = Object.keys(EXIT_ON).map((signal) => [
    signal,
    () => {
      if (state.stoppedBy === null) {
        state.stoppedBy = signal;
        console.error(`\n${signal}: stopping, then cleaning up`);
      }
      state.child?.kill(signal);
    },
  ]);
  for (const [signal, handler] of handlers) process.on(signal, handler);

  /** One step, its output shown as it comes — and kept, with `capture`.
   * Resolves with its exit status (128 + the signal's number when one
   * ended it) and output. */
  const spawnStep = (cmd, argv, opts = {}) => {
    console.log(`\n$ ${cmd} ${argv.join(" ")}  (in ${path.relative(process.cwd(), k.dir) || "."})`);
    return new Promise((resolve) => {
      const c = spawn(cmd, argv, {
        cwd: k.dir,
        stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
      });
      state.child = c;
      let output = "";
      if (opts.capture) {
        c.stdout.on("data", (d) => {
          output += d.toString();
          process.stdout.write(d);
        });
        c.stderr.on("data", (d) => {
          output += d.toString();
          process.stderr.write(d);
        });
      }
      c.on("error", (error) => {
        console.error(`${cmd}: ${error.message}`);
        resolve({ status: 127, output });
      });
      c.on("close", (code, signal) => {
        state.child = null;
        resolve({ status: code ?? 128 + (constants.signals[signal] ?? 0), output });
      });
    });
  };

  return {
    stoppedBy: () => state.stoppedBy,
    /** A step, unless a signal stopped the run before it or during it. */
    step: async (cmd, argv, opts) => {
      if (state.stoppedBy !== null) throw STOPPED;
      const r = await spawnStep(cmd, argv, opts);
      if (state.stoppedBy !== null) throw STOPPED;
      return r;
    },
    dispose: () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    },
  };
}

/** Each plugin folder copied into the kernel, marked first — a copy that
 * fails partway is still this script's — with its `@daydream/*` packages
 * pointed at the kernel's workspace and every package the kernel also
 * declares (zod, solid-js, vitest…) pinned to the version the kernel runs:
 * two copies of zod make the host part's schemas a type the kernel's
 * plugin-api does not accept. */
function copyPlugins(k, plan) {
  const kernelPkg = JSON.parse(readFileSync(path.join(k.dir, "package.json"), "utf8"));
  const kernelDeclares = new Set([
    ...Object.keys(kernelPkg.dependencies ?? {}),
    ...Object.keys(kernelPkg.devDependencies ?? {}),
  ]);
  const kernelVersion = (name) => {
    try {
      return JSON.parse(
        readFileSync(path.join(k.dir, "node_modules", name, "package.json"), "utf8"),
      ).version;
    } catch {
      return undefined;
    }
  };
  for (const [i, src] of plan.folders.entries()) {
    const dest = plan.copies[i];
    mkdirSync(dest);
    writeFileSync(path.join(dest, MARK), "");
    cpSync(src, dest, {
      recursive: true,
      filter: (p) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path.relative(src, p)),
    });
    const pkgPath = path.join(dest, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (WORKSPACE.includes(name)) pkg[field][name] = "workspace:*";
        else if (field !== "peerDependencies" && kernelDeclares.has(name)) {
          const version = kernelVersion(name);
          if (version !== undefined) pkg[field][name] = version;
        }
      }
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
  console.log(`copied ${plan.ids.join(", ")} into ${k.plugins}`);
}

/** The steps over the copies. Answers each step's result, in order: a
 * name and 0 when it passed, anything else when it did not. */
async function runSteps(opts, k, plan, steps) {
  const results = [];
  const mirrors = checkMirrors(k.dir, plan.folders);
  for (const note of mirrors.notes) console.log(`mirrors: ${note}`);
  for (const failure of mirrors.failures) console.error(`mirrors: ${failure}`);
  results.push([`mirrors (${mirrors.checked} marked)`, mirrors.failures.length]);

  // The kernel as its lockfile has it, so its own versions can be read.
  if ((await steps.step("pnpm", ["install", "--frozen-lockfile"])).status !== 0) {
    throw new Error("kernel install failed");
  }
  copyPlugins(k, plan);
  const install = await steps.step("pnpm", ["install", "--no-frozen-lockfile"]);
  if (install.status !== 0) throw new Error("pnpm install failed");

  const targets = plan.ids.map((id) => `plugins/${id}/`);
  const tests = await steps.step("pnpm", ["exec", "vitest", "run", ...targets], {
    capture: true,
  });
  results.push(["vitest", tests.status]);
  // Solid's dev warnings pass the tests but name a real fault: a read
  // that will not update, a flush that does nothing. The kernel's own
  // suite raises neither, so a plugin's run fails on each. One line per
  // warning; Solid adds one "repair guide" line per code, not counted.
  const lines = tests.output.split("\n");
  for (const code of ["STRICT_READ_UNTRACKED", "FLUSH_IN_EFFECT_CALLBACK"]) {
    const count = lines.filter((l) => l.includes(`[${code}]`) && !l.includes("repair guide")).length;
    results.push([`${code} warnings`, count]);
  }
  if (opts.lint) {
    results.push([
      "eslint (boundary rules)",
      (await steps.step("pnpm", ["exec", "eslint", ...targets])).status,
    ]);
  }
  // The kernel's tsconfig includes plugins/, so its tsc covers the copies,
  // their browser tests among them.
  if (opts.typecheck) {
    results.push(["tsc", (await steps.step("pnpm", ["exec", "tsc"])).status]);
  }
  return results;
}

/** Leave the kernel as it was found — or, with --keep, the copies and
 * the lockfile they changed, recorded in each copy's mark. Answers a
 * result when the clean-up failed. */
function cleanUp(opts, k, plan) {
  if (opts.keep) {
    const hash = k.lockfileHash();
    for (const dir of plan.copies) {
      if (existsSync(path.join(dir, MARK))) writeFileSync(path.join(dir, MARK), hash);
    }
    console.log(
      `\nkept ${plan.ids.join(", ")} in ${k.plugins} and the changed pnpm-lock.yaml; \`pnpm test:kernel ${opts.kernelArg} --clean\` removes them`,
    );
    return null;
  }
  const failed = restore(k, plan.copies);
  if (failed.length > 0) {
    console.error(`\nclean-up failed: ${failed.join("; ")}`);
    return ["clean-up", "failed"];
  }
  console.log(`\ncleaned up: removed ${plan.ids.join(", ")}; pnpm-lock.yaml restored`);
  return null;
}

/** A run over the plugins, under the kernel's lock. Answers the exit
 * status. */
async function runPlugins(opts, k) {
  const lock = takeLock(k);
  if (lock.release === undefined) {
    throw new Refused(
      lock.running
        ? inProgress(k, lock.holder)
        : `${k.dir} holds the lock of a run that stopped without cleaning up (${describeHolder(lock.holder)}); \`pnpm test:kernel ${opts.kernelArg} --clean\` removes what it left`,
    );
  }
  try {
    const plan = preflight(opts, k);
    const steps = stepper(k);
    let results = [];
    try {
      results = await runSteps(opts, k, plan, steps);
    } catch (error) {
      results.push(
        error === STOPPED
          ? [`stopped by ${steps.stoppedBy()}`, "no later step ran"]
          : ["setup", String(error?.message ?? error)],
      );
    } finally {
      const failed = cleanUp(opts, k, plan);
      if (failed !== null) results.push(failed);
      steps.dispose();
    }
    console.log("\nsummary");
    for (const [name, status] of results) {
      console.log(`  ${status === 0 ? "ok  " : "FAIL"} ${name}${status === 0 ? "" : ` (${status})`}`);
    }
    const stoppedBy = steps.stoppedBy();
    if (stoppedBy !== null) return EXIT_ON[stoppedBy];
    return results.every(([, s]) => s === 0) ? 0 : 1;
  } finally {
    lock.release();
  }
}

/** The whole script: its exit status. */
async function main(argv) {
  try {
    const opts = parseArgs(argv);
    const k = kernelCheckout(opts.kernel);
    return opts.clean ? clean(opts, k) : await runPlugins(opts, k);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(error.message);
    return error.status;
  }
}

process.exitCode = await main(process.argv.slice(2));
