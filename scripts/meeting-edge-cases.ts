/**
 * Every task-meeting edge case, run against the real rules, printed as a table.
 *
 *     npm run meeting:cases
 *
 * The test suite already asserts all of this — this exists so the ANSWERS are
 * readable rather than only the pass/fail. When somebody asks "what happens if
 * the creator never shows up", the useful reply is `0m`, not "there's a test
 * for it".
 *
 * Nothing here reimplements anything: every figure comes from
 * `lib/rules/meetings/meetingCredit.ts` and `lib/rules/tasks/`. A number that
 * looks wrong on this table is wrong in the product.
 *
 * Exits non-zero if any case fails, so it works in CI as well as by eye.
 */

import {
  NO_MEETINGS,
  addSession,
  creditTargets,
  creditableSecs,
  settleSession,
  type Attendance,
  type SettlementTask,
} from "../lib/rules/meetings/meetingCredit.ts";
import {
  workingSecsInSpan,
  type WeekSchedule,
} from "../lib/rules/tasks/deadlineCompensation.ts";
import { chainDeadlines } from "../lib/rules/tasks/priorityDeadline.ts";
import type { TaskStatus } from "../lib/domain/tasks.ts";

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const CREATOR = "rakesh";
const ASSIGNEE = "pramod";

/** August 2026: the 4th is a Tuesday, the 9th a Sunday. */
const T = (day: string, hm: string) =>
  new Date(`2026-08-${day}T${hm}:00`).getTime();

const OFFICE: WeekSchedule = {
  monday: { inTime: "09:30", outTime: "18:30" },
  tuesday: { inTime: "09:30", outTime: "18:30" },
  wednesday: { inTime: "09:30", outTime: "18:30" },
  thursday: { inTime: "09:30", outTime: "18:30" },
  friday: { inTime: "09:30", outTime: "18:30" },
  saturday: { inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true },
};

const span = (
  who: string,
  day: string,
  from: string,
  to: string | null,
): Attendance => ({
  employeeId: who,
  joinedAtMs: T(day, from),
  leftAtMs: to === null ? null : T(day, to),
});

const mins = (secs: number) =>
  `${Number((secs / 60).toFixed(1))}m`.replace(".0m", "m");
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/* ── Reporting ────────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

function check(label: string, got: string, want: string, note = "") {
  const ok = got === want;
  if (ok) passed++;
  else failed++;
  const mark = ok ? `${GREEN}PASS${OFF}` : `${RED}FAIL${OFF}`;
  const shown = ok ? got : `${got}  ${RED}(expected ${want})${OFF}`;
  console.log(
    `  ${mark}  ${label.padEnd(44)} ${shown.padEnd(14)} ${DIM}${note}${OFF}`,
  );
}

function heading(text: string) {
  console.log(`\n${text}`);
  console.log("  " + "─".repeat(76));
}

/* ── A · What a session is worth ──────────────────────────────────────────── */

heading("A · WHAT A SESSION IS WORTH  (only the task creator's presence counts)");

const worth = (attendance: Attendance[], endDay: string, endAt: string) =>
  mins(creditableSecs({ creatorId: CREATOR, attendance, endedAtMs: T(endDay, endAt) }));

check(
  "creator + assignee, both 10:00-10:45",
  worth([span(CREATOR, "04", "10:00", "10:45"), span(ASSIGNEE, "04", "10:00", "10:45")], "04", "10:45"),
  "45m",
  "the whole meeting",
);
check(
  "creator leaves 10:30, assignee stays to 11:00",
  worth([span(CREATOR, "04", "10:00", "10:30"), span(ASSIGNEE, "04", "10:00", "11:00")], "04", "11:00"),
  "30m",
  "ANTI-CHEAT",
);
check(
  "assignee alone in the room 10:00-12:00",
  worth([span(ASSIGNEE, "04", "10:00", "12:00")], "04", "12:00"),
  "0m",
  "empty room earns nothing",
);
check(
  "creator overlapping 10:00-10:20 + 10:10-10:30",
  worth([span(CREATOR, "04", "10:00", "10:20"), span(CREATOR, "04", "10:10", "10:30")], "04", "10:30"),
  "30m",
  "merged, not 40m",
);
check(
  "creator apart 10:00-10:10 + 10:20-10:30",
  worth([span(CREATOR, "04", "10:00", "10:10"), span(CREATOR, "04", "10:20", "10:30")], "04", "10:30"),
  "20m",
  "genuinely separate, summed",
);
check(
  "three nested spans inside one hour",
  worth(
    [
      span(CREATOR, "04", "10:00", "11:00"),
      span(CREATOR, "04", "10:15", "10:30"),
      span(CREATOR, "04", "10:45", "10:50"),
    ],
    "04",
    "11:00",
  ),
  "60m",
  "not 95m",
);
check(
  "creator never left, room closed 10:15",
  worth([span(CREATOR, "04", "10:00", null)], "04", "10:15"),
  "15m",
  "bounded at the close, not now",
);
check(
  "span entirely after the close (clock skew)",
  worth([span(CREATOR, "04", "11:00", "11:30")], "04", "10:00"),
  "0m",
  "clamped, never negative",
);
check("zero-length span", worth([span(CREATOR, "04", "10:00", "10:00")], "04", "11:00"), "0m");
check("reversed span (left before joined)", worth([span(CREATOR, "04", "10:30", "10:00")], "04", "11:00"), "0m");
check("no attendance rows at all", worth([], "04", "11:00"), "0m");
check(
  "SELF task — creator IS the assignee",
  mins(
    creditableSecs({
      creatorId: ASSIGNEE,
      attendance: [span(ASSIGNEE, "04", "10:00", "10:20")],
      endedAtMs: T("04", "10:20"),
    }),
  ),
  "20m",
  "credits normally",
);
check(
  "meeting across midnight 23:30 → 00:30",
  mins(
    creditableSecs({
      creatorId: CREATOR,
      attendance: [{ employeeId: CREATOR, joinedAtMs: T("04", "23:30"), leftAtMs: T("05", "00:30") }],
      endedAtMs: T("05", "00:30"),
    }),
  ),
  "60m",
);

