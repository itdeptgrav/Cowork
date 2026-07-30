import assert from "node:assert/strict";
import { test } from "node:test";

import { dutyTransition } from "../presence/duty.ts";
import { compensatedDueAt } from "./deadlineCompensation.ts";

/**
 * The compensation event is the return to ONLINE — nothing else.
 *
 * Going offline/break/emergency stamps a start; coming back online is when the
 * lost time (`now - unavailableStartedAt`) is measured and every active task's
 * deadline moves by it. Online, a running timer, a heartbeat, a refresh — none of
 * them touch the date. These drive `dutyTransition`, which is the authority for
 * "which transition compensates, and by how much", and apply the result with
 * `compensatedDueAt` (`dueAt += lostTime`).
 *
 * `dutyTransition` returns the RAW span, exactly as the brief's
 * `lostTime = currentTime - unavailableStartedAt`. (The repository additionally
 * bounds it to office hours before applying, so an overnight absence credits
 * nothing — a deliberate earlier decision; for the in-hours spans here the two
 * are identical.)
 */

const MIN = 60_000;
const secs = (ms: number) => Math.round(ms / 1000);

/* ══ The event is the return to online, not the departure ══════════════════ */

test("going into an unavailable state compensates nothing yet", () => {
  const t = dutyTransition({
    previous: { mode: "online", heartbeatAt: 0 },
    next: "offline",
    nowMs: 9 * 60 * MIN, // 09:00
    connectionId: null,
  });
  assert.equal(t.offlineToCreditMs, 0, "leaving online must not credit");
  assert.equal(t.patch.offlineStartedAtMs, 9 * 60 * MIN, "the start is stamped");
});

/* ══ Single interruption shifts EVERY active task by the lost time ═════════ */

test("returning online shifts all active deadlines by the offline duration", () => {
  const goneAt = 9 * 60 * MIN; // 09:00
  const backAt = goneAt + 30 * MIN; // 09:30
  const back = dutyTransition({
    previous: { mode: "offline", offlineStartedAtMs: goneAt },
    next: "online",
    nowMs: backAt,
    connectionId: "tab-a",
  });
  assert.equal(back.offlineToCreditMs, 30 * MIN, "lostTime = now - unavailableStartedAt");
  assert.equal(back.patch.offlineStartedAtMs, null, "the tracker resets");

  /* The same lostTime lands on every active task — Task A and Task B alike. */
  const lost = secs(back.offlineToCreditMs);
  assert.equal(compensatedDueAt("2026-07-27T12:00:00.000Z", lost), "2026-07-27T12:30:00.000Z");
  assert.equal(compensatedDueAt("2026-07-27T15:00:00.000Z", lost), "2026-07-27T15:30:00.000Z");
});

/* ══ Online time between interruptions moves nothing ═══════════════════════ */

test("staying online adds nothing to the deadline", () => {
  /* An online→online 'heartbeat'-shaped call: no unavailable span, no credit. */
  const t = dutyTransition({
    previous: { mode: "online", heartbeatAt: 10 * 60 * MIN },
    next: "online",
    nowMs: 15 * 60 * MIN, // five hours later
    connectionId: "tab-a",
  });
  assert.equal(t.offlineToCreditMs, 0);
  assert.equal(t.breakToCreditMs, 0);
  assert.equal(t.emergencyToRaiseMs, 0);
  assert.equal(
    compensatedDueAt("2026-07-27T12:00:00.000Z", 0),
    "2026-07-27T12:00:00.000Z",
  );
});

/* ══ Multiple modes accumulate: 20 + 30 + 15 = 65 ══════════════════════════ */

test("offline 20 + break 30 + emergency 15 returns compensate to 65 minutes", () => {
  /* Each unavailable stretch is entered from online and left back to it; the
     credit is applied at each RETURN, and the three sum. */
  const offBack = dutyTransition({
    previous: { mode: "offline", offlineStartedAtMs: 9 * 60 * MIN }, // 09:00
    next: "online",
    nowMs: 9 * 60 * MIN + 20 * MIN, // 09:20
    connectionId: "a",
  });
  const brkBack = dutyTransition({
    previous: { mode: "break", breakStartedAtMs: 10 * 60 * MIN }, // 10:00
    next: "online",
    nowMs: 10 * 60 * MIN + 30 * MIN, // 10:30
    connectionId: "a",
  });
  const emeBack = dutyTransition({
    previous: { mode: "emergency", emergencyStartedAtMs: 11 * 60 * MIN }, // 11:00
    next: "online",
    nowMs: 11 * 60 * MIN + 15 * MIN, // 11:15
    connectionId: "a",
  });

  assert.equal(secs(offBack.offlineToCreditMs), 20 * 60);
  assert.equal(secs(brkBack.breakToCreditMs), 30 * 60);
  assert.equal(secs(emeBack.emergencyToRaiseMs), 15 * 60);

  const total =
    offBack.offlineToCreditMs + brkBack.breakToCreditMs + emeBack.emergencyToRaiseMs;
  assert.equal(secs(total), 65 * 60, "the three unavailable returns sum to 65 minutes");

  /* Applied one after another to a task, the deadline ends 65 minutes later. */
  let due = "2026-07-27T12:00:00.000Z";
  due = compensatedDueAt(due, secs(offBack.offlineToCreditMs));
  due = compensatedDueAt(due, secs(brkBack.breakToCreditMs));
  due = compensatedDueAt(due, secs(emeBack.emergencyToRaiseMs));
  assert.equal(due, "2026-07-27T13:05:00.000Z");
});

/* ══ The three unavailable modes are measured identically ══════════════════ */

test("offline, break and emergency all measure now - startedAt", () => {
  const started = 14 * 60 * MIN;
  const back = (mode: "offline" | "break" | "emergency", stampKey: string) =>
    dutyTransition({
      previous: { mode, [stampKey]: started } as never,
      next: "online",
      nowMs: started + 45 * MIN,
      connectionId: "a",
    });
  assert.equal(back("offline", "offlineStartedAtMs").offlineToCreditMs, 45 * MIN);
  assert.equal(back("break", "breakStartedAtMs").breakToCreditMs, 45 * MIN);
  assert.equal(back("emergency", "emergencyStartedAtMs").emergencyToRaiseMs, 45 * MIN);
});
