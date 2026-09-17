// The NECESSITY lint (docs/agent-css-knowledge-prd.md, "Lints"; decisions.md
// #43, #46, #48 P9): per declaration, remove it in-page, re-read, restore —
// and call it DEAD when nothing observable moved. "Observable" is the
// browser's own answer twice over: every measured element's border box and
// its computed style, both read from the live-strategy iframe core mounts
// (`dd.mountViewport`). No layout is reimplemented and no rule of thumb
// decides what a property "should" do: a declaration is live exactly when
// the page differs without it. Core owns the mount and its one sanctioned
// write (withoutDeclaration); this file owns the JUDGEMENT — which is why
// it lives in the css-author plugin and not in src/measure.
//
// What that catches is the "just in case" class of failure: explicit
// initial values, a custom property nothing reads, an invalid property the
// parser dropped, a layer whose condition no width can satisfy. What it
// deliberately does not judge: interaction-state properties (transition*,
// animation*) and `cursor`, exempt by the PRD's rule (nothing else).
//
// Motion is neutralised in the LINT document only (`still: true` on the
// mount): a `transition: all 200ms` would otherwise make every
// remove→read→restore (synchronous, so the computed value is still the
// start value) read dead for colours, paddings, gaps, radii.
//
// Three rules keep a CORRECT responsive document landable (the PRD's "dead
// means no change in any viewport of the document"; decision #38's layers
// as the other branch of a conditional):
//
// 1. PAIRED CHECK. A base declaration of P on an element that also sets P
//    in one or more conditional layers is judged by removing the base
//    TOGETHER with every layer declaration of P on that element — one
//    combined removal, one read, one restore — and is dead only if that
//    changes nothing. (Removed alone, a base a matching layer overrides
//    always reads dead, and the mobile branch of every responsive grid
//    would be reported.) Each layer declaration of P is still judged on its
//    own.
// 2. WIDTH SWEEP (#46). A page is not a photo: `minmax(0, 1fr)`, a
//    `flex-wrap`, a layer for a breakpoint the frame is not at, all change
//    nothing at THIS width and everything at another. So a declaration
//    that reads dead at the viewport's own frame is judged again with the
//    same window at a sweep of other widths — the fixed SWEEP_WIDTHS plus
//    every px breakpoint the viewport's own media conditions name, with
//    one px either side of each — and is dead only if it changes nothing
//    at every one of them. The frame is judged first and in full; the
//    probes re-judge only the survivors, so a clean document (the common
//    landing) never mounts a probe at all, and a live declaration costs
//    what it did. The finding names every width it was dead at. This
//    only ever ACQUITS: a declaration live at the frame is live, full
//    stop, and no probe reports a problem at a width the user never asked
//    for (the measure report stays at the document's own viewports, #43).
// 3. CROSS-VIEWPORT INTERSECTION. With several viewports, a declaration is
//    dead only if it is dead in EVERY viewport where a corresponding
//    element exists. Correspondence: the element's label when present and
//    unique within its viewport, else its tree path (child indexes from
//    the root) — plus property and layer. A finding names the element as
//    it appears in the first viewport it exists in. Each viewport keeps
//    its own mount lifecycle (mount, baseline, every check, dispose, then
//    the same per probe width); verdicts are collected per viewport and
//    intersected after.
//
// Cost model (a 40-element fixture lints in well under a second): one
// write set/read/undo per declaration, where the read walks every element
// and stops at the first difference — so LIVE declarations (the common
// case) exit early and only dead ones pay a full sweep, and only dead ones
// are carried into the probe mounts. Computed style is snapshotted as the
// FULL getComputedStyle enumeration minus custom properties (see
// snapshotProperties for why those are excluded).

import type {
  CoreApi,
  DaydreamApi,
  DreamDocument,
  DreamElement,
  DreamViewport,
  Finding,
  MountedViewport,
  StyleRule,
} from "@daydream/plugin-api";

import { hasStatePseudo } from "./statePseudo";

/** What the lint needs from the API object: the pure helpers and the
 * live mount. A gate hands in its `dd`; a test hands in a test kernel's. */
export type NecessityHost = Pick<DaydreamApi, "core" | "mountViewport">;

export interface NecessityOptions {
  /** Restrict to these viewports (unknown id → error). Default: all. */
  viewportIds?: string[];
}

