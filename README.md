# Daydream plugins

Plugins for [Daydream](https://github.com/martinbavio/daydream-public), the
design tool for the web where real HTML/CSS is the grain. This repository
is also the template for a plugin repository of your own: one pnpm
workspace, one build, one folder per plugin.

## What is here

| Plugin               | What it adds                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `mrbavio.text`        | plain canvas text as an item kind: type, edit, resize, paste a paragraph |
| `mrbavio.grid`        | a DevTools-style grid overlay for the selected grid container            |
| `mrbavio.notes`       | a notes pane in the dock, saved with the document                         |
| `mrbavio.html-editor` | the selected element's subtree as HTML source, structure only            |
| `mrbavio.html-paste`  | pasting HTML on the canvas lands it as a viewport                        |
| `mrbavio.css-author`  | the opinion about CSS: two lints as gates, the layout procedures, a technique corpus the knowledge tools serve, and a `procedures` resource — the `dream-author` workflow itself is Daydream's own |
| `mrbavio.glaser`      | design verbs on the canvas — [Impeccable](https://impeccable.style)'s playbooks over a viewport, read from the skill installed on the machine (`npx impeccable install`), never vendored. Select something, ⌘P, type a verb and, after it, a brief in your own words (bolder, quieter, typeset, layout, colorize, delight fan out three draft variants; distill, polish, clarify, animate, adapt rework in place); an agent in a Glaser session wakes on the pick through the plugin's storage file; `adopt` in a variant's title bar folds it into its source as one undo step. Also `glaser_verb` from a sentence, and a prompt per verb. Needs Daydream with decisions.md #67 |

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
pnpm build plugins/mrbavio.grid
```

`solid-js` and `@solidjs/web` stay bare imports in the built file; the
Daydream page resolves them through its import map to the one Solid
instance it runs. Everything else is bundled in.

## Install into Daydream

One line per plugin, from a built folder to an installed plugin
(Daydream 0.1.10 or later):

```
daydream plugin install plugins/mrbavio.grid
```

It links the folder into `~/.daydream/plugins/<id>` and records the trust
(printing what the plugin's manifest declares first). The plugin starts
OFF: turn it on from the plugins page (⌥⌘P), or install with `--enable`.
`pnpm ship` builds every plugin here and installs them all; a plugin
already on stays on, so after a rebuild `pnpm ship` re-trusts and nothing
else moves — a running Daydream sees the change and every tab picks it
up. Name folders to ship only those, and pass install's flags through:
`pnpm ship plugins/mrbavio.impeccable --enable`. `daydream plugin uninstall <id>` removes the link, the trust and the
enabled entry.

Under Daydream's dev host the same link serves the source with hot reload,
no build needed. On an older Daydream, copy the folder into
`~/.daydream/plugins/` instead, run `daydream trust <id>`, and turn the
plugin on from the plugins page.

## Tests

`pnpm test` runs each plugin's unit tests under node. The browser tests
(`*.browser.test.tsx`) mount Daydream's real shell through its test
harness, which lives in the Daydream checkout and reaches into its source;
they are kept beside the code as the specification and run from a Daydream
checkout, not from here. The HTML editor's `edit`, `parse`, `reconcile` and
`serialize` tests build a kernel through the same harness and are excluded
for the same reason, as are the CSS author's `staticLint` and corpus
tests. The CSS author's knowledge index (`knowledge/INDEX.md`) is
regenerated with Daydream's `pnpm knowledge:index <folder>` from a
Daydream checkout; the host renders the index live, so a stale file only
misleads a reader.

## Your own

Copy a folder, change the id (two dotted lowercase segments, never the
`daydream.` prefix — that one is reserved for Daydream's own), and run the
build. The `@daydream/plugin-api` types are a dev dependency at the root,
with `zod`, which its host-part contract types tool schemas with.
