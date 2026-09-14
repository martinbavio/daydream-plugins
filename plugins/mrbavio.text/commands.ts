import type { DaydreamApi } from "@daydream/plugin-api";

import type { TextEditing } from "./editing";
import { isTextItem, resizeTextFont, TEXT_FONT_SIZE_STEP } from "./model";

export function registerTextCommands(
  dd: DaydreamApi,
  editing: TextEditing,
): void {
  const soleSelectedText = () => {
    const ids = dd.itemSelection();
    if (ids.length !== 1) return null;
    const item = dd.items().find((candidate) => candidate.id === ids[0]);
    return item !== undefined && isTextItem(item) ? item.id : null;
  };
  dd.registerCommand({
    id: "mrbavio.text.edit",
    title: "Edit text",
    scope: "canvas",
    when: () => soleSelectedText() !== null,
    run: () => {
      const id = soleSelectedText();
      if (id === null) return false;
      editing.begin(id);
    },
  });
  dd.bindShortcut("mrbavio.text.edit", "Enter");

  for (const direction of [-1, 1]) {
    const name = direction > 0 ? "increase" : "decrease";
    const keys = direction > 0 ? ["Mod++", "Mod+="] : ["Mod+-"];
    // The manifest advertises the canvas bindings. Register a matching
    // editor-scoped command so the same chord preserves its caret and
    // belongs to the current text-edit transaction while typing.
    for (const scope of ["canvas", "editor"] as const) {
      const id = `mrbavio.text.${name}-font-size-${scope}`;
      dd.registerCommand({
        id,
        title: `${direction > 0 ? "Increase" : "Decrease"} text size`,
        scope,
        when: (ctx) =>
          scope === "editor"
            ? ctx.event?.target instanceof Element &&
              ctx.event.target.closest("[data-text-editor]") !== null
            : dd
                .items()
                .some(
                  (item) =>
                    dd.itemSelection().includes(item.id) && isTextItem(item),
                ),
        run: () => {
          const delta = direction * TEXT_FONT_SIZE_STEP;
          if (scope === "editor") return editing.changeFontSize(delta);
          const selected = new Set(dd.itemSelection());
          dd.mutateItems((items) => {
            for (const item of items)
              if (selected.has(item.id) && isTextItem(item))
                resizeTextFont(item, delta);
          });
        },
      });
      for (const key of keys) dd.bindShortcut(id, key);
    }
  }
}
