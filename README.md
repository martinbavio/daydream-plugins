# Daydream plugins

Plugins for [Daydream](https://github.com/martinbavio/daydream-public), the
design tool for the web where real HTML/CSS is the grain. This repository
is also the template for a plugin repository of your own: one pnpm
workspace, one build, one folder per plugin.

## What is here

| Plugin                | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mrbavio.text`        | plain canvas text as an item kind: type, edit, resize, paste a paragraph. Needs Daydream 0.1.38 or later (decision #76, a format 7 document)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `mrbavio.grid`        | a DevTools-style grid overlay for the selected grid container. Needs Daydream 0.1.39 or later (decision #76, a format 7 page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `mrbavio.notes`       | a notes pane in the dock, saved with the document. Needs Daydream 0.1.39 or later (decision #76, a format 7 page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mrbavio.html-editor` | the selected page's HTML as its own text, edited and saved as written, the selected element marked in it. Needs Daydream 0.1.39 or later (decision #76, the page payload)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mrbavio.html-paste`  | pasting HTML on the canvas lands it as a viewport                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mrbavio.css-author`  | the opinion about CSS: two lints as gates, the layout procedures, a technique corpus the knowledge tools serve, and a `procedures` resource — the `dream-author` workflow itself is Daydream's own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mrbavio.impeccable`  | [Impeccable](https://impeccable.style)'s design verbs on the canvas — its playbooks over a viewport, read from the skill installed on the machine (`npx impeccable install`), never vendored. Select something, ⌘P, type a verb and, after it, a brief in your own words (bolder, quieter, typeset, layout, colorize, delight fan out three draft variants; distill, polish, clarify, animate, adapt rework in place; critique and audit answer a scored review over the rendered page with Impeccable's detector, landing nothing); an agent in a design session ("start a design session in Daydream" — not the `/impeccable` skill's live mode) wakes on the pick through the plugin's storage file; `adopt` in a variant's title bar folds it into its source as one undo step. Also `impeccable_verb` from a sentence, and a prompt per verb. Needs Daydream 0.1.39 or later (decision #67 and #76, a format 7 page)    |

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

## The kernel pin

Every plugin builds and tests against one Daydream commit:
`@daydream/plugin-api` and `@daydream/plugin-testing` come from the
kernel's repository at that commit
(`github:…/daydream#<commit>&path:packages/…`). The commit is written
once, in the `catalog:` of `pnpm-workspace.yaml`. Each package.json asks
for the two packages as `catalog:`, and the root's `pnpm.overrides` pins
`@daydream/plugin-api` the same way, so every plugin resolves one copy.
To move to another kernel, change the commit on both catalog lines and
run `pnpm install`. `pnpm test:kernel` warns when the checkout it is
given is at another commit. While a change here needs kernel API that is
not released yet, the pin names the head of the kernel branch that adds
it, so the two are reviewed together. That pin is for review only: before
a change here merges, the pin must name a kernel tag, or a commit on the
kernel's main, never a branch commit — a branch may be squash-merged and
its commits gone — and a plugin's `minCore` names the release that tag
is.

## Ship

The daily loop, from this checkout to a running Daydream (0.1.10 or
later):

```
pnpm ship                                  # build every plugin, link and trust them all
pnpm ship plugins/mrbavio.grid --enable    # only these folders; --enable turns a fresh install on
```

`ship` is `pnpm build` then `daydream plugin install` per folder. Install
links the folder into `~/.daydream/plugins/<id>` and records the trust,
printing what the plugin's manifest declares first. A fresh install
starts OFF unless `--enable` is given; a plugin already on stays on, so
after a rebuild `pnpm ship` re-trusts and nothing else moves. A running
Daydream sees the change and every tab picks it up.
`daydream plugin uninstall <id>` removes the link, the trust and the
enabled entry.

## Install by hand

The same two steps, one plugin at a time:

```
pnpm build plugins/mrbavio.grid
daydream plugin install plugins/mrbavio.grid
```

Under Daydream's dev host the same link serves the source with hot reload,
no build needed. On an older Daydream, copy the folder into
`~/.daydream/plugins/` instead, run `daydream trust <id>`, and turn the
plugin on from the plugins page (⌥⌘P).

## Tests

`pnpm test` runs each plugin's unit tests, and the scripts', under node:
every `*.test.ts[x]` but two kinds, which need the kernel's own code and
so run from a Daydream checkout. The browser tests (`*.browser.test.ts[x]`)
run in a browser, most mounting Daydream's real shell through its test
harness, which lives in the Daydream checkout and reaches into its source.
The kernel tests (`*.kernel.test.ts[x]`) run under node but read through
the kernel itself — plugin-testing's `coreApi()`, `dd.core` with no shell,
which reaches into the same source: the CSS author's reading of a real
sheet through the kernel's scan is one. Anything that is a plugin's own
logic over what the kernel hands it stays a unit test: the CSS author's
rule walks, nesting, `@scope` and every lint's judgement over a scan are
proved over blocks and declarations written by hand
(`plugins/mrbavio.css-author/testBlocks.ts`). The other two kinds are kept
beside the code as the specification and run from a Daydream checkout,
not from here: `pnpm test:kernel <daydream-checkout> [plugins/<id> …]`
copies each plugin into the checkout with its `@daydream/*` packages pointed
at the checkout's own, runs its tests, the kernel's boundary lint and its
typecheck, and removes the copies. `--no-lint` and `--no-typecheck` skip
those two steps; `--keep` leaves the copies, and the lockfile they changed,
for inspection, and `pnpm test:kernel <daydream-checkout> --clean` removes
them after — every copy at once, since they share the lockfile, so
`--clean` takes no plugin folders. Any other flag is refused. While a run
is going it holds a lock in the checkout (`.kernel-test.lock`, its pid and
start time): a second run, or `--clean`, says one is in progress and stops
with exit status 2 — it never waits; a lock whose process is gone is a
killed run's leftover, which `--clean` removes.

A plugin may not import the kernel's source, so a function it needs to the
letter is copied, with a one-line marker above it naming where it came
from, and `test:kernel` checks each against the kernel it runs on
(`scripts/mirrors.mjs`). No plugin here holds such a copy today — what
they copied, the kernel now hands them through `dd.core` — and the
checker and its tests (`scripts/kernel-test.test.ts`) are kept on purpose,
as the guard for the next copy:

```
// mirrors: src/render/uniqueSelector.ts stepFor
// mirrors-adapted: src/render/cssRanges.ts closesItsOwnBlocks 3f2a9c01b7e4
```

`mirrors:` (or `mirrors-exact:`) promises the copy is the kernel's function
as written, comments and formatting aside: the two are compared token by
token as TypeScript's scanner reads them — so `a + ++b` is not `a++ + b`,
and a line break that ends a statement (`return⏎x`) is not a space — and a
difference fails the run, naming the line where it starts in each file.
`mirrors-adapted:` is a copy changed on purpose — an import path, a type, a
helper's name — so the two are never compared; the hash is the kernel
function's as it was when the copy was adapted, and when the kernel's no
longer hashes so, the run says the copy should be read again, without
failing (with no hash, it says which to record). A marker naming a file or
function the kernel does not have fails either way. CI runs the same on every pull request
(`.github/workflows/kernel-test.yml`) against the kernel commit the
plugins pin; it needs the `DAYDREAM_KERNEL_TOKEN` secret, a token that
can read the private kernel repository. The CSS author's lints read a page through the
browser, so their tests — the static lint's and the corpus's gate check
among them — are browser tests too. The CSS author's knowledge index
(`knowledge/INDEX.md`) is
regenerated with Daydream's `pnpm knowledge:index <folder>` from a
Daydream checkout; the host renders the index live, so a stale file only
misleads a reader.

## Your own

Copy a folder, change the id (two dotted lowercase segments, never the
`daydream.` prefix — that one is reserved for Daydream's own), and run the
build. The `@daydream/plugin-api` types are a dev dependency at the root,
with `zod`, which its host-part contract types tool schemas with. A new
plugin's package.json asks for the `@daydream/*` packages as `catalog:`
(see the kernel pin above).

A module that calls the API is handed `dd`, narrowed with
`Pick<DaydreamApi, …>` to the members it calls, `core` among them when it
reads `dd.core`. A module that needs only the kernel's pure helpers is
handed `dd.core` whole, as `core: CoreApi` — never a `Pick` of it or a
subset under a name of its own — and a walk over a scan is handed the
blocks, read once by its caller (`core.cssBlocks(css)`), not the text.
