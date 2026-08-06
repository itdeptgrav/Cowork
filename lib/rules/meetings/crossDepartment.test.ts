import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_MEETINGS,
  creditInWindowFor,
  creditsInWindow,
  liveCrossDeptFigures,
  settleCrossDeptSession,
  sharedWindowSecs,
  type SettlementTask,
} from "./meetingCredit.ts";

/**
 * The CROSS-DEPARTMENT meeting rule — OWNER DECISION.
 *
 * Two things differ from an ordinary task, and both are here:
 *
 *  1. The clock runs only while the SENDER and the RECEIVER are in the room
 *     together. Either one missing and nobody earns anything.
 *  2. Everyone in that window earns their OWN time in it, against their OWN
 *     tasks — not the meeting's full length, and not each other's queues.
 *
 * The worked example this was agreed from, and the case that decides the shape:
 *
 *     meeting 10:00-11:00
 *       Pramod (receiver) 10:00-11:00
 *       Rakesh (sender)   10:10-10:50
 *       Sunil  (approver) 10:30-10:40
 *       Umung  (approver) 10:55-11:00
 *
 *     window = 10:10-10:50 = 40m
 *       Pramod +40   Rakesh +40   Sunil +10   Umung 0
 *
 * Umung is the one worth staring at: he was genuinely in the room for five
 * minutes, and they were five minutes after the meeting stopped being a meeting.
 */

const T0 = Date.UTC(2026, 7, 6, 4, 30); /* 10:00 IST */
const at = (min: number) => T0 + min * 60_000;
const mins = (secs: number) => secs / 60;

const SENDER = "rakesh";
const RECEIVER = "pramod";
const SUNIL = "sunil";
const UMUNG = "umung";

/** `[who, joined, left]` in minutes from the start; null left = still inside. */
function session(
  rows: Array<[string, number, number | null]>,
  endedAtMin = 60,
) {
  return {
    counterpartyId: SENDER,
    receiverId: RECEIVER,
    startedAtMs: T0,
    endedAtMs: at(endedAtMin),
    attendance: rows.map(([employeeId, joined, left]) => ({
      employeeId,
      joinedAtMs: at(joined),
      leftAtMs: left === null ? null : at(left),
    })),
  };
}

/* ── The agreed example, end to end ───────────────────────────────────────── */

test("THE WORKED EXAMPLE — 40m window, four people, four different answers", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 10, 50],
    [SUNIL, 30, 40],
    [UMUNG, 55, 60],
  ]);

  assert.equal(mins(sharedWindowSecs(s)), 40, "window is 10:10-10:50");
  assert.deepEqual(
    creditsInWindow(s).map((c) => `${c.employeeId} ${mins(c.secs)}m`),
    ["pramod 40m", "rakesh 40m", "sunil 10m"],
    "Umung earns nothing and is not listed — he arrived after the window closed",
  );
  assert.equal(creditInWindowFor(s, UMUNG), 0);
});

/* ── The window ───────────────────────────────────────────────────────────── */

test("both present throughout — the window is the whole meeting", () => {
  const s = session([
    [SENDER, 0, 60],
    [RECEIVER, 0, 60],
  ]);
  assert.equal(mins(sharedWindowSecs(s)), 60);
});

test("the window opens when the LATER of the two arrives", () => {
  assert.equal(mins(sharedWindowSecs(session([[SENDER, 20, 60], [RECEIVER, 0, 60]]))), 40);
  assert.equal(mins(sharedWindowSecs(session([[SENDER, 0, 60], [RECEIVER, 20, 60]]))), 40);
});

test("the window closes when the EARLIER of the two leaves", () => {
  assert.equal(mins(sharedWindowSecs(session([[SENDER, 0, 30], [RECEIVER, 0, 60]]))), 30);
  assert.equal(mins(sharedWindowSecs(session([[SENDER, 0, 60], [RECEIVER, 0, 30]]))), 30);
});

test("one side missing entirely — nobody earns anything", () => {
  /* The anti-cheat. A room full of people without the other side is not a
     meeting about this work. */
  const noSender = session([[RECEIVER, 0, 60], [SUNIL, 0, 60], [UMUNG, 0, 60]]);
  assert.equal(sharedWindowSecs(noSender), 0);
  assert.deepEqual(creditsInWindow(noSender), []);

  const noReceiver = session([[SENDER, 0, 60], [SUNIL, 0, 60]]);
  assert.equal(sharedWindowSecs(noReceiver), 0);
  assert.deepEqual(creditsInWindow(noReceiver), []);
});