/* ── B · Who receives it ──────────────────────────────────────────────────── */

heading("B · WHO RECEIVES IT  (the assignee's live tasks — Rules 1 to 3)");

const t = (taskId: string, status: TaskStatus, who = ASSIGNEE) => ({
  taskId,
  status,
  assigneeIds: [who],
});
const who = (tasks: ReturnType<typeof t>[], already: string[] = []) =>
  creditTargets({ tasks, assigneeId: ASSIGNEE, alreadyCredited: already }).join(",") ||
  "(none)";

check("three tasks all in progress", who([t("P1", "in_progress"), t("P2", "in_progress"), t("P3", "in_progress")]), "P1,P2,P3", "Rule 1");
check("P1 completed, P2 and P3 live", who([t("P1", "completed"), t("P2", "in_progress"), t("P3", "in_progress")]), "P2,P3", "Rule 3 — P1 frozen");
check("accepted but not started (kickoff)", who([t("K", "confirmed")]), "K", "the headline case");
check("cancelled / rejected / in review / done", who([t("a", "cancelled"), t("b", "assignment_rejected"), t("c", "in_review"), t("d", "completed")]), "(none)");
check("draft / awaiting approval / assigned", who([t("a", "draft"), t("b", "pending_approval"), t("c", "assigned"), t("d", "deadline_negotiation")]), "(none)");
check("a colleague's task in the same call", who([t("mine", "in_progress"), t("theirs", "in_progress", "someone-else")]), "mine", "credit follows the receiver");
check("already credited this session", who([t("P1", "in_progress"), t("P2", "in_progress")], ["P1"]), "P2", "retry is harmless");
check("no tasks at all", who([]), "(none)");

/* ── C · Totals across sessions ───────────────────────────────────────────── */

heading("C · TOTALS ACROSS SESSIONS  (bracket is not duration)");

let totals = NO_MEETINGS;
for (const [from, to, secs] of [
  ["10:00", "10:30", 1800],
  ["14:00", "14:20", 1200],
  ["16:00", "16:05", 300],
] as const) {
  totals = addSession(totals, {
    startedAtMs: T("04", from),
    endedAtMs: T("04", to),
    creditedSecs: secs,
  });
}
check("three sessions 30 + 20 + 5", mins(totals.totalSecs), "55m", `bracket ${clock(totals.firstStartedAtMs!)} → ${clock(totals.lastEndedAtMs!)}`);
check("  …first start is never rewritten", clock(totals.firstStartedAtMs!), "10:00");

const outOfOrder = addSession(
  addSession(NO_MEETINGS, { startedAtMs: T("04", "14:00"), endedAtMs: T("04", "14:20"), creditedSecs: 1200 }),
  { startedAtMs: T("04", "10:00"), endedAtMs: T("04", "10:30"), creditedSecs: 1800 },
);
check("a late write cannot rewrite history", clock(outOfOrder.firstStartedAtMs!), "10:00", "earlier session arrived second");
check("a negative credit cannot erase meetings", mins(addSession(NO_MEETINGS, { startedAtMs: T("04", "10:00"), endedAtMs: T("04", "10:10"), creditedSecs: -600 }).totalSecs), "0m");

/* ── D · The settlement ───────────────────────────────────────────────────── */

heading("D · SETTLEMENT  (window AND due date — both, or the queue never sees it)");

const st = (taskId: string, over: Partial<SettlementTask> = {}): SettlementTask => ({
  taskId,
  status: "in_progress",
  assigneeIds: [ASSIGNEE],
  totals: NO_MEETINGS,
  dueAtMs: T("04", "17:00"),
  windowSecs: 3600,
  rank: 1,
  ...over,
});
const settle = (tasks: SettlementTask[], from = "10:00", to = "10:10") =>
  settleSession({
    session: {
      creatorId: CREATOR,
      startedAtMs: T("04", from),
      endedAtMs: T("04", to),
      attendance: [span(CREATOR, "04", from, to)],
    },
    onTaskId: tasks[0].taskId,
    assigneeId: ASSIGNEE,
    tasks,
  });

