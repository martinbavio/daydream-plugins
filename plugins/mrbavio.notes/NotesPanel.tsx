// The notes pane (decision #48, P5): the learning companion for a
// project — its meta (title, notes) read beside the canvas, with the
// provenance of the page in view. A project's meta is the project's
// (decision #78: `daydream.json`'s `meta`, `{ title?, notes? }`), and a
// viewport has none of its own: what is per page is where the page came
// from, `pages[].meta.sourceUrl`. So the title and the notes are the
// project's whatever is selected, and the source link is the page of the
// viewport owning the current selection (the viewport item itself, or
// the page an element sits in, decision #76) — or, with nothing selected
// in a one-viewport project, the sole viewport's page. Absent meta
// renders nothing; the panel stays registered so the dock order never
// shifts with the document.

import { createMemo, For, Show, untrack } from "solid-js";

import type { DaydreamApi, ElementId } from "@daydream/plugin-api";

import { boldSegments, parseNotes } from "./notesFormat";
import { classPrefix } from "./styles";

/**
 * A factory, not a `<Component>`: the panel's `render` (index.tsx) calls
 * it under the dock's owner, so the memo below belongs to the dock section
 * and dies with it.
 */
export default function createNotesPanel(dd: DaydreamApi) {
  // Class prefix from the plugin id: a copy under another id styles its
  // own nodes, never this plugin's.
  const p = classPrefix(dd.plugin.id);

  // The viewport an element of a page belongs to (decision #76): the
  // page's elements are not in the document, so the kernel answers it,
  // through `dd.pageElement(id).viewportId` — read once per mounted
  // element by the kernel, so the memo below asks again on every document
  // write (a drag writes one per frame) at the cost of a lookup.
  const pageOf = (id: ElementId): string | null =>
    untrack(() => dd.pageElement(id))?.viewportId ?? null;

  const meta = createMemo<Shown | undefined>(() => {
    const doc = dd.document();
    const id = dd.selection();
    const viewports = dd.core.viewportItems(doc);
    // A viewport item selected whole, else the page an element is in;
    // with nothing selected, a sole viewport.
    const vp =
      id === null
        ? viewports.length === 1
          ? viewports[0]
          : undefined
        : (viewports.find((v) => v.id === id) ??
          (dd.items().some((item) => item.id === id)
            ? undefined
            : viewports.find((v) => v.id === pageOf(id))));
    const sourceUrl =
      vp === undefined
        ? undefined
        : doc.pages.find((page) => page.path === vp.payload.page)?.meta
            ?.sourceUrl;
    const { title, notes } = doc.meta ?? {};
    if (title === undefined && notes === undefined && sourceUrl === undefined)
      return undefined;
    return { title, notes, sourceUrl };
  });

  return (
    <div class={`${p}-panel`}>
      <Show when={meta()}>
        {(meta) => (
          <section class={`${p}-body`} aria-label="Project notes">
            <Show when={meta().title}>
              <h3 class={`${p}-title`}>{meta().title}</h3>
            </Show>
            <Show when={meta().notes}>
              {(notes) => (
                <For each={parseNotes(notes())}>
                  {(block) =>
                    block.type === "paragraph" ? (
                      <p class={`${p}-paragraph`}>
                        <BoldText text={block.text} />
                      </p>
                    ) : (
                      <ol class={`${p}-list`}>
                        <For each={block.items}>
                          {(item) => (
                            <li>
                              <BoldText text={item} />
                            </li>
                          )}
                        </For>
                      </ol>
                    )
                  }
                </For>
              )}
            </Show>
            <Show when={meta().sourceUrl}>
              {(url) => (
                <a
                  class={`${p}-source`}
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {url().replace(/^https?:\/\//, "")}
                </a>
              )}
            </Show>
          </section>
        )}
      </Show>
    </div>
  );
}

/** What the pane shows: the project's title and notes, and the source of
 * the page in view. */
interface Shown {
  title: string | undefined;
  notes: string | undefined;
  sourceUrl: string | undefined;
}

/** Inline **bold** rendering: odd segments from boldSegments are <strong>.
 * The parity read sits in a `Show` condition — a tracked scope — because
 * `For` keeps a moved segment's node and only updates its index, and a
 * bare ternary in the callback would evaluate once and never follow it. */
function BoldText(props: { text: string }) {
  return (
    <For each={boldSegments(props.text)}>
      {(segment, i) => (
        <Show when={i() % 2 === 1} fallback={segment}>
          <strong>{segment}</strong>
        </Show>
      )}
    </For>
  );
}