test("they were both there, but never at the same time", () => {
  /* Ships past each other: sender 10:00-10:20, receiver 10:30-11:00. */
  const s = session([[SENDER, 0, 20], [RECEIVER, 30, 60]]);
  assert.equal(sharedWindowSecs(s), 0);
  assert.deepEqual(creditsInWindow(s), []);
});

test("a dropped connection: two windows, and the gap between is not counted", () => {
  /* Sender drops 10:20-10:40. The meeting is two stretches of twenty minutes. */
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 0, 20],
    [SENDER, 40, 60],
  ]);
  assert.equal(mins(sharedWindowSecs(s)), 40, "20 + 20, not 60");
});

test("an overlapping rejoin is merged, never paid twice", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 0, 30],
    [SENDER, 20, 50],
  ]);
  assert.equal(mins(sharedWindowSecs(s)), 50, "0-50 merged, not 30 + 30");
});

test("still in the room at the close — bounded at the close, not at now", () => {
  const s = session([[SENDER, 0, null], [RECEIVER, 0, null]], 25);
  assert.equal(mins(sharedWindowSecs(s)), 25);
});

test("clock skew and nonsense rows are ignored, never negative", () => {
  /* Rows entirely after the close, reversed rows and zero-length rows. */
  assert.equal(sharedWindowSecs(session([[SENDER, 70, 80], [RECEIVER, 70, 80]], 60)), 0);
  assert.equal(sharedWindowSecs(session([[SENDER, 30, 10], [RECEIVER, 0, 60]])), 0);
  assert.equal(sharedWindowSecs(session([[SENDER, 10, 10], [RECEIVER, 0, 60]])), 0);
  assert.equal(sharedWindowSecs(session([])), 0);
});

test("touching spans do not double-count the boundary", () => {
  /* Sender leaves at 10:30 and rejoins at 10:30 exactly. */
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 0, 30],
    [SENDER, 30, 60],
  ]);
  assert.equal(mins(sharedWindowSecs(s)), 60);
});

/* ── What each person earns ───────────────────────────────────────────────── */

test("the two sides always earn exactly the window", () => {
  const s = session([[SENDER, 10, 50], [RECEIVER, 0, 60]]);
  const w = sharedWindowSecs(s);
  assert.equal(creditInWindowFor(s, SENDER), w);
  assert.equal(creditInWindowFor(s, RECEIVER), w);
});

test("a third party earns only the part of their visit inside the window", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 10, 50],
    /* Sunil is there 10:00-11:00 — an hour — but the window is only 40m. */
    [SUNIL, 0, 60],
  ]);
  assert.equal(mins(creditInWindowFor(s, SUNIL)), 40, "capped by the window");
});

test("a third party who arrives before the window earns from when it opens", () => {
  const s = session([[RECEIVER, 0, 60], [SENDER, 30, 60], [SUNIL, 0, 45]]);
  assert.equal(mins(creditInWindowFor(s, SUNIL)), 15, "10:30-10:45");
});

test("a third party's own gaps are their own — merged, then clipped", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 0, 60],
    [SUNIL, 5, 15],
    [SUNIL, 40, 50],
  ]);
  assert.equal(mins(creditInWindowFor(s, SUNIL)), 20, "10 + 10");
});

test("somebody who never attended earns nothing and is not listed", () => {
  const s = session([[SENDER, 0, 60], [RECEIVER, 0, 60]]);
  assert.equal(creditInWindowFor(s, "a-stranger"), 0);
  assert.equal(
    creditsInWindow(s).some((c) => c.employeeId === "a-stranger"),
    false,
  );
});

test("an empty identity is never credited", () => {
  const s = session([["", 0, 60], [SENDER, 0, 60], [RECEIVER, 0, 60]]);
  assert.equal(creditInWindowFor(s, ""), 0);
  assert.deepEqual(
    creditsInWindow(s).map((c) => c.employeeId).sort(),
    [RECEIVER, SENDER],
  );
});

test("each person appears once however many times they joined", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 0, 20],
    [SENDER, 30, 60],
    [SUNIL, 0, 10],
    [SUNIL, 50, 60],
  ]);
  const ids = creditsInWindow(s).map((c) => c.employeeId);
  assert.equal(new Set(ids).size, ids.length, "somebody was listed twice");
});

/* ── The settlement ───────────────────────────────────────────────────────── */

