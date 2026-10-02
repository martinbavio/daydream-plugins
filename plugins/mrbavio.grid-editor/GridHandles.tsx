import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  Show,
  untrack,
  type Accessor,
} from "solid-js";

import type { JSX } from "@solidjs/web";

import type {
  CanvasDragHandlers,
  DaydreamApi,
  Disposable,
  ElementId,
  OverlayRect,
} from "@daydream/plugin-api";

import type { GridGeometry } from "./gridGeometry";
import { selectedGrid } from "./selectedGrid";
import {
  beginSession,
  insertEqualAt,
  removeBefore,
  type Axis,
  type Mode,
  type Session,
} from "./session";
import { classPrefix } from "./styles";

// The furniture: one band per grid line of the selected grid — the gaps
// between tracks, and the two edges, which show under the pointer —
// drawn in the interactive slot (screen space, takes input) and clipped
// to the viewport's window, and a note beside the pointer while a band
// is dragged. Which grid: the selected element's own, else its parent's
// (the same rule as the guides, Daydream's decision #11). Geometry is read in
// the effect's apply phase and re-read on every geometry trigger —
// including the drag's own writes, so the bands follow the lines they
// are moving.

interface Visual {
  gridId: ElementId;
  geometry: GridGeometry;
  /** The viewport's window, overlay px: what the bands are clipped to. */
  clip: OverlayRect | null;
}

/** One band's box, overlay px, and the grid line it stands on (0 = the
 * start edge; line n stands after track n − 1). */
interface HandleBox {
  x: number;
  y: number;
  width: number;
  height: number;
  line: number;
  edge: boolean;
}

interface Note {
  x: number;
  y: number;
  text: string;
}

/** Which lines are lit while a band is dragged: the one pressed (it holds
 * the pointer) and the one under the pointer — an insert opens a line
 * the press never touched, and that is the one that moves. */
interface Dragging {
  axis: Axis;
  line: number;
  hot: number;
}

/** A gap of 0 still gets a band this wide to grab (screen px); the edges
 * always do. */
const MIN_HIT = 10;
const NOTE_OFFSET = { x: 14, y: 18 };
/** How long a double-click's note stays. */
const FLASH_MS = 900;
/** A `dblclick` this soon after a moved gesture ended is the browser
 * counting that gesture's release as a click — the kernel suppresses the
 * `click`, not the `dblclick` — and is ignored. */
const DOUBLE_CLICK_MS = 600;

