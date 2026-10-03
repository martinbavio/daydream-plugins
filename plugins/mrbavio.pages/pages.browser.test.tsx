// The panel through the loader seam: the real shell with this plugin
// enabled, a project of three pages (two on the canvas, one off it), and
// what a user observes — the rows, the items, the selection, one undo
// step per placement — never the registry. A new page is made over the
// kernel's fake project host, which names it as the host does, in memory.
import { describe, expect, test, vi } from "vitest";

import type { PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  fakeProjectHost,
  flush,
  mountPlugin,
  testProject,
  viewportItems,
  type MountedPlugin,
} from "@daydream/plugin-testing";

import activate from "./index";
import manifest from "./manifest.json";
const page = (path: string, title: string, frame?: { width: number }) =>
  createPageItem(
    {
      html: `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`,
    },
    { path, ...(frame === undefined ? {} : { frame }) },
  );

async function mount(
  options: { host?: Parameters<typeof mountPlugin>[0]["host"] } = {},
): Promise<{ mounted: MountedPlugin; home: string; about: string }> {
  const home = page("index.html", "Home", { width: 1280 });
  const about = page("about.html", "About");
  const post = page("blog/post.html", "A post");
  const project = testProject([home, about], { pages: [post.page] });
  const mounted = await mountPlugin({
    entry: activate,
    manifest: manifest as PluginManifest,
    project,
    ...(options.host === undefined ? {} : { host: options.host }),
  });
  await vi.waitFor(() => expect(rows(mounted)).toHaveLength(3));
  return { mounted, home: home.item.id, about: about.item.id };
}

const rows = (mounted: MountedPlugin): HTMLElement[] => [
  ...(mounted.panel()?.querySelectorAll<HTMLElement>("li[data-path]") ?? []),
];

const row = (mounted: MountedPlugin, path: string): HTMLElement =>
  mounted.panel()!.querySelector<HTMLElement>(`li[data-path="${path}"]`)!;

/** A row's name: the handle a drag starts from and a click selects by. */
const name = (mounted: MountedPlugin, path: string): HTMLElement =>
  row(mounted, path).querySelector<HTMLElement>('[role="button"]')!;

const viewportsOf = (mounted: MountedPlugin, path: string) =>
  viewportItems(mounted.store.document).filter(
    (item) => item.payload.page === path,
  );

describe("the list", () => {
  test("every page by path, with its title; one off the canvas reads so", async () => {
    const { mounted } = await mount();
    expect(rows(mounted).map((li) => li.dataset.path)).toEqual([
      "about.html",
      "blog/post.html",
      "index.html",
    ]);
    const post = row(mounted, "blog/post.html");
    await vi.waitFor(() => expect(post.textContent).toContain("A post"));
    expect(post.hasAttribute("data-off")).toBe(true);
    expect(row(mounted, "index.html").hasAttribute("data-off")).toBe(false);
  });

  test("a click selects the page's viewport, and the row reads selected", async () => {
    const { mounted, home } = await mount();
    name(mounted, "index.html").click();
    flush();
    expect(mounted.store.selectedId()).toBe(home);
    await vi.waitFor(() =>
      expect(row(mounted, "index.html").hasAttribute("data-selected")).toBe(
        true,
      ),
    );
  });
});

/** A page's name dragged from its row and let go on the canvas at
 * `offset` from the canvas's top-left, as the browser sends it: one
 * DataTransfer through dragstart, dragover and drop. Answers the drop and
 * the drag image the row set, with where it holds it. */
function drag(
  mounted: MountedPlugin,
  path: string,
  offset: { x: number; y: number },
) {
  const canvas = mounted.host.querySelector<HTMLElement>(
    '[class*="_canvas_"]',
  )!;
  const rect = canvas.getBoundingClientRect();
  const at = { clientX: rect.left + offset.x, clientY: rect.top + offset.y };
  const transfer = new DataTransfer();
  const image = vi.spyOn(transfer, "setDragImage");
  name(mounted, path).dispatchEvent(
    new DragEvent("dragstart", { dataTransfer: transfer, bubbles: true }),
  );
  const init = {
    ...at,
    dataTransfer: transfer,
    bubbles: true,
    cancelable: true,
  };
  const over = new DragEvent("dragover", init);
  canvas.dispatchEvent(over);
  const drop = new DragEvent("drop", init);
  canvas.dispatchEvent(drop);
  flush();
  const [ghost, x, y] = image.mock.calls[0] ?? [];
  return { over, drop, ghost: ghost as HTMLElement | undefined, x, y };
}

