import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  MAX_TOASTS,
  TOAST_MS,
  IMPORTANT_TOAST_MS,
  addToast,
  dismissToast,
  toastFrom,
  toastMsFor,
  toastToneFor,
  type Toast,
} from "./toastStack.ts";

const make = (id: string, over: Partial<Toast> = {}): Toast => ({
  id,
  title: id,
  body: "",
  type: "info",
  tone: "info",
  ms: TOAST_MS,
  ...over,
});

/* ── the stack ──────────────────────────────────────────────────────────── */

test("the same notification arriving twice replaces its own pop-up", () => {
  /**
   * The engine re-sends on retry, and two identical pop-ups side by side
   * reads as a bug in the app rather than as one event happening once.
   */
  const stack = addToast(addToast([], make("a")), make("a", { title: "newer" }));
  assert.equal(stack.length, 1);
  assert.equal(stack[0]!.title, "newer");
});

test("the oldest is dropped rather than stacking down the screen", () => {
  /* A submission can re-chain several tasks, so a burst is normal. */
  let stack: Toast[] = [];
  for (const id of ["a", "b", "c", "d", "e"]) stack = addToast(stack, make(id));
  assert.equal(stack.length, MAX_TOASTS);
  assert.deepEqual(stack.map((t) => t.id), ["c", "d", "e"]);
});

test("dismissing removes only the one asked for", () => {
  const stack = addToast(addToast([], make("a")), make("b"));
  assert.deepEqual(dismissToast(stack, "a").map((t) => t.id), ["b"]);
  /* An id that is not there is not an error — a timer can fire after a
     click has already removed it. */
  assert.deepEqual(dismissToast(stack, "zzz").map((t) => t.id), ["a", "b"]);
});

/* ── what each notification looks like ──────────────────────────────────── */

test("anything that COSTS the reader something stays longer", () => {
  /**
   * Six seconds is enough to notice a message. It is not enough to read
   * "your deadline moved to 17:59, was 18:19" and work out what to do.
   */
  assert.equal(toastMsFor("deadline_moved_earlier"), IMPORTANT_TOAST_MS);
  assert.equal(toastMsFor("task_rework"), IMPORTANT_TOAST_MS);
  assert.equal(toastMsFor("completion_rejected"), IMPORTANT_TOAST_MS);
  assert.equal(toastMsFor("message"), TOAST_MS);
  assert.ok(IMPORTANT_TOAST_MS > TOAST_MS);
});

test("tone follows what the notification means, not its wording", () => {
  assert.equal(toastToneFor("deadline_moved_earlier"), "warn");
  assert.equal(toastToneFor("task_rework"), "warn");
  assert.equal(toastToneFor("completion_approved"), "good");
  assert.equal(toastToneFor("message"), "info");
  assert.equal(toastToneFor(""), "info");
});

test("a notification with no title is not shown at all", () => {
  /* An untitled pop-up is a grey box that says nothing and cannot be acted
     on — worse than the notification not appearing. */
  assert.equal(toastFrom({ body: "something happened" }), null);
  assert.equal(toastFrom({ title: "   " }), null);
  assert.equal(toastFrom({}), null);
});

test("a real rework notification becomes a warn toast that lingers", () => {
  const toast = toastFrom({
    title: "🔄 Rework Required · task 789",
    body: "Reason: fix the header — you have until 18:14, the time that was left when you handed it in.",
    type: "task_rework",
    url: "/coworking/tasks",
    tag: "task_rework:T072",
  });
  assert.ok(toast);
  assert.equal(toast!.id, "task_rework:T072");
  assert.equal(toast!.tone, "warn");
  assert.equal(toast!.ms, IMPORTANT_TOAST_MS);
  assert.match(toast!.body, /you have until 18:14/);
});

test("a deadline that moved earlier reads as a warning", () => {
  const toast = toastFrom({
    title: "⏱ Less time · task 789",
    body: "Now due 17:59 (was 18:19) — “task 123” above this was handed in.",
    type: "deadline_moved_earlier",
    tag: "deadline_moved_earlier:T072",
  });
  assert.equal(toast!.tone, "warn");
  assert.equal(toast!.ms, IMPORTANT_TOAST_MS);
});

test("without a tag, an id is still stable for the same event", () => {
  /* Otherwise a retry stacks a duplicate. */
  const a = toastFrom({ title: "Same", type: "x" });
  const b = toastFrom({ title: "Same", type: "x" });
  assert.equal(a!.id, b!.id);
});

/* ── wiring ─────────────────────────────────────────────────────────────── */

const toasts = readFileSync(
  "components/layout/shell/NotificationToasts.tsx",
  "utf8",
);
const shell = readFileSync("components/layout/shell/ShellFrame.tsx", "utf8");
const hook = readFileSync("lib/legacy-ui/useCoworkNotifications.ts", "utf8");

test("something actually listens to the event the hook dispatches", () => {
  /**
   * The bug this fixes. The hook suppressed the browser's own pop-up while
   * the tab was focused — correctly — and dispatched `cowork:notification`
   * instead. Nothing listened, so a person working IN the app was the one
   * person who never saw their own notifications.
   */
  assert.match(hook, /new CustomEvent\("cowork:notification"/);
  assert.match(toasts, /addEventListener\("cowork:notification"/);
  assert.match(toasts, /removeEventListener\("cowork:notification"/);
});

test("it is mounted once for the whole app", () => {
  /* Not per screen — every page has to show them, and each screen
     remembering to is how half of them end up not doing it. */
  assert.match(shell, /<NotificationToasts \/>/);
  assert.match(shell, /import \{ NotificationToasts \}/);
});

test("a pop-up never blocks the app", () => {
  /* These report what has already happened. Anything that must be dismissed
     before carrying on punishes the reader for being told. */
  assert.match(toasts, /pointer-events-none fixed/);
  assert.doesNotMatch(toasts, /aria-modal/);
  assert.doesNotMatch(toasts, /role="dialog"/);
  assert.match(toasts, /aria-live="polite"/);
});

test("every pop-up can be dismissed by hand as well as by timer", () => {
  assert.match(toasts, /aria-label="Dismiss"/);
  assert.match(toasts, /window\.setTimeout\(\(\) => drop\(toast\.id\), toast\.ms\)/);
});
