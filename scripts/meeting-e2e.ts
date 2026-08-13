/**
 * End-to-end proof, against the REAL repository rather than the rules alone.
 *
 *     npm run meeting:e2e
 *
 * `meeting:cases` exercises `lib/rules/meetings/`. This drives
 * `MockRepository.joinTaskMeeting / leaveTaskMeeting / endTaskMeeting` — the
 * same methods the product calls — so what is proved here is the WIRING: the
 * cross-department branch, the per-person settlement, the queue writes, and the
 * idempotency of closing a meeting that several people are leaving at once.
 *
 * The three faults this reproduces and then disproves, all reported from the
 * running product:
 *
 *   1. A fifteen-minute meeting moved a deadline by three quarters of an hour.
 *   2. Somebody who attended ten minutes was credited fifteen.
 *   3. A cross-department kickoff credited nobody anything at all.
 *
 * Attendance timestamps are written directly into the store after joining,
 * because the repository stamps `Date.now()` and this would otherwise have to
 * run for fifteen real minutes. Everything after that point — the branch, the
 * arithmetic, the writes, the idempotency — is the product's own code.
 *
 * Exits non-zero on any failure.
 */

import { mockRepository as repo } from "../lib/repositories/mock/index.ts";
import { getStore, resetStore, setActingId } from "../lib/repositories/mock/store.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

let passed = 0;
let failed = 0;

function check(label: string, got: unknown, want: unknown, note = "") {
  const ok = String(got) === String(want);
  if (ok) passed++;
  else failed++;
  console.log(
    `  ${ok ? `${GREEN}PASS${OFF}` : `${RED}FAIL${OFF}`}  ${label.padEnd(46)} ` +
      `${String(ok ? got : `${got}  ${RED}(expected ${want})${OFF}`).padEnd(16)} ${DIM}${note}${OFF}`,
  );
}

function heading(text: string) {
  console.log(`\n${text}`);
  console.log("  " + "─".repeat(78));
}

const mins = (secs: number) => `${Math.round(secs / 60)}m`;
const hhmm = (iso: string | null) =>
  iso === null
    ? "—"
    : new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });

/* ── The cast ─────────────────────────────────────────────────────────────── */

const SENDER = "e-02"; /* Rakesh's part — raised the work */
const RECEIVER = "e-03"; /* Pramod's part — doing the work */
const APPROVER = "e-04"; /* Sunil's part — joined late for ten minutes */

/* Anchored in the RECENT PAST, not at a fixed date: the first `endTaskMeeting`
   call stamps the close from the real clock, and a meeting timestamped in the
   future would be clamped away to nothing. Twenty minutes back leaves the whole
   fifteen-minute meeting behind us. */
const T0 = Date.now() - 20 * 60_000;
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

/**
 * A beat from a browser that is in the room RIGHT NOW.
 *
 * The fixtures below backdate joins by minutes so a fifteen-minute meeting can
 * be proved in milliseconds — but presence is now evidenced by beats against
 * the real clock, so "still here" has to be stamped against the real clock too.
 * An open row with no beat describes somebody who walked out and left the tab
 * open, which is a different scenario with its own cases below.
 */
const beating = () => new Date().toISOString();

/**
 * A live task for one person, with a three-hour budget and a 17:00 deadline —
 * the shape from the report.
 */
function giveTask(id: string, who: string, title: string) {
  const s = getStore();
  const seedTask = s.tasks[0];
  s.tasks.push({
    ...structuredClone(seedTask),
    id,
    title,
    status: "in_progress",
    createdById: SENDER,
    pendingAssigneeIds: [],
    isCrossDepartment: false,
    deletedAt: null,
    meetings: { firstStartedAt: null, lastEndedAt: null, totalSecs: 0 },
    deadline: {
      ...structuredClone(seedTask.deadline),
      dueAt: "2026-08-06T17:00:00.000Z",
      officialDueAt: "2026-08-06T17:00:00.000Z",
      currentWindowSecs: 3 * 3600,
      state: "agreed",
    },
  } as never);
  s.assignments.push({
    id: `a-${id}`,
    taskId: id,
    employeeId: who,
    rank: 1,
    queuePosition: 1,
    provisionalPosition: null,
    assignedAt: at(0),
    confirmedAt: at(0),
    startedAt: at(0),
    isScoreSubject: true,
  } as never);
  return s.tasks[s.tasks.length - 1];
}

const budgetOf = (id: string) =>
  getStore().tasks.find((t) => t.id === id)!.deadline.currentWindowSecs ?? 0;
const dueOf = (id: string) =>
  getStore().tasks.find((t) => t.id === id)!.deadline.dueAt;

