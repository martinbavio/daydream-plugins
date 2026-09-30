// A variants round on the kernel's variants (Phase 9, decision #80),
// through the real shell: the user picks a variants verb, the agent takes
// it and finalizes each copy it opened — driven here through the tab's
// real draft handlers, the host's part (naming the variant's file and its
// base) played by the test — and each lands as a viewport of the source's
// page naming its variant. The caption counts them, the last ending the
// round. The user ends a variant with the kernel's own Accept and Discard
// in its title bar, which write through the host's variant routes (faked
// at the host's capability); the plugin adds no word beside them.
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DreamViewport, PluginManifest } from "@daydream/plugin-api";
import {
  createPageItem,
  createTestRequestHandlers,
  fixturePage,
  flush,
  mountPlugin,
  overrideHostForTests,
  pageElementId,
  pageFixtureProject,
  pageShadow,
  testProject,
  unusedProjectFiles,
  viewportItems,
  type Host,
  type HostProject,
  type MountedPlugin,
  type TestProject,
} from "@daydream/plugin-testing";

import activate, { DONE_TOOL, HTML_TOOL, PICK_TOOL } from "./index";
import rawManifest from "./manifest.json";

const manifest = rawManifest as PluginManifest;
const BASE = "c".repeat(64);

type AcceptRequest = Parameters<NonNullable<HostProject["acceptVariant"]>>[0];
/** The tab's request handlers, as the host calls them. */
type Handlers = Awaited<ReturnType<typeof createTestRequestHandlers>>;

let mounted: MountedPlugin | null = null;
afterEach(() => {
  overrideHostForTests(null);
  mounted?.dispose();
  mounted = null;
});

/** A host that keeps plugin data in memory and answers the project's two
 * variant routes as the Daydream host does — every accept and discard
 * recorded — for the plugins and for the canvas's own gesture alike. */
function variantHost() {
  const accepted: AcceptRequest[] = [];
  const discarded: string[] = [];
  const data: Record<string, unknown> = {};
  const project: HostProject = {
    read: () => Promise.reject(new Error("the project is not read again here")),
    open: () => Promise.resolve({ cancelled: true }),
    saveManifest: () => Promise.resolve({ hash: "0".repeat(64) }),
    ...unusedProjectFiles,
    acceptVariant: async (request) => {
      accepted.push(request);
      return {
        files: request.writes.map((write) => write.path),
        removed: [request.file],
        kept: [],
      };
    },
    discardVariant: async (file) => {
      discarded.push(file);
      return { removed: [file], kept: [] };
    },
  };
  const host = {
    storage: {
      loadPluginData: vi.fn(async (id: string) => (data[id] as Record<string, unknown>) ?? {}),
      savePluginData: vi.fn(async (id: string, value: unknown) => {
        data[id] = structuredClone(value);
      }),
    },
    project,
  } as unknown as Host;
  // The title bar's Accept and Discard write through the app's host.
  overrideHostForTests(host);
  return { host, accepted, discarded };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
  flush();
}

const caption = (): HTMLElement | null =>
  mounted!.overlay()!.querySelector(".impeccable-caption");
const run = (id: string): boolean => mounted!.kernel.commands.runCommand(id);
const tool = (name: string) =>
  mounted!.kernel.registry.tools.entries().find((e) => e.value.name === name)!.value;

/** Pick `verb` from the picker on `selected` (an element or item id). */
async function pickVerb(selected: string, verb: string): Promise<void> {
  mounted!.store.setSelectedId(selected);
  flush();
  run("mrbavio.impeccable.pick");
  await settle();
  mounted!.host
    .querySelector('[role="dialog"][aria-label="Impeccable"]')!
    .querySelector<HTMLElement>(`[data-verb="${verb}"]`)!
    .click();
  await settle();
}

/** The viewports on the canvas that show a variant. */
function variantViewports(): DreamViewport[] {
  return viewportItems(mounted!.store.document).filter((viewport) => viewport.payload.variant !== undefined);
}

/** The variant file the host names the `n`th copy of `page` (the kernel's
 * `<page-stem>.<n>.html`). */
function variantFile(page: string, n: number): string {
  const stem = page.slice(page.lastIndexOf("/") + 1).replace(/\.html$/, "");
  return `.daydream/variants/${stem}.${n}.html`;
}

/**
 * What an agent does for one direction, through the tab's real draft
 * handlers: a copy of `sourceId` opened, its css written, and finalized —
 * the tab asking the host for the variant's name, the host (the test)
 * naming it, the tab planning its two files and landing its viewport once
 * they are written. Answers the viewport it landed as.
 */
