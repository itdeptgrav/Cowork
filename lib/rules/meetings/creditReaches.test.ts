import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_MEETINGS, settleSession, type SettlementTask } from "./meetingCredit.ts";

/**
 * Does the credit actually REACH the screen?
 *
 * `meetingCredit.test.ts` already proves the arithmetic. It cannot prove that
 * the repositories persist it, and for three separate reasons they did not:
 *
 *  1. Both applied the settlement only `if (newDueAtMs !== null)` — and a task
 *     whose date is derived from the receiver's queue rather than typed by the
 *     creator reports exactly that. The grown WINDOW went in the bin.
 *  2. `#compensateOneDeadline` returned early when the task had no stored
 *     deadline field, before writing the budget.
 *  3. `endTaskMeeting` never called `notifyRepositoryChanged()`, so the open
 *     Details panel kept rendering the figures it fetched before the meeting.
 *
 * Every one of them shows up to a reader as the same thing: a meeting is
 * recorded, the sessions list shows the seconds, and Expected completion does
 * not move. The unit tests were green throughout.
 *
 * Source-read because the repositories need Firestore and a mock store; what is
 * asserted is that the wiring cannot silently revert to any of the three.
 */

const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

function endTaskMeetingBody(file: string): string {
  const src = readFileSync(file, "utf8");
  const from = src.indexOf("async endTaskMeeting");
  assert.ok(from > 0, `${file} has no endTaskMeeting`);
  const to = src.indexOf("async listTaskMeetingSessions", from);
  assert.ok(to > from, `${file}: could not bound endTaskMeeting`);
  return src.slice(from, to);
}

/* ── The rule the repositories have to honour ─────────────────────────────── */

test("a task with a budget and NO stored due date still grows its window", () => {
  /* The exact shape from the report: 20 minutes of budget, no stored date,
     five minutes of meeting. This is the ordinary task, not an edge case —
     the creator sets hours and the date comes from the queue. */
  const task: SettlementTask = {
    taskId: "T012",
    status: "in_progress",
    assigneeIds: ["pramod"],
    totals: NO_MEETINGS,
    dueAtMs: null,
    windowSecs: 20 * 60,
    rank: 1,
  };

  const start = Date.UTC(2026, 7, 5, 11, 31);
  const settlement = settleSession({
    session: {
      counterpartyId: "rakesh",
      startedAtMs: start,
      endedAtMs: start + 5 * 60_000,
      /* Both of them in the room: everybody earns their own time in it, so the
         person whose window this asserts has to have been there. */
      attendance: [
        { employeeId: "rakesh", joinedAtMs: start, leftAtMs: start + 5 * 60_000 },
        { employeeId: "pramod", joinedAtMs: start, leftAtMs: start + 5 * 60_000 },
      ],
    },
    onTaskId: "T012",
    receiverId: "pramod",
    tasksByEmployee: new Map([["pramod", [task]]]),
  });

  const update = settlement.updates[0];
  assert.equal(update.newDueAtMs, null, "there was no date to move");
  assert.equal(
    update.newWindowSecs,
    25 * 60,
    "the window must still grow — it is what Expected completion is computed from",
  );
});

/* ── That the repositories do not throw it away ───────────────────────────── */

