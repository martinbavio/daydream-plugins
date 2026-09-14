---
topic: formatting-contexts
title: Formatting contexts and containing blocks
tags:
  [
    reference,
    formatting-context,
    bfc,
    ifc,
    flex,
    grid,
    containing-block,
    position,
  ]
tier: reference
summary: What a formatting context is, which declarations establish one (block, inline, flex, grid), what establishing one changes for the children, and how the containing block for positioned boxes is chosen.
sources:
  - https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Introduction_to_formatting_contexts
  - https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Block_formatting_context
  - https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block
  - https://www.w3.org/TR/css-display-3/
  - https://www.w3.org/TR/css-flexbox-1/
  - https://www.w3.org/TR/css-grid-2/
---

## The idea

Every box lays out its children under the rules of exactly one formatting
context, and the container's `display` value decides which. The children do
not get a vote: an item inside a grid container is a grid item whatever its
own `display` says, and an item inside a flex container is a flex item. That
is why "which formatting context" is a decision made once, at the container,
and why a declaration meant for an item (`flex-grow`, `grid-column`,
`align-self`) is inert unless the parent established the matching context.

## The four that matter here

**Block formatting context (BFC).** The default for block-level boxes: each
child is a block stacked vertically, taking the full width available, and
vertical margins between adjacent blocks collapse. The root element
establishes one; so does anything with `overflow` other than `visible`,
`display: flow-root`, a float, an absolutely positioned box, and every flex
or grid ITEM (each item is its own little world). A new BFC contains floats
and stops margin collapsing across its edge — the two practical reasons to
create one on purpose.

**Inline formatting context (IFC).** Established by a block container whose
children are all inline-level (text, `span`, `img`, `strong`). Boxes flow
horizontally into line boxes; `line-height`, `vertical-align` and
`text-align` act here and nowhere else. Width and height on an inline box do
nothing; vertical margins are ignored, and vertical padding and borders
paint (and take hits) without changing the line box's height. This is the context a
paragraph lives in, and the reason `img` — inline by default — leaves a gap
of descender space under it until it is made `display: block` or its parent
becomes flex or grid.

**Flex formatting context.** `display: flex` on the container. Children
become flex items laid out along ONE main axis (`flex-direction`); the cross
axis only stretches or aligns. Item margins do not collapse, `float` and
`vertical-align` are ignored on items, and `flex-basis`/`flex-grow`/
`flex-shrink` replace width as the sizing story along the main axis. Wrapping
(`flex-wrap`) makes more lines, but lines are independent: nothing in line
two aligns to anything in line one. The one-axis test in the procedures
follows from that.

**Grid formatting context.** `display: grid` on the container. The container
defines tracks in both axes; children become grid items placed into cells
either by auto-placement or explicit line numbers, names or areas. Tracks
are shared by every item in the row or column, which is what makes cross-item
alignment possible — a label column as wide as its widest label, card rows
that line up. Item margins do not collapse; `float` and `vertical-align` are
ignored; `gap` belongs to the container, never to the items.

## What changes for the children

Establishing a flex or grid context "blockifies" the children: an inline
child (a `span`, an `img`) is treated as block-level, so it accepts width and
height, and its text-sizing quirks (the image descender gap) disappear.
`display: inline-block` on a flex item is therefore a no-op worth deleting.
The reverse is also true: `align-items`, `justify-content` and
`grid-template-*` on a container that is not flex or grid do nothing (`gap`
is the exception — it also applies to multi-column containers), and a
`grid-column` on an element whose parent is not a grid does nothing. The
necessity lint finds these; the procedures ask not to write them.

## Containing blocks

Percentages and offsets resolve against a containing block, and its choice
depends on `position`:

- `static` and `relative`: the content box of the nearest block container
  (or the nearest flex/grid container's content box). Percent widths mean "of
  the parent's content width".
- `absolute`: the padding box of the nearest ancestor whose `position` is
  not `static` — or the initial containing block (the viewport-sized box at
  the top of the page) when there is none. This is the reason an overlay
  needs a positioned ancestor: without one, `top: 0; right: 0` pins to the
  page, not the card.
- `fixed`: the viewport, unless an ancestor has a `transform`, `filter` or
  `perspective`, which silently turns it into the containing block. In
  Daydream only the live strategy (what `measure` renders) is a real window,
  so `fixed` resolves against the frame there; in the simulated strategy it
  resolves against the pannable canvas world, not the viewport box.
- An absolutely positioned box is taken out of flow: it takes no space in
  its parent's formatting context, its siblings lay out as if it were gone,
  and it establishes its own BFC. That is the whole reason absolute is for
  overlays and never for siblings that must share space.
