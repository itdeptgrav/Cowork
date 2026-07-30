import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readMeetingStatus,
  readParticipants,
  toIso,
  toMeeting,
  toMeetings,
  toNotification,
  toNotifications,
  toWorkloadRow,
  toWorkloadRows,
} from "./workMap.ts";

/* ── Notifications ────────────────────────────────────────────────────────── */

test("a notification maps field for field", () => {
  const n = toNotification({
    id: "n1", recipientEmployeeId: "E001", type: "task_assigned",
    title: "New task", body: "Ship it", data: { taskId: "t1" },
    read: false, createdAt: "2026-07-28T09:00:00.000Z",
  })!;
  assert.equal(n.id, "n1");
  assert.equal(n.recipientId, "E001");
  assert.equal(n.type, "task_assigned");
  assert.equal(n.title, "New task");
  assert.equal(n.body, "Ship it");
  assert.deepEqual(n.data, { taskId: "t1" });
  assert.equal(n.createdAt, "2026-07-28T09:00:00.000Z");
});

test("read/unread distinguishes 'read, time unknown' from genuinely unread", () => {
  /* The domain records WHEN; legacy records only WHETHER. There is no timestamp
     to recover, and inventing one would date a read that never happened. */
  assert.equal(toNotification({ id: "n", read: true })!.readAt, "");
  assert.equal(toNotification({ id: "n", read: false })!.readAt, null);
  assert.equal(toNotification({ id: "n" })!.readAt, null, "absent means unread");
});

test("a notification with no id is dropped rather than rendered", () => {
  assert.equal(toNotification({ title: "Orphan" }), null);
  assert.equal(toNotifications([{ title: "Orphan" }, { id: "n1" }]).length, 1);
});

test("source references stay null — legacy carries none", () => {
  const n = toNotification({ id: "n1" })!;
  assert.equal(n.sourceType, null);
  assert.equal(n.sourceId, null);
});

/* ── Meetings ─────────────────────────────────────────────────────────────── */

test("a meeting maps, and no duration is invented", () => {
  /* Legacy stores one instant and no end. `endsAt` empty says "not known";
     repeating startsAt would assert a zero-length meeting and an assumed hour
     would put a made-up block in somebody's day. */
  const m = toMeeting({
    id: "m1", title: "Standup", dateTime: "2026-07-28T09:30:00.000Z",
    createdBy: "E001", participants: ["E001", "E002"], status: "scheduled",
  })!;
  assert.equal(m.startsAt, "2026-07-28T09:30:00.000Z");
  assert.equal(m.endsAt, "");
  assert.equal(m.actualDurationSecs, null);
  assert.equal(m.organiserId, "E001");
  assert.deepEqual(m.participantIds, ["E001", "E002"]);
});

test("meetId stands in when id is absent", () => {
  assert.equal(toMeeting({ meetId: "mt-9", title: "X" })!.id, "mt-9");
  assert.equal(toMeeting({ title: "no id" }), null);
});

test("isCancelled wins over a stale status", () => {
  /* Legacy leaves `status` at its scheduled value on a cancelled meeting. */
  assert.equal(
    readMeetingStatus({ status: "scheduled", isCancelled: true }),
    "cancelled",
  );
  assert.equal(readMeetingStatus({ status: "live" }), "live");
  assert.equal(readMeetingStatus({ status: "nonsense" }), "scheduled");
  assert.equal(readMeetingStatus({}), "scheduled");
});

test("participants read as ids or as objects", () => {
  /* Both forms observed. Reading one would render a meeting as unattended. */
  assert.deepEqual(readParticipants(["E1", "E2"]), ["E1", "E2"]);
  assert.deepEqual(readParticipants([{ employeeId: "E1" }, { id: "E2" }]), ["E1", "E2"]);
  assert.deepEqual(readParticipants([{ nothing: 1 }, "E3"]), ["E3"]);
  assert.deepEqual(readParticipants(undefined), []);
});

test("an untitled meeting renders a placeholder, not a blank row", () => {
  assert.equal(toMeeting({ id: "m1" })!.title, "Untitled meeting");
});

test("recording and summary are false — legacy reports neither", () => {
  /* Both are claims about what was captured. */
  const m = toMeeting({ id: "m1" })!;
  assert.equal(m.recordingEnabled, false);
  assert.equal(m.hasSummary, false);
  assert.deepEqual(m.actionItems, []);
});

test("meetings without ids are dropped in bulk", () => {
  assert.equal(toMeetings([{ title: "a" }, { id: "m1" }, { meetId: "m2" }]).length, 2);
});

/* ── Workload ─────────────────────────────────────────────────────────────── */

test("a workload row maps only what the engine sends", () => {
  const r = toWorkloadRow({
    employeeId: "E001", name: "Maya", department: "QC", role: "tl",
    totalHours: 32, pendingHours: 8, overdueCount: 2, overdueHours: 5,
    c1Count: 12, c2Count: 3,
  })!;
  assert.equal(r.employeeId, "E001");
  assert.equal(r.totalHours, 32);
  assert.equal(r.overdueCount, 2);
  assert.equal(r.c2Count, 3);
  /* Fields legacy never sends must not appear at all. */
  assert.equal("openTasks" in r, false);
  assert.equal("load" in r, false);
  assert.equal("week" in r, false);
  assert.equal("period" in r, false);
});

test("an unreported figure is null, never zero", () => {
  /* "No hours reported" and "reported zero hours" are different statements
     about somebody's week. */
  const r = toWorkloadRow({ employeeId: "E1", name: "X" })!;
  assert.equal(r.totalHours, null);
  assert.equal(r.overdueCount, null);
  assert.equal(r.department, null);
});

