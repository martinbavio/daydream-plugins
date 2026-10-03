// The panel body: one row per page of the project, and a new page at the
// end. A FACTORY the kernel calls once per mount under the panel's owner
// (PanelRegistration.render), so its memos and effects die with the body
// — a minimized panel's is unmounted, and nothing here must outlive it.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
} from "solid-js";

import type { DaydreamApi, PanelContext } from "@daydream/plugin-api";

import { nextViewport, pageRows, type PageRow } from "./pages";
import { createEmptyPage, startPageDrag } from "./place";
import { classPrefix } from "./styles";

export default function createPagesPanel(
  dd: DaydreamApi,
  context: PanelContext,
) {
  const p = classPrefix(dd.plugin.id);
  const rows = createMemo(() =>
    pageRows(dd.document(), dd.core.viewportItems(dd.document())),
  );
  // The list is keyed by path, so a row keeps its node (and its parsed
  // title) through the document writes a drag makes on every frame.
  const paths = createMemo(() => rows().map((row) => row.path));
  const byPath = createMemo(
    () => new Map(rows().map((row) => [row.path, row] as const)),
  );

  // The viewport the panel is for: a selected item, or the page an
  // element of it sits in. `pageElement` reads the mount, so it is read
  // in the apply phase (decision #33), subscribed in compute to the
  // selection and to every document change (a remount gives the element
  // a new id).
  const [selectedViewport, setSelectedViewport] = createSignal<string | null>(
    null,
  );
  createEffect(
    () => {
      dd.documentVersion();
      return { element: context.selection(), items: context.itemSelection() };
    },
    ({ element, items }) => {
      setSelectedViewport(
        items.length > 0
          ? items.at(-1)!
          : element === null
            ? null
            : (untrack(() => dd.pageElement(element))?.viewportId ?? null),
      );
    },
  );

  const select = (row: PageRow) => {
    const id = nextViewport(row.viewports, selectedViewport());
    if (id !== null) dd.select(id);
  };

  return (
    <div class={`${p}-panel`}>
      <Show
        when={paths().length > 0}
        fallback={<p class={`${p}-empty`}>No pages in this project yet.</p>}
      >
        <ul class={`${p}-list`} aria-label="Pages">
          <For each={paths()}>
            {(path) => {
              const row = () => byPath().get(path)!;
              return (
                <PageRowView
                  dd={dd}
                  p={p}
                  row={row()}
                  selected={row().viewports.includes(selectedViewport() ?? "")}
                  onSelect={() => select(row())}
                />
              );
            }}
          </For>
        </ul>
      </Show>
      <NewPage dd={dd} p={p} />
    </div>
  );
}

function PageRowView(props: {
  dd: DaydreamApi;
  p: string;
  row: PageRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const page = () => props.dd.page(props.row.path);
  const missing = () => page() === undefined;
  // The page's title as the browser reads it: parsed again only when its
  // markup changes.
  const html = createMemo(() => page()?.html ?? "");
  const title = createMemo(() =>
    html() === "" ? "" : props.dd.core.parsePage(html()).title.trim(),
  );
  const count = () => props.row.viewports.length;
  const onCanvas = () => count() > 0;

  return (
    <li
      class={`${props.p}-row`}
      data-path={props.row.path}
      data-selected={props.selected ? "" : undefined}
      data-off={onCanvas() ? undefined : ""}
      data-missing={missing() ? "" : undefined}
    >
      {/* The name is the handle: a drag lands a viewport where it is
          dropped, a click selects the page's viewport. Not a <button>: a
          disabled one swallows the press a drag starts with. */}
      <div
        class={`${props.p}-name`}
        role="button"
        tabindex={onCanvas() ? 0 : -1}
        aria-disabled={onCanvas() ? undefined : "true"}
        title={
          missing()
            ? `${props.row.path} is missing from the project`
            : onCanvas()
              ? `Select ${props.row.path}, or drag it onto the canvas`
              : `Drag ${props.row.path} onto the canvas`
        }
        draggable={missing() ? "false" : "true"}
        onDragStart={(event) => startPageDrag(props.dd, props.row.path, event)}
        onClick={() => {
          if (onCanvas()) props.onSelect();
        }}
        onKeyDown={(event) => {
          if (!onCanvas() || (event.key !== "Enter" && event.key !== " "))
            return;
          event.preventDefault();
          props.onSelect();
        }}
      >
        <span class={`${props.p}-path`}>
          <Show when={props.row.folder !== ""}>
            <span class={`${props.p}-folder`}>{props.row.folder}</span>
          </Show>
          {props.row.name}
        </span>
        <Show when={title() !== ""}>
          <span class={`${props.p}-title`}>{title()}</span>
        </Show>
      </div>
      <Show
        when={!missing()}
        fallback={<span class={`${props.p}-note`}>missing</span>}
      >
        <Show when={count() > 1}>
          <span
            class={`${props.p}-note`}
            title={`${count()} viewports on the canvas`}
          >
            {count()}
          </span>
        </Show>
      </Show>
    </li>
  );
}

/** "New page": a title field in place of the button while it is open.
 * Enter makes the page; Escape, or leaving it empty, closes it. */
function NewPage(props: { dd: DaydreamApi; p: string }) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const close = () => {
    setOpen(false);
    setProblem(null);
  };
  const submit = async (input: HTMLInputElement) => {
    const title = input.value.trim();
    if (title === "" || busy()) return;
    setBusy(true);
    setProblem(null);
    try {
      await createEmptyPage(props.dd, title);
      close();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={`${props.p}-new`}>
      <Show
        when={open()}
        fallback={
          <button
            type="button"
            class={`${props.p}-new-button`}
            onClick={() => setOpen(true)}
          >
            New page
          </button>
        }
      >
        <input
          ref={(node) => queueMicrotask(() => node.focus())}
          class={`${props.p}-new-input`}
          type="text"
          placeholder="Title, then Enter"
          aria-label="New page title"
          disabled={busy()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit(event.currentTarget);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          onBlur={(event) => {
            if (event.currentTarget.value.trim() === "" && !busy()) close();
          }}
        />
        <Show when={problem()}>
          {(text) => <p class={`${props.p}-problem`}>{text()}</p>}
        </Show>
      </Show>
    </div>
  );
}
