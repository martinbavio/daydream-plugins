// What a paste lost (decision #56). The report is the INSTRUMENT for
// the steps after this one — each judged by pasting the same fragments
// and watching these counts fall. The selectors step (decision #71)
// was measured by it: `class`, `id` and the `<style>` block left these
// buckets, and the at-rules a sheet still loses (`@import`, `@keyframes`,
// `@layer`, `@property`) took their place under `dropped`, by name, so
// the next step is measured by the same instrument. Names, never just
// totals: a later step wants to know it was `table` and `@layer`, not
// "three things".

export interface PasteReport {
  /** Elements whose tag the kernel cannot hold, kept as `span` or `div`:
   * source tag → count. */
  downgraded: Record<string, number>;
  /** What was removed with its content, by name → count: an element's
   * tag; a stylesheet's at-rule by keyword (`@import`, `@keyframes`,
   * `@layer`, a `@font-face` that would not load, a condition the format
   * refuses); `rule` for a style rule whose selector the
   * parser or the format refused; everything past the depth cap, under
   * `deeper than <n>`. */
  dropped: Record<string, number>;
  /** Attributes removed: name → count. `style` never appears whole — it
   * is parsed into the element's styles — but a declaration the renderer
   * would refuse, inline or in a rule, counts as `style (<property>)`,
   * and a `@font-face` descriptor the format does not hold as
   * `@font-face (<descriptor>)`. */
  stripped: Record<string, number>;
  /** `!important` flags removed from declarations, inline and in rules:
   * the format has no importance (decision #38, #71). */
  important: number;
  /** Image sources the `img` could not keep, by reason (`relative`,
   * `http:`, `data:` when vendoring failed, another scheme) → count. The
   * element stays, with its `alt`. */
  images: Record<string, number>;
}

export function emptyReport(): PasteReport {
  return {
    downgraded: {},
    dropped: {},
    stripped: {},
    important: 0,
    images: {},
  };
}

/** Add `by` under `key`. Own properties only: a key named `constructor`
 * or `__proto__` — a pasted `<constructor>` tag is a real thing — must
 * neither read the prototype's nor write to it. */
export function count(
  bucket: Record<string, number>,
  key: string,
  by = 1,
): void {
  const value = (Object.hasOwn(bucket, key) ? bucket[key]! : 0) + by;
  Object.defineProperty(bucket, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** One line for the console: what landed and what was lost, by name. */
export function describeReport(report: PasteReport, elements: number): string {
  const parts: string[] = [];
  const bucket = (name: string, entries: Record<string, number>) => {
    const listed = Object.entries(entries)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([key, n]) => `${key}×${n}`);
    if (listed.length > 0) parts.push(`${name} ${listed.join(", ")}`);
  };
  bucket("downgraded", report.downgraded);
  bucket("dropped", report.dropped);
  bucket("stripped", report.stripped);
  if (report.important > 0) parts.push(`${report.important} !important`);
  bucket("image src dropped", report.images);
  const landed = `landed ${elements} element${elements === 1 ? "" : "s"}`;
  return parts.length === 0
    ? `${landed}, nothing lost`
    : `${landed}; ${parts.join("; ")}`;
}
