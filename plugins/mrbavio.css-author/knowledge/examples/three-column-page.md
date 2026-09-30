---
topic: three-column-page
title: Three-column page — fixed sidebars, fluid article
tags: [example, grid, columns, fr, gap, media, stacking, page, rule, class]
tier: example
summary: A navigation, article and aside as one grid — fixed rem sidebars, a fluid fr article — that stacks into one column below 640px through a single media rule on the body; the two sidebars share one .card rule.
intent: A page with navigation on the left, an article in the middle and an aside on the right. The sidebars keep their width, the article takes the rest, and under 640px everything stacks.
---

## Why grid

Procedures §1.3: three items share tracks that are declared ONCE on the
container — two fixed rem tracks and one fluid `fr` track — and the
container owns the spacing (`gap`). Flex would spread the same decision
over the items (`flex: 1` on the article, a width on each sidebar) and hide
the track structure the lesson is about; grid states it in one declaration.

## Why these rules

Procedures §3: the two sidebars share their padding, so it is written ONCE
as a `.card` rule, and `class="card"` on each names who shares it. What is
each sidebar's alone — its background — is a rule of its own, by tag,
since `nav` and `aside` already say which box they are. The article is not
a card: its padding is its own, so it sits in the `main` rule. The
single-column state is one `@media` rule that changes the one declaration
that differs, and nothing else.

## What was NOT written

- `padding` in the `nav` and `aside` rules — the `.card` rule sets it
  (§3); restating it would be redundant.
- `display: block` on `nav`, `main`, `aside` — the UA already says so
  (§2.3), and grid items are blockified regardless
  (reference/formatting-contexts.md).
- `width: 100%` on the article — a grid item fills its track (§2.4).
- `margin: 0` on the headings inside — their UA margins are the vertical
  rhythm; nothing asked to remove them.
- A second `@media` rule: the single-column state is the only other state
  the intent named (§3, no invented responsiveness).

## The page

The page is two files of the project: `index.html`, which links its
stylesheet, and `style.css` beside it.

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <title>Three-column page</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <nav class="card">
      <p>Overview</p>
      <p>Getting started</p>
      <p>A much longer entry that wraps</p>
    </nav>
    <main>
      <h1>Why the sidebars never move</h1>
      <p>The article is the only flexible track. Everything the frame gains or loses shows up here, while the navigation and the aside keep the width they were given.</p>
      <p>Supercalifragilisticexpialidocious is one word, so the column cannot shrink below it — that floor is the min-content size of this paragraph.</p>
    </main>
    <aside class="card">
      <p>Related</p>
      <p>Short.</p>
    </aside>
  </body>
</html>
```

`style.css`:

```css
html {
  font-family: system-ui, sans-serif;
  line-height: 1.5;
  color: #222222;
  background: #f4f2ec;
}

body {
  margin: 0;
  padding: 2rem;
  display: grid;
  grid-template-columns: 12rem 1fr 10rem;
  gap: 2rem;
}

@media (width < 640px) {
  body {
    grid-template-columns: 1fr;
  }
}

.card {
  padding: 1rem;
}

nav {
  background: #dfe6d9;
}

aside {
  background: #e8dfd0;
}

main {
  padding: 1rem 1.5rem;
  background: #ffffff;
}
```

The project's `daydream.json`, one viewport showing the page:

```json
{
  "version": 8,
  "meta": {
    "title": "Three-column page"
  },
  "pages": [
    {
      "path": "index.html"
    }
  ],
  "canvases": [
    {
      "id": "first",
      "name": "First Canvas",
      "items": [
        {
          "id": "three-column-page",
          "kind": "daydream.viewport",
          "position": { "x": 0, "y": 0 },
          "frame": { "width": 960 },
          "payload": {
            "page": "index.html"
          }
        }
      ]
    }
  ]
}
```