const task = (
  taskId: string,
  over: Partial<SettlementTask> = {},
): SettlementTask => ({
  taskId,
  status: "in_progress",
  assigneeIds: [],
  totals: NO_MEETINGS,
  dueAtMs: at(600),
  windowSecs: 3600,
  rank: 1,
  ...over,
});

/** Each person owns their tasks, so `assigneeIds` is filled per queue. */
const queueFor = (who: string, tasks: SettlementTask[]) =>
  tasks.map((t) => ({ ...t, assigneeIds: [who] }));

test("each person's time lands on their OWN tasks", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 10, 50],
    [SUNIL, 30, 40],
  ]);

  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T017",
    tasksByEmployee: new Map([
      [RECEIVER, queueFor(RECEIVER, [task("PRAMOD-1")])],
      [SENDER, queueFor(SENDER, [task("RAKESH-1")])],
      [SUNIL, queueFor(SUNIL, [task("SUNIL-1")])],
    ]),
  });

  assert.equal(mins(r.creditedSecs), 40, "the session is worth the window");
  assert.deepEqual(
    r.updates.map(
      (u) => `${u.taskId} for=${u.forEmployeeId} +${mins(u.newWindowSecs! - 3600)}m`,
    ),
    [
      "PRAMOD-1 for=pramod +40m",
      "RAKESH-1 for=rakesh +40m",
      "SUNIL-1 for=sunil +10m",
    ],
  );
});

test("the session's worth is the WINDOW, not everybody's shares added up", () => {
  /* Four people in a forty-minute meeting cost forty minutes of wall clock. */
  const s = session([
    [RECEIVER, 0, 40],
    [SENDER, 0, 40],
    [SUNIL, 0, 40],
    [UMUNG, 0, 40],
  ]);
  assert.equal(mins(settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    tasksByEmployee: new Map(),
  }).creditedSecs), 40, "not 160");
});

test("a person with no tasks produces no updates and no error", () => {
  const s = session([[RECEIVER, 0, 30], [SENDER, 0, 30], [SUNIL, 0, 30]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    /* Sunil is a manager with nothing assigned to him. */
    tasksByEmployee: new Map([[RECEIVER, queueFor(RECEIVER, [task("P1")])]]),
  });
  assert.deepEqual(r.updates.map((u) => u.taskId), ["P1"]);
  assert.equal(mins(r.creditedSecs), 30, "the meeting was still worth 30m");
});

test("no window means no updates at all", () => {
  const s = session([[RECEIVER, 0, 60], [SUNIL, 0, 60]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    tasksByEmployee: new Map([[RECEIVER, queueFor(RECEIVER, [task("P1")])]]),
  });
  assert.equal(r.creditedSecs, 0);
  assert.deepEqual(r.updates, []);
});

test("each person's own queue shifts once — the head, not every task", () => {
  /* Option B, per person. Pramod has three tasks; only his P1 window grows,
     and the chain carries the shift to P2 and P3. */
  const s = session([[RECEIVER, 0, 30], [SENDER, 0, 30]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    tasksByEmployee: new Map([
      [
        RECEIVER,
        queueFor(RECEIVER, [
          task("P1", { rank: 1 }),
          task("P2", { rank: 2 }),
          task("P3", { rank: 3 }),
        ]),
      ],
      [SENDER, queueFor(SENDER, [task("R1", { rank: 1 }), task("R2", { rank: 2 })])],
    ]),
  });

  assert.deepEqual(
    r.updates.map((u) => `${u.taskId}:${u.newWindowSecs === null ? "-" : "grew"}`),
    ["P1:grew", "P2:-", "P3:-", "R1:grew", "R2:-"],
    "more than one window grew in somebody's queue",
  );
  /* Every task's stored date still shifts by the same 30 minutes. */
  assert.deepEqual(
    r.updates.map((u) => (u.newDueAtMs! - at(600)) / 60_000),
    [30, 30, 30, 30, 30],
  );
});

test("the host task, still held at approval, receives nothing", () => {
  /* A cross-department task waiting on its HODs is `pending_approval`, so it is
     not a live task — but the receiver's OTHER work still gets the time. This
     is the case that used to credit absolutely nothing. */
  const s = session([[RECEIVER, 0, 30], [SENDER, 0, 30]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "HELD",
    tasksByEmployee: new Map([
      [
        RECEIVER,
        queueFor(RECEIVER, [
          task("HELD", { status: "pending_approval" }),
          task("OTHER-1"),
          task("OTHER-2", { status: "confirmed", rank: 2 }),
        ]),
      ],
    ]),
  });
  assert.deepEqual(r.updates.map((u) => u.taskId), ["OTHER-1", "OTHER-2"]);
});

