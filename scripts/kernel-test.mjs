#!/usr/bin/env node
// `node scripts/kernel-test.mjs <kernel-checkout> [plugins/<id> ...]`
//
// Runs this repository's plugins against a Daydream kernel checkout: the
// browser tests (which mount the kernel's shell harness and reach into its
// src/), the kernel's boundary lint and its typecheck. A plugin's github
// pins cannot reach the kernel's source, so each plugin folder is copied
// into <kernel>/plugins/<id>/ with `@daydream/plugin-api` and
// `@daydream/plugin-testing` pointed at `workspace:*`, the kernel installs,
// and the kernel's own vitest/eslint/tsc run over the copies.
//
// Afterwards — pass or fail, or on Ctrl-C or SIGTERM — the copies are
// deleted, the kernel's pnpm-lock.yaml is restored and the kernel
// reinstalled, so the checkout is left as it was found. A signal is passed
// to the step running and no later step starts. The kernel checkout should be at the
// commit the plugins pin (the one pnpm-workspace.yaml's catalog names).
//
// Flags: --no-lint, --no-typecheck, --keep (leave the copies and the
// changed lockfile for inspection: each copy carries a `.kernel-test-copy`
// mark, written before anything is copied into it and holding the
// lockfile the run left, and a later run refuses to start until they are
// gone).
//
// `node scripts/kernel-test.mjs <kernel-checkout> --clean` removes what a
// --keep run left — every marked copy under <kernel>/plugins/, the
// lockfile restored, the kernel reinstalled — and touches nothing when
// there is none. It never resets a lockfile the run did not leave: one
// changed with no copies there, or changed since the --keep run, is
// refused. A clean-up that fails says so and exits 1.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [kernelArg, ...given] = args.filter((a) => !a.startsWith("--"));
if (kernelArg === undefined) {
  console.error(
    "usage: kernel-test.mjs <kernel-checkout> [plugins/<id> ...] [--no-lint] [--no-typecheck] [--keep]\n       kernel-test.mjs <kernel-checkout> --clean",
  );
  process.exit(2);
}
const kernel = path.resolve(kernelArg);
if (
  !existsSync(path.join(kernel, "packages", "plugin-testing", "package.json"))
) {
  console.error(
    `${kernel}: not a Daydream checkout (no packages/plugin-testing)`,
  );
  process.exit(2);
}

/** The step running now, so a signal reaches it too. */
let child = null;
/** The signal that stopped the run, once one has. */
let stoppedBy = null;

/** One step, its output shown as it comes — and kept, with `capture`.
 * Asynchronous, so a signal is handled while it runs. Resolves with its
 * exit status (128 + the signal's number when one ended it) and output. */
const run = (cmd, argv, opts = {}) => {
  console.log(
    `\n$ ${cmd} ${argv.join(" ")}  (in ${path.relative(process.cwd(), kernel) || "."})`,
  );
  return new Promise((resolve) => {
    const c = spawn(cmd, argv, {
      cwd: kernel,
      stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    child = c;
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
      child = null;
      resolve({
        status: code ?? 128 + (constants.signals[signal] ?? 0),
        output,
      });
    });
  });
};

// The mark a copy carries, so a --keep run's copies are told from the
// kernel's own plugins.
const MARK = ".kernel-test-copy";
const kernelPlugins = path.join(kernel, "plugins");
const leftovers = existsSync(kernelPlugins)
  ? readdirSync(kernelPlugins)
      .map((name) => path.join(kernelPlugins, name))
      .filter((dir) => existsSync(path.join(dir, MARK)))
  : [];

const LOCKFILE = path.join(kernel, "pnpm-lock.yaml");
/** Whether the kernel's lockfile differs from its HEAD. */
const lockfileChanged = () =>
  spawnSync("git", ["status", "--porcelain", "--", "pnpm-lock.yaml"], {
    cwd: kernel,
    encoding: "utf8",
  }).stdout.trim() !== "";
const lockfileHash = () =>
  createHash("sha256").update(readFileSync(LOCKFILE)).digest("hex");

/** Put the kernel back as it was found: the copies removed, the lockfile
 * restored, node_modules relinked without the copies. Answers what
 * failed, empty when nothing did. */
const restore = (dirs) => {
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
    const r = spawnSync(cmd, argv, { cwd: kernel, stdio: "inherit" });
    if (r.status !== 0) failed.push(`${cmd} ${argv.join(" ")}`);
  }
  return failed;
};