function clipTo(box: HandleBox, clip: OverlayRect | null): HandleBox {
  if (clip === null) return box;
  const x0 = Math.max(box.x, clip.x);
  const y0 = Math.max(box.y, clip.y);
  const x1 = Math.min(box.x + box.width, clip.x + clip.width);
  const y1 = Math.min(box.y + box.height, clip.y + clip.height);
  return {
    ...box,
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

/** The bands of one axis, in line order: line n is the array's index n,
 * whatever the direction. A box clipped away keeps its place, at no
 * size. */
function handlesFor(
  axis: Axis,
  g: GridGeometry,
  clip: OverlayRect | null,
): HandleBox[] {
  const along = axis === "cols" ? g.cols.bands : g.rows.bands;
  const across = axis === "cols" ? g.rows.bands : g.cols.bands;
  const reversed = axis === "cols" ? g.cols.reversed : g.rows.reversed;
  const first = along[0];
  const last = along[along.length - 1];
  if (first === undefined || last === undefined) return [];
  const spanStart =
    across.length === 0
      ? axis === "cols"
        ? g.rect.y
        : g.rect.x
      : Math.min(...across.map((band) => band.start));
  const spanEnd =
    across.length === 0
      ? axis === "cols"
        ? g.rect.y + g.rect.height
        : g.rect.x + g.rect.width
      : Math.max(...across.map((band) => band.end));
  const box = (
    line: number,
    center: number,
    size: number,
    edge: boolean,
  ): HandleBox =>
    clipTo(
      axis === "cols"
        ? {
            x: center - size / 2,
            y: spanStart,
            width: size,
            height: spanEnd - spanStart,
            line,
            edge,
          }
        : {
            x: spanStart,
            y: center - size / 2,
            width: spanEnd - spanStart,
            height: size,
            line,
            edge,
          },
      clip,
    );
  const out: HandleBox[] = [
    box(0, reversed ? first.end : first.start, MIN_HIT, true),
  ];
  for (let i = 0; i + 1 < along.length; i++) {
    // The gap between two tracks, whichever side each is on.
    const a = Math.min(along[i]!.end, along[i + 1]!.end);
    const b = Math.max(along[i]!.start, along[i + 1]!.start);
    out.push(box(i + 1, (a + b) / 2, Math.max(b - a, MIN_HIT), false));
  }
  out.push(box(along.length, reversed ? last.start : last.end, MIN_HIT, true));
  return out;
}

export default function createGridHandles(dd: DaydreamApi): JSX.Element {
  const p = classPrefix(dd.plugin.id);
  const [visual, setVisual] = createSignal<Visual | null>(null);
  const [note, setNote] = createSignal<Note | null>(null);
  const [dragging, setDragging] = createSignal<Dragging | null>(null);
  let flashTimer: number | undefined;
  onSettled(() => () => window.clearTimeout(flashTimer));

  const readVisual = (selectedId: ElementId): Visual | null => {
    const grid = selectedGrid(dd, selectedId);
    if (grid === null) return null;
    const viewportId = dd.pageElement(grid.gridId)?.viewportId ?? null;
    const clip = viewportId === null ? null : dd.geometry.itemRect(viewportId);
    return { ...grid, clip };
  };

  // Subscribe in compute (the selection and every geometry trigger), read
  // the DOM in apply — the same frame's layout, never the previous one's.
  createEffect(
    () => {
      dd.geometry.version();
      return dd.selection();
    },
    (selectedId) => {
      setVisual(
        selectedId === null ? null : untrack(() => readVisual(selectedId)),
      );
    },
  );

  const cols = createMemo(() => {
    const v = visual();
    return v === null ? [] : handlesFor("cols", v.geometry, v.clip);
  });
  const rows = createMemo(() => {
    const v = visual();
    return v === null ? [] : handlesFor("rows", v.geometry, v.clip);
  });

  /** The pointer's overlay position: window client px → world →
   * overlay (pan + world × zoom). */
  const overlayPoint = (clientX: number, clientY: number) => {
    const world = dd.canvas.screenToWorld(clientX, clientY);
    const camera = dd.geometry.camera();
    return {
      x: camera.panX + world.x * camera.zoom,
      y: camera.panY + world.y * camera.zoom,
    };
  };

  const showNote = (clientX: number, clientY: number, text: string) => {
    const at = overlayPoint(clientX, clientY);
    setNote({ x: at.x + NOTE_OFFSET.x, y: at.y + NOTE_OFFSET.y, text });
  };

  const handlers = (
    axis: Axis,
    box: Accessor<HandleBox>,
    onMoved: () => void,
  ): CanvasDragHandlers => {
    let mode: Mode = "trade";
    let session: Session | null = null;
    let zoom = 1;
    /** −1 on an axis whose track order runs against the screen (rtl
     * columns): the pointer moving right then moves the line toward
     * the tracks before it. */
    let sign = 1;
    /** Whether a frame was written: the release then writes the final
     * position even from inside the click threshold, so a drag that
     * comes back to its start does not keep an earlier frame's value. */
    let wrote = false;
    const delta = (screen: { x: number; y: number }) =>
      (sign * (axis === "cols" ? screen.x : screen.y)) / zoom;
    return {
      shouldStart: (event) => {
        // ⌘ (Ctrl too — Mod is either, as the kernel's chords have it)
        // is the gap; ⇧ pulls a new track out of the line, as does any
        // drag on an edge, where no trade exists. (⌥ is the canvas's
        // browse modifier, decision #52, and hides the overlay while
        // held.)
        mode =
          event.metaKey || event.ctrlKey
            ? "gap"
            : event.shiftKey || untrack(box).edge
              ? "insert"
              : "trade";
        return true;
      },
      movementAxes: () =>
        axis === "cols" ? { x: true, y: false } : { x: false, y: true },
      onStart: (context) => {
        const v = untrack(visual);
        if (v === null) return;
        const line = untrack(box).line;
        zoom = v.geometry.zoom;
        sign = v.geometry[axis].reversed ? -1 : 1;
        wrote = false;
        window.clearTimeout(flashTimer);
        session = untrack(() =>
          beginSession(dd, v.gridId, v.geometry, axis, line, mode),
        );
        // The press shows; only a move writes.
        const step = session.peek();
        setDragging({ axis, line, hot: step.line });
        showNote(context.startScreen.x, context.startScreen.y, step.note);
      },
      onMove: (context) => {
        if (session === null || !context.moved) return;
        wrote = true;
        const step = session.step(delta(context.deltaScreen));
        setDragging((d) => (d === null ? null : { ...d, hot: step.line }));
        showNote(context.currentScreen.x, context.currentScreen.y, step.note);
      },
      onEnd: (context) => {
        if (context.moved || wrote) onMoved();
        if (session !== null) {
          // A move still waiting for its frame is dropped at release; the
          // end context carries the final position, so the last write is
          // made from it, and the whole drag is then one undo step.
          if (context.canceled) session.restore();
          else {
            if (context.moved || wrote)
              session.step(delta(context.deltaScreen));
            session.commit();
          }
        }
        session = null;
        setDragging(null);
        setNote(null);
      },
    };
  };

  /** A double-click on a band: a track equal to the one before its line,
   * written at once — or, with ⇧, that track removed. The note says
   * what, briefly. The band is resolved from the press's box, never from
   * the event's target: pointer capture retargets the click. */
  const doubleClick = (
    axis: Axis,
    box: Accessor<HandleBox>,
    event: MouseEvent,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const v = untrack(visual);
    if (v === null) return;
    const line = untrack(box).line;
    const text = untrack(() =>
      event.shiftKey
        ? removeBefore(dd, v.gridId, axis, line)
        : insertEqualAt(dd, v.gridId, axis, line),
    );
    showNote(event.clientX, event.clientY, text);
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => setNote(null), FLASH_MS);
  };

  const Handle = (props: { axis: Axis; box: Accessor<HandleBox> }) => {
    let binding: Disposable | undefined;
    let movedAt = Number.NEGATIVE_INFINITY;
    onSettled(() => () => binding?.dispose());
    const mine = (which: "line" | "hot") => {
      const d = dragging();
      return (
        d !== null && d.axis === props.axis && d[which] === props.box().line
      );
    };
    return (
      <div
        class={`${p}-handle ${p}-handle-${props.axis}`}
        data-line={props.box().line}
        data-edge={props.box().edge ? "" : undefined}
        data-active={mine("line") ? "" : undefined}
        data-hot={mine("hot") ? "" : undefined}
        style={{
          left: `${props.box().x}px`,
          top: `${props.box().y}px`,
          width: `${props.box().width}px`,
          height: `${props.box().height}px`,
        }}
        onDblClick={(event) => {
          if (performance.now() - movedAt < DOUBLE_CLICK_MS) return;
          doubleClick(props.axis, props.box, event);
        }}
        ref={(node) => {
          binding = dd.canvas.bindDrag(
            node,
            handlers(props.axis, props.box, () => {
              movedAt = performance.now();
            }),
          );
        }}
      />
    );
  };

  return (
    <div
      class={`${p}-layer`}
      data-dragging={dragging() === null ? undefined : ""}
    >
      {/* Index-keyed (`keyed={false}`): a band's node persists while the
          drag it hosts rewrites the geometry under it, and the node at
          index n is always line n. */}
      <For each={cols()} keyed={false}>
        {(box) => <Handle axis="cols" box={box} />}
      </For>
      <For each={rows()} keyed={false}>
        {(box) => <Handle axis="rows" box={box} />}
      </For>
      <Show when={note()}>
        {(n) => (
          <div
            class={`${p}-note`}
            style={{ left: `${n().x}px`, top: `${n().y}px` }}
          >
            {n().text}
          </div>
        )}
      </Show>
    </div>
  );
}