for (const file of [LEGACY, MOCK]) {
  test(`${file}: the settlement is applied on EITHER axis`, () => {
    const body = endTaskMeetingBody(file);

    assert.ok(
      !/if \(update\.newDueAtMs !== null\)\s*\{/.test(body),
      "The settlement is gated on the date alone. On a task whose date is " +
        "derived rather than stored, that discards the grown window and the " +
        "meeting moves nothing a reader can see.",
    );
    assert.ok(
      !/update\.newDueAtMs !== null && [a-z]/i.test(body),
      "The date is ANDed with something. Either axis alone must be enough.",
    );
    assert.match(
      body,
      /update\.newDueAtMs !== null \|\| update\.newWindowSecs !== null/,
      "Expected the apply to run when either the date or the window changed.",
    );
  });
}

test("the legacy writer does not bail out before writing the budget", () => {
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  assert.ok(from > 0);
  const body = src.slice(from, src.indexOf("async #compensateActiveDeadlines", from));

  assert.ok(
    !/if \(field === null\) return;/.test(body),
    "The writer returns as soon as the task has no stored deadline field — " +
      "which is most tasks — before it writes `deadlineWindowSecs`. That is " +
      "the one write Expected completion depends on.",
  );
  assert.match(
    body,
    /if \(!movesDate && !growsWindow\) return;/,
    "Expected the early return to require BOTH axes to be absent.",
  );
  /* The window write must not sit behind the date's condition. */
  assert.match(body, /growsWindow\s*\?\s*\{\s*deadlineWindowSecs/);
});

test("closing a meeting tells the open screens to re-read", () => {
  /* Without this the write is correct and invisible: `useQuery` holds the
     figures fetched before the meeting, so a reader sees the sessions list gain
     a row and Expected completion stay exactly where it was. */
  for (const file of [LEGACY, MOCK]) {
    const body = endTaskMeetingBody(file);
    const notifies =
      /notifyRepositoryChanged\(\)/.test(body) ||
      /* The mock mutates a shared store its own hook already watches. */
      file === MOCK;
    assert.ok(
      notifies,
      `${file}: endTaskMeeting moves deadlines and never announces it, so the ` +
        `panel keeps showing the pre-meeting figures.`,
    );
  }
});

test("the deadline history still records why a date moved", () => {
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  const body = src.slice(from, src.indexOf("async #compensateActiveDeadlines", from));

  assert.match(body, /cowork_task_deadline_extensions/);
  assert.match(body, /previousDeadline:/);
  assert.match(body, /proposedDeadline:/);
});

test("the credit follows the ASSIGNER OF RECORD, not whoever created it", () => {
  /* The self-task hole, guarded at the wiring rather than only in the rule.
     `creditableSecs` counts `counterpartyId`; if the repository fills that from
     `createdById`, then on a self task — where the creator IS the assignee —
     somebody can sit alone in a room and mint their own deadline. The engine
     already names the right person in `assignedBy`: the assignee's manager,
     because nobody negotiates a budget with or reviews their own work.

     Order matters in the fallback. `assignedById ?? createdById` is correct;
     the other way round silently restores the hole on exactly the task that
     needs it closed, and every ordinary task would still pass. */
  const settle = endTaskMeetingBody(LEGACY);
  const m = settle.match(/counterpartyId:\s*([^\n]+)/);
  assert.ok(m, "endTaskMeeting no longer names who the credit follows");

  assert.match(
    m![1],
    /assignedById/,
    "The meeting clock is not reading the assigner of record, so a self task " +
      "credits the assignee for their own attendance.",
  );
  assert.ok(
    m![1].indexOf("assignedById") < m![1].indexOf("createdById"),
    "`createdById` is preferred over `assignedById`. On a self task that is " +
      "the assignee, and the anti-cheat is gone.",
  );
});

test("a meeting NEVER asks anybody to approve or confirm it", () => {
  /* The bug this holds shut, because it looked like the responsible thing to
     do: a window-only credit filed a `cowork_task_budget_extensions` row so the
     change would have an account. That collection is a NEGOTIATION — an
     approved row in it means "your manager offered you this, confirm it to put
     it in force" — so the meeting produced a card asking the assignee to accept
     5m08s, and accepting would have SET the budget to 5m08s instead of adding
     to it. A meeting needs no approval; the creator's attendance is the
     evidence. It must never enter a flow whose premise is that somebody agrees.
  */
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  const body = src.slice(from, src.indexOf("async #compensateActiveDeadlines", from));

  assert.ok(
    !/addDoc\(\s*\n?\s*collection\([^)]*cowork_task_budget_extensions/.test(body),
    "The meeting credit files a budget-extension request, which the assignee " +
      "is then asked to accept.",
  );
  assert.ok(
    !/timeBudgetExtension\(/.test(body),
    "The meeting credit builds a budget NEGOTIATION record.",
  );

  /* And the same for the settlement that drives it — nothing on this path may
     produce a record somebody has to answer. */
  const settle = endTaskMeetingBody(LEGACY);
  for (const negotiation of [
    "cowork_task_budget_extensions",
    "timeBudgetExtension(",
    "requestTimeBudgetExtension",
  ]) {
    assert.ok(
      !settle.includes(negotiation),
      `endTaskMeeting reaches for ${negotiation} — a meeting applies itself.`,
    );
  }
});

/* ── The cross-department branch ──────────────────────────────────────────── */

test("a gated task resolves its receiver from pendingAssigneeId FIRST", () => {
  /* The bug: a cross-department task carries `assigneeIds: []` until its
     approvals clear — the engine's own visibility rule — so reading
     `assigneeIds[0]` returned "" on exactly the tasks a kickoff is held about.
     The queue lookup was skipped and an hour of meeting credited nobody.
     Order matters: `assigneeIds` first would restore the bug on the gated task
     while every ordinary task kept passing. */
  for (const file of [LEGACY, MOCK]) {
    const body = endTaskMeetingBody(file);
    const m = body.match(/const assigneeId = String\(([\s\S]*?)\n\s*\);/);
    assert.ok(m, `${file}: endTaskMeeting no longer resolves a receiver`);
    const expr = m![1];
    assert.match(
      expr,
      /pendingAssignee/i,
      `${file}: the receiver is read from assigneeIds alone, so a task still ` +
        `awaiting department approval credits nobody anything.`,
    );
    assert.ok(
      expr.search(/pendingAssignee/i) < expr.search(/assigneeIds|assignments/),
      `${file}: assigneeIds is preferred over pendingAssigneeId.`,
    );
  }
});

test("the settlement branches on the TASK, not on who is in the room", () => {
  /* Branching on attendance would let one meeting settle two different ways
     depending on who happened to join it. */
  for (const file of [LEGACY, MOCK]) {
    const body = endTaskMeetingBody(file);
    assert.match(
      body,
      /isCrossDepartment/,
      `${file}: cross-department work is not settled by its own rule.`,
    );
    assert.match(
      body,
      /settleCrossDeptSession\(/,
      `${file}: the shared-window settlement is never called.`,
    );
    assert.match(
      body,
      /settleSession\(/,
      `${file}: the ordinary rule was lost when the branch was added.`,
    );
  }
});

test("the shared window is built from the RECEIVER, not from any attendee", () => {
  for (const file of [LEGACY, MOCK]) {
    const body = endTaskMeetingBody(file);
    assert.match(
      body,
      /receiverId: assigneeId/,
      `${file}: the window's second side is not the receiver of the work.`,
    );
  }
});

test("each person's history row is filed in THEIR name", () => {
  /* Several people's deadlines move in one cross-department settlement. A
     single shared id would file everybody's shift under whoever was first. */
  const src = readFileSync(LEGACY, "utf8");
  assert.match(
    src,
    /byEmployeeId: update\.forEmployeeId/,
    "the deadline-history row names one fixed person for every update",
  );
});

/* ── Closing the same meeting more than once ──────────────────────────────── */

test("a meeting closes ONCE — a later call must not re-close it at a new instant", () => {
  /* Everybody in the room calls `endTaskMeeting` on their way out, so a
     three-person meeting is three calls. Reading the clock afresh each time
     re-closed the session later and later, and anybody still marked present was
     credited up to the NEW close — so the same meeting grew every time somebody
     left, and a ten-minute visitor came out with fifteen. */
  const legacy = endTaskMeetingBody(LEGACY);
  /* The recorded end comes FIRST, whatever follows it. What follows is
     `roomEmptiedAtMs` — an abandoned session closes at the moment the room
     actually emptied rather than when somebody noticed — and that fallback is
     only ever reached on a session with no recorded end at all. */
  assert.match(
    legacy,
    /const endedAtMs =\s*\n?\s*readInstant\(session\.endedAt\) \?\?/,
    "the legacy close reads the clock instead of the session's recorded end",
  );
  assert.ok(
    !/const endedAtMs = Date\.now\(\);/.test(legacy),
    "the legacy close still stamps a fresh instant on an already-closed session",
  );

  const mock = endTaskMeetingBody(MOCK);
  assert.match(
    mock,
    /session\.endedAt\s*\n?\s*\?\s*Date\.parse\(session\.endedAt\)/,
    "the mock close reads the clock instead of the session's recorded end",
  );
});

test("the credited-task record is MERGED, never replaced", () => {
  /* The second person to leave credits nothing — the first call already did it —
     and writing only that call's result wiped the record back to empty. The
     third person's call then found nothing marked and paid the whole meeting
     again. Three people in a room paid the credit roughly twice. */
  const body = endTaskMeetingBody(LEGACY);
  assert.ok(
    !/creditedTaskIds: settlement\.updates\.map\(\(u\) => u\.taskId\),\s*\n\s*\}\);/.test(
      body,
    ),
    "creditedTaskIds is written from this call alone, wiping what earlier " +
      "calls had already recorded.",
  );
  assert.match(
    body,
    /new Set\(\[\.\.\.alreadyCredited,/,
    "expected the already-credited ids to be carried into the new record",
  );
});

/* ── Seeing work you sent ─────────────────────────────────────────────────── */

test("a task you ASSIGNED is fetched whatever your role", () => {
  /* Reported: work sent to another department vanished from the sender's own
     list. The `assignedBy` query was behind `role === "ceo" || role === "tl"`,
     so an ordinary employee got `assigneeIds array-contains` alone — and a
     cross-department task carries `assigneeIds: []` until its approvals clear.
     Nothing they could query matched it. Seniority was never the right test for
     "may I see what I sent". */
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #taskDocuments");
  assert.ok(from > 0, "the task fetch was renamed");
  const body = src.slice(from, src.indexOf("backfillFolderParents", from));

  const assignedBy = body.indexOf('where("assignedBy", "==", viewerId)');
  assert.ok(assignedBy > 0, "tasks are no longer fetched by who assigned them");

  const roleGate = body.indexOf('role === "ceo" || role === "tl"');
  assert.ok(
    roleGate === -1 || assignedBy < roleGate,
    "the assignedBy query sits behind a role check again, so an employee " +
      "cannot see the work they gave to another department.",
  );
});

/* ── Who is allowed to end a meeting ──────────────────────────────────────── */

test("a meeting is closed by the LAST person out, not the first", () => {
  /* Reported: a head of department looked in for one minute and left, and the
     two people still talking were credited ONE minute for a ten-minute
     conversation — because every participant calls `endTaskMeeting` on their
     way out and it closed the session outright, clamping every span still open
     to that instant. The live figure stopped counting while they were still in
     the room.

     Their own departure is already recorded by `leaveTaskMeeting`, so nothing
     is lost by returning early; whoever is last out closes it, and by then
     every span is complete. */
  /* The check is `roomIsEmpty`, from the rules module, and no longer a bare
     `leftAt == null` scan. The difference matters: an open row whose browser
     died without writing its departure is NOT somebody in the room, and reading
     it as one held meetings open indefinitely. Both spellings are accepted so
     this asserts the property — something asks whether the room is occupied,
     before settling — rather than one way of writing it. */
  const OCCUPANCY = /roomIsEmpty\(|leftAt == null|leftAt === null/;
  for (const file of [LEGACY, MOCK]) {
    const body = endTaskMeetingBody(file);
    assert.match(
      body,
      OCCUPANCY,
      `${file}: nothing checks whether anybody is still in the room, so the ` +
        `first person to leave ends the meeting for everybody.`,
    );
    /* And the check has to come BEFORE the settlement, or it settles anyway. */
    const guard = body.search(OCCUPANCY);
    const settle = body.search(/settleCrossDeptSession\(|settleSession\(/);
    assert.ok(
      guard > 0 && guard < settle,
      `${file}: the still-in-the-room check runs after the settlement`,
    );
  }
});

test("the LAST departure settles it, so the credit never waits on a button", () => {
  /* The ordinary way out of a meeting is closing the tab, which fires
     `beforeunload` — that can record a departure and cannot await a
     settlement. With the close gated on "the room is empty", everybody leaving
     by tab left the session open for ever and nobody was credited anything.
     Recording the last departure IS the last-one-out condition. */
  for (const file of [LEGACY, MOCK]) {
    const src = readFileSync(file, "utf8");
    const from = src.indexOf("async leaveTaskMeeting");
    assert.ok(from > 0, `${file}: leaveTaskMeeting is gone`);
    const body = src.slice(from, src.indexOf("async endTaskMeeting", from));

    assert.match(
      body,
      /endTaskMeeting\(/,
      `${file}: leaving never settles, so a meeting everybody closed the tab ` +
        `on stays open and credits nobody.`,
    );
    assert.match(
      body,
      /roomIsEmpty\(|leftAt == null|leftAt === null/,
      `${file}: leaving settles unconditionally, which ends the meeting for ` +
        `everybody still in the room.`,
    );
  }
});
