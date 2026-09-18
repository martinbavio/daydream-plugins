// The `style` attribute as a style map: verbatim declarations, the one
// grain the document holds (CLAUDE.md — every style value is verbatim
// CSS). Comments are removed and declarations split on semicolons
// OUTSIDE parentheses and quotes, so `background: url("a;b")` and
// `font-family: "x;y"` survive; the property is lower-cased (custom
// properties excepted — `--Foo` and `--foo` are different variables) and
// held to the renderer's property grammar, the value to its safety rule
// (`isSafeValue`: nothing that escapes its declaration), so a broken
// declaration is counted rather than stored as one nothing can emit; the
// value is kept as written, less an `!important` the format cannot hold
// (decision #38), which is counted — and which still wins over a
// later plain declaration of the same property, as it does in CSS.

export interface ParsedStyle {
  styles: Record<string, string>;
  /** `!important` flags stripped. */
  important: number;
  /** Property names of declarations the renderer would refuse — a bad
   * name, or a value that escapes its declaration — as written. */
  invalid: string[];
}

/** The renderer's two grammars, as `dd.core` hands them. */
export interface StyleRules {
  isPropertyName(name: string): boolean;
  isSafeValue(value: string): boolean;
}

export function parseStyleAttribute(
  value: string,
  rules: StyleRules,
): ParsedStyle {
  const styles: Record<string, string> = {};
  const held = new Set<string>();
  const invalid: string[] = [];
  let important = 0;
  for (const declaration of splitDeclarations(stripComments(value))) {
    const colon = declaration.indexOf(":");
    if (colon === -1) {
      invalid.push(declaration);
      continue;
    }
    const rawProperty = declaration.slice(0, colon).trim();
    const property = rawProperty.startsWith("--")
      ? rawProperty
      : rawProperty.toLowerCase();
    let text = declaration.slice(colon + 1).trim();
    if (property === "" || !rules.isPropertyName(property)) {
      invalid.push(rawProperty);
      continue;
    }
    if (text === "") continue;
    const flagged = /\s*!\s*important\s*$/i.exec(text);
    if (flagged !== null) {
      important += 1;
      text = text.slice(0, flagged.index).trim();
      if (text === "") continue;
    }
    if (!rules.isSafeValue(text)) {
      invalid.push(rawProperty);
      continue;
    }
    if (flagged !== null) held.add(property);
    else if (held.has(property)) continue;
    styles[property] = text;
  }
  return { styles, important, invalid };
}

/** `/* … *\/` removed wherever it is not inside a string. */
export function stripComments(value: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quote !== null) {
      out += char;
      if (char === "\\" && i + 1 < value.length) out += value[++i];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && value[i + 1] === "*") {
      const end = value.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** Top-level `;` splits; a `;` inside `(...)`, `"..."` or `'...'` does
 * not. A backslash escapes the next character inside a string. */
export function splitDeclarations(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quote !== null) {
      current += char;
      if (char === "\\" && i + 1 < value.length) current += value[++i];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** An SVG `width`/`height` attribute as a CSS length: a bare number is
 * user units, which are px on the page; anything else is already a
 * length or a percentage and goes through as written. */
export function cssLength(value: string): string {
  const trimmed = value.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)
    ? `${trimmed}px`
    : trimmed;
}

/** Whether the element's own `white-space` keeps its text as written. */
export function preservesWhitespace(
  styles: Readonly<Record<string, string>>,
): boolean {
  return /^(pre|pre-wrap|pre-line|break-spaces)$/.test(
    styles["white-space"]?.trim().toLowerCase() ?? "",
  );
}