if (flags.has("--clean")) {
  const changed = lockfileChanged();
  if (leftovers.length === 0) {
    if (changed) {
      console.error(
        `${kernel}: pnpm-lock.yaml has changes, and no copies a --keep run left: they are not this script's, so --clean leaves them`,
      );
      process.exit(2);
    }
    console.log(`${kernelPlugins}: no copies left by a --keep run`);
    process.exit(0);
  }
  // The lockfile a --keep run left is in its marks; a mark still empty is
  // a run that stopped before its clean-up, and that run started from a
  // clean lockfile.
  const left = new Set(
    leftovers
      .map((dir) => readFileSync(path.join(dir, MARK), "utf8").trim())
      .filter((hash) => hash !== ""),
  );
  if (changed && left.size > 0 && !left.has(lockfileHash())) {
    console.error(
      `${kernel}: pnpm-lock.yaml changed after the --keep run left it; keep what you need of it and restore it (git checkout -- pnpm-lock.yaml), then --clean again`,
    );
    process.exit(2);
  }
  const failed = restore(leftovers);
  if (failed.length > 0) {
    console.error(`clean-up failed: ${failed.join("; ")}`);
    process.exit(1);
  }
  console.log(
    `cleaned up: removed ${leftovers.map((dir) => path.basename(dir)).join(", ")}; pnpm-lock.yaml restored`,
  );
  process.exit(0);
}
if (leftovers.length > 0) {
  console.error(
    `${kernelPlugins} holds copies a --keep run left (${leftovers.map((dir) => path.basename(dir)).join(", ")}); \`pnpm test:kernel ${kernelArg} --clean\` removes them and restores the lockfile`,
  );
  process.exit(2);
}

// The kernel must start clean where this script writes: its lockfile, and
// no plugin folder of the same id (never clobber the kernel's own plugins).
if (lockfileChanged()) {
  console.error(
    `${kernel}: pnpm-lock.yaml has local changes; commit or restore them first`,
  );
  process.exit(2);
}
const pinSha = /"?@daydream\/plugin-api"?\s*:\s*\S*#([0-9a-f]{7,40})/.exec(
  readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"),
)?.[1];
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: kernel,
  encoding: "utf8",
}).stdout.trim();
if (pinSha !== undefined && !head.startsWith(pinSha)) {
  console.warn(
    `warning: kernel is at ${head.slice(0, 10)}, the plugins pin ${pinSha.slice(0, 10)}`,
  );
}

const isPlugin = (dir) => existsSync(path.join(dir, "manifest.json"));
// A folder named on the command line is a plugin or a mistake: dropping it
// quietly would run whatever is left — or, with nothing left, the kernel's
// own suite — and report a pass for tests that never ran.
const notPlugins = given.map((d) => path.resolve(d)).filter((d) => !isPlugin(d));
if (notPlugins.length > 0) {
  console.error(
    `not a plugin folder (no manifest.json): ${notPlugins.join(", ")}`,
  );
  process.exit(2);
}
const folders = (
  given.length > 0
    ? given.map((d) => path.resolve(d))
    : readdirSync(path.join(root, "plugins")).map((n) =>
        path.join(root, "plugins", n),
      )
).filter(isPlugin);
if (folders.length === 0) {
  console.error(`no plugin folders under ${path.join(root, "plugins")}`);
  process.exit(2);
}
const ids = folders.map((dir) => path.basename(dir));
for (const id of ids) {
  if (existsSync(path.join(kernel, "plugins", id))) {
    console.error(
      `${kernel}/plugins/${id} already exists; remove it first (this script never overwrites the kernel's plugins)`,
    );
    process.exit(2);
  }
}

