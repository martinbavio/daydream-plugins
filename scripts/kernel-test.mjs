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
// Afterwards — pass or fail, or on Ctrl-C — the copies are deleted, the
// kernel's pnpm-lock.yaml is restored and the kernel reinstalled, so the
// checkout is left as it was found. The kernel checkout should be at the
// commit the plugins pin (the sha in the root package.json's override).
//
// Flags: --no-lint, --no-typecheck, --keep (leave the copies for a rerun).
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [kernelArg, ...given] = args.filter((a) => !a.startsWith("--"));
if (kernelArg === undefined) {
  console.error(
    "usage: kernel-test.mjs <kernel-checkout> [plugins/<id> ...] [--no-lint] [--no-typecheck] [--keep]",
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

const run = (cmd, argv, opts = {}) => {
  console.log(
    `\n$ ${cmd} ${argv.join(" ")}  (in ${path.relative(process.cwd(), opts.cwd ?? kernel) || "."})`,
  );
  const r = spawnSync(cmd, argv, {
    cwd: kernel,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: opts.capture ? "pipe" : "inherit",
    ...opts,
  });
  if (opts.capture) {
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
  }
  return r;
};

// The kernel must start clean where this script writes: its lockfile, and
// no plugin folder of the same id (never clobber the kernel's own plugins).
const dirty = spawnSync(
  "git",
  ["status", "--porcelain", "--", "pnpm-lock.yaml"],
  { cwd: kernel, encoding: "utf8" },
);
if (dirty.stdout.trim() !== "") {
  console.error(
    `${kernel}: pnpm-lock.yaml has local changes; commit or restore them first`,
  );
  process.exit(2);
}
const pinned = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  .pnpm?.overrides?.["@daydream/plugin-api"];
const pinSha = /#([0-9a-f]{7,40})/.exec(pinned ?? "")?.[1];
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: kernel,
  encoding: "utf8",
}).stdout.trim();
if (pinSha !== undefined && !head.startsWith(pinSha)) {
  console.warn(
    `warning: kernel is at ${head.slice(0, 10)}, the plugins pin ${pinSha.slice(0, 10)}`,
  );
}

const folders = (
  given.length > 0
    ? given.map((d) => path.resolve(d))
    : readdirSync(path.join(root, "plugins")).map((n) =>
        path.join(root, "plugins", n),
      )
).filter((dir) => existsSync(path.join(dir, "manifest.json")));
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
  if (cleaned || flags.has("--keep")) return;
  cleaned = true;
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  spawnSync("git", ["checkout", "--", "pnpm-lock.yaml"], {
    cwd: kernel,
    stdio: "inherit",
  });
  // Relink node_modules without the copies, so the kernel runs as before.
  spawnSync("pnpm", ["install", "--frozen-lockfile", "--silent"], {
    cwd: kernel,
    stdio: "inherit",
  });
  console.log(
    `\ncleaned up: removed ${ids.join(", ")}; pnpm-lock.yaml restored`,
  );
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

const WORKSPACE = ["@daydream/plugin-api", "@daydream/plugin-testing"];
const results = [];
try {
  // The kernel as its lockfile has it, so its own versions can be read.
  if (run("pnpm", ["install", "--frozen-lockfile"]).status !== 0)
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

  const install = run("pnpm", ["install", "--no-frozen-lockfile"]);
  if (install.status !== 0) throw new Error("pnpm install failed");

  const targets = ids.map((id) => `plugins/${id}/`);
  const tests = run("pnpm", ["exec", "vitest", "run", ...targets], {
    capture: true,
  });
  const out = (tests.stdout ?? "") + (tests.stderr ?? "");
  const untracked = out
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
      run("pnpm", ["exec", "eslint", ...targets]).status,
    ]);
  // The kernel's tsconfig includes plugins/, so its tsc covers the copies,
  // their browser tests among them.
  if (!flags.has("--no-typecheck"))
    results.push(["tsc", run("pnpm", ["exec", "tsc"]).status]);
} catch (error) {
  results.push(["setup", String(error.message ?? error)]);
} finally {
  cleanup();
}

console.log("\nsummary");
for (const [name, status] of results)
  console.log(
    `  ${status === 0 ? "ok  " : "FAIL"} ${name}${status === 0 ? "" : ` (${status})`}`,
  );
process.exit(results.every(([, s]) => s === 0) ? 0 : 1);
