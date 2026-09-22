// WHAT A SAVE REFUSES (decision #76). A page stores what its author
// wrote, and the renderer makes it safe — except for what cannot be made
// safe at render time, which never reaches storage: a landing strips it
// and says what went. The editor is a door too, but one a person is
// typing through, so it REFUSES instead of stripping: nothing is written,
// the sentence says what is in the way, and the text stays as typed.
//
// The rule is the kernel's (its src/core/unsafeHtml.ts), read here from
// the browser's parse of the text: the four executing tags, the
// executing attributes, a meta `http-equiv`, and a URL the page would
// reach outside its bundle through. A plugin never imports the kernel's
// source, so this is a copy of that rule, kept to the same cases.

import { parsePage } from "./pageSource";

/** Removed with their subtrees: each executes in the app's origin, and
 * `base` rewrites where every relative URL of the page resolves. */
const REMOVED_TAGS: ReadonlySet<string> = new Set([
  "script",
  "embed",
  "object",
  "base",
]);

/** Attributes whose value is a URL the page reaches through. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "src",
  "href",
  "srcset",
  "poster",
  "data",
  "ping",
  "action",
  "formaction",
  "cite",
]);

/** The elements whose `href` only navigates, which a link may point
 * beyond the bundle (`http:`, `mailto:`) with. */
const NAVIGATING: ReadonlySet<string> = new Set(["a", "area"]);

const NOTHING_SAVED = "nothing was saved";

/** Why `html` cannot be saved as a page's markup, as a sentence, or null
 * when it can. */
export function markupProblem(html: string): string | null {
  const parsed = parsePage(html);
  for (const el of elementsOf(parsed)) {
    const tag = el.localName.toLowerCase();
    if (REMOVED_TAGS.has(tag)) {
      return `A page can't hold <${tag}>: ${NOTHING_SAVED}.`;
    }
    for (const name of el.getAttributeNames()) {
      const lower = name.toLowerCase();
      if (
        lower.startsWith("on") ||
        lower.startsWith("data-dream-") ||
        lower === "srcdoc" ||
        (tag === "meta" && lower === "http-equiv")
      ) {
        return `A page can't hold the "${lower}" attribute: ${NOTHING_SAVED}.`;
      }
      const value = el.getAttribute(name) ?? "";
      if (
        URL_ATTRIBUTES.has(lower) &&
        !storableUrlAttribute(lower, value, tag)
      ) {
        return `A page can't reach "${value.trim()}" through "${lower}": use https:, a path under assets/, or a #fragment — ${NOTHING_SAVED}.`;
      }
    }
  }
  return null;
}

/** Every element of a parse, template contents included, the root first. */
function elementsOf(parsed: Document): Element[] {
  const out: Element[] = [];
  const visit = (scope: ParentNode): void => {
    for (const el of Array.from(scope.children)) {
      out.push(el);
      visit(el instanceof HTMLTemplateElement ? el.content : el);
    }
  };
  visit(parsed);
  return out;
}

function storableUrlAttribute(
  name: string,
  value: string,
  tag: string,
): boolean {
  if (name === "srcset") {
    return value
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
      .every((url) => url === "" || storableUrl(url));
  }
  if (name === "href" && NAVIGATING.has(tag)) {
    const url = value.replace(/[\u0000-\u0020]/g, "");
    if (url.includes("\\")) return false;
    return /^(?:http:\/\/|mailto:)/i.test(url) || storableUrl(value);
  }
  return storableUrl(value);
}

/** `https:`, a relative path inside the bundle, or a fragment — read the
 * way a browser reads a scheme and a path. */
function storableUrl(value: string): boolean {
  const url = value.replace(/[\u0000-\u0020]/g, "");
  if (url === "") return true;
  if (url.includes("\\")) return false;
  if (url.startsWith("#")) return true;
  if (/^https:\/\//i.test(url)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  if (url.startsWith("//") || url.startsWith("/")) return false;
  return !url
    .split("/")
    .some((segment) => segment.replace(/%2e/gi, ".") === "..");
}
