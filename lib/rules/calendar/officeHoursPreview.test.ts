import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeTaskCount,
  formatDays,
  formatMinute,
  hasChanges,
  previewRows,
} from "./officeHoursPreview.ts";
import { DEFAULT_OFFICE_HOURS } from "../../domain/office.ts";
import type { OfficeHours, Task } from "../../domain/index.ts";

/**
 * What the confirmation dialog shows, and what the warning counts.
 *
 * The dialog and the history list both render from `previewRows`, so an edit
 * cannot be described one way before saving and another way afterwards.
 */

const base = (over: Partial<OfficeHours> = {}): OfficeHours => ({
  ...structuredClone(DEFAULT_OFFICE_HOURS),
  ...over,
});

test("an unchanged configuration produces no rows", () => {
  /* A confirmation listing seven unchanged fields buries the one that matters. */
  assert.deepEqual(previewRows(base(), base()), []);
  assert.equal(hasChanges(base(), base()), false);
});

test("the brief's example renders as before → after", () => {
  const rows = previewRows(
    base(),
    base({
      startMinuteOfDay: 600,
      endMinuteOfDay: 19 * 60,
      timezone: "Europe/London",
      workingDays: [1, 2, 3, 4, 5, 6],
    }),
  );
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual(byLabel["Office hours"], {
    label: "Office hours",
    before: "09:00–18:00",
    after: "10:00–19:00",
  });
  assert.deepEqual(byLabel["Timezone"], {
    label: "Timezone",
    before: "Asia/Kolkata",
    after: "Europe/London",
  });
  assert.deepEqual(byLabel["Working days"], {
    label: "Working days",
    before: "Mon–Fri",
    after: "Mon–Sat",
  });
});

test("only changed fields appear", () => {
  const rows = previewRows(base(), base({ timezone: "UTC" }));
  assert.deepEqual(rows.map((r) => r.label), ["Timezone"]);
});

test("contiguous days collapse to a range, scattered days list", () => {
  assert.equal(formatDays([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(formatDays([1, 3, 5]), "Mon, Wed, Fri");
  assert.equal(formatDays([]), "None");
  /* Two days are listed rather than ranged — "Mon–Tue" is longer than
     "Mon, Tue" and reads as a span that excludes nothing. */
  assert.equal(formatDays([1, 2]), "Mon, Tue");
});

test("minutes render as wall-clock", () => {
  assert.equal(formatMinute(540), "09:00");
  assert.equal(formatMinute(0), "00:00");
  assert.equal(formatMinute(1439), "23:59");
});

test("adding and removing a break is visible", () => {
  const rows = previewRows(
    base(),
    base({ breaks: [{ startMinuteOfDay: 780, endMinuteOfDay: 840 }] }),
  );
  const b = rows.find((r) => r.label === "Breaks");
  assert.equal(b?.before, "None");
  assert.equal(b?.after, "13:00–14:00");
});

/* ── The active-task warning ──────────────────────────────────────────────── */

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t",
    status: "in_progress",
    deletedAt: null,
    deadline: { dueAt: "2026-08-01T10:00:00.000Z" },
    ...over,
  }) as Task;

test("the warning counts only live, dated work", () => {
  /* Counting finished or undated tasks would inflate a number people need to
     trust before changing something this load-bearing. */
  const tasks = [
    task({ id: "live" }),
    task({ id: "done", status: "completed" }),
    task({ id: "cancelled", status: "cancelled" }),
    task({ id: "refused", status: "assignment_rejected" }),
    task({ id: "deleted", deletedAt: "2026-07-01T00:00:00.000Z" }),
    task({ id: "undated", deadline: { dueAt: null } as Task["deadline"] }),
  ];
  assert.equal(activeTaskCount(tasks), 1);
});

test("no tasks means no warning", () => {
  assert.equal(activeTaskCount([]), 0);
});
