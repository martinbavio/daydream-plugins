import type {
  DaydreamApi,
  DeepReadonly,
  Disposable,
  DreamItem,
} from "@daydream/plugin-api";
import { createEffect, createSignal, onSettled, Show, untrack } from "solid-js";

import type { TextEditing } from "./editing";
import { editableText, placeCaret } from "./editorDom";
import {
  DEFAULT_TEXT_FONT_SIZE,
  isTextItem,
  nextTextFontSize,
  resizeTextFont,
  TEXT_KIND,
  textOf,
} from "./model";
import { textClasses } from "./styles";

export default function TextItemView(props: {
  dd: DaydreamApi;
  editing: TextEditing;
  item: DeepReadonly<DreamItem>;
  ephemeral?: boolean;
  onFinish?: () => void;
}) {
  const dd = untrack(() => props.dd);
  const editing = untrack(() => props.editing);
  const itemId = untrack(() => props.item.id);
  const initialPosition = untrack(() => ({ ...props.item.position }));
  const onFinish = untrack(() => props.onFinish);
  const findItem = () => dd.items().find((item) => item.id === itemId);
  let initialText = untrack(() => textOf(props.item));
  let sessionText = initialText;
  let editor: HTMLDivElement | undefined;
  let binding: Disposable | undefined;
  let transaction: ReturnType<DaydreamApi["beginItemTransaction"]> | undefined;
  let terminalSentinel = false;
  const [draftFontSize, setDraftFontSize] = createSignal(
    DEFAULT_TEXT_FONT_SIZE,
  );
  const currentItem = () =>
    props.ephemeral ? (findItem() ?? props.item) : props.item;
  const fontSize = () => {
    const item = currentItem();
    return isTextItem(item)
      ? (item.payload.fontSize ?? draftFontSize())
      : draftFontSize();
  };

  const mutateText = (text: string): void => {
    if (text.trim() === "") return;
    const existing = findItem();
    if (existing === undefined) {
      const size = draftFontSize();
      transaction?.mutate((items) => {
        items.push({
          id: itemId,
          kind: TEXT_KIND,
          position: { ...initialPosition },
          payload: {
            text,
            ...(size === DEFAULT_TEXT_FONT_SIZE ? {} : { fontSize: size }),
          },
        });
      });
      dd.select(itemId);
    } else if (textOf(existing) !== text) {
      transaction?.update(itemId, (item) => {
        if (isTextItem(item)) item.payload.text = text;
      });
    }
  };

  /** Every way out of the editor keeps the text: Escape commits like ⌘Enter. */
  const finish = (): void =>
    untrack(() => {
      if (!editing.active(itemId)) return;
      const value =
        editor === undefined
          ? sessionText
          : editableText(editor, terminalSentinel);
      if (value.trim() === "") {
        if (findItem() !== undefined) {
          // Exit editing before removing the component that owns the editor.
          editing.end(itemId);
          transaction?.mutate((items) => {
            const index = items.findIndex((item) => item.id === itemId);
            if (index !== -1) items.splice(index, 1);
          });
        }
      } else {
        mutateText(value);
        dd.select(itemId);
      }
      transaction?.commit();
      transaction = undefined;
      sessionText = value;
      editing.end(itemId);
      onFinish?.();
    });

  createEffect(
    () => editing.intent(),
    (intent) => {
      if (intent?.id !== itemId) return;
      initialText = untrack(() => textOf(props.item));
      sessionText = initialText;
      terminalSentinel = false;
      transaction ??= dd.beginItemTransaction({
        onInterrupted: () => {
          transaction = undefined;
          editing.end(itemId);
          onFinish?.();
        },
      });
      queueMicrotask(() => {
        if (editor === undefined || !editing.active(itemId)) return;
        terminalSentinel = initialText.endsWith("\n");
        editor.textContent = terminalSentinel
          ? `${initialText}\n`
          : initialText;
        editor.focus({ preventScroll: true });
        placeCaret(editor, intent.caret, terminalSentinel);
      });
    },
  );

  onSettled(() => {
    const unregister = editing.register(itemId, {
      commit: () => finish(),
      changeFontSize: (delta) => {
        if (findItem() === undefined) {
          setDraftFontSize(nextTextFontSize(draftFontSize(), delta));
        } else {
          transaction?.update(itemId, (item) => {
            if (isTextItem(item)) resizeTextFont(item, delta);
          });
        }
      },
    });
    return () =>
      untrack(() => {
        unregister();
        binding?.dispose();
        if (editing.active(itemId)) {
          transaction?.cancel();
          transaction = undefined;
          editing.end(itemId);
        }
      });
  });

  const boxStyle = (): Record<string, string> => ({
    "font-size": `${fontSize()}px`,
    left: `${props.item.position.x}px`,
    top: `${props.item.position.y}px`,
    ...(currentItem().frame === undefined
      ? {}
      : { width: `${currentItem().frame!.width}px` }),
    ...(currentItem().frame?.height === undefined
      ? {}
      : { height: `${currentItem().frame!.height}px` }),
  });

  return (
    <div
      ref={(node) => {
        binding = dd.canvas.bindItemNode(itemId, node, {
          canDrag: () => !editing.active(itemId),
        });
      }}
      class={textClasses(currentItem().frame)}
      style={boxStyle()}
      data-text-item={itemId}
      data-item-kind={TEXT_KIND}
      onDblClick={(event) => {
        event.stopPropagation();
        if (!dd.canvas.panMode() && !editing.active(itemId)) {
          dd.select(itemId);
          editing.begin(itemId, {
            clientX: event.clientX,
            clientY: event.clientY,
          });
        }
      }}
    >
      {editing.active(itemId) ? (
        <div
          ref={(el) => (editor = el)}
          class="daydream-text-editor"
          data-text-editor
          data-dd-editable
          data-dd-native-undo
          contenteditable="plaintext-only"
          spellcheck={true}
          role="textbox"
          aria-label="Canvas text"
          aria-multiline="true"
          onInput={(event) => {
            const inputType = event.inputType;
            const rawText = event.currentTarget.innerText;
            terminalSentinel =
              ((inputType === "insertParagraph" ||
                inputType === "insertLineBreak" ||
                inputType === "deleteContentBackward" ||
                inputType === "deleteContentForward" ||
                inputType === "historyUndo" ||
                inputType === "historyRedo") &&
                rawText.endsWith("\n\n")) ||
              (terminalSentinel && rawText.endsWith("\n"));
            sessionText = editableText(event.currentTarget, terminalSentinel);
            mutateText(sessionText);
          }}
          onBlur={() => finish()}
          onKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (
              event.key === "Escape" ||
              (event.key === "Enter" && (event.metaKey || event.ctrlKey))
            ) {
              event.preventDefault();
              event.stopPropagation();
              finish();
            }
          }}
        >
          {sessionText}
        </div>
      ) : (
        <div class="daydream-text-content">
          {textOf(props.item)}
          <Show when={textOf(props.item).endsWith("\n")}>
            <br aria-hidden="true" />
          </Show>
        </div>
      )}
    </div>
  );
}