async function finalizeCopy(
  handlers: Handlers,
  sourceId: string,
  page: string,
  n: number,
): Promise<string> {
  const opened = (await handlers.draftOpen({
    copyOf: sourceId,
    position: { x: 1100 * n, y: 0 },
    meta: { title: `${page} · bolder ${n}/3` },
  })) as { draft: { id: string } };
  const draft = opened.draft.id;
  await handlers.draftAppend({ draft, css: `.grid { gap: ${n}px }` });
  expect(await handlers.draftFinalize({ draft })).toMatchObject({ variant: { page } });
  const plan = (await handlers.draftFinalize({
    draft,
    variant: { file: variantFile(page, n), base: BASE },
  })) as { planned: true; epoch: number };
  expect(plan.planned).toBe(true);
  const landed = (await handlers.draftCommit({ draft, epoch: plan.epoch })) as { landed: true; id: string };
  expect(landed.landed).toBe(true);
  await settle();
  return landed.id;
}

/** A title bar word of the kernel's on the viewport of the variant
 * `file`: the button in the bar that names the file (`index.2.html`). */
async function variantAction(file: string, outcome: "accept" | "discard"): Promise<HTMLElement> {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return vi.waitFor(() => {
    const own = Array.from(
      mounted!.host.querySelectorAll<HTMLElement>(`[data-variant-action="${outcome}"]`),
    ).find((button) => {
      // The bar is the button's ancestor placed on the screen.
      let bar = button.parentElement;
      while (bar !== null && bar.style.top === "") bar = bar.parentElement;
      return Array.from(bar?.querySelectorAll("span") ?? []).some((span) => span.textContent === name);
    });
    expect(own).toBeDefined();
    return own!;
  });
}

/** The source project, and the page its viewport shows. */
function sourceProject(): { project: TestProject; source: DreamViewport } {
  const project = pageFixtureProject();
  return { project, source: fixturePage(project) };
}

