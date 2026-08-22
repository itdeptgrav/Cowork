import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * **Who you are must not depend on the directory being readable.**
 *
 * Reported 21 Aug 2026: signed in as Umung, Go online was greyed out, the score
 * pill was blank, and no `cowork_duty_status` document was ever written for
 * that account — while two colleagues who had gone online earlier had theirs.
 *
 * The cause was the Firebase project's daily read quota. Every Firestore read
 * failed, so `#employeesById` threw, so `getViewer` rejected, so
 * `useViewerId()` returned null — and null viewerId is load-bearing far beyond
 * the method that produced it:
 *
 *  · `StatusButton` greys Go online on `!viewerId`
 *  · BOTH of `DutySync`'s effects open with `if (!viewerId) return`, so
 *    presence is never watched AND never published
 *  · the score pill reads the same viewer
 *
 * One failed read therefore removed the ability to go online at all. The tree
 * is ~17 HTTP calls — one `my-managers` per employee — and `getViewer` awaited
 * every one of them to fill in two booleans.
 *
 * A person who cannot be placed in a hierarchy is still a person with an
 * employee id. Degrading to "no manager, no reports" is the same answer the
 * tree already gives for somebody absent from HR.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const REPO = "lib/repositories/legacy/index.ts";

function methodBody(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\n  async ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

test("an unreadable reporting tree costs the hierarchy, not the identity", () => {
  const fn = methodBody(code(REPO), "getViewer");
  assert.notEqual(fn, "", "getViewer not found — renamed?");
  /* The await is inside a try, and the failure is swallowed rather than
     rethrown — an employee id is still returned. */
  assert.match(fn, /try \{\s*tree = await this\.#reportingTree\(\);\s*\} catch/);
  assert.match(fn, /tree\?\.byEmployee\.get\(/);
});

test("the id comes from the context, never from the tree", () => {
  /* It was always known synchronously. Nothing about resolving WHO somebody is
     should have required a network call in the first place. */
  const fn = methodBody(code(REPO), "getViewer");
  assert.match(fn, /const id = String\(employeeId \?\? this\.#ctx\.employeeId\)/);
  assert.ok(
    fn.indexOf("const id =") < fn.indexOf("#reportingTree"),
    "identity must be resolved before the tree is even attempted",
  );
});

test("a null tree cannot reach an unguarded property", () => {
  /* The whole value of the fallback is lost if any reader still assumes it. */
  const fn = methodBody(code(REPO), "getViewer");
  const unguarded = [...fn.matchAll(/(?<!\?)\btree\./g)];
  assert.equal(
    unguarded.length,
    0,
    `getViewer dereferences tree without \`?.\` — ${unguarded.length} place(s)`,
  );
});