/** The widths every viewport's dead-at-the-frame declarations are re-judged
 * at (rule 2), besides the breakpoints its own conditions name: a phone, a
 * tablet, a laptop and a wide desktop. A declaration that matters only in
 * a band between these, at a width no condition names, is the residual —
 * add a viewport there. */
export const SWEEP_WIDTHS: readonly number[] = [360, 768, 1280, 1920];

/** Properties the lint never checks — the PRD's exemption, exactly:
 * interaction-state properties (transition*, animation*; nothing for
 * :hover/:focus until state layers exist) and `cursor`. Nothing else.
 * Transitions and animations could never read live anyway: the lint
 * document neutralises motion (the mount's `still`) so every other read
 * is the resting value. Prefix matches cover the longhands and vendor
 * prefixes (`transition-delay`, `-webkit-animation`). */
const EXEMPT_PREFIX = /^(?:-[a-z]+-)?(?:transition|animation)/i;

export function isExemptProperty(property: string): boolean {
  const name = property.trim().toLowerCase();
  if (EXEMPT_PREFIX.test(name)) return true;
  return name.replace(/^-[a-z]+-/, "") === "cursor";
}

/**
 * Every dead declaration of the document, as findings — dead at every
 * swept width (rule 2) in every viewport where the element exists (rule
 * 3). Each viewport is mounted once at its frame (one iframe), baselined,
 * then every declaration of every element — base map, then each stored
 * conditional layer — is removed, read against the baseline, and
 * restored, in tree order; the survivors are then re-judged at each probe
 * width in a fresh mount. Every iframe is disposed, a thrown read included.
 */
export async function necessityLint(
  dd: NecessityHost,
  doc: DreamDocument,
  options: NecessityOptions = {},
): Promise<Finding[]> {
  const perViewport: ViewportVerdicts[] = [];
  for (const vp of selectViewports(dd.core, doc, options.viewportIds)) {
    perViewport.push(await lintViewport(dd, vp));
  }
  return [
    ...intersect(perViewport.map((v) => v.elements)),
    ...intersectRules(perViewport.map((v) => v.rules)),
  ];
}

/** The document's viewports, or the named subset in document order. An
 * unknown id is an error, not a silent skip — the same rule as core's
 * measure (a caller asking about a viewport that does not exist should
 * hear so). */
function selectViewports(
  core: CoreApi,
  doc: DreamDocument,
  viewportIds: string[] | undefined,
): DreamViewport[] {
  const viewports = core.viewportItems(doc) as DreamViewport[];
  if (viewportIds === undefined) return viewports;
  const wanted = new Set(viewportIds);
  const known = new Set(viewports.map((vp) => vp.id));
  const unknown = viewportIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`No such viewport: ${unknown.join(", ")}`);
  }
  return viewports.filter((vp) => wanted.has(vp.id));
}

/** One declaration's fate in one viewport, with the finding it would be
 * (named as the element appears there) and the key that pairs it with the
 * same declaration in the other viewports. */
interface Verdict {
  /** Correspondence: `label:<label>` when the label is unique within the
   * viewport, else `path:<child indexes from the root>`. */
  element: string;
  property: string;
  layer: string | undefined;
  dead: boolean;
  finding: Finding;
}

/** A declaration as the probe mounts re-judge it: where it is removed from
 * (`at`, the paired set of rule 1) and what its finding would say. */
interface Candidate {
  verdict: Verdict;
  el: DreamElement;
  value: string;
  at: (string | undefined)[];
}

/** A rule declaration's fate (decisions.md #71, plan phase 9): the
 * correspondence key pairs it with the same declaration in another
 * viewport by selector and conditions text, never by index — an index is
 * only a position in ONE viewport's sheet. */
interface RuleVerdict {
  key: string;
  property: string;
  dead: boolean;
  finding: Finding;
}

/** Where a declaration is removed from — an element's base map or one
 * layer (the existing shape `isDead` already takes), or a rule of the
 * viewport's `sheet` by its stored index (the phase-9 kernel seam,
 * `MountedViewport.withoutDeclaration({ rule }, property)`). */
type RemovalTarget = { elementId: string; layer?: string } | { rule: number };

