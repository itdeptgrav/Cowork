import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_MEETINGS,
  conversationWindow,
  creditInWindowFor,
  creditsInWindow,
  liveCrossDeptFigures,
  secsOf,
  settleCrossDeptSession,
  sharedWindowSecs,
  type SettlementTask,
} from "./meetingCredit.ts";

/**
 * The CROSS-DEPARTMENT meeting rule — OWNER DECISION.
 *
 * Two things differ from an ordinary task, and both are here:
 *
 *  1. The clock runs while **any two people are in the room at the same time**,
 *     rather than only while the person who assigned the work is present.
 *  2. Everyone in that window earns their OWN time in it, against their OWN
 *     tasks — not the meeting's full length, and not each other's queues.
 *
 * ## The window used to name two people, and that was the bug
 *
 * It was the intersection of the SENDER of record and the RECEIVER of record.
 * Both absent, and the meeting was worth nothing to anybody — including the
 * people who were in it, talking. On cross-department work the sender of record
 * is frequently the department head who forwarded the task rather than anyone
 * in the call, so the window was empty on ordinary genuine meetings and nobody
 * was credited a second. Reported exactly that way, and changed by decision:
 * only the people who actually attended are credited, and two of them make it
 * a meeting.
 *
 * **Two people, not two particular people.** Somebody alone in a room still
 * earns nothing however long they leave it open, which is the whole point of
 * measuring attendance — you cannot hold a meeting with yourself.
 *
 * The worked example this was agreed from, and the case that decides the shape:
 *
 *     meeting 10:00-11:00
 *       Pramod (receiver) 10:00-11:00
 *       Rakesh (sender)   10:10-10:50
 *       Sunil  (approver) 10:30-10:40
 *       Umung  (approver) 10:55-11:00
 *
 *     conversation = 10:10-10:50 and 10:55-11:00 = 45m
 *       Pramod +45   Rakesh +40   Sunil +10   Umung +5
 *
 * Umung is the one worth staring at, and he is what changed. He arrives at
 * 10:55, long after the sender has gone — under the old rule his five minutes
 * were "in a room, not in a meeting" and worth nothing. Pramod was still there,
 * so under the two-people rule those five minutes are a conversation and both
 * of them earn it. The stretch from 10:50 to 10:55, with Pramod alone, is worth
 * nothing to anybody.
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

test("THE WORKED EXAMPLE — 45m of conversation, four people, four answers", () => {
  const s = session([
    [RECEIVER, 0, 60],
    [SENDER, 10, 50],
    [SUNIL, 30, 40],
    [UMUNG, 55, 60],
  ]);

  assert.equal(
    mins(secsOf(conversationWindow(s))),
    45,
    "10:10-10:50 with the sender, then 10:55-11:00 with Umung",
  );
  assert.deepEqual(
    creditsInWindow(s).map((c) => `${c.employeeId} ${mins(c.secs)}m`),
    ["pramod 45m", "rakesh 40m", "sunil 10m", "umung 5m"],
    "each earns their own time inside the conversation, and nobody earns the " +
      "five minutes Pramod spent alone",
  );
  assert.equal(creditInWindowFor(s, UMUNG), 5 * 60);

  /* The two sides were together for forty of those forty-five. Still true, and
     no longer what decides the credit. */
  assert.equal(mins(sharedWindowSecs(s)), 40);
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

test("one side missing — the people who DID attend are still credited", () => {
  /* The reported case, and the decision. A room full of people without the
     named sender is still a meeting: on cross-department work the sender of
     record is often the department head who forwarded the task and never joins
     the call. Crediting nobody for a conversation that plainly happened is what
     this rule was changed to stop. */
  const noSender = session([[RECEIVER, 0, 60], [SUNIL, 0, 60], [UMUNG, 0, 60]]);
  assert.equal(mins(secsOf(conversationWindow(noSender))), 60);
  assert.deepEqual(
    creditsInWindow(noSender).map((c) => `${c.employeeId} ${mins(c.secs)}m`),
    ["pramod 60m", "sunil 60m", "umung 60m"],
  );

  const noReceiver = session([[SENDER, 0, 60], [SUNIL, 0, 60]]);
  assert.deepEqual(
    creditsInWindow(noReceiver).map((c) => `${c.employeeId} ${mins(c.secs)}m`),
    ["rakesh 60m", "sunil 60m"],
  );

  /* Both sides absent is no different: it is the people in the room that make
     it a meeting, not which people they are. */
  const neither = session([[SUNIL, 0, 30], [UMUNG, 10, 60]]);
  assert.deepEqual(
    creditsInWindow(neither).map((c) => `${c.employeeId} ${mins(c.secs)}m`),
    ["sunil 20m", "umung 20m"],
    "10:10-10:30, the stretch they were both there",
  );
});