test("a task already credited this session is not credited again", () => {
  const s = session([[RECEIVER, 0, 30], [SENDER, 0, 30]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    tasksByEmployee: new Map([
      [RECEIVER, queueFor(RECEIVER, [task("P1", { rank: 1 }), task("P2", { rank: 2 })])],
    ]),
    alreadyCredited: ["P1"],
  });
  assert.deepEqual(r.updates.map((u) => u.taskId), ["P2"]);
  assert.equal(
    r.updates[0].newWindowSecs,
    null,
    "P2 absorbed the shift on a retry, moving the queue twice",
  );
});

test("the history sentence names each person's OWN minutes", () => {
  const s = session([[RECEIVER, 0, 60], [SENDER, 10, 50], [SUNIL, 30, 40]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T017",
    tasksByEmployee: new Map([
      [RECEIVER, queueFor(RECEIVER, [task("P1")])],
      [SUNIL, queueFor(SUNIL, [task("S1")])],
    ]),
  });
  assert.equal(r.updates.find((u) => u.taskId === "P1")!.reason, "Meeting time — 40m on T017");
  assert.equal(r.updates.find((u) => u.taskId === "S1")!.reason, "Meeting time — 10m on T017");
});

test("somebody else's task in a queue is never credited to them", () => {
  /* Belt and braces: `creditTargets` filters by assignee, so a queue that
     accidentally contained a colleague's task cannot pay the wrong person. */
  const s = session([[RECEIVER, 0, 30], [SENDER, 0, 30]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    tasksByEmployee: new Map([
      [
        RECEIVER,
        [
          { ...task("MINE"), assigneeIds: [RECEIVER] },
          { ...task("THEIRS"), assigneeIds: ["somebody-else"] },
        ],
      ],
    ]),
  });
  assert.deepEqual(r.updates.map((u) => u.taskId), ["MINE"]);
});

/* ── The live panel, per viewer ───────────────────────────────────────────── */

test("LIVE: each person watching sees their OWN number, not the meeting's", () => {
  /* 10:00 start, now 10:45. Window opened at 10:10 and is still open.
     Sunil looked in 10:30-10:40 and has gone. */
  const s = session(
    [
      [RECEIVER, 0, null],
      [SENDER, 10, null],
      [SUNIL, 30, 40],
    ],
    45,
  );
  const now = at(45);

  const pramod = liveCrossDeptFigures(s, RECEIVER, now);
  assert.equal(mins(pramod.elapsedSecs), 45, "wall clock is the same for all");
  assert.equal(mins(pramod.creditedSecs), 35, "10:10 to now");
  assert.equal(pramod.counting, true);

  const sunil = liveCrossDeptFigures(s, SUNIL, now);
  assert.equal(mins(sunil.elapsedSecs), 45);
  assert.equal(mins(sunil.creditedSecs), 10, "only his ten minutes");
  assert.equal(sunil.counting, false, "he has left the room");
});

test("LIVE: nothing counts for anybody while one side is missing", () => {
  const s = session([[RECEIVER, 0, null], [SUNIL, 0, null]], 30);
  for (const who of [RECEIVER, SUNIL]) {
    const f = liveCrossDeptFigures(s, who, at(30));
    assert.equal(f.creditedSecs, 0, `${who} earned while the sender was absent`);
    assert.equal(f.counting, false);
  }
});

test("LIVE: somebody outside the room sees the meeting but earns nothing", () => {
  const s = session([[RECEIVER, 0, null], [SENDER, 0, null]], 20);
  const umung = liveCrossDeptFigures(s, UMUNG, at(20));
  assert.equal(mins(umung.elapsedSecs), 20, "the meeting is visibly running");
  assert.equal(umung.creditedSecs, 0);
  assert.equal(umung.counting, false);
});

test("LIVE: the running figure equals what ending it now would credit", () => {
  /* The property that matters most: a panel that counts up to one number and
     settles at another teaches people the total is unreliable. */
  const s = session([[RECEIVER, 0, null], [SENDER, 5, null], [SUNIL, 10, 20]], 60);
  for (const now of [3, 8, 15, 25, 40].map(at)) {
    for (const who of [RECEIVER, SENDER, SUNIL]) {
      assert.equal(
        liveCrossDeptFigures(s, who, now).creditedSecs,
        creditInWindowFor({ ...s, endedAtMs: now }, who),
        `live and settled disagree for ${who}`,
      );
    }
  }
});
