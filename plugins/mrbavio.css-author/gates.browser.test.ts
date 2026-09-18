// The plugin's browser part through the API (decision #48 P9): the
// two gates it registers, each finding at the severity the plugin
// declares — blocking — and each judging on its own: what the two say of
// ONE declaration is the runner's to fold (src/ai/gates.ts dropCovered,
// tested in src/ai/gates.test.ts). Real Chromium: the necessity gate
// mounts the page.
import { afterAll, describe, expect, test } from "vitest";

import type {
  DreamDocument,
  Finding,
  GateRegistration,
  PluginManifest,
} from "@daydream/plugin-api";
import {
  createTestKernel,
  documentFrom,
  fixtureDocument,
  fixtureRoot,
  flush,
} from "@daydream/plugin-testing";

import activate, { NECESSITY_GATE, STATIC_GATE } from "./index";

/** What the real manifest declares of gates (the manifests test pins the
 * file itself; a JSON import needs a compiler flag the plugins do not
 * assume). */
const manifest: PluginManifest = {
  id: "mrbavio.css-author",
  name: "CSS author",
  version: "0.1.0",
  minCore: "0.1.0",
  contributes: { gates: [STATIC_GATE, NECESSITY_GATE] },
};

const kernel = createTestKernel({ manifest });
afterAll(() => kernel.dispose());

function gates(): Map<string, GateRegistration> {
  return new Map(
    kernel.registry.gates.entries().map((e) => [e.value.id, e.value]),
  );
}

async function judge(id: string, doc: DreamDocument): Promise<Finding[]> {
  const gate = gates().get(id);
  if (gate === undefined) throw new Error(`no gate ${id}`);
  return gate.run(doc, { measure: kernel.dd.measure });
}

describe("css-author gates", () => {
  test("activation registers the two declared gates, static first", () => {
    activate(kernel.dd);
    flush(); // the registry is a signal; a registration lands on the next flush
    expect(
      kernel.registry.gates.entries().map((e) => [e.pluginId, e.value.id]),
    ).toEqual([
      ["mrbavio.css-author", STATIC_GATE],
      ["mrbavio.css-author", NECESSITY_GATE],
    ]);
  });

  test("a clean document passes both", async () => {
    const doc = fixtureDocument();
    expect(await judge(STATIC_GATE, doc)).toEqual([]);
    expect(await judge(NECESSITY_GATE, doc)).toEqual([]);
  });

  test("every finding is blocking, tier-named, addressed to an element; the necessity gate reports a dropped declaration too — the runner, not the gate, keeps it to one line", async () => {
    const doc = fixtureDocument();
    const grid = fixtureRoot(doc).children[0]!.children[0]!;
    grid.styles["width"] = "100"; // static rule 2 — and dead in the page
    grid.styles["position"] = "static"; // static rule 3 — and dead
    grid.children[0]!.styles["float"] = "none"; // static rule 3
    grid.children[1]!.styles["--unused"] = "1px"; // dead, nothing static

    const statics = await judge(STATIC_GATE, doc);
    expect(statics.map((f) => [f.tier, f.severity, f.property])).toEqual([
      ["static", "blocking", "width"],
      ["static", "blocking", "position"],
      ["static", "blocking", "float"],
    ]);
    for (const finding of statics) expect(finding.elementId).toBeDefined();

    const necessity = await judge(NECESSITY_GATE, doc);
    // A declaration the parser dropped (width) or that restates the
    // initial value (position, float) changes nothing without it, so the
    // necessity gate names it as well as the static gate does: the gate
    // knows nothing of the other, and the runner drops the symptom once it
    // knows both findings' effective severity. The unread custom property
    // is the necessity gate's alone.
    expect(necessity.map((f) => [f.tier, f.severity, f.property])).toEqual([
      ["necessity", "blocking", "width"],
      ["necessity", "blocking", "position"],
      ["necessity", "blocking", "float"],
      ["necessity", "blocking", "--unused"],
    ]);
    for (const finding of necessity) expect(finding.elementId).toBeDefined();
    expect(necessity.at(-1)!.message).toMatch(
      /^--unused: 1px on Aside changes nothing \(in base\) at /,
    );
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  // The eval regression (2026-09-17 raw eval jsonl): the static gate,
  // through the real registration `activate` installed above, judging a
  // document straight from `documentFrom` — never loaded into the app
  // store, never rendered on the canvas, exactly how `src/ai/requests.ts`
  // hands a gate an incoming ingest/replace_viewport document. A `.card`
  // rule whose element is plainly in the tree must not be refused as
  // dead just because nothing was ever on the canvas to read a match
  // fact from (matchLint.ts's header).
  test("the static gate does not refuse a landing whose sheet rules match elements that were never on the canvas", async () => {
    const result = documentFrom({
      version: 6,
      items: [
        {
          kind: "daydream.viewport",
          frame: { width: 960, height: 600 },
          payload: {
            root: {
              tag: "html",
              children: [
                {
                  tag: "body",
                  children: [{ tag: "div", attrs: { class: "card" } }],
                },
              ],
            },
            sheet: [{ selector: ".card", styles: { color: "red" } }],
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    expect(await judge(STATIC_GATE, result.doc)).toEqual([]);
  });
});
