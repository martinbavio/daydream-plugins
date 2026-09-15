// `pnpm ship [<plugin folder> ...] [--enable ...]` — build, then install
// into Daydream: every plugin here by default, or only the folders named.
// Flags are passed on to `daydream plugin install` (`--enable` turns a
// fresh install on; an installed plugin's switch is never moved). The
// same two steps as by hand, in one line.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const given = args.filter((a) => !a.startsWith("--")).map((d) => path.resolve(d));
const folders =
  given.length > 0
    ? given
    : readdirSync(path.join(root, "plugins"))
        .map((name) => path.join(root, "plugins", name))
        .filter((dir) => existsSync(path.join(dir, "manifest.json")));
for (const folder of folders) {
  if (!existsSync(path.join(folder, "manifest.json"))) {
    console.error(`${path.relative(root, folder)}: no manifest.json`);
    process.exit(1);
  }
}

const run = (file, argv) => execFileSync(file, argv, { cwd: root, stdio: "inherit" });
run(process.execPath, [path.join(root, "scripts", "build.mjs"), ...folders]);
run("daydream", ["plugin", "install", ...folders, ...flags]);
