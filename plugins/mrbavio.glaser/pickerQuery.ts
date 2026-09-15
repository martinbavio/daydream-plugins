// The picker's line, read without the DOM (so a node test can): what is
// typed and which verbs it names.

export interface PickerEntry {
  id: string;
  title: string;
}

/** What is typed, read the way Impeccable's own command line reads
 * `$impeccable bolder <free text>`: the FIRST WORD names the verb, the
 * rest is the brief. `head` is empty when nothing is typed. */
export function parseQuery(query: string): { head: string; brief: string } {
  const trimmed = query.trimStart();
  const space = trimmed.search(/\s/);
  if (space === -1) return { head: trimmed, brief: "" };
  return { head: trimmed.slice(0, space), brief: trimmed.slice(space).trim() };
}

/** The verbs matching the query's first word (a substring of the id or
 * the title, case-insensitively); an empty word matches all. Once a word
 * matches an entry exactly, the list is that entry alone — the rest of
 * the line is the brief, not a filter. */
export function matchEntries(entries: readonly PickerEntry[], query: string): PickerEntry[] {
  const { head } = parseQuery(query);
  const word = head.toLowerCase();
  if (word === "") return [...entries];
  const exact = entries.find((e) => e.id.toLowerCase() === word);
  if (exact !== undefined) return [exact];
  return entries.filter((e) => `${e.id} ${e.title}`.toLowerCase().includes(word));
}