/** A rule declaration as the probe mounts re-judge it: `targets` is the
 * PAIRED removal set (rule 1's own trick, extended to rules) — the rule's
 * declaration together with every element it matches that shadows the
 * same property inline, removed TOGETHER so the rule reads dead only when
 * NOTHING relies on the property regardless of source. A rule dead only
 * because its matched elements shadow it inline is the redundancy
 * finding's story, not this one's (matchLint.ts). */
interface RuleCandidate {
  verdict: RuleVerdict;
  rule: StyleRule;
  index: number;
  value: string;
  targets: RemovalTarget[];
}

/** Every viewport's element and rule verdicts, kept apart: each has its
 * own correspondence key and its own cross-viewport intersection. */
interface ViewportVerdicts {
  elements: Verdict[];
  rules: RuleVerdict[];
}

/** One element's observation: its border box (to 0.01px) and its computed
 * style, as one comparable string. */
type Observation = string;

interface Probe {
  /** Every `[data-dream-id]` node of the page, in tree order. */
  nodes: Element[];
  /** The computed-style property names the snapshot reads, fixed once. */
  properties: string[];
  baseline: Observation[];
}

/** The viewport at its frame, every declaration judged; then the sweep
 * (rule 2) over whatever read dead, each probe width a fresh mount of the
 * same window at that width. A finding that survives names every width. */
async function lintViewport(
  dd: NecessityHost,
  vp: DreamViewport,
): Promise<ViewportVerdicts> {
  // The width the page was rendered at is the mount's to say (a viewport
  // with no frame renders at the measurer's default), so it is read back
  // rather than guessed here. Element and rule candidates share ONE mount
  // per width — the same baseline serves both judgements, so a document
  // with a sheet costs no more mounts than one without.
  const { own, elementCandidates, ruleCandidates } = await withMount(
    dd,
    vp,
    undefined,
    (mounted) => {
      const own = mounted.read().frame.width;
      return {
        own,
        elementCandidates: judgeAll(dd.core, vp, mounted, own),
        ruleCandidates: judgeRules(dd.core, vp, mounted, own),
      };
    },
  );
  let pendingEl = elementCandidates.filter((c) => c.verdict.dead);
  let pendingRule = ruleCandidates.filter((c) => c.verdict.dead);
  const swept = [own];
  for (const width of probeWidths(dd.core, vp, own)) {
    if (pendingEl.length === 0 && pendingRule.length === 0) break;
    await withMount(dd, vp, width, (mounted) => {
      const probe = baseline(mounted);
      for (const c of pendingEl) {
        c.verdict.dead = isDead(
          probe,
          mounted,
          c.el.id,
          c.verdict.property,
          c.at,
        );
      }
      for (const c of pendingRule) {
        c.verdict.dead = isDeadAt(probe, mounted, c.verdict.property, c.targets);
      }
    });
    swept.push(width);
    pendingEl = pendingEl.filter((c) => c.verdict.dead);
    pendingRule = pendingRule.filter((c) => c.verdict.dead);
  }
  for (const c of pendingEl) {
    c.verdict.finding = finding(
      c.el,
      c.verdict.property,
      c.value,
      c.verdict.layer,
      swept,
    );
  }
  for (const c of pendingRule) {
    c.verdict.finding = ruleFinding(vp, c.rule, c.index, c.verdict.property, c.value, swept);
  }
  return {
    elements: elementCandidates.map((c) => c.verdict),
    rules: ruleCandidates.map((c) => c.verdict),
  };
}

/** Mount (motion pinned off), run, dispose — the one lifecycle every mount
 * of the lint follows, a thrown read included. `width` undefined is the
 * frame's own; a number is the same window at that width (rule 2). */
async function withMount<T>(
  dd: NecessityHost,
  vp: DreamViewport,
  width: number | undefined,
  run: (mounted: MountedViewport) => T,
): Promise<T> {
  const mounted = await dd.mountViewport(vp, {
    still: true,
    ...(width === undefined ? {} : { width }),
  });
  try {
    return run(mounted);
  } finally {
    mounted.dispose();
  }
}