test("ONE person, however long — nobody earns alone", () => {
  /* The anti-cheat, and all that is left of it. Without this somebody could
     open a room, leave it running, and mint an unlimited deadline extension for
     an empty call — which is the reason attendance is recorded at all. */
  const alone = session([[RECEIVER, 0, 60]]);
  assert.equal(secsOf(conversationWindow(alone)), 0);
  assert.deepEqual(creditsInWindow(alone), []);

  /* Nor by rejoining: a reconnect is two rows and one person. */
  const rejoined = session([[RECEIVER, 0, 30], [RECEIVER, 20, 60]]);
  assert.equal(
    secsOf(conversationWindow(rejoined)),
    0,
    "somebody met themselves",
  );
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

test("a third party earns only the part of their visit spent with somebody", () => {
  /* Sunil is there for the whole hour, and the first twenty minutes of it he is
     on his own. Waiting in an empty room is not a meeting. */
  const s = session([
    [SUNIL, 0, 60],
    [RECEIVER, 20, 60],
    [SENDER, 30, 50],
  ]);
  assert.equal(mins(secsOf(conversationWindow(s))), 40, "10:20-11:00");
  assert.equal(mins(creditInWindowFor(s, SUNIL)), 40, "not the 60 he sat for");
});

test("a third party in the room with the receiver alone still earns it", () => {
  /* The change, at its smallest. The sender never comes; two other people talk
     for forty-five minutes. Under the old rule that was worth nothing to
     either of them. */
  const s = session([[RECEIVER, 0, 60], [SUNIL, 0, 45]]);
  assert.equal(mins(creditInWindowFor(s, SUNIL)), 45);
  assert.equal(mins(creditInWindowFor(s, RECEIVER)), 45, "and only the 45");
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

test("no window means nothing is CREDITED — but the meeting is recorded", () => {
  /* Nobody to talk to, so nobody earns a second. The session still happened,
     and the receiver's tasks record it: refusing the credit must not refuse the
     history, or every surface that asks "has this task ever met" goes on saying
     no after a meeting was held. It used to return nothing at all, which lost
     that.
     One person alone is the only empty window left — a room with two people in
     it is a conversation whoever they are. */
  const s = session([[RECEIVER, 0, 60]]);
  const r = settleCrossDeptSession({
    session: s,
    onTaskId: "T",
    tasksByEmployee: new Map([[RECEIVER, queueFor(RECEIVER, [task("P1")])]]),
  });
  assert.equal(r.creditedSecs, 0);

  assert.equal(r.updates.length, 1, "only the receiver, and only to record it");
  const [u] = r.updates;
  assert.equal(u.taskId, "P1");
  assert.equal(u.newDueAtMs, null, "a worthless session moves no date");
  assert.equal(u.newWindowSecs, null, "and grows no window");
  assert.equal(u.totals.totalSecs, 0);
  assert.notEqual(u.totals.firstStartedAtMs, null, "the meeting is on the record");
});

test("each person's whole queue gains the meeting — OWNER DECISION", () => {
  /* Every live task with a budget grows, per person, and priority decides
     nothing. This replaced a rule that grew one window per person — the head of
     their queue — which left the budget on the task people had just met about
     standing still unless it happened to be their top-ranked one. */
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
    ["P1:grew", "P2:grew", "P3:grew", "R1:grew", "R2:grew"],
    "somebody's task was left out",
  );
  /* And each person's own tasks only — the sender's queue never gains the
     receiver's minutes, which is what keeps two people's work apart. */
  assert.deepEqual(
    r.updates.map((u) => u.forEmployeeId),
    [RECEIVER, RECEIVER, RECEIVER, SENDER, SENDER],
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
  assert.deepEqual(
    r.updates.map((u) => u.taskId),
    ["P2"],
    "P1 was credited twice for one meeting",
  );
  /* P2 grows, and that is right: every live task gains the meeting exactly
     once, and this is P2's first. The retry-safety that matters is
     `alreadyCredited`, which is what keeps P1 out — under the rule this
     replaced, the guard was also load-bearing for WHICH task absorbed the
     shift, and it no longer has to be. */
  assert.equal(r.updates[0].newWindowSecs, 3600 + 30 * 60);
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

test("LIVE: two people in the room count, whoever they are", () => {
  /* The sender is absent and it counts anyway. The panel used to read "nothing
     is being added" through a conversation that was in fact being added to
     both of them — it required the two NAMED sides, and on cross-department
     work the named sender is often somebody who never joins. */
  const s = session([[RECEIVER, 0, null], [SUNIL, 0, null]], 30);
  for (const who of [RECEIVER, SUNIL]) {
    const f = liveCrossDeptFigures(s, who, at(30));
    assert.equal(mins(f.creditedSecs), 30, `${who} earned nothing`);
    assert.equal(f.counting, true);
  }
});

test("LIVE: one person alone is not counting, however long they wait", () => {
  const s = session([[RECEIVER, 0, null]], 30);
  const f = liveCrossDeptFigures(s, RECEIVER, at(30));
  assert.equal(f.creditedSecs, 0);
  assert.equal(f.counting, false);
  assert.equal(mins(f.elapsedSecs), 30, "the room is open, and says so");
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
