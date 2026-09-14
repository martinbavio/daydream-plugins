/** A corpus file's body: the text after its frontmatter fence, or the
 * whole text when it has none. The same split the knowledge loader makes
 * (Daydream's tools/knowledge/load.ts), for the one file this plugin
 * reads itself. */
export function bodyOf(text: string): string {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text.trim();
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return text.trim();
  return lines
    .slice(end + 1)
    .join("\n")
    .trim();
}