/**
 * The widths rule 2 sweeps for a viewport rendered at `own`, ascending,
 * without `own` itself: SWEEP_WIDTHS plus one px either side of every px
 * breakpoint its media conditions name (`(width >= 900px)` flips between
 * 899 and 900, `(width > 900px)` between 900 and 901, so all three are
 * probed). Container conditions name a container's width, not the
 * window's, and contribute nothing; em/rem breakpoints convert at the
 * initial font size; a unit the evaluator still cannot place is covered
 * only where a fixed sweep width happens to land on its side.
 */
export function probeWidths(
  core: CoreApi,
  vp: DreamViewport,
  own: number,
): number[] {
  const widths = new Set<number>(SWEEP_WIDTHS);
  for (const breakpoint of mediaBreakpoints(core, vp.payload.root)) {
    widths.add(breakpoint - 1);
    widths.add(breakpoint);
    widths.add(breakpoint + 1);
  }
  widths.delete(own);
  return Array.from(widths)
    .filter((width) => width >= 1)
    .sort((a, b) => a - b);
}

/** Every px-axis length a storable media prelude in the tree names. */
function mediaBreakpoints(core: CoreApi, root: DreamElement): number[] {
  const out: number[] = [];
  const visit = (el: DreamElement): void => {
    for (const layer of el.conditionals ?? []) {
      if (core.conditionKind(layer.condition) !== "media") continue;
      if (core.conditionPreludeProblem(layer.condition) !== null) continue;
      for (const px of core.mediaPreludePxValues(layer.condition)) {
        out.push(px);
      }
    }
    el.children.forEach(visit);
  };
  visit(root);
  return out;
}

/** Every checked declaration of the viewport judged once at the mounted
 * width, in tree order. The finding each carries is provisional — named
 * for the frame alone — and is rewritten with the swept widths for the
 * ones that stay dead. */
function judgeAll(
  core: CoreApi,
  vp: DreamViewport,
  mounted: MountedViewport,
  own: number,
): Candidate[] {
  const probe = baseline(mounted);
  const labels = labelCounts(vp.payload.root);
  const candidates: Candidate[] = [];
  const visit = (el: DreamElement, path: string): void => {
    const element =
      el.label !== undefined && labels.get(el.label) === 1
        ? `label:${el.label}`
        : `path:${path}`;
    const layers = (el.conditionals ?? []).filter(
      // A prelude the sheet refused emitted no block (core's html.ts), so
      // there is nothing to remove; the static tier owns that report. A
      // STATE layer (`&:hover`, decisions.md #53) is never judged: on a
      // page nobody hovers or focuses, every one of its declarations
      // changes nothing, and that is not a finding.
      (layer) =>
        core.conditionPreludeProblem(layer.condition) === null &&
        core.conditionKind(layer.condition) !== "state",
    );
    const record = (
      property: string,
      value: string,
      layer: string | undefined,
      at: (string | undefined)[],
    ): void => {
      candidates.push({
        verdict: {
          element,
          property,
          layer,
          dead: isDead(probe, mounted, el.id, property, at),
          finding: finding(el, property, value, layer, [own]),
        },
        el,
        value,
        at,
      });
    };
    for (const [property, value] of Object.entries(el.styles)) {
      if (!isChecked(core, property, value)) continue;
      // Rule 1: the base goes together with every layer restating it.
      const paired = layers
        .filter((layer) => property in layer.styles)
        .map((layer) => layer.condition);
      record(property, value, undefined, [undefined, ...paired]);
    }
    for (const layer of layers) {
      for (const [property, value] of Object.entries(layer.styles)) {
        if (!isChecked(core, property, value)) continue;
        record(property, value, layer.condition, [layer.condition]);
      }
    }
    el.children.forEach((child, index) =>
      visit(child, path === "" ? String(index) : `${path}/${index}`),
    );
  };
  visit(vp.payload.root, "");
  return candidates;
}

/**
 * Every checked declaration of the viewport's `sheet`, rule 1's paired
 * check extended to rules (decisions.md #71, plan phase 9): a rule's
 * declaration goes together with every element it matches that ALSO
 * carries its own inline (base-map) declaration of the same property,
 * removed in one combined set — so a rule reads dead only when nothing
 * relies on the property AT ALL, never merely because its matched
 * elements happen to restate it (that shape is matchLint.ts's redundancy
 * finding). A rule under a state pseudo-class is skipped outright — in a
 * rule `:hover` belongs to the selector, and nobody hovers a lint run
 * (statePseudo.ts) — as is one whose own `@media` condition is not active
 * at the viewport's frame: the generated sheet never emits an inactive
 * group's rule at all (decisions.md #71), so there is nothing here to
 * remove yet: `isDeadAt` skips a width it cannot reach anyway.
 */
