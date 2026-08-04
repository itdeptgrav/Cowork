import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Every `var(--token)` a component names must exist, or carry a fallback.
 *
 * ## Why this needs a test rather than review
 *
 * An undefined custom property fails **silently and invisibly**. CSS declares
 * `background-color: var(--surface)` invalid at computed-value time when
 * `--surface` is not defined, and the property falls back to its initial value
 * — `transparent`. Nothing throws, nothing logs, the class is still on the
 * element, and the build passes.
 *
 * What that looked like in practice: the MRF withdraw confirmation rendered
 * perfectly and was simply not visible. The dialog, its scrim and its buttons
 * were all correct; the panel just had no surface, so the scrim showed straight
 * through it and the whole thing read as a washed-out page rather than as a
 * broken dialog. It shipped because there is nothing to notice — you have to
 * already know that `--surface` is not a token in this system (it defines
 * `--surface-raised` and `--surface-sunken`, and nothing between them).
 *
 * A sweep at the time found the same mistake in four more files, across focus
 * rings and field backgrounds. Two of those were wrong colours rather than
 * missing ones, which is even easier to miss.
 *
 * ## What counts as safe
 *
 * `var(--maybe, fallback)` is fine and deliberately not flagged — that is the
 * language's own way of saying "this may not exist", and the code that writes
 * it has already decided what happens when it does not.
 */

const CSS = readFileSync("app/globals.css", "utf8");

/** Every token `globals.css` defines, in any selector or media block. */
const DEFINED = new Set(
  [...CSS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);

const SKIP = new Set(["node_modules", ".next", ".git", "public"]);

/**
 * Drop comments, so prose ABOUT a token is not read as a use of one.
 *
 * The note in `MrfArea` explaining that `--surface` does not exist would
 * otherwise be reported as the very bug it documents. `//` is only treated as a
 * line comment when it is not preceded by `:`, so a `https://` inside a string
 * does not swallow the rest of its line.
 */
function stripComments(source: string): string {
  return source
    /* Newlines are KEPT so the reported line number still points at the real
       line in the real file. A blanket delete shifts every offence upward by
       however much prose sat above it, and a wrong line number in a failure
       message costs more than the check saves. */
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

test("globals.css defines a usable number of tokens", () => {
  /* Guards the guard: if the regex above ever stops matching — the file is
     renamed, the syntax changes — `DEFINED` empties and every check below
     passes vacuously while reporting nothing. */
  assert.ok(
    DEFINED.size > 50,
    `only ${DEFINED.size} tokens parsed from globals.css — the scan is broken, not the code`,
  );
  assert.ok(DEFINED.has("--surface-sunken"), "--surface-sunken not found");
});

test("every CSS token a component uses exists, or has a fallback", () => {
  const offenders: string[] = [];

  for (const file of [...sourceFiles("components"), ...sourceFiles("app")]) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const m of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
      const [, token, next] = m;
      /* A fallback is an explicit decision about the missing case. */
      if (next === ",") continue;
      if (DEFINED.has(token)) continue;
      const line = source.slice(0, m.index).split("\n").length;
      offenders.push(`${file}:${line} — var(${token}) is not defined`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `\n${offenders.join("\n")}\n\n` +
      "An undefined custom property makes the whole declaration invalid, so the " +
      "property silently falls back to its initial value — transparent, for a " +
      "background. Use a token globals.css defines, or give it a fallback.",
  );
});