const copies = ids.map((id) => path.join(kernel, "plugins", id));
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  if (flags.has("--keep")) {
    const hash = lockfileHash();
    for (const dir of copies) {
      if (existsSync(path.join(dir, MARK)))
        writeFileSync(path.join(dir, MARK), hash);
    }
    console.log(
      `\nkept ${ids.join(", ")} in ${kernelPlugins} and the changed pnpm-lock.yaml; \`pnpm test:kernel ${kernelArg} --clean\` removes them`,
    );
    return;
  }
  const failed = restore(copies);
  if (failed.length > 0) {
    console.error(`\nclean-up failed: ${failed.join("; ")}`);
    results.push(["clean-up", "failed"]);
    return;
  }
  console.log(
    `\ncleaned up: removed ${ids.join(", ")}; pnpm-lock.yaml restored`,
  );
};
// Ctrl-C reaches the step's process too, from the terminal; SIGTERM
// reaches this one alone. Either way the step is stopped, no later step
// starts, and the clean-up below runs.
const EXIT_ON = { SIGINT: 130, SIGTERM: 143 };
const STOPPED = Symbol("stopped");
for (const signal of Object.keys(EXIT_ON)) {
  process.on(signal, () => {
    if (stoppedBy === null) {
      stoppedBy = signal;
      console.error(`\n${signal}: stopping, then cleaning up`);
    }
    child?.kill(signal);
  });
}
/** A step, unless a signal stopped the run before it or during it. */
const step = async (cmd, argv, opts) => {
  if (stoppedBy !== null) throw STOPPED;
  const r = await run(cmd, argv, opts);
  if (stoppedBy !== null) throw STOPPED;
  return r;
};

const WORKSPACE = ["@daydream/plugin-api", "@daydream/plugin-testing"];
const results = [];
try {
  // The kernel as its lockfile has it, so its own versions can be read.
  if ((await step("pnpm", ["install", "--frozen-lockfile"])).status !== 0)
    throw new Error("kernel install failed");
  // A package the kernel also declares (zod, solid-js, vitest…) is pinned
  // in the copy to the version the kernel runs: two copies of zod make the
  // host part's schemas a type the kernel's plugin-api does not accept.
  const kernelPkg = JSON.parse(
    readFileSync(path.join(kernel, "package.json"), "utf8"),
  );
  const kernelDeclares = new Set([
    ...Object.keys(kernelPkg.dependencies ?? {}),
    ...Object.keys(kernelPkg.devDependencies ?? {}),
  ]);
  const kernelVersion = (name) => {
    try {
      return JSON.parse(
        readFileSync(
          path.join(kernel, "node_modules", name, "package.json"),
          "utf8",
        ),
      ).version;
    } catch {
      return undefined;
    }
  };
  for (const [i, src] of folders.entries()) {
    const dest = copies[i];
    // Marked first: a copy that fails partway is still this script's.
    mkdirSync(dest);
    writeFileSync(path.join(dest, MARK), "");
    cpSync(src, dest, {
      recursive: true,
      filter: (p) =>
        !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path.relative(src, p)),
    });
    const pkgPath = path.join(dest, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ]) {
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
  console.log(`copied ${ids.join(", ")} into ${path.join(kernel, "plugins")}`);

  const install = await step("pnpm", ["install", "--no-frozen-lockfile"]);
  if (install.status !== 0) throw new Error("pnpm install failed");

  const targets = ids.map((id) => `plugins/${id}/`);
  const tests = await step("pnpm", ["exec", "vitest", "run", ...targets], {
    capture: true,
  });
  const untracked = tests.output
    .split("\n")
    .filter((l) => l.includes("STRICT_READ_UNTRACKED"));
  results.push(["vitest", tests.status]);
  results.push([
    "STRICT_READ_UNTRACKED warnings",
    untracked.length === 0 ? 0 : `${untracked.length} line(s)`,
  ]);

  if (!flags.has("--no-lint"))
    results.push([
      "eslint (boundary rules)",
      (await step("pnpm", ["exec", "eslint", ...targets])).status,
    ]);
  // The kernel's tsconfig includes plugins/, so its tsc covers the copies,
  // their browser tests among them.
  if (!flags.has("--no-typecheck"))
    results.push(["tsc", (await step("pnpm", ["exec", "tsc"])).status]);
} catch (error) {
  if (error === STOPPED) results.push([`stopped by ${stoppedBy}`, "no later step ran"]);
  else results.push(["setup", String(error.message ?? error)]);
} finally {
  cleanup();
}

console.log("\nsummary");
for (const [name, status] of results)
  console.log(
    `  ${status === 0 ? "ok  " : "FAIL"} ${name}${status === 0 ? "" : ` (${status})`}`,
  );
process.exit(
  stoppedBy !== null
    ? EXIT_ON[stoppedBy]
    : results.every(([, s]) => s === 0)
      ? 0
      : 1,
);
