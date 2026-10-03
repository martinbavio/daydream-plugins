// The panel's writes, through `dd` alone: a page dragged from the panel
// onto the canvas, landed as a viewport where it is dropped (one undo
// step, then selected), and a new empty page made through the kernel. A
// refusal is said on the console under the plugin's id and writes
// nothing.

import type { DaydreamApi } from "@daydream/plugin-api";

import {
  centeredAt,
  clearOf,
  DEFAULT_FRAME,
  emptyPage,
  frameFor,
  ghostSize,
} from "./pages";

/** The drag's data type: a page's path, from a row of the panel. Lower
 * case, as `DataTransfer.types` reports every type. */
export const dragType = (pluginId: string): string =>
  `application/x-${pluginId}-page`;

/** Every item's top-left on the shown canvas: the spots a placement
 * steps aside from. */
const taken = (dd: DaydreamApi) => dd.items().map((item) => item.position);

/** Place a viewport of the page at `path`, its top-left at `at` (world
 * px), and select it. Answers its id, or null when nothing was placed — a
 * page the project does not hold, or a write the kernel refused. */
export function placeViewport(
  dd: DaydreamApi,
  path: string,
  at: { x: number; y: number },
): string | null {
  if (dd.page(path) === undefined) return null;
  const frame = frameFor(path, dd.core.viewportItems(dd.document()));
  const position = { x: Math.round(at.x), y: Math.round(at.y) };
  const id = dd.core.generateId();
  try {
    dd.mutateItems((items) => {
      items.push({
        id,
        kind: dd.core.viewportKind,
        position,
        frame,
        payload: { page: path },
      });
    });
  } catch (error) {
    console.error(`[${dd.plugin.id}] could not place ${path}:`, error);
    return null;
  }
  dd.select(id);
  return id;
}

/** Make a new empty page titled `title`, placed at the view's center and
 * selected. The host names its file after the title. Resolves to its
 * path; rejects with the kernel's sentence. */
export async function createEmptyPage(
  dd: DaydreamApi,
  title: string,
): Promise<string> {
  const made = await dd.createPage(emptyPage(title), {
    position: clearOf(centeredAt(dd.canvas.center(), DEFAULT_FRAME), taken(dd)),
    frame: { ...DEFAULT_FRAME },
  });
  dd.select(made.viewportId);
  return made.path;
}

/** Start dragging the page at `path` from its name in the panel. What
 * the pointer carries is the viewport it will land — its frame outlined at
 * the canvas's zoom, the size its last viewport shows at, held by its
 * top-left — so where the outline is let go is where the viewport lands.
 * A drag image must be in the document when it is taken: the outline is
 * put off-screen for the moment the browser copies it, then removed. Its
 * styles are inline, since the panel's sheet does not reach `<body>`. */
export function startPageDrag(
  dd: DaydreamApi,
  path: string,
  event: DragEvent,
): void {
  const transfer = event.dataTransfer;
  if (transfer === null || dd.page(path) === undefined) return;
  transfer.setData(dragType(dd.plugin.id), path);
  transfer.effectAllowed = "copy";

  const viewports = dd.core.viewportItems(dd.document());
  const own = viewports.filter(
    (viewport) =>
      viewport.payload.page === path && viewport.payload.variant === undefined,
  );
  const last = own.at(-1);
  const size = ghostSize(
    frameFor(path, viewports),
    dd.geometry.camera().zoom,
    last === undefined ? null : dd.geometry.itemRect(last.id),
  );
  const ghost = document.createElement("div");
  ghost.textContent = path;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-10000px",
    left: "-10000px",
    boxSizing: "border-box",
    width: `${size.width}px`,
    height: `${size.height}px`,
    padding: "4px 6px",
    font: "11px/1.4 system-ui, sans-serif",
    color: "#4c9aff",
    background: "rgba(76, 154, 255, 0.08)",
    border: "1px solid #4c9aff",
    overflow: "hidden",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  });
  document.body.append(ghost);
  transfer.setDragImage(ghost, 0, 0);
  requestAnimationFrame(() => ghost.remove());
}

/** The canvas takes a page dragged from the panel: a viewport of it,
 * its top-left where it is dropped — where the dragged outline's was. */
export function registerDrop(dd: DaydreamApi): void {
  const type = dragType(dd.plugin.id);
  dd.canvas.onDragOver((event) => {
    if (!event.dataTransfer?.types.includes(type)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  dd.canvas.onDrop((event) => {
    const path = event.dataTransfer?.getData(type) ?? "";
    if (path === "") return;
    event.preventDefault();
    placeViewport(
      dd,
      path,
      dd.canvas.screenToWorld(event.clientX, event.clientY),
    );
  });
}
