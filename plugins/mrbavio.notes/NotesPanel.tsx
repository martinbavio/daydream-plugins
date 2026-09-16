// The notes pane (decisions.md #48, P5): the learning companion for library
// documents — a viewport's meta (title, notes, source) read beside the
// canvas. Per-viewport since v3 (decisions.md #32): the pane shows the meta
// of the viewport owning the current selection, falling back to the
// canvas-level meta, then — for one-viewport documents — to the sole
// viewport's, when nothing is selected or the selection's viewport has
// none. Absent meta renders nothing; the panel stays registered so the
// dock order never shifts with the document.

import { createMemo, For, Show } from "solid-js";

import type {
  DaydreamApi,
  DeepReadonly,
  DreamMeta,
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
  const meta = createMemo<DeepReadonly<DreamMeta> | undefined>(() => {
    const doc = dd.document();
    const id = dd.selection();
    if (id !== null) {
      const vp = dd.core.findViewport(doc, id);
      if (vp?.payload.meta !== undefined) return vp.payload.meta;
    }
    if (doc.meta !== undefined) return doc.meta;
    const viewports = dd.core.viewportItems(doc);
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
