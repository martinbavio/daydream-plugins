---
topic: three-column-page
title: Three-column page — fixed sidebars, fluid article
tags: [example, grid, columns, fr, gap, media, stacking, sheet, rule, class]
tier: example
summary: A navigation, article and aside as one grid — fixed rem sidebars, a fluid fr article — that stacks into one column below 640px through a single media layer on the body; the two sidebars share one .card rule in the sheet.
intent: A page with navigation on the left, an article in the middle and an aside on the right. The sidebars keep their width, the article takes the rest, and under 640px everything stacks.
---

## Why grid

Procedures §1.3: three items share tracks that are declared ONCE on the
container — two fixed rem tracks and one fluid `fr` track — and the
container owns the spacing (`gap`). Flex would spread the same decision
over the items (`flex: 1` on the article, a width on each sidebar) and hide
the track structure the lesson is about; grid states it in one declaration.

## Why a rule

Procedures §3: the two sidebars share their padding, so it is written ONCE
as a `.card` rule in the sheet, and `class: "card"` on each names who
shares it. What is each sidebar's alone — its background — stays on the
element's map, which beats every rule. The article is not a card: its
padding is its own, so it stays on the element. The rule comes first in
the document, before the elements it styles.

## What was NOT written

- `padding` on the navigation and the aside — the `.card` rule sets it
  (§3); restating it on the element would be redundant.
- `display: block` on `nav`, `main`, `aside` — the UA already says so
  (§2.3), and grid items are blockified regardless
  (reference/formatting-contexts.md).
- `width: 100%` on the article — a grid item fills its track (§2.4).
- `margin: 0` on the headings inside — their UA margins are the vertical
  rhythm; nothing asked to remove them.
- A second media layer: the single-column state is the only other state the
  intent named (§3, no invented responsiveness).

```json
{
  "version": 6,
  "meta": { "title": "Three-column page" },
  "items": [
    {
      "kind": "daydream.viewport",
      "frame": { "width": 960 },
      "position": { "x": 0, "y": 0 },
      "payload": {
        "meta": {
          "title": "Three-column page — fixed sidebars, fluid article"
        },
        "sheet": [{ "selector": ".card", "styles": { "padding": "1rem" } }],
        "root": {
          "tag": "html",
          "styles": {
            "font-family": "system-ui, sans-serif",
            "line-height": "1.5",
            "color": "#222222",
            "background": "#f4f2ec"
          },
          "children": [
            {
              "tag": "body",
              "label": "Page grid",
              "styles": {
                "margin": "0",
                "padding": "2rem",
                "display": "grid",
                "grid-template-columns": "12rem 1fr 10rem",
                "gap": "2rem"
              },
              "conditionals": [
                {
                  "condition": "@media (width < 640px)",
                  "styles": { "grid-template-columns": "1fr" }
                }
              ],
              "children": [
                {
                  "tag": "nav",
                  "label": "Navigation",
                  "attrs": { "class": "card" },
                  "styles": { "background": "#dfe6d9" },
                  "children": [
                    { "tag": "p", "text": "Overview", "children": [] },
                    { "tag": "p", "text": "Getting started", "children": [] },
                    {
                      "tag": "p",
                      "text": "A much longer entry that wraps",
                      "children": []
                    }
                  ]
                },
                {
                  "tag": "main",
                  "label": "Article",
                  "styles": {
                    "background": "#ffffff",
                    "padding": "1rem 1.5rem"
                  },
                  "children": [
                    {
                      "tag": "h1",
                      "text": "Why the sidebars never move",
                      "children": []
                    },
                    {
                      "tag": "p",
                      "text": "The article is the only flexible track. Everything the frame gains or loses shows up here, while the navigation and the aside keep the width they were given.",
                      "children": []
                    },
                    {
                      "tag": "p",
                      "text": "Supercalifragilisticexpialidocious is one word, so the column cannot shrink below it — that floor is the min-content size of this paragraph.",
                      "children": []
                    }
                  ]
                },
                {
                  "tag": "aside",
                  "label": "Aside",
                  "attrs": { "class": "card" },
                  "styles": { "background": "#e8dfd0" },
                  "children": [
                    { "tag": "p", "text": "Related", "children": [] },
                    { "tag": "p", "text": "Short.", "children": [] }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ]
}
```
