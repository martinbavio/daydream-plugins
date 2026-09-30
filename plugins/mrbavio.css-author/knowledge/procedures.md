---
topic: procedures
title: Layout procedures
tags:
  [
    procedure,
    formatting-context,
    flow,
    flex,
    grid,
    absolute,
    cascade,
    declarations,
    loop,
  ]
tier: procedure
status: v1 draft from general expertise — to be corrected against the maintainer's notes; hard budget about 1,200 tokens
summary: Decision procedures against the three judgment failures — which formatting context, whether a declaration is needed at all, where in the cascade to set it — and the author → finalize → fix loop.
---

## 1. Which formatting context

Decide per container, in this order; take the first that fits.

1. **Flow** (no `display` change). Test: does the browser's default — blocks stacked, text wrapping — already give this shape? Headings over paragraphs, an article, a stack of cards: flow. Reach for `max-width`, `margin`, `padding` before any layout mode.
2. **Flex** (`display: flex`). Test: is there ONE axis along which items are distributed, aligned or sized against each other, while the cross axis just follows? Nav bars, button rows, a label beside a field, centering one box. Wrapping flex is still one axis: its rows do not align to each other.
3. **Grid** (`display: grid`). Test: must items line up in TWO directions at once, must different items share tracks (a label column, card rows that align), or is it a composition of named areas or overlap by line placement? Prefer `fr` tracks and `gap`; `minmax()` with `auto-fit` for fluid columns.
4. **Absolute** (`position: absolute` / `fixed`). Test: is the box an OVERLAY that must take no space in its parent's flow — a badge, a tooltip, a backdrop, a pinned corner? Only then; `absolute` needs a positioned ancestor to pin to (`fixed` pins to the viewport, or to a transformed ancestor). Never for laying out siblings.

Never: absolute for columns; flex for a two-axis table of cards; grid for one row of buttons; `float` for anything but text wrapping around a figure.

## 2. Before adding a declaration

Ask four questions; if any answers yes, do not write it.

1. **Is it the initial value of a non-inherited property?** `position: static`, `flex-direction: row`, `width: auto`, `opacity: 1`. An initial in a base rule or a `style` changes nothing there — unless the UA stylesheet sets another value on that tag (an open `dialog` is `position: absolute`, a `[popover]` `position: fixed` with `inset: 0`), where restating the initial is the override; the static lint reports the common non-inherited ones where removing them changes nothing. An INHERITED property restated at its initial (`line-height: normal` under a parent's 1.5) is a real reset — judge it under question 2.
2. **Is it inherited from an ancestor already?** `color`, `font-*`, `line-height`, `text-align`, `letter-spacing` flow down; a child restating its parent's value is noise. Set them once, high.
3. **Does the UA stylesheet already set it on this tag?** `h1` is bold and large; `p` and `h*` carry vertical margins; `ul` carries left padding; `body` carries 8px margin; `img` is inline; `button` has its own font, padding and border. Restate only to CHANGE it.
4. **Is it implied or made inert by another declaration?** `align-items` on a box that is not flex or grid, `flex-wrap` without `display: flex`, `top` or `inset` on a static box, `width: 100%` on a block child, `justify-content` where `gap` already does the job, `min-width: 0` where nothing overflows. Drop it.

Then: would the page change if this line went — at this width or at another? If at none, the necessity lint will report it dead; leave it out when you write the page, not after the lint.

## 3. Cascade reasoning

- Set inherited properties (font, color, line-height) on the nearest common ancestor — usually `html` — and let inheritance work.
- Layout goes on the container, sizing on the items. A child's `margin` fights a parent's `gap`: pick one.
- A conditional rule (`@media`, `@container`) overrides the base ONLY for what changes under that condition. One restating the base is dead weight; one per breakpoint nobody asked for is invented responsiveness. Write the widest-reaching state as the base.
- No `!important`, ever. Shared styling is a rule, its selector naming who shares it; a one-off is a rule of its own (a tag or an `id` that says which box) or, rarely, the element's `style`, which beats every rule. Never restate in a `style` what a rule sets (the lint blocks it).
- **When to write a rule.** Two or more elements carrying the same declarations are ONE rule plus a class saying what they are (`.card`; never `.card-1`, `.card-2`), and each element's own rule or `style` keeps only what is its alone. A tag selector where the tag already says it (`nav a`, `h2`); a class where the markup does not. Ask it before the second card, not after the third.
- Dead weight the static lint blocks: a class no rule names, a rule no element matches, and a rule's line that repeats, for everything it reaches, what the rule beneath it already sets. Drop the hook, the rule, or the line.
- A `;` after a rule's `}` (`.a { … };`) is no separator: where rules follow, the browser reads it into the next rule's selector and drops that rule. The static lint blocks it; delete the `;`.
- One reason per element. A wrapper that exists only to carry a declaration gives it to its child or parent and disappears.

## 4. The loop

1. This file rides the `dream-author` prompt; `knowledge_bundle {query}` brings the format rules with the nearest example.
2. Gather the source or the intent; decide each container's formatting context with §1.
3. Author the smallest page; pass every declaration through §2 and §3.
4. `draft_finalize` it (the `dream-author` prompt says how): the static lint's text facts judge the page first, and a blocking one refuses the write. Matching and necessity need the page mounted, so they judge it once written: `lint` it next, fix what each finding names (the element, or the rule and its stylesheet) and lint again.
5. Reply from what `draft_finalize` (its measure report) and `lint` answered, not from a second look.