function judgeRules(
  core: CoreApi,
  vp: DreamViewport,
  mounted: MountedViewport,
  own: number,
): RuleCandidate[] {
  const probe = baseline(mounted);
  const sheet = vp.payload.sheet ?? [];
  const byId = elementsById(vp.payload.root);
  const candidates: RuleCandidate[] = [];
  sheet.forEach((rule, index) => {
    if (hasStatePseudo(rule.selector)) return;
    if (!ruleActiveAtOwnFrame(core, vp, rule)) return;
    // The live strategy scopes nothing (decisions.md #71): the mounted
    // iframe is its own unnamespaced document, so the stored selector is
    // asked of it verbatim — no kernel rewrite needed, unlike matchLint.ts's
    // canvas reads.
    const matched = mountedRuleMatches(mounted, rule.selector);
    const key = `${rule.selector} ${(rule.conditions ?? []).join(" ")}`;
    for (const [property, value] of Object.entries(rule.styles)) {
      if (!isChecked(core, property, value)) continue;
      const targets: RemovalTarget[] = [{ rule: index }];
      for (const elementId of matched) {
        const el = byId.get(elementId);
        if (el !== undefined && property in el.styles) {
          targets.push({ elementId });
        }
      }
      candidates.push({
        verdict: {
          key,
          property,
          dead: isDeadAt(probe, mounted, property, targets),
          finding: ruleFinding(vp, rule, index, property, value, [own]),
        },
        rule,
        index,
        value,
        targets,
      });
    }
  });
  return candidates;
}

/** Whether a rule's OWN `@media` condition holds at the viewport's frame
 * — the same evaluator the kernel's match cache runs
 * (src/canvas/ruleMatch.ts ruleIsActive), rebuilt here from `dd.core`'s
 * public pieces since a plugin has no import of the kernel's internals.
 * `@container`/`@supports` conditions are left in (the browser decides
 * those when it renders the generated sheet); only a DEFINITE `false`
 * excludes — "unknown" (no frame to evaluate against) is left checkable. */
function ruleActiveAtOwnFrame(
  core: CoreApi,
  vp: DreamViewport,
  rule: StyleRule,
): boolean {
  const conditions = rule.conditions ?? [];
  if (conditions.length === 0) return true;
  const env = core.viewportMediaEnvironment(vp);
  for (const condition of conditions) {
    if (core.conditionKind(condition) !== "media") continue;
    const result = env === null ? "unknown" : core.evaluateMediaCondition(condition, env);
    if (result === false) return false;
  }
  return true;
}

/** Which of the mounted page's elements a selector matches, by id — the
 * live strategy's unscoped DOM asked directly (see judgeRules), never
 * `dd.ruleMatches` (that reads the CANVAS's own rendered document, a
 * different DOM than the one `dd.mountViewport` renders off-screen here).
 * A selector list is asked whole, as `Element.matches` already handles
 * one; a pseudo-element member throws on `matches` in most engines and is
 * caught as no match — there is no inline declaration on an element for a
 * pseudo-element's box to shadow anyway. */
function mountedRuleMatches(
  mounted: MountedViewport,
  selector: string,
): string[] {
  const out: string[] = [];
  for (const node of Array.from(
    mounted.document().querySelectorAll("[data-dream-id]"),
  )) {
    let ok: boolean;
    try {
      ok = node.matches(selector);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    const id = (node as HTMLElement).dataset["dreamId"];
    if (id !== undefined) out.push(id);
  }
  return out;
}

/** Every element of the viewport keyed by its stored id — the document's
 * own tree, never the mounted page's, since we need each element's
 * inline declarations (the paired check), not its geometry. */
function elementsById(root: DreamElement): Map<string, DreamElement> {
  const map = new Map<string, DreamElement>();
  const visit = (el: DreamElement): void => {
    map.set(el.id, el);
    el.children.forEach(visit);
  };
  visit(root);
  return map;
}

/** How many elements of the viewport carry each label: a label is an
 * address only when one element answers to it. */
function labelCounts(root: DreamElement): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (el: DreamElement): void => {
    if (el.label !== undefined) {
      counts.set(el.label, (counts.get(el.label) ?? 0) + 1);
    }
    el.children.forEach(visit);
  };
  visit(root);
  return counts;
}