const three = settle([st("P1", { rank: 1 }), st("P2", { rank: 2 }), st("P3", { rank: 3 })]);
check("10m meeting → ONE window absorbs it", three.updates.map((u) => u.newWindowSecs === null ? "—" : mins(u.newWindowSecs)).join(" "), "70m — —", "the head of the queue");
check("10m meeting → every due date moves once", three.updates.map((u) => clock(u.newDueAtMs!)).join(" "), "17:10 17:10 17:10", "the same 10m, not 10/20/30");
check("the head is picked by rank, not by which task", settle([st("P3", { rank: 3 }), st("P1", { rank: 1 })]).updates.filter((u) => u.newWindowSecs !== null).map((u) => u.taskId).join(" "), "P1");
check("fixed-deadline task (no window)", String(settle([st("F", { windowSecs: null })]).updates[0].newWindowSecs), "null", "date still moves");
check("task with no due date", String(settle([st("N", { dueAtMs: null })]).updates[0].newDueAtMs), "null", "window still grows");

const absent = settleSession({
  session: {
    creatorId: CREATOR,
    startedAtMs: T("04", "10:00"),
    endedAtMs: T("04", "11:00"),
    attendance: [span(ASSIGNEE, "04", "10:00", "11:00")],
  },
  onTaskId: "T",
  assigneeId: ASSIGNEE,
  tasks: [st("T")],
});
check("creator absent → nothing moves", `${absent.updates[0].newWindowSecs}/${absent.updates[0].newDueAtMs}`, "null/null");
check("  …but the session is still recorded", clock(absent.updates[0].totals.firstStartedAtMs!), "10:00");
check("history sentence", three.updates[0].reason, "Meeting time — 10m on P1");

/* ── E · The line shifts once, down the queue ─────────────────────────────── */

heading("E · THE LINE SHIFTS ONCE  (10m of meeting delays everything by 10m)");

const walk = (from: number, secs: number) => new Date(from + secs * 1000).toISOString();
const laid = (windows: number[]) =>
  chainDeadlines({
    queue: windows.map((w, i) => ({
      taskId: `P${i + 1}`,
      assigneeIds: [ASSIGNEE],
      assigneePriorities: { [ASSIGNEE]: i + 1 },
      status: "in_progress",
      deadlineWindowSecs: w,
      loggedSecs: 0,
    })) as never,
    anchorMs: T("04", "09:30"),
    addWorkingSecs: walk,
  })
    .map((c) => clock(Date.parse(c.dueDate)))
    .join(" ");

check("three 1h tasks, no meetings", laid([3600, 3600, 3600]), "10:30 11:30 12:30");
check(
  "after a 10m meeting",
  laid(three.updates.map((u) => u.newWindowSecs ?? 3600)),
  "10:40 11:40 12:40",
  "+10 / +10 / +10",
);
check(
  "the rejected shape, for comparison",
  laid([4200, 4200, 4200]),
  "10:40 11:50 13:00",
  "what growing EVERY window would give — 10/20/30",
);

/* ── F · Meeting vs break and offline ─────────────────────────────────────── */

heading("F · MEETING vs BREAK  (same span, two rules — POLICY GAP, see below)");

const compare = (label: string, day: string, from: string, to: string) => {
  const asBreak = workingSecsInSpan({ startMs: T(day, from), endMs: T(day, to), schedule: OFFICE });
  const asMeeting = creditableSecs({
    creatorId: CREATOR,
    attendance: [span(CREATOR, day, from, to)],
    endedAtMs: T(day, to),
  });
  /* Counted as passed either way: this section REPORTS a policy difference, it
     does not judge one. A DIFF here is a decision waiting to be made, not a bug. */
  const same = asBreak === asMeeting;
  passed++;
  console.log(
    `  ${same ? `${GREEN}SAME${OFF}` : `${RED}DIFF${OFF}`}  ${label.padEnd(44)} ` +
      `${`${mins(asBreak)} / ${mins(asMeeting)}`.padEnd(14)} ${DIM}break / meeting${OFF}`,
  );
};

compare("11:00-11:30, inside office hours", "04", "11:00", "11:30");
compare("18:00-19:00, straddling closing", "04", "18:00", "19:00");
compare("22:00-23:00, after hours", "04", "22:00", "23:00");
compare("Sunday 10:00-11:00", "09", "10:00", "11:00");

/* ── Result ───────────────────────────────────────────────────────────────── */

console.log("\n" + "─".repeat(78));
console.log(
  failed === 0
    ? `  ${GREEN}ALL ${passed} CHECKS PASSED${OFF}`
    : `  ${RED}${failed} FAILED${OFF}, ${passed} passed`,
);
console.log(
  `\n  ${DIM}Section F is a POLICY GAP, not a failure: meeting time is not clamped to\n` +
    `  office hours, while break and offline are. A Sunday meeting therefore extends\n` +
    `  a deadline where a Sunday break does not. Decide, then pin it either way.${OFF}\n`,
);

process.exit(failed === 0 ? 0 : 1);
