# Daydream plugins

Plugins for [Daydream](https://github.com/martinbavio/daydream-public), the
design tool for the web where real HTML/CSS is the grain. This repository
is also the template for a plugin repository of your own: one pnpm
workspace, one build, one folder per plugin.

## What is here

| Plugin               | What it adds                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `mbavio.text`        | plain canvas text as an item kind: type, edit, resize, paste a paragraph |
| `mbavio.grid`        | a DevTools-style grid overlay for the selected grid container            |
| `mbavio.notes`       | a notes pane in the dock, saved with the document                         |
| `mbavio.html-editor` | the selected element's subtree as HTML source, structure only            |
| `mbavio.html-paste`  | pasting HTML on the canvas lands it as a viewport                        |

Each is a folder under `plugins/`: `manifest.json`, `index.tsx`, `styles.ts`
(CSS as a string), `icon.svg`, its own `package.json` for its runtime
dependencies, and after a build `dist/index.js` — the browser part as one
prebuilt ES module, which is what the manifest's `built` names and what a
Daydream host serves. The plugin API is documented in Daydream's
`docs/plugin-authoring.md`.

## Build

```
pnpm install
pnpm build            # every plugin → plugins/<id>/dist/index.js
pnpm build plugins/mbavio.grid
```

`solid-js` and `@solidjs/web` stay bare imports in the built file; the
Daydream page resolves them through its import map to the one Solid
instance it runs. Everything else is bundled in.

## Install into Daydream

Daydream discovers plugins in `~/.daydream/plugins/<id>/` and in the served
project's `.daydream/plugins/<id>/`. Link a built plugin there, trust it,
and turn it on from the plugins page (⌥⌘P):

```
ln -s "$PWD/plugins/mbavio.grid" ~/.daydream/plugins/mbavio.grid
daydream trust mbavio.grid
```

Trust is a disclosure of the folder and its declared permissions, recorded
as the folder's hash; every rebuild changes the hash, so trust it again
after `pnpm build`. Under Daydream's dev host the same link serves the
source with hot reload, no build needed.

## Tests

`pnpm test` runs each plugin's unit tests under node. The browser tests
(`*.browser.test.tsx`) mount Daydream's real shell through its test
harness, which lives in the Daydream checkout and reaches into its source;
they are kept beside the code as the specification and run from a Daydream
checkout, not from here. The HTML editor's `edit`, `parse`, `reconcile` and
`serialize` tests build a kernel through the same harness and are excluded
for the same reason.

## Your own

Copy a folder, change the id (two dotted lowercase segments, never the
`daydream.` prefix — that one is reserved for Daydream's own), and run the
build. The `@daydream/plugin-api` types are a dev dependency at the root.