/** Rule 3: dead only where dead everywhere the declaration exists. Order
 * is first appearance — the first viewport's tree order, then whatever
 * later viewports add — and the finding is the first viewport's. */
function intersect(perViewport: Verdict[][]): Finding[] {
  const merged = new Map<string, { dead: boolean; finding: Finding }>();
  for (const verdicts of perViewport) {
    for (const verdict of verdicts) {
      const key = `${verdict.element}\u0000${verdict.property}\u0000${verdict.layer ?? ""}`;
      const seen = merged.get(key);
      if (seen === undefined) {
        merged.set(key, { dead: verdict.dead, finding: verdict.finding });
      } else {
        seen.dead = seen.dead && verdict.dead;
      }
    }
  }
  const out: Finding[] = [];
  for (const entry of merged.values()) if (entry.dead) out.push(entry.finding);
  return out;
}

/** The same cross-viewport intersection as `intersect`, keyed on a rule's
 * selector and conditions text instead of an element's label/path
 * (decisions.md #71, plan phase 9): a rule's stored INDEX is only a
 * position in one viewport's own sheet, never a correspondence a second
 * viewport could share. */
function intersectRules(perViewport: RuleVerdict[][]): Finding[] {
  const merged = new Map<string, { dead: boolean; finding: Finding }>();
  for (const verdicts of perViewport) {
    for (const verdict of verdicts) {
      const key = `${verdict.key} ${verdict.property}`;
      const seen = merged.get(key);
      if (seen === undefined) {
        merged.set(key, { dead: verdict.dead, finding: verdict.finding });
      } else {
        seen.dead = seen.dead && verdict.dead;
      }
    }
  }
  const out: Finding[] = [];
  for (const entry of merged.values()) if (entry.dead) out.push(entry.finding);
  return out;
}

/** A declaration the page actually received: real property name, safe
 * value (core drops the rest before emission — nothing to remove), and
 * not exempt. */
function isChecked(core: CoreApi, property: string, value: string): boolean {
  if (!core.isPropertyName(property)) return false;
  if (!core.isSafeValue(value)) return false;
  return !isExemptProperty(property);
}

/** Remove, read, restore — one write set, one read, one restore. `at` is
 * where the property is removed from: `undefined` for the base map, a
 * prelude for that layer's rule; several entries are the paired check
 * (rule 1), removed together and restored in reverse. The read is a single
 * sweep that stops at the first element whose observation left the
 * baseline. */
