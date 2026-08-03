import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  SECTION_TYPES,
  badgeLabel,
  sectionOf,
  unreadForSection,
  type NotificationSection,
} from "./sections.ts";

const n = (type: string, read = false) => ({ type, read });

test("a section counts only its own unread notifications", () => {
  const list = [
    n("task_assigned"),
    n("task_chat"),
    n("group_added"),
    n("meet_scheduled"),
    n("task_started", true), // read — not counted
  ];
  assert.equal(unreadForSection("/tasks", list), 2);
  assert.equal(unreadForSection("/messages", list), 1);
  assert.equal(unreadForSection("/meetings", list), 1);
  assert.equal(unreadForSection("/score", list), 0);
});

test("chat messages are NOT counted from notifications", () => {
  /* The bug this pins. Sending a message writes no `cowork_notifications` row
     — `/direct-message/notify` and `/group/:id/notify` push and email and
     nothing else — so counting these types produced a Messages badge that
     could never be anything but zero, however many unread messages there were.
     The count comes from the conversations' own `readBy`, like the old app. */
  const list = [n("direct_message"), n("group_message")];
  assert.equal(unreadForSection("/messages", list), 0);
  assert.equal(sectionOf("direct_message"), null);
  assert.equal(sectionOf("group_message"), null);
});

test("a score deduction counts against Score, not Tasks", () => {
  /* It carries a `taskId`, so the obvious mistake is filing it under the task
     it came from. The person needs the score page, where the entry and the
     recheck control are. */
  assert.equal(sectionOf("sop_bleach_applied"), "/score");
  assert.equal(unreadForSection("/score", [n("sop_bleach_applied")]), 1);
  assert.equal(unreadForSection("/tasks", [n("sop_bleach_applied")]), 0);
});

test("every type belongs to at most one section", () => {
  /* Two sections claiming a type means visiting one clears the other's badge —
     a count that drops for no visible reason. */
  const seen = new Map<string, string>();
  for (const [section, types] of Object.entries(SECTION_TYPES)) {
    for (const t of types) {
      assert.ok(
        !seen.has(t),
        `"${t}" is claimed by both ${seen.get(t)} and ${section}`,
      );
      seen.set(t, section);
    }
  }
});

test("every section is a real nav destination", () => {
  /* A badge on an href the bar never renders is a count nobody can reach, and
     therefore one nobody can clear. */
  const nav = readFileSync("lib/utils/nav.ts", "utf8");
  for (const href of Object.keys(SECTION_TYPES)) {
    assert.ok(
      nav.includes(`href: "${href}"`),
      `${href} carries a badge but is not a nav item`,
    );
  }
});

test("every event the engine emits is counted somewhere", (t) => {
  /* The invariant that keeps this honest as events are added: a notification
     belonging to no section rings the bell and shows on no badge, so nothing
     on the bar ever indicates it arrived.

     Compared against the emitted `type`, not the announce KIND — the two are
     not the same word. `group_member_added` is what the client asks for and
     `group_added` is what lands in the inbox, and it is the latter the badge
     filters on. */
  const BACKEND =
    "D:/GRAV_Project/grav-cms-backend/routes/task_routes/coworkEvents.routes.js";
  if (!existsSync(BACKEND)) {
    t.skip("grav-cms-backend is not checked out beside this repository");
    return;
  }
  const src = readFileSync(BACKEND, "utf8");
  const block = /const EVENTS = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block, "EVENTS map not found");
  const emitted = new Set(
    [...block[1].matchAll(/type:\s*"([a-z_]+)"/g)].map((m) => m[1]),
  );
  assert.ok(emitted.size > 0, "no emitted types found");
  for (const type of emitted) {
    assert.ok(
      sectionOf(type),
      `"${type}" is emitted but belongs to no nav section, so no badge would ever show it`,
    );
  }
});

test("the badge caps the way the old app's does", () => {
  assert.equal(badgeLabel(1), "1");
  assert.equal(badgeLabel(9), "9");
  assert.equal(badgeLabel(10), "9+");
  assert.equal(badgeLabel(99), "9+");
  assert.equal(badgeLabel(100), "99+");
});

test("zero renders nothing at all, rather than a nought", () => {
  /* A badge saying there is nothing to do draws the eye to say nothing. */
  assert.equal(badgeLabel(0), null);
  assert.equal(badgeLabel(-1), null);
  assert.equal(badgeLabel(Number.NaN), null);
});

test("an unknown type belongs to no section", () => {
  assert.equal(sectionOf("something_invented_later"), null);
  assert.equal(unreadForSection("/tasks", [n("something_invented_later")]), 0);
});

test("visiting a section can always clear its own badge", () => {
  /* The counts and the mark-read come from ONE table, which is what makes this
     true. If they were separate lists, a badge could count a type that
     visiting the section did not clear — a number that follows you with no way
     to dismiss it. */
  for (const section of Object.keys(SECTION_TYPES) as NotificationSection[]) {
    const list = SECTION_TYPES[section].map((t) => n(t));
    assert.equal(unreadForSection(section, list), list.length);
    const afterVisit = list.map((x) => ({ ...x, read: true }));
    assert.equal(unreadForSection(section, afterVisit), 0);
  }
});

/* ── The badge window ─────────────────────────────────────────────────────── */

const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const daysAgo = (d: number) =>
  new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

test("a badge counts only what is recent enough to be news", () => {
  /* Measured against live data before this existed: one employee held 73
     unread MRF notifications and 17 meeting ones going back to July, so those
     sections read `9+` permanently — true for months, unactionable, and
     unchanged by anything anybody did. */
  const list = [
    { type: "meet_scheduled", read: false, createdAt: daysAgo(1) },
    { type: "meet_updated", read: false, createdAt: daysAgo(6) },
    { type: "meet_cancelled", read: false, createdAt: daysAgo(40) },
    { type: "meet_started", read: false, createdAt: daysAgo(90) },
  ];
  assert.equal(unreadForSection("/meetings", list, NOW), 2);
});

test("without a clock the window does not apply", () => {
  /* The cutoff is the caller's decision, not something buried in the rule. */
  const list = [{ type: "meet_scheduled", read: false, createdAt: daysAgo(90) }];
  assert.equal(unreadForSection("/meetings", list), 1);
  assert.equal(unreadForSection("/meetings", list, NOW), 0);
});

test("an undateable notification is not counted as recent", () => {
  /* Guessing in favour of showing a number is exactly how a permanent `9+`
     happens. A notification we cannot date is one we cannot call new. */
  const list = [
    { type: "request", read: false },
    { type: "request", read: false, createdAt: "not a date" },
    { type: "request", read: false, createdAt: daysAgo(2) },
  ];
  assert.equal(unreadForSection("/mrf", list, NOW), 1);
});

test("the window never resurrects something already read", () => {
  const list = [{ type: "task_assigned", read: true, createdAt: daysAgo(1) }];
  assert.equal(unreadForSection("/tasks", list, NOW), 0);
});
