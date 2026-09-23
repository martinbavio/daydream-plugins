// COPIES OF KERNEL CODE, checked against the kernel. A plugin may not
// import the kernel's source, so a function it needs to the letter is
// copied into it, and the copy carries a one-line marker naming where it
// came from, just above the function (a doc comment may sit between):
//
//   // mirrors: src/render/cssRanges.ts closesItsOwnBlocks
//
// kernel-test (scripts/kernel-test.mjs) reads every marker in the plugin
// files it copies, takes the named function out of the kernel file at
// the checkout and the function declared after the marker out of the
// plugin file, and compares the two with comments and formatting set
// aside. Three forms:
//
// - `mirrors:` or `mirrors-exact:` — the copy is the kernel's, to the
//   letter. A difference fails the run, pointing at the line where it
//   starts in each file.
// - `mirrors-adapted: <path> <function> [<hash>]` — the copy was changed
//   on purpose (an import path, a type, a helper's name), so the two are
//   not compared. The hash is the kernel function's as it was when the
//   copy was adapted; a kernel whose function hashes otherwise is
//   REPORTED, never failed, so the copy is read again. Without a hash the
//   report gives the one to record.
//
// A marker naming a file or a function the kernel does not have fails in
// every form: it points at nothing. The path is the kernel's, from its
// root (`src/` may be left off). The pattern is one constant,
// MIRROR_MARKER, and lenient in its spelling: `//` or a block comment,
// any case, the colon optional, the function after a space, `#` or `:`,
// with or without `()`.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** One marker line: its form (`exact`, `adapted`, or none for plain
 * `mirrors`), the kernel path — something with a `/` or a `.` in it, so
 * prose that starts "mirrors the …" is not one — the function, and an
 * adapted copy's recorded hash. */
export const MIRROR_MARKER =
  /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*mirrors(?:-(exact|adapted))?[ \t]*:?[ \t]*([^\s#:]*[/.][^\s#:]*)(?:[ \t]*[#:][ \t]*|[ \t]+)([A-Za-z_$][\w$]*)(?:\(\))?(?:[ \t]+([0-9a-f]{8,64}))?[ \t]*(?:\*\/)?[ \t]*$/i;

/** The files of a plugin folder that can hold a marker: its source,
 * never node_modules or a build. */
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED = new Set(["node_modules", "dist"]);

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) files.push(...sourceFiles(full));
    } else if (SOURCE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// A small reader of TypeScript's surface: enough to step over comments,
// strings, template literals and regex literals, so a bracket or a
// comment marker inside one is not taken for code.

const KEYWORD_BEFORE_REGEX =
  /^(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

/** The token at `i`: its kind (`space`, `comment`, `literal`, `word` or
 * `punct`) and where it ends. `state` carries the last significant token,
 * which tells a regex literal from a division. */
function tokenAt(src, i, state) {
  const c = src[i];
  const next = src[i + 1];
  if (/\s/.test(c)) {
    let j = i + 1;
    while (j < src.length && /\s/.test(src[j])) j++;
    return { kind: "space", end: j };
  }
  if (c === "/" && next === "/") {
    const nl = src.indexOf("\n", i);
    return { kind: "comment", end: nl === -1 ? src.length : nl };
  }
  if (c === "/" && next === "*") {
    const close = src.indexOf("*/", i + 2);
    return { kind: "comment", end: close === -1 ? src.length : close + 2 };
  }
  const operand = (end) => {
    state.prev = "a";
    state.word = "";
    return { kind: "literal", end };
  };
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c && src[j] !== "\n") {
      j += src[j] === "\\" ? 2 : 1;
    }
    return operand(j + 1);
  }
  if (c === "`") return operand(templateEnd(src, i));
  const regexMayStart =
    state.prev === "a"
      ? KEYWORD_BEFORE_REGEX.test(state.word)
      : state.prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(state.prev);
  if (c === "/" && regexMayStart) {
    let j = i + 1;
    let inClass = false;
    while (j < src.length && src[j] !== "\n") {
      if (src[j] === "\\") {
        j += 2;
        continue;
      }
      if (src[j] === "[") inClass = true;
      else if (src[j] === "]") inClass = false;
      else if (src[j] === "/" && !inClass) break;
      j++;
    }
    j++;
    while (/[a-z]/i.test(src[j] ?? "")) j++;
    return operand(j);
  }
  if (/[\w$]/.test(c)) {
    let j = i + 1;
    while (j < src.length && /[\w$]/.test(src[j])) j++;
    state.prev = "a";
    state.word = src.slice(i, j);
    return { kind: "word", end: j };
  }
  state.prev = c;
  state.word = "";
  return { kind: "punct", end: i + 1 };
}