function isDead(
  probe: Probe,
  mounted: MountedViewport,
  elementId: string,
  property: string,
  at: (string | undefined)[],
): boolean {
  const restores: (() => void)[] = [];
  try {
    for (const layer of at) {
      restores.push(mounted.withoutDeclaration(elementId, property, layer));
    }
    return unchanged(probe);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

/** One removal, addressed at either shape `withoutDeclaration` takes
 * (the phase-9 kernel seam): an element's own declaration, or a rule of
 * the sheet by its stored index. */
function withoutAt(mounted: MountedViewport, target: RemovalTarget, property: string): () => void {
  return "rule" in target
    ? mounted.withoutDeclaration({ rule: target.rule }, property)
    : mounted.withoutDeclaration(target.elementId, property, target.layer);
}

/** The general form of `isDead`, for a rule's paired removal set (targets
 * spanning a rule address and any number of matched elements' inline
 * declarations, judgeRules's `at`). A removal that THROWS — the rule's own
 * `@media` condition inactive at THIS width, so the generated sheet never
 * marked it here at all (decisions.md #71) — is not evidence either way:
 * the declaration is left ALIVE for this width rather than risk a false
 * dead verdict the sweep cannot actually support here. */
function isDeadAt(
  probe: Probe,
  mounted: MountedViewport,
  property: string,
  targets: RemovalTarget[],
): boolean {
  const restores: (() => void)[] = [];
  try {
    for (const target of targets) {
      restores.push(withoutAt(mounted, target, property));
    }
  } catch {
    for (const restore of restores.reverse()) restore();
    return false;
  }
  try {
    return unchanged(probe);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

/** The finding's sentence names every width the declaration was dead at,
 * ascending — the fact is "changes nothing at any of these", never
 * "changes nothing". */
function finding(
  el: DreamElement,
  property: string,
  value: string,
  layer: string | undefined,
  widths: number[],
): Finding {
  const where = layer === undefined ? "in base" : `in ${layer.trim()}`;
  const out: Finding = {
    tier: "necessity",
    severity: "blocking",
    elementId: el.id,
    property,
    message: `${property}: ${value} on ${nameOf(el)} changes nothing (${where}) at ${widthsText(widths)}`,
  };
  if (layer !== undefined) out.layer = layer;
  return out;
}

/** A rule declaration's finding: `Finding.rule` names `sheet[i]` — a rule
 * finding carries no element coordinates of its own, and its viewport
 * only appears in the message, the same way the dead-rule finding names
 * it (matchLint.ts). */
function ruleFinding(
  vp: DreamViewport,
  rule: StyleRule,
  index: number,
  property: string,
  value: string,
  widths: number[],
): Finding {
  return {
    tier: "necessity",
    severity: "blocking",
    rule: index,
    property,
    message: `${property}: ${value} in rule ${rule.selector} (sheet[${index}]) of viewport ${vp.id} changes nothing at ${widthsText(widths)}`,
  };
}

/** `360, 400, 768, 1280 or 1920px`; one width is `400px`. */
export function widthsText(widths: readonly number[]): string {
  const sorted = Array.from(new Set(widths)).sort((a, b) => a - b);
  if (sorted.length === 1) return `${sorted[0]}px`;
  const head = sorted.slice(0, -1).join(", ");
  return `${head} or ${sorted[sorted.length - 1]}px`;
}

/** The same convention as the static lint (staticLint.ts): the label when
 * the author gave one, else `tag#id`. */
function nameOf(el: DreamElement): string {
  return el.label ?? `${el.tag}#${el.id}`;
}

/**
 * The page as it stands, before any removal. The node list and the
 * property list are fixed here: removals never add or drop elements, and
 * the set of standard longhands the engine enumerates is the same for every
 * element, so both are read once.
 */
function baseline(mounted: MountedViewport): Probe {
  const nodes = Array.from(
    mounted.document().querySelectorAll("[data-dream-id]"),
  );
  const first = nodes[0];
  const properties =
    first === undefined ? [] : snapshotProperties(computedStyleOf(first));
  return {
    nodes,
    properties,
    baseline: nodes.map((node) => observe(node, properties)),
  };
}

function unchanged(probe: Probe): boolean {
  for (let i = 0; i < probe.nodes.length; i++) {
    if (
      observe(probe.nodes[i] as Element, probe.properties) !== probe.baseline[i]
    ) {
      return false;
    }
  }
  return true;
}

/** Border box to 0.01px plus every snapshotted computed value, joined. */
function observe(node: Element, properties: string[]): Observation {
  const rect = node.getBoundingClientRect();
  const style = computedStyleOf(node);
  let out = `${hundredths(rect.left)},${hundredths(rect.top)},${hundredths(rect.width)},${hundredths(rect.height)}`;
  for (const property of properties) {
    out += `|${style.getPropertyValue(property)}`;
  }
  return out;
}

function hundredths(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The property names one observation reads: the engine's full computed
 * style enumeration MINUS custom properties. A custom property's own
 * computed value on its element vanishes the moment it is removed, so
 * including it would make every `--x` live by definition; excluded, `--x`
 * is live exactly when some `var(--x)` resolved differently without it —
 * which is what "an unread custom property is dead" means. (The decision
 * #42 probes, `--dream-match-N`, drop out the same way.)
 */
function snapshotProperties(style: CSSStyleDeclaration): string[] {
  return Array.from(style).filter((name) => !name.startsWith("--"));
}

/** The iframe's own getComputedStyle: the node lives in the frame's realm,
 * and its window is the honest handle (the parent's answers too — same
 * origin — but this never depends on it). */
function computedStyleOf(node: Element): CSSStyleDeclaration {
  const view = node.ownerDocument.defaultView ?? window;
  return view.getComputedStyle(node);
}