async function main() {
  /* ── Set the stage ────────────────────────────────────────────────────────── */

  resetStore();

  /* The cross-department task the meeting is held about, plus one live task each
     for the three people in the room — the queues their credit must land on. */
  const HOST = "X-CROSS";
  const host = giveTask(HOST, RECEIVER, "Cross-department work");
  host.isCrossDepartment = true;
  /* The receiving side's HOD, recorded on the task the way the department gate
     records them. It is what lets him into the room at all. */
  host.approverIds = [APPROVER];

  giveTask("R-1", RECEIVER, "Receiver's other work");
  giveTask("S-1", SENDER, "Sender's own work");
  giveTask("A-1", APPROVER, "Approver's own work");

  const before = {
    [HOST]: budgetOf(HOST),
    "R-1": budgetOf("R-1"),
    "S-1": budgetOf("S-1"),
    "A-1": budgetOf("A-1"),
  };

  heading("SETUP  (a cross-department task, three people, one 15-minute meeting)");
  check("host task is cross-department", host.isCrossDepartment, "true");
  check("everybody starts on a 3h budget", mins(before[HOST]), "180m");
  check("everybody's deadline starts at", hhmm(dueOf(HOST)), hhmm("2026-08-06T17:00:00.000Z"));

  /* ── The meeting ──────────────────────────────────────────────────────────── */

  setActingId(RECEIVER);
  const joinR = await repo.joinTaskMeeting(HOST as never);
  if (!joinR.ok) throw new Error(`receiver could not join: ${joinR.message}`);
  setActingId(SENDER);
  const joinS = await repo.joinTaskMeeting(HOST as never);
  if (!joinS.ok) throw new Error(`sender could not join: ${joinS.message}`);
  setActingId(APPROVER);
  const joinA = await repo.joinTaskMeeting(HOST as never);
  if (!joinA.ok) throw new Error(`approver could not join: ${joinA.message}`);

  const sessionId = joinR.data.sessionId;
  const session = getStore().taskMeetingSessions.find((x) => x.id === sessionId)!;

  heading("JOINING  (all three are named on the task, so all three are let in)");
  check("one session, not three", getStore().taskMeetingSessions.length, 1);
  check("everyone reached the same room", joinS.data.sessionId, sessionId);
  check("people in the room", session.attendance.length, 3);

  setActingId("e-06");
  const stranger = await repo.joinTaskMeeting(HOST as never);
  check(
    "somebody not named on the task",
    stranger.ok ? "let in" : "refused",
    "refused",
    stranger.ok ? "" : stranger.message,
  );

  /* The spans from the report: a 15-minute meeting, with the approver arriving
     five minutes late. Written directly because the repository stamps the real
     clock and this would otherwise take fifteen minutes to run. */
  session.startedAt = at(0);
  session.attendance = [
    { employeeId: RECEIVER, joinedAt: at(0), leftAt: at(15) },
    { employeeId: SENDER, joinedAt: at(0), leftAt: at(15) },
    { employeeId: APPROVER, joinedAt: at(5), leftAt: at(15) },
  ];

  /* ── Everybody leaves — three separate `endTaskMeeting` calls ─────────────── */

  heading("CLOSING  (each of the three ends the meeting on their way out)");

  for (const [n, who] of [RECEIVER, SENDER, APPROVER].entries()) {
    setActingId(who);
    const r = await repo.endTaskMeeting({ taskId: HOST as never, sessionId });
    if (!r.ok) throw new Error(`end #${n + 1} failed: ${r.message}`);
    check(
      `end call ${n + 1} of 3 — session worth`,
      mins(r.data.creditedSecs),
      "15m",
      n === 0 ? "the window" : "unchanged by a repeat call",
    );
  }

  /* ── What actually moved ──────────────────────────────────────────────────── */

  heading("RESULT  (each person's own queue, credited once)");

  check(
    "receiver's live task grew by",
    mins(budgetOf("R-1") - before["R-1"]),
    "15m",
    "the whole window",
  );
  check(
    "sender's own task grew by",
    mins(budgetOf("S-1") - before["S-1"]),
    "15m",
    "he lost the same 15 minutes",
  );
  check(
    "approver's own task grew by",
    mins(budgetOf("A-1") - before["A-1"]),
    "10m",
    "he arrived five minutes late",
  );
  check(
    "host task (already live) grew by",
    mins(budgetOf(HOST) - before[HOST]),
    "15m",
    "every held task gains the meeting",
  );

  heading("THE THREE REPORTED FAULTS");

  check(
    "15m meeting did NOT move a deadline by 45m+",
    mins(budgetOf("R-1") - before["R-1"]),
    "15m",
    "was ~45m — settled three times",
  );
  check(
    "a 10-minute attendee got 10, not 15",
    mins(budgetOf("A-1") - before["A-1"]),
    "10m",
    "was 15m — the session re-closed later",
  );
  check(
    "a cross-department meeting credited somebody",
    budgetOf("R-1") > before["R-1"] ? "yes" : "no",
    "yes",
    "was: nothing at all, assigneeIds was empty",
  );

  /* ── A short visitor must not end the meeting ─────────────────────────────── */

  heading("A ONE-MINUTE VISITOR  (the HOD looks in and leaves; the others talk on)");

  /* Reported: the HOD joined for a minute and left, and the two people still
     talking were credited ONE minute for a ten-minute conversation — because
     his departure closed the session and clamped everybody's spans to it. */
  const V = "V-CROSS";
  const visited = giveTask(V, RECEIVER, "Cross-department, with a visitor");
  visited.isCrossDepartment = true;
  visited.approverIds = [APPROVER];
  const vBefore = {
    R: budgetOf("R-1"),
    S: budgetOf("S-1"),
    A: budgetOf("A-1"),
  };

  for (const who of [RECEIVER, SENDER, APPROVER]) {
    setActingId(who);
    const j = await repo.joinTaskMeeting(V as never);
    if (!j.ok) throw new Error(`${who} could not join: ${j.message}`);
  }
  const vId = getStore().taskMeetingSessions.find(
    (x) => x.taskId === V && x.endedAt === null,
  )!.id;
  const vSession = getStore().taskMeetingSessions.find((x) => x.id === vId)!;

  /* The HOD is in for one minute of a ten-minute meeting and has left; the two
     mandatory people are still in the room. */
  vSession.startedAt = at(0);
  /* Still in the room, and SAYING SO. An open row is no longer presence on its
     own — a browser that stopped beating is somebody who has gone, and that is
     what lets an abandoned room settle itself. So a fixture meaning "these two
     are still talking" has to carry a beat, exactly as a live panel sends one
     every twenty seconds. Without it, this closed a ten-minute conversation one
     minute in. */
  vSession.attendance = [
    { employeeId: RECEIVER, joinedAt: at(0), leftAt: null, lastSeenAt: beating() },
    { employeeId: SENDER, joinedAt: at(0), leftAt: null, lastSeenAt: beating() },
    { employeeId: APPROVER, joinedAt: at(1), leftAt: at(2) },
  ];

  setActingId(APPROVER);
  const early = await repo.endTaskMeeting({ taskId: V as never, sessionId: vId });
  if (!early.ok) throw new Error(early.message);
  check("visitor leaves — session closed?", vSession.endedAt === null ? "no" : "yes", "no", "others are still talking");
  check("visitor leaves — anybody credited?", mins(early.data.creditedSecs), "0m", "nothing settles yet");
  check("the two are still counting", budgetOf("R-1") - vBefore.R, 0, "no premature credit");

  /* Now the two finish, ten minutes in. */
  vSession.attendance = [
    { employeeId: RECEIVER, joinedAt: at(0), leftAt: at(10) },
    { employeeId: SENDER, joinedAt: at(0), leftAt: at(10) },
    { employeeId: APPROVER, joinedAt: at(1), leftAt: at(2) },
  ];
  setActingId(RECEIVER);
  const done = await repo.endTaskMeeting({ taskId: V as never, sessionId: vId });
  if (!done.ok) throw new Error(done.message);

  check("last one out — session worth", mins(done.data.creditedSecs), "10m", "the whole conversation");
  check("receiver credited", mins(budgetOf("R-1") - vBefore.R), "10m", "not 1m");
  check("sender credited", mins(budgetOf("S-1") - vBefore.S), "10m", "not 1m");
  check("the HOD credited", mins(budgetOf("A-1") - vBefore.A), "1m", "his own minute");

  /* ── Rejoining, and leaving by closing the tab ────────────────────────────── */

  heading("REJOINS & TAB-CLOSE  (your two questions, answered by the product)");

  const W = "W-CROSS";
  const wTask = giveTask(W, RECEIVER, "Cross-department, with rejoins");
  wTask.isCrossDepartment = true;
  wTask.approverIds = [APPROVER];
  const wBefore = { R: budgetOf("R-1"), S: budgetOf("S-1"), A: budgetOf("A-1") };

  for (const who of [RECEIVER, SENDER, APPROVER]) {
    setActingId(who);
    const j = await repo.joinTaskMeeting(W as never);
    if (!j.ok) throw new Error(`${who} could not join: ${j.message}`);
  }
  const wId = getStore().taskMeetingSessions.find(
    (x) => x.taskId === W && x.endedAt === null,
  )!.id;
  const wSession = getStore().taskMeetingSessions.find((x) => x.id === wId)!;

  /* Both mandatory people are in for the whole 20 minutes and never press
     Leave. The HOD joins THREE times — 1m, then 2m, then 1m overlapping his
     own second visit, which must merge rather than add. */
  wSession.startedAt = at(0);
  wSession.attendance = [
    { employeeId: RECEIVER, joinedAt: at(0), leftAt: null, lastSeenAt: beating() },
    { employeeId: SENDER, joinedAt: at(0), leftAt: null, lastSeenAt: beating() },
    { employeeId: APPROVER, joinedAt: at(2), leftAt: at(3) },
    { employeeId: APPROVER, joinedAt: at(6), leftAt: at(8) },
    { employeeId: APPROVER, joinedAt: at(7), leftAt: at(8) },
  ];

  /* Everybody closes their tab — `beforeunload` records a departure and never
     calls the explicit close. The LAST departure has to settle it. */
  for (const who of [APPROVER, SENDER, RECEIVER]) {
    setActingId(who);
    /* The receiver is last, and is still marked present, so their leave stamps
       now — 20 minutes in, per the fixture below. */
    if (who === RECEIVER || who === SENDER) {
      const row = wSession.attendance.find(
        (a) => a.employeeId === who && a.leftAt === null,
      )!;
      row.leftAt = at(20);
    }
    const r = await repo.leaveTaskMeeting({ taskId: W as never, sessionId: wId });
    if (!r.ok) throw new Error(`${who} could not leave: ${r.message}`);
  }

  check("nobody pressed Leave — did it settle?", wSession.endedAt === null ? "no" : "yes", "yes", "the last departure closed it");
  check("the two who never left, credited", mins(budgetOf("R-1") - wBefore.R), "20m", "the whole meeting");
  check("the sender, credited", mins(budgetOf("S-1") - wBefore.S), "20m");
  check("HOD joined 3 times (1m + 2m, overlapping)", mins(budgetOf("A-1") - wBefore.A), "3m", "merged, not 4m");

  /* ── The anti-cheat still holds ───────────────────────────────────────────── */

  /* On a CROSS-DEPARTMENT task the clock runs while any two people are in the
     room together — the sender of record is often the head who forwarded the
     work and never joins the call, and crediting nobody for a conversation
     that plainly happened is what that changed. So the protection is no longer
     "the named sender must be there"; it is that nobody earns ALONE. */
  heading("ANTI-CHEAT  (a room with one person in it, and a room with two)");

  const budgetBefore = budgetOf("R-1");
  setActingId(RECEIVER);
  const solo = await repo.joinTaskMeeting(HOST as never);
  if (!solo.ok) throw new Error(solo.message);
  const soloSession = getStore().taskMeetingSessions.find(
    (x) => x.id === solo.data.sessionId,
  )!;
  soloSession.startedAt = at(16);
  soloSession.attendance = [
    { employeeId: RECEIVER, joinedAt: at(16), leftAt: at(19) },
  ];
  const soloEnd = await repo.endTaskMeeting({
    taskId: HOST as never,
    sessionId: solo.data.sessionId,
  });
  if (!soloEnd.ok) throw new Error(soloEnd.message);

  check("three minutes on his own", mins(soloEnd.data.creditedSecs), "0m");
  check("receiver's budget after it", mins(budgetOf("R-1") - budgetBefore), "0m", "nobody earns alone");

  /* And the case the rule was changed for: two people, neither of them the
     sender of record. */
  const pairBefore = { R: budgetOf("R-1"), A: budgetOf("A-1") };
  setActingId(RECEIVER);
  const pair = await repo.joinTaskMeeting(HOST as never);
  if (!pair.ok) throw new Error(pair.message);
  const pairSession = getStore().taskMeetingSessions.find(
    (x) => x.id === pair.data.sessionId,
  )!;
  pairSession.startedAt = at(20);
  pairSession.attendance = [
    { employeeId: RECEIVER, joinedAt: at(20), leftAt: at(25) },
    { employeeId: APPROVER, joinedAt: at(20), leftAt: at(25) },
  ];
  const pairEnd = await repo.endTaskMeeting({
    taskId: HOST as never,
    sessionId: pair.data.sessionId,
  });
  if (!pairEnd.ok) throw new Error(pairEnd.message);

  check("five minutes, sender absent — worth", mins(pairEnd.data.creditedSecs), "5m", "two people is a meeting");
  check("  the receiver credited", mins(budgetOf("R-1") - pairBefore.R), "5m");
  check("  the approver credited", mins(budgetOf("A-1") - pairBefore.A), "5m", "his own tasks");

  /* ── Summary ──────────────────────────────────────────────────────────────── */

  console.log("\n" + "─".repeat(80));
  if (failed === 0) {
    console.log(`  ${GREEN}ALL ${passed} END-TO-END CHECKS PASSED${OFF}`);
  } else {
    console.log(`  ${RED}${failed} of ${passed + failed} FAILED${OFF}`);
  }
  console.log(
    `\n  ${DIM}Driven through MockRepository — the same join/leave/end methods the\n` +
      `  product calls. Firestore is not exercised; the legacy repository runs the\n` +
      `  same settlement through the same rules.${OFF}\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
