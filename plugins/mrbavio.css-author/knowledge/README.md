# knowledge/

The css-author plugin's corpus (docs/agent-css-knowledge-prd.md, "Corpus";
decisions.md #43, #48): what a GOOD .dream document looks like, served by
the core knowledge tools (`knowledge_bundle` / `knowledge_index` /
`knowledge_read` / `knowledge_search`) while the plugin is enabled, under
paths prefixed with the plugin id (`mrbavio.css-author/procedures.md`).
Markdown files with YAML frontmatter, in three of the four tiers:

- `procedure` — `procedures.md`, the short decision procedures the
  `procedures` MCP resource carries verbatim and the knowledge tools
  serve. Hard budget ~1,200 tokens.
- `example` — `examples/`, intent → minimal document, each verified against
  the format gate and the static lint by a test.
- `reference` — `reference/`, longer synthesis read on demand through
  `knowledge_search` / `knowledge_read`.

The fourth tier, `format` — the .dream v6 rules — is CORE's
(`knowledge/format.md` at the repo root): the MCP server's own instructions
carry it, and the bundle returns it as `format.md`. Nothing here restates
it (tools/knowledge/singleSource.test.ts).

## Frontmatter contract

```yaml
---
topic: kebab-case-id # unique
title: Human title
tags: [a, b, c] # inline or "- item" block list
tier: procedure | example | reference | format
summary: One line; INDEX.md is generated from it.
sources: # optional — citations, never excerpts
  - https://…
intent: … # example tier only — what the document answers
---
```

Only these YAML forms are parsed (tools/knowledge/load.ts): `key: scalar`,
`key: [a, b]` (the bracket list may wrap over lines, as prettier formats a
long one), and `key:` followed by `- item` lines; a trailing `# comment` is
dropped, so quote a value that contains ` #` (`"decisions.md #38"`). A file without a
frontmatter block is ignored. `INDEX.md` is generated — run
`pnpm --filter @mrbavio/plugin-css-author knowledge:index` (or the root
`pnpm knowledge:index`, which indexes every plugin's declared folder) after
editing frontmatter and commit the result. The loader, the search and the
index renderer are core's (tools/knowledge/): one frontmatter parser for
every plugin's corpus.

## Private tier

`knowledge/private/` is gitignored (`plugins/*/knowledge/private/`) and
never bundled. It holds owned but unlicensed material (course notes, book
excerpts) for the local host only: the loader reads it when present and
does not mind its absence. Nothing in it appears in the committed
`INDEX.md`; the live `knowledge_index` tool lists it for the local host
alone.

## Licensing

Everything committed here is the maintainer's own synthesis with sources
cited. Owning a copy of a course or a book grants no right to redistribute
it: no verbatim excerpts, ever, outside `private/`.