/** Where the template literal opening at `i` ends, its `${…}` stepped
 * through as code. */
function templateEnd(src, i) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
    } else if (src[j] === "`") {
      return j + 1;
    } else if (src[j] === "$" && src[j + 1] === "{") {
      j = blockEnd(src, j + 2);
    } else {
      j++;
    }
  }
  return src.length;
}

/** Where the code from `from` closes the brace opened just before it. */
function blockEnd(src, from) {
  const state = { prev: "(", word: "" };
  let depth = 0;
  for (let i = from; i < src.length; ) {
    const token = tokenAt(src, i, state);
    if (token.kind === "punct") {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        if (depth === 0) return token.end;
        depth--;
      }
    }
    i = token.end;
  }
  return src.length;
}

/** The next significant token from `i`: its first character, or "". */
function nextSignificant(src, i) {
  const state = { prev: "", word: "" };
  while (i < src.length) {
    const token = tokenAt(src, i, state);
    if (token.kind !== "space" && token.kind !== "comment") return src[i];
    i = token.end;
  }
  return "";
}

/** Where the declaration whose name ends at `from` ends: past the `}`
 * that closes its body — not a type's `{ … }`, which a body, an arrow, a
 * `>` or a `,` follows — or past a `;` outside any bracket. */
function declarationEnd(src, from) {
  const state = { prev: "a", word: "" };
  let depth = 0;
  for (let i = from; i < src.length; ) {
    const token = tokenAt(src, i, state);
    if (token.kind === "punct") {
      const c = src[i];
      if ("{([".includes(c)) depth++;
      else if ("})]".includes(c)) depth--;
      else if (c === ";" && depth === 0) return token.end;
      if (c === "}" && depth === 0) {
        if (!"{=|&[>,".includes(nextSignificant(src, token.end) || " ")) {
          return token.end;
        }
      }
    }
    i = token.end;
  }
  return src.length;
}

/** The function declared at or after `from` — named `name`, or any when
 * none is given — as `function f(…)` or `const f = …`: where its name
 * ends and where it ends. Null when there is none. */
function declaration(src, from, name) {
  const state = { prev: "", word: "" };
  let before = "";
  for (let i = from; i < src.length; ) {
    const token = tokenAt(src, i, state);
    if (token.kind === "word") {
      const word = src.slice(i, token.end);
      const declares = /^(?:function|const|let|var)$/.test(before);
      if (declares && (name === undefined || word === name)) {
        const after = nextSignificant(src, token.end);
        if ("(<:=".includes(after) && after !== "") {
          return {
            name: word,
            start: i,
            end: declarationEnd(src, token.end),
            bodyStart: token.end,
          };
        }
      }
      before = word;
    } else if (token.kind === "punct" && src[i] !== "*") {
      // `function*` keeps the keyword in reach; anything else ends it.
      before = "";
    }
    i = token.end;
  }
  return null;
}

/** `src[from, to)` with comments and formatting set aside: one space
 * only where two words would otherwise run together, no trailing comma.
 * `at[k]` is where `text[k]` was in `src`. */
export function normalised(src, from = 0, to = src.length) {
  const state = { prev: "", word: "" };
  let text = "";
  const at = [];
  const emit = (chunk, offset) => {
    for (let k = 0; k < chunk.length; k++) {
      text += chunk[k];
      at.push(offset + k);
    }
  };
  for (let i = from; i < to; ) {
    const token = tokenAt(src, i, state);
    const end = Math.min(token.end, to);
    if (token.kind === "word" || token.kind === "literal") {
      if (/[\w$]$/.test(text) && /^[\w$]/.test(src[i])) emit(" ", i);
      emit(src.slice(i, end), i);
    } else if (token.kind === "punct") {
      if (")]}".includes(src[i]) && text.endsWith(",")) {
        text = text.slice(0, -1);
        at.pop();
      }
      emit(src[i], i);
    }
    i = end;
  }
  return { text, at };
}

