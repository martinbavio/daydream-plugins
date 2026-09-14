// `pnpm build [<plugin folder> ...]` — every plugin's browser part as ONE
// prebuilt ES module, dist/index.js beside its manifest: what a Daydream
// host serves (the manifest's `built`). Vite in library mode with the
// Solid plugin; `solid-js` and `@solidjs/web` stay bare imports the page's
// import map resolves to its own Solid instance, everything else — a
// plugin's own dependencies, resolved from its folder upward — is bundled
// in. CSS is a string in a plugin already, so nothing but JavaScript
// comes out. The same build Daydream's `pnpm plugin:build` runs.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import solid from "@solidjs/vite-plugin";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isExposed = (id) => /^(solid-js|@solidjs\/web)(\/|$)/.test(id);

async function buildPlugin(folder) {
  const entry = ["index.tsx", "index.ts"].find((f) => existsSync(path.join(folder, f)));
  if (entry === undefined) throw new Error(`${folder}: no index.tsx or index.ts`);
  await build({
    configFile: false,
    root: folder,
    logLevel: "warn",
    plugins: [solid()],
    build: {
      outDir: path.join(folder, "dist"),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: "esnext",
      lib: { entry: path.join(folder, entry), formats: ["es"], fileName: () => "index.js" },
      rollupOptions: { external: isExposed, output: { codeSplitting: false } },
    },
  });
  console.log(path.relative(root, path.join(folder, "dist", "index.js")));
}

const given = process.argv.slice(2).map((d) => path.resolve(d));
const folders =
  given.length > 0
    ? given
    : readdirSync(path.join(root, "plugins"))
        .map((name) => path.join(root, "plugins", name))
        .filter((dir) => existsSync(path.join(dir, "manifest.json")));
for (const folder of folders) await buildPlugin(folder);
