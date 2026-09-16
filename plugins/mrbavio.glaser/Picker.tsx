import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";

import type { DaydreamApi, OverlayRect } from "@daydream/plugin-api";

import { classPrefix } from "./styles";

import { matchEntries, parseQuery, type PickerEntry } from "./pickerQuery";

export type { PickerEntry };

export interface PickerState {
  /** The target the picker opened on, or null when closed. */
  open: () => { viewportId: string; elementId: string | null } | null;
  close(): void;
  /** The chosen entry, with what was typed after the verb as the brief. */
  choose(id: string, brief: string): void;
}

/** Glaser's own picker, drawn in the interactive slot beside the target
 * (decisions.md #67): a field and the verbs, nothing else. Typing narrows,
 * Enter or a click picks, arrows move and wrap, Escape or a press outside
 * closes. Positioned from the target's rect in the apply phase; the field
 * takes focus once it exists. */
export default function createPicker(dd: DaydreamApi, entries: readonly PickerEntry[], state: PickerState) {
  const [box, setBox] = createSignal<OverlayRect | null>(null);
  const [query, setQuery] = createSignal("");
  const [index, setIndex] = createSignal(0);
  const matches = () => matchEntries(entries, query());
  let inputEl: HTMLInputElement | undefined;
  let rootEl: HTMLDivElement | undefined;

  createEffect(
    () => {
      dd.geometry.version();
      return state.open();
    },
    (target, previous) => {
      if (target === null) {
        setBox(null);
        return;
      }
      const rect = untrack(() =>
        target.elementId === null ? dd.geometry.itemRect(target.viewportId) : dd.geometry.rect(target.elementId),
      );
      setBox(rect);
      if (previous === null || previous === undefined) {
        setQuery("");
        setIndex(0);
        // The field mounts with the Show on the next flush; focus once it
        // exists (the title bar's rename does the same).
        queueMicrotask(() => inputEl?.focus());
      }
    },
  );

  // A press outside closes; the canvas never sees presses inside (#67).
  const onWindowPointerDown = (event: PointerEvent): void => {
    if (state.open() === null) return;
    if (rootEl !== undefined && event.target instanceof Node && rootEl.contains(event.target)) return;
    state.close();
  };
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  onCleanup(() => window.removeEventListener("pointerdown", onWindowPointerDown, true));

  const onKeyDown = (event: KeyboardEvent): void => {
    const list = matches();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex(list.length === 0 ? 0 : (index() + 1) % list.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(list.length === 0 ? 0 : (index() - 1 + list.length) % list.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = list[index()];
      if (chosen !== undefined) state.choose(chosen.id, parseQuery(query()).brief);
    } else if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p")) {
      // Escape closes; ⌘P inside the field closes too, instead of printing.
      event.preventDefault();
      event.stopPropagation();
      state.close();
    }
  };

  return (
    <Show when={box()}>
      {(rect) => (
        <div
          ref={(el) => (rootEl = el)}
          class={`${classPrefix}-picker`}
          role="dialog"
          aria-label="Glaser"
          style={{ left: `${rect().x + rect().width + 12}px`, top: `${rect().y}px` }}
        >
          <input
            ref={(el) => (inputEl = el)}
            class={`${classPrefix}-picker-input`}
            type="text"
            placeholder="Verb, then a brief"
            aria-label="Verb"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul class={`${classPrefix}-picker-list`} role="listbox">
            <For each={matches()}>
              {(entry, i) => (
                <li
                  class={`${classPrefix}-picker-item`}
                  role="option"
                  aria-selected={i() === index() ? "true" : "false"}
                  data-verb={entry.id}
                  onPointerEnter={() => setIndex(i())}
                  onClick={() => state.choose(entry.id, parseQuery(query()).brief)}
                >
                  {entry.title}
                </li>
              )}
            </For>
          </ul>
        </div>
      )}
    </Show>
  );
}