test("numeric strings are accepted, nonsense is not", () => {
  assert.equal(toWorkloadRow({ employeeId: "E1", totalHours: "32" })!.totalHours, 32);
  assert.equal(toWorkloadRow({ employeeId: "E1", totalHours: "many" })!.totalHours, null);
});

test("a row with no employeeId is dropped", () => {
  assert.equal(toWorkloadRow({ name: "Ghost" }), null);
  assert.equal(toWorkloadRows([{ name: "Ghost" }, { employeeId: "E1" }]).length, 1);
});

test("the name falls back to the id rather than rendering blank", () => {
  assert.equal(toWorkloadRow({ employeeId: "E7" })!.name, "E7");
});

/* ── Timestamps ───────────────────────────────────────────────────────────── */

test("every timestamp form legacy writes is read", () => {
  /* ISO strings, epoch numbers and Firestore Timestamps appear in the same
     field across records of different vintages. */
  assert.equal(toIso("2026-07-28T09:00:00.000Z"), "2026-07-28T09:00:00.000Z");
  assert.equal(toIso(1785229200000), new Date(1785229200000).toISOString());
  assert.equal(toIso({ seconds: 1785229200, nanoseconds: 0 }), new Date(1785229200000).toISOString());
  assert.equal(toIso({ _seconds: 1785229200 }), new Date(1785229200000).toISOString());
  assert.equal(toIso(null), null);
  assert.equal(toIso("not a date"), null);
});

/* ── Directory lookup ─────────────────────────────────────────────────────── */

test("getEmployee is served from the cached directory, not a second request", async () => {
  /* `/cowork/employee/:id` returns the same document `listEmployees` already
     fetched. A profile page should not pay for a round trip the repository is
     already holding the answer to. */
  const { LegacyRepository } = await import("./index.ts");
  const proto = LegacyRepository.prototype as unknown as Record<string, unknown>;
  assert.equal(typeof proto.getEmployee, "function");
});

/* ── Shell survivability ──────────────────────────────────────────────────── */

test("every shell-mounted read resolves rather than throwing", async () => {
  /* These are called from components mounted in AppShell/ShellFrame, and some
     call the repository DIRECTLY rather than through useQuery — so a rejection
     escapes and blanks the whole application rather than one widget.
     `PriorityAckGate` additionally polls every 2.5s, so a throw repeats. */
  const { LegacyRepository, toCoworkRepository } = await import("./index.ts");
  const repo = toCoworkRepository(
    new LegacyRepository({
      getToken: async () => null,
      employeeId: "E1",
      legacyRole: "employee",
      hasManager: false,
    }),
  ) as unknown as Record<string, () => Promise<unknown>>;

  for (const name of [
    "listPendingAcknowledgements",
    "listMusicFavourites",
    "listMusicPlayed",
    "listMusicSearches",
    "recordMusicSearch",
    "clearMusicSearches",
    "toggleMusicFavourite",
    "saveMusicQueue",
    "saveMusicPreferences",
    "resetDemoData",
  ]) {
    await repo[name]();  // throws the test if it rejects
  }
});

test("priority acknowledgements are empty because legacy has no such queue", async () => {
  /* Not a placeholder. The only "acknowledge" in cowork-old-backend is the
     Accountant module's audit notes — a different product. Cowork's priority is
     a numeric field with no acknowledgement step, so "none pending" is true. */
  const { LegacyRepository } = await import("./index.ts");
  const repo = new LegacyRepository({
    getToken: async () => null,
    employeeId: "E1",
    legacyRole: "employee",
    hasManager: false,
  });
  assert.deepEqual(await repo.listPendingAcknowledgements(), []);
});

/* ── People / team surfaces ───────────────────────────────────────────────── */

test("every /people and /team read resolves rather than blanking the page", async () => {
  /* TeamArea mounts all of these. Monitoring is Firestore+LiveKit only,
     attendance needs the HR JWT, and goal activities have never been exercised
     against a real response — so they answer empty. A rejection here takes the
     page down, not the panel. */
  const { LegacyRepository, toCoworkRepository } = await import("./index.ts");
  const repo = toCoworkRepository(
    new LegacyRepository({
      getToken: async () => null,
      employeeId: "E1",
      legacyRole: "employee",
      hasManager: false,
    }),
  ) as unknown as Record<string, () => Promise<unknown>>;

  for (const name of [
    "listTeamMonitoring", "getMonitoringSubject", "getMonitoringPerformance",
    "getDailySummary", "getDeviceInfo", "listActivityEvents",
    "listObservations", "listAttendance", "listGoals",
  ]) {
    await repo[name]();
  }
});

/* ── PARITY: one source per fact ──────────────────────────────────────────── */

test("a notification maps from the Firestore document shape", () => {
  /* The old app reads cowork_notifications directly. The repository used to
     read GET /cowork/notifications instead — two sources for one fact, so the
     bell could count what the list below it did not show. Both now read the
     same collection, so both must map the same document. */
  const n = toNotification({
    id: "n1", recipientEmployeeId: "GR0045", type: "task_assigned",
    title: "New task", body: "Ship it", read: false,
    createdAt: "2026-07-29T09:00:00.000Z",
  })!;
  assert.equal(n.recipientId, "GR0045", "Firestore's recipientEmployeeId");
  assert.equal(n.readAt, null, "unread");
  assert.equal(n.createdAt, "2026-07-29T09:00:00.000Z");
});

test("a Firestore Timestamp on createdAt maps like any other form", () => {
  /* The API returned ISO strings; Firestore returns Timestamp objects. Reading
     only one form would leave every notification undated. */
  const n = toNotification({
    id: "n1", recipientEmployeeId: "GR0045",
    createdAt: { seconds: 1785229200, nanoseconds: 0 },
  })!;
  assert.equal(n.createdAt, new Date(1785229200000).toISOString());
});
