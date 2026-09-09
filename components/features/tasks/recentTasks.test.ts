import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TaskView } from "@/lib/repositories";
import {
  forgetTasks,
  heldTaskCount,
  recentTask,
  rememberTask,
} from "./recentTasks.ts";

/**
 * Every tab of a task is its own route, so switching one unmounted the page and
 * `getTask` began again from nothing — and the loading branch replaced
 * EVERYTHING, including the title, the chips and the tab bar just clicked. The
 * one thing that had not changed was the thing that disappeared, on every tab,
 * every time.
 *
 * The read still always happens. This only decides what is drawn while it is in
 * flight, so the tests that matter most are the ones about not holding on to
 * anything it should not.
 */

const view = (id: string): TaskView =>
  ({ task: { id, title: id } }) as unknown as TaskView;

test("a task that has not been opened has nothing to draw", () => {
  forgetTasks();
  assert.equal(recentTask("T1"), null);
});

test("what was on screen comes back for that task", () => {
  forgetTasks();
  rememberTask("T1", view("T1"));
  assert.equal(recentTask("T1")?.task.id, "T1");
});

test("one task's view never answers for another", () => {
  forgetTasks();
  rememberTask("T1", view("T1"));
  assert.equal(recentTask("T2"), null);
});

test("re-remembering replaces rather than merging", () => {
  forgetTasks();
  rememberTask("T1", view("first"));
  rememberTask("T1", view("second"));
  assert.equal(recentTask("T1")?.task.id, "second");
});

test("it does not grow without limit", () => {
  forgetTasks();
  for (let i = 0; i < 30; i += 1) rememberTask(`T${i}`, view(`T${i}`));
  assert.ok(heldTaskCount() <= 8, `held ${heldTaskCount()}`);
});

test("the task evicted is the one nobody has gone back to", () => {
  forgetTasks();
  for (let i = 0; i < 8; i += 1) rememberTask(`T${i}`, view(`T${i}`));
  rememberTask("T0", view("T0-again"));
  rememberTask("NEW", view("NEW"));
  assert.ok(recentTask("T0"), "the task just re-opened was evicted");
  assert.equal(recentTask("T1"), null);
});

test("signing somebody else in leaves nothing behind", () => {
  rememberTask("T1", view("T1"));
  forgetTasks();
  assert.equal(recentTask("T1"), null);
  assert.equal(heldTaskCount(), 0);
});

/* ── How the page uses it ─────────────────────────────────────────────────── */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const DETAIL = code("components/features/tasks/TaskDetail.tsx");

test("the whole page is replaced only when there is nothing to draw", () => {
  /* The complaint: switching a tab dissolved the title, the chips and the tab
     bar into placeholders, when the only thing that had changed was which tab
     was selected. */
  assert.match(
    DETAIL,
    /if \(isLoading && !view\)\s*\n?\s*return <SkeletonDetail/,
    "the loading branch no longer checks whether there is a task in hand",
  );
});

test("the page reads the seed, not the raw query, everywhere it matters", () => {
  assert.match(DETAIL, /const view = data \?\? seed;/);
  assert.match(DETAIL, /const v = view;/);
  assert.match(DETAIL, /if \(!view\)/, "the not-found branch still reads the query alone");
  assert.match(
    DETAIL,
    /assignees: view\?\.assignees \?\? \[\]/,
    "the priority reorder check still reads the query alone",
  );
});

test("the read still happens, and its answer is what is remembered", () => {
  /* If this ever became a cache that answered instead of fetching, a task
     edited elsewhere would sit stale on screen. */
  assert.match(DETAIL, /const \{ data, isLoading, error, isUnavailable, refetch \} = useQuery\(/);
  assert.match(DETAIL, /if \(data\) rememberTask\(taskId, data\);/);
});

test("the seed is dropped when the reader changes", () => {
  assert.match(DETAIL, /useEffect\(\(\) => \(\) => forgetTasks\(\), \[me\]\);/);
});
