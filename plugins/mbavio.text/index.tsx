import type { DaydreamApi, DreamItem } from "@daydream/plugin-api";
import { createSignal, onCleanup, Show } from "solid-js";

import { registerClipboard } from "./clipboard";
import { registerTextCommands } from "./commands";
import { createTextEditing } from "./editing";
import { measureInitialTextFrame, measureNaturalTextItem } from "./measurement";
import { isTextItem, TEXT_KIND, textOf, textPayloadProblem } from "./model";
import { textStyles } from "./styles";
import TextItemView from "./TextItem";

export default function activate(dd: DaydreamApi): void {
  const editing = createTextEditing();
  const [draft, setDraft] = createSignal<DreamItem | null>(null);
  // Install before registering the kind: ingest can measure immediately.
  const style = document.createElement("style");
  style.dataset["daydreamTextStyles"] = "";
  style.textContent = textStyles;
  document.head.append(style);
  onCleanup(() => style.remove());

  dd.registerItemKind({
    kind: TEXT_KIND,
    payloadProblem: textPayloadProblem,
    render: (props) => (
      <Show when={draft()?.id !== props.item.id}>
        <TextItemView dd={dd} editing={editing} item={props.item} />
      </Show>
    ),
    prepare: (item) => {
      if (item.frame !== undefined || !isTextItem(item)) return;
      const frame = measureInitialTextFrame(
        item.payload.text,
        item.payload.fontSize,
      );
      if (frame !== undefined) item.frame = frame;
    },
    measure: (item) =>
      isTextItem(item)
        ? measureNaturalTextItem(
            item.payload.text,
            item.frame,
            item.payload.fontSize,
          )
        : null,
    describe: textOf,
    title: false,
    resize: { min: 16, max: Number.POSITIVE_INFINITY, reset: true },
    editing: editing.active,
  });
  dd.registerOverlay({
    id: "draft",
    slot: "overlay.world",
    render: () => (
      <Show when={draft()}>
        {(item) => (
          <TextItemView
            dd={dd}
            editing={editing}
            item={item()}
            ephemeral
            onFinish={() => setDraft(null)}
          />
        )}
      </Show>
    ),
  });
  dd.canvas.onEmptyDoubleClick((event, position) => {
    event.preventDefault();
    const item: DreamItem = {
      id: dd.core.generateId(),
      kind: TEXT_KIND,
      position,
      payload: { text: "" },
    };
    setDraft(item);
    editing.begin(item.id);
  });
  dd.canvas.onPointerDown((event, context) => {
    if (editing.intent() === null) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-text-editor]") != null) return;
    if (context.empty) event.preventDefault();
    editing.commit();
  });
  registerClipboard(dd);
  registerTextCommands(dd, editing);
}
