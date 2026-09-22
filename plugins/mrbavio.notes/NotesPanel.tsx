// The notes pane (decision #48, P5): the learning companion for library
// documents — a viewport's meta (title, notes, source) read beside the
// canvas. Per-viewport since v3 (decision #32): the pane shows the meta
// of the viewport owning the current selection (the viewport item itself,
// or the page an element sits in, decision #76), falling back to the
// canvas-level meta, then — for one-viewport documents — to the sole
// viewport's, when nothing is selected or the selection's viewport has
// none. Absent meta renders nothing; the panel stays registered so the
// dock order never shifts with the document.

import { createMemo, For, Show, untrack } from "solid-js";

import type {
  DaydreamApi,
  DeepReadonly,
  DreamMeta,
  ElementId,
} from "@daydream/plugin-api";

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
  // through `dd.pageStack(id).viewportId`. A render-time id never
  // outlives its mount, so its viewport never changes and one answer per
  // id is kept — the stack is read once per selection, not on every
  // document write (a drag writes one per frame). Not kept while nothing
  // is mounted under the id yet.
  let owner: { id: ElementId; viewportId: string } | null = null;
  const pageOf = (id: ElementId): string | null => {
    if (owner?.id === id) return owner.viewportId;
    const stack = untrack(() => dd.pageStack(id));
    if (stack === null) return null;
    owner = { id, viewportId: stack.viewportId };
    return owner.viewportId;
  };

  const meta = createMemo<DeepReadonly<DreamMeta> | undefined>(() => {
    const doc = dd.document();
    const id = dd.selection();
    const viewports = dd.core.viewportItems(doc);
    if (id !== null) {
      // A viewport item selected whole, else the page an element is in.
      const vp =
        viewports.find((v) => v.id === id) ??
        (doc.items.some((item) => item.id === id)
          ? undefined
          : viewports.find((v) => v.id === pageOf(id)));
      if (vp?.payload.meta !== undefined) return vp.payload.meta;
    }
    if (doc.meta !== undefined) return doc.meta;
    return viewports.length === 1 ? viewports[0]?.payload.meta : undefined;
  });

  return (
    <div class={`${p}-panel`}>
      <Show when={meta()}>
        {(meta) => (
          <section class={`${p}-body`} aria-label="Document notes">
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