/** A normalised body's hash, as a marker records it. */
export const bodyHash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

/** 1-based line of `offset` in `src`. */
const lineOf = (src, offset) => src.slice(0, offset).split("\n").length;

/** The kernel file a marker names, inside the checkout, or null. */
function kernelFile(kernel, named) {
  for (const candidate of [named, path.join("src", named)]) {
    const full = path.resolve(kernel, candidate);
    if (!full.startsWith(kernel + path.sep)) return null;
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Every marker in the plugin folders' source, checked against the kernel
 * at `kernel`. Answers how many were checked, the failures (an exact copy
 * that differs, a marker that points at nothing) and the notes (an
 * adapted copy whose kernel function changed, or has no hash recorded),
 * each a line naming the files.
 */
export function checkMirrors(kernel, folders) {
  const report = { checked: 0, failures: [], notes: [] };
  for (const folder of folders) {
    for (const file of sourceFiles(folder)) {
      const src = readFileSync(file, "utf8");
      const where = path.relative(path.dirname(folder), file);
      let offset = 0;
      for (const [index, line] of src.split("\n").entries()) {
        const lineStart = offset;
        offset += line.length + 1;
        const marker = MIRROR_MARKER.exec(line);
        if (marker === null) continue;
        report.checked++;
        const [, form = "exact", named, fn, recorded] = marker;
        const at = `${where}:${index + 1}`;
        const found = kernelFile(kernel, named);
        const theirs = found === null ? "" : readFileSync(found, "utf8");
        const kernelFn = found === null ? null : declaration(theirs, 0, fn);
        if (kernelFn === null) {
          report.failures.push(
            `${at}: mirrors ${named} ${fn}, which the kernel does not have${found === null ? " (no such file)" : ""}`,
          );
          continue;
        }
        const kernelBody = normalised(theirs, kernelFn.bodyStart, kernelFn.end);
        const hash = bodyHash(kernelBody.text);
        const kernelAt = `${path.relative(kernel, found)}:${lineOf(theirs, kernelFn.start)}`;
        if (form.toLowerCase() === "adapted") {
          if (recorded === undefined) {
            report.notes.push(
              `${at}: ${fn} is adapted from ${kernelAt}, whose hash is ${hash}; record it on the marker to be told when the kernel's changes`,
            );
          } else if (!hash.startsWith(recorded) && !recorded.startsWith(hash)) {
            report.notes.push(
              `${at}: the kernel's ${fn} (${kernelAt}) changed since the copy was adapted (${recorded}, now ${hash}); read it again, then record ${hash}`,
            );
          }
          continue;
        }
        // After the marker's comment: a doc comment's prose is not code.
        const close = /^\s*\/\//.test(line) ? -1 : src.indexOf("*/", lineStart);
        const mine = declaration(
          src,
          close === -1 ? lineStart + line.length : close + 2,
        );
        if (mine === null) {
          report.failures.push(`${at}: no function follows the marker`);
          continue;
        }
        const pluginBody = normalised(src, mine.bodyStart, mine.end);
        if (pluginBody.text === kernelBody.text) continue;
        let k = 0;
        while (pluginBody.text[k] === kernelBody.text[k]) k++;
        const context = (body) =>
          JSON.stringify(body.text.slice(Math.max(0, k - 20), k + 40));
        const lineIn = (body, text, fallback) =>
          lineOf(text, body.at[k] ?? fallback);
        report.failures.push(
          [
            `${at}: ${mine.name} differs from the kernel's ${fn} (${kernelAt})`,
            `    from ${path.relative(kernel, found)}:${lineIn(kernelBody, theirs, kernelFn.end)} ${context(kernelBody)}`,
            `    and  ${where}:${lineIn(pluginBody, src, mine.end)} ${context(pluginBody)}`,
            `    copy it again, or mark it mirrors-adapted with ${hash} if it differs on purpose`,
          ].join("\n"),
        );
      }
    }
  }
  return report;
}