describe("mrbavio.impeccable on the kernel's variants", () => {
  test("a design session's variants round: each copy the agent finalizes lands as a variant beside the source, counted by the caption, the last ending the round; accepting one goes through the kernel's title bar, and discarding another", async () => {
    const { project, source } = sourceProject();
    const page = source.payload.page;
    const { host, accepted, discarded } = variantHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    const handlers = await createTestRequestHandlers(mounted);
    await vi.waitFor(() => expect(pageElementId(source.id, ".grid")).not.toBeNull());

    await pickVerb(pageElementId(source.id, ".grid")!, "bolder");
    expect(caption()!.textContent).toBe("bolder · waiting for an agent");
    await tool(PICK_TOOL).run({});
    await settle();
    expect(caption()!.textContent).toBe("bolder · building");

    // Each finalized copy is a variant of the source's page, nothing of
    // the site written, and the caption counts it.
    const first = await finalizeCopy(handlers, source.id, page, 1);
    expect(caption()!.textContent).toBe("bolder · 1 of 3");
    const second = await finalizeCopy(handlers, source.id, page, 2);
    expect(caption()!.textContent).toBe("bolder · 2 of 3");
    const third = await finalizeCopy(handlers, source.id, page, 3);
    // The last ends the round: no impeccable_done needed for the caption.
    expect(caption()).toBeNull();
    expect(variantViewports().map((v) => [v.id, v.payload])).toEqual([
      [first, { page, variant: { file: variantFile(page, 1), base: BASE } }],
      [second, { page, variant: { file: variantFile(page, 2), base: BASE } }],
      [third, { page, variant: { file: variantFile(page, 3), base: BASE } }],
    ]);
    // Nothing of the site was written: the page is its file as it was.
    const before = mounted.store.page(page)!.html;
    expect(before).toBe(project.pages.find((each) => each.path === page)!.html);
    // The agent's impeccable_done after is harmless.
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });

    // The plugin puts no word of its own on any title bar: the kernel's
    // Accept and Discard are the variant's ends.
    expect(mounted.host.querySelectorAll("[data-item-action]")).toHaveLength(0);
    expect(mounted.host.querySelectorAll('[data-variant-action="accept"]')).toHaveLength(3);

    // Accept the second: the kernel plans its markup over the page's file
    // and its rules into the page's sheet, the host writes them, and the
    // variant leaves the canvas.
    (await variantAction(variantFile(page, 2), "accept")).click();
    await vi.waitFor(() => expect(accepted).toHaveLength(1));
    expect(accepted[0]).toMatchObject({ file: variantFile(page, 2), page, base: BASE });
    expect(accepted[0]!.variant.css).toBe(".grid { gap: 2px }\n");
    expect(accepted[0]!.writes.map((write) => write.path)).toContain(page);
    const sheet = accepted[0]!.writes.find((write) => write.path !== page)!;
    expect(sheet.text.endsWith(".grid { gap: 2px }\n")).toBe(true);
    await vi.waitFor(() => expect(variantViewports().map((v) => v.id)).toEqual([first, third]));
    // The canvas reads the page as the host wrote it: the variant's
    // markup — the copy's own, since the directions here changed only css
    // — with the kernel's link to the sheet its rules went to (the
    // fixture's markup links none).
    const written = accepted[0]!.writes.find((write) => write.path === page)!;
    expect(written.read).toBe(before);
    expect(written.text).toContain(`href="${sheet.path}"`);
    expect(mounted.store.page(page)!.html).toBe(written.text);

    // Discard the first: its files alone go, and it leaves the canvas.
    (await variantAction(variantFile(page, 1), "discard")).click();
    await vi.waitFor(() => expect(discarded).toEqual([variantFile(page, 1)]));
    await vi.waitFor(() => expect(variantViewports().map((v) => v.id)).toEqual([third]));
    expect(accepted).toHaveLength(1);
    // Nothing of either end touched the session: no pick waits, nothing
    // builds.
    await settle();
    expect(caption()).toBeNull();
  });

  test("a round counts its own variants alone: one of another page, or one landed before the round, is not counted; a round stopped short ends at impeccable_done", async () => {
    const home = createPageItem(
      { html: '<!doctype html><html><head></head><body><main class="grid"><p>home</p></main></body></html>', css: ".grid { gap: 0 }" },
      { id: "home", path: "home.html", frame: { width: 640 } },
    );
    const about = createPageItem(
      { html: '<!doctype html><html><head></head><body><main class="grid"><p>about</p></main></body></html>', css: ".grid { gap: 0 }" },
      { id: "about", path: "about.html", position: { x: 0, y: 900 }, frame: { width: 640 } },
    );
    const { host } = variantHost();
    mounted = await mountPlugin({ entry: activate, manifest, project: testProject([home, about]), host });
    const handlers = await createTestRequestHandlers(mounted);
    await vi.waitFor(() => expect(pageElementId("home", ".grid")).not.toBeNull());

    // A variant of home.html made before any round is nobody's round.
    await finalizeCopy(handlers, "home", "home.html", 1);
    expect(caption()).toBeNull();

    await pickVerb("home", "quieter");
    await tool(PICK_TOOL).run({});
    await settle();
    expect(caption()!.textContent).toBe("quieter · building");
    // A variant of another page is not this round's.
    await finalizeCopy(handlers, "about", "about.html", 1);
    expect(caption()!.textContent).toBe("quieter · building");
    await finalizeCopy(handlers, "home", "home.html", 2);
    expect(caption()!.textContent).toBe("quieter · 1 of 3");
    // The agent stopped short: its word ends the round.
    expect(await tool(DONE_TOOL).run({})).toEqual({ done: true });
    await settle();
    expect(caption()).toBeNull();
    // A variant landing after the round is not counted into a new one.
    await finalizeCopy(handlers, "home", "home.html", 3);
    expect(caption()).toBeNull();
    // An in-place verb counts nothing: a variant landing while it builds
    // leaves it building.
    await pickVerb("home", "polish");
    await tool(PICK_TOOL).run({});
    await settle();
    await finalizeCopy(handlers, "home", "home.html", 4);
    expect(caption()!.textContent).toBe("polish · building");
    await tool(DONE_TOOL).run({});
  });

  test("impeccable_html over a variant's viewport exports the variant as it renders, its own sheet with the page's", async () => {
    const { project, source } = sourceProject();
    const page = source.payload.page;
    const { host } = variantHost();
    mounted = await mountPlugin({ entry: activate, manifest, project, host });
    const handlers = await createTestRequestHandlers(mounted);
    await vi.waitFor(() => expect(pageElementId(source.id, ".grid")).not.toBeNull());
    const opened = (await handlers.draftOpen({ copyOf: source.id })) as { draft: { id: string } };
    const draft = opened.draft.id;
    await handlers.draftReplace({ draft, target: ".header", html: '<header class="header loud">Loud</header>' });
    await handlers.draftAppend({ draft, css: ".loud { font-weight: 900 }" });
    await handlers.draftFinalize({ draft });
    const plan = (await handlers.draftFinalize({
      draft,
      variant: { file: variantFile(page, 1), base: BASE },
    })) as { epoch: number };
    const { id } = (await handlers.draftCommit({ draft, epoch: plan.epoch })) as { id: string };
    await vi.waitFor(() => expect(pageShadow(id)?.querySelector(".loud")).toBeTruthy());

    const exported = (await tool(HTML_TOOL).run({ viewport: id, element: ".loud" })) as {
      page: string;
      html: string;
      target: { selector: string };
    };
    expect(exported.page).toBe(page);
    expect(exported.html).toContain("Loud");
    expect(exported.html).toContain(".loud { font-weight: 900 }");
    expect(exported.target.selector).toBe(".loud");
    // The source's page is untouched, and exports as it was.
    const own = (await tool(HTML_TOOL).run({ viewport: source.id })) as { html: string };
    expect(own.html).not.toContain("Loud");
  });
});
