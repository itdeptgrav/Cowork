import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The viewer's id has to be known on the FIRST render, not the second.
 *
 * `null` from `useViewerId` does not mean "nobody is signed in" — it means "the
 * answer has not arrived", and no caller can tell those apart. Every one of them
 * renders as though nobody were signed in for as long as it lasts.
 *
 * The conversation list made it visible: `conversationTitle` filters the viewer
 * out of a thread's participants, so a `null` viewer filtered nobody out and
 * every direct conversation was titled with BOTH names — the reader's own
 * included — until `getViewer()` resolved and the whole list rewrote itself.
 * A list that corrects itself a second after it appears reads as a fault
 * whatever it settles on.
 *
 * Source assertions, because the bug is about WHEN a value is available. A test
 * that awaited the hook would observe the settled state, which was never wrong.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

const HOOK = "lib/hooks/usePermissions.ts";
const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";
const TYPES = "lib/repositories/types.ts";
const AREA = "components/features/messages/MessagesArea.tsx";

test("useViewerId falls back to the synchronous acting id", () => {
  assert.match(
    code(HOOK),
    /viewer\.data\?\.employeeId \?\? repo\.actingEmployeeId\?\.\(\) \?\? null/,
    "useViewerId still returns null while getViewer is in flight",
  );
});

test("the asynchronous answer still wins once it arrives", () => {
  /* Ordering is the safety property: after the query resolves the behaviour is
     byte-identical to before this change, so only the gap is affected. */
  const src = code(HOOK);
  const line = src.match(/return viewer\.data\?\.employeeId[^;]*;/)?.[0] ?? "";
  assert.ok(
    line.indexOf("viewer.data") < line.indexOf("actingEmployeeId"),
    "the synchronous fallback must not take precedence over the resolved query",
  );
});

test("the repository contract declares it optional", () => {
  /* Optional so an implementation with no acting identity omits it and callers
     fall back to the asynchronous answer rather than throwing. */
  assert.match(code(TYPES), /actingEmployeeId\?\(\): EmployeeId \| null;/);
});

test("both repositories implement it", () => {
  assert.match(code(LEGACY), /actingEmployeeId\(\): EmployeeId \| null \{/);
  assert.match(code(MOCK), /actingEmployeeId\(\): EmployeeId \| null \{/);
});

test("the legacy id is the same field getViewer derives from", () => {
  /* If these two read different fields they could disagree, and the fallback
     would hand out an id the rest of the app would then contradict. */
  const src = code(LEGACY);
  const viewer = src.slice(src.indexOf("async getViewer(employeeId"));
  assert.match(
    viewer.slice(0, 200),
    /String\(employeeId \?\? this\.#ctx\.employeeId\)/,
    "getViewer no longer derives its id from #ctx.employeeId",
  );
  const acting = src.slice(src.indexOf("actingEmployeeId(): EmployeeId | null {"));
  assert.match(acting.slice(0, 200), /this\.#ctx\.employeeId/);
});

test("the mock reads its acting id live, so the profile switcher still works", () => {
  /* The mock CAN be re-pointed by `setActingEmployee`; caching would freeze the
     switcher on whoever was acting when the module first ran. */
  const src = code(MOCK);
  const at = src.indexOf("actingEmployeeId(): EmployeeId | null {");
  assert.match(src.slice(at, at + 140), /return actingId\(\) \?\? null;/);
});

test("the conversation title still filters the viewer out", () => {
  /* The fallback fixes WHEN the id is known; this is the code that uses it, and
     it is what made the fault visible. */
  assert.match(
    code(AREA),
    /const others = c\.participants\.filter\(\(p\) => p\.id !== viewerId\);/,
  );
});