/** Where a drop at `offset` from the canvas's top-left is in the world. */
function world(mounted: MountedPlugin, offset: { x: number; y: number }) {
  const { store } = mounted;
  return {
    x: Math.round((offset.x - store.panX()) / store.zoom()),
    y: Math.round((offset.y - store.panY()) / store.zoom()),
  };
}

describe("dragging a page onto the canvas", () => {
  test("lands a viewport of it, its top-left where it is dropped, selected, as one undo step", async () => {
    const { mounted } = await mount();
    await mounted.framed;
    const offset = { x: 80, y: 100 };
    const { over, drop } = drag(mounted, "blog/post.html", offset);
    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    const placed = viewportsOf(mounted, "blog/post.html");
    expect(placed).toHaveLength(1);
    expect(placed[0]!.position).toEqual(world(mounted, offset));
    expect(placed[0]!.frame).toEqual({ width: 960 });
    expect(mounted.store.selectedId()).toBe(placed[0]!.id);
    await vi.waitFor(() =>
      expect(row(mounted, "blog/post.html").hasAttribute("data-off")).toBe(
        false,
      ),
    );

    mounted.store.undo();
    flush();
    expect(viewportsOf(mounted, "blog/post.html")).toHaveLength(0);
  });

  test("carries the viewport's outline, held by its top-left, at the canvas's zoom", async () => {
    const { mounted } = await mount();
    await mounted.framed;
    const { ghost, x, y } = drag(mounted, "blog/post.html", { x: 40, y: 40 });
    expect([x, y]).toEqual([0, 0]);
    const zoom = mounted.store.zoom();
    expect(ghost!.style.width).toBe(`${Math.round(960 * zoom)}px`);
    expect(ghost!.textContent).toBe("blog/post.html");
    await vi.waitFor(() => expect(ghost!.isConnected).toBe(false));
  });

  test("a second viewport of a page takes the frame of its last one", async () => {
    const { mounted, home } = await mount();
    await mounted.framed;
    drag(mounted, "index.html", { x: 60, y: 60 });
    const views = viewportsOf(mounted, "index.html");
    expect(views).toHaveLength(2);
    expect(views[1]!.frame).toEqual({ width: 1280 });
    await vi.waitFor(() =>
      expect(row(mounted, "index.html").textContent).toContain("2"),
    );

    // A click on the name now steps through the page's viewports.
    name(mounted, "index.html").click();
    flush();
    expect(mounted.store.selectedId()).toBe(home);
    name(mounted, "index.html").click();
    flush();
    expect(mounted.store.selectedId()).toBe(views[1]!.id);
  });

  test("the row has no place button: the drag is the way on", async () => {
    const { mounted } = await mount();
    expect(row(mounted, "blog/post.html").querySelector("button")).toBeNull();
  });

  test("a drag of anything else is left to the canvas", async () => {
    const { mounted } = await mount();
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "index.html");
    const drop = new DragEvent("drop", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    mounted.host
      .querySelector<HTMLElement>('[class*="_canvas_"]')!
      .dispatchEvent(drop);
    expect(viewportItems(mounted.store.document)).toHaveLength(2);
  });
});

describe("a new page", () => {
  test("is made from its title through the host, placed and selected", async () => {
    const fake = fakeProjectHost();
    const { mounted } = await mount({ host: fake.host });
    const panel = mounted.panel()!;
    [...panel.querySelectorAll("button")]
      .find((b) => b.textContent === "New page")!
      .click();
    flush();
    const input = await vi.waitFor(() => {
      const found = panel.querySelector<HTMLInputElement>("input");
      expect(found).not.toBeNull();
      return found!;
    });
    input.value = "Pricing & plans";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await vi.waitFor(() => expect(fake.made).toHaveLength(1));
    expect(fake.made[0]!.title).toBe("Pricing & plans");
    await vi.waitFor(() =>
      expect(rows(mounted).map((li) => li.dataset.path)).toContain(
        "pricing-plans.html",
      ),
    );
    const made = viewportsOf(mounted, "pricing-plans.html");
    expect(made).toHaveLength(1);
    expect(mounted.store.selectedId()).toBe(made[0]!.id);
    expect(panel.querySelector("input")).toBeNull();
  });
});
