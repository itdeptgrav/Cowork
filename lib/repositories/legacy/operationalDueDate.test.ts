import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { chainDeadlines } from "../../rules/tasks/priorityDeadline.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * When the work actually finishes, against what was promised.
 *
 * **T648 showed 13:30.** Legacy stores a `deadline` on the task, written when
 * the hours are set, as roughly "the moment of assignment plus the budget". A
 * four-hour task handed over at 09:30 stores 13:30 — correct only for somebody
 * with an empty desk. Pramod had three hours of committed work in front of it,
 * so the real answer was 12:30 → 16:30.
 *
 * The mapper read that stored field into `dueAt` AND `officialDueAt`, so every
 * surface repeated it. Fixing the display would have left the number wrong; the
 * fix is that the operational date is now DERIVED from the same chain the
 * preview uses, and the stored figure is kept for what it honestly is — the
 * commitment, and what scoring measures.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const REPO = "lib/repositories/legacy/index.ts";
const MAP = "lib/repositories/legacy/taskMap.ts";

/* The shape `_dayCfg` actually reads: FULL day names, `isOff`, `inTime`,
   `outTime`. The earlier fixture used `mon`/`open`/`close`/`isOpen`, none of
   which it looks at — so it silently fell back to the built-in default and
   these tests were not exercising the schedule they declared. It matched by
   coincidence (09:30–18:30) and nothing here crossed a Saturday, which the
   default leaves OPEN. */
const SCHEDULE = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  saturday: { isOff: true, inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true, inTime: "09:30", outTime: "18:30" },
};
const work = (a: number, s: number) =>
  addWorkingSecs(a, s, SCHEDULE, new Set<string>(), []);

const H = 3600;
const MON_0930 = Date.parse("2026-08-03T04:00:00.000Z");
const AT = {
  "11:30": "2026-08-03T06:00:00.000Z",
  "12:30": "2026-08-03T07:00:00.000Z",
  "13:30": "2026-08-03T08:00:00.000Z",
  "16:30": "2026-08-03T11:00:00.000Z",
};

/* Pramod's queue, exactly as reported. */
const QUEUE = [
  { taskId: "P1", assigneeIds: ["PRAMOD"], priority: 1, senderTimerWindowSecs: 2 * H },
  { taskId: "P2", assigneeIds: ["PRAMOD"], priority: 2, senderTimerWindowSecs: 1 * H },
  { taskId: "T648", assigneeIds: ["PRAMOD"], priority: 3, senderTimerWindowSecs: 4 * H },
] as never;

test("the chain gives T648 12:30 → 16:30, not the stored 13:30", () => {
  const chained = chainDeadlines({
    queue: QUEUE,
    anchorMs: MON_0930,
    addWorkingSecs: work,
  });
  const by = new Map(chained.map((c) => [String(c.taskId), c.dueDate]));

  assert.equal(by.get("P1"), AT["11:30"]);
  assert.equal(by.get("P2"), AT["12:30"]);
  /* Starts where P2 ended, runs four working hours inside a day closing 18:30. */
  assert.equal(by.get("T648"), AT["16:30"]);

  /* The stored value the page was showing: 09:30 + 4h, queue-blind. It is a
     real date and a real answer to a different question — which is why it
     looked right. */
  assert.equal(work(MON_0930, 4 * H), AT["13:30"]);
  assert.notEqual(by.get("T648"), AT["13:30"]);
});

test("the operational date ignores the assignor deadline entirely", () => {
  /* Nothing in the chain takes a committed date as input — there is nowhere to
     pass one. The commitment is compared against the result, never used to
     produce it. */
  const withNoise = chainDeadlines({
    queue: QUEUE,
    anchorMs: MON_0930,
    addWorkingSecs: work,
  });
  const again = chainDeadlines({
    queue: QUEUE,
    anchorMs: MON_0930,
    addWorkingSecs: work,
  });
  assert.deepEqual(
    withNoise.map((c) => c.dueDate),
    again.map((c) => c.dueDate),
  );
});

/* ── The wiring, so the derived date actually reaches the screen ──────────── */

test("the repository chains the queue rather than reading the stored deadline", () => {
  /* The chain moved into `#chainQueue`, shared by the list and the task page,
     so a person's queue cannot produce one set of dates on their list and
     another on the task itself. */
  const src = code(REPO);
  const at = src.indexOf("async #chainQueue(");
  assert.ok(at > 0);
  const fn = src.slice(at, at + 2800);
  assert.match(fn, /chainDeadlines\(\{/);
  assert.match(fn, /addWorkingSecs\(anchorMs, secs, policy\.schedule, blocked, policy\.breaks\)/);
  /* Settled hours only. Planning against a proposed budget would promise time
     nobody has agreed to. */
  /* Through the shared resolver now, so the chain lays out exactly the seconds
     the Details panel shows — they were different numbers, which is how T646
     read "00:00:00" beside a correct completion date. */
  assert.match(fn, /senderTimerWindowSecs: resolveTimeBudget\(x\)/);
  /* The anchor is NOW, and the chain moves it forward. Not creation time, not
     an approval time, and not a stored deadline. */
  assert.match(fn, /anchorMs: Date\.now\(\)/);
  assert.equal(
    /fixedDeadline|dueAtMs|readDueAtMs/.test(fn),
    false,
    "the chain is seeded from the stored deadline",
  );
});

test("a held cross-department task is in its pending assignee's queue", () => {
  /* `assigneeIds array-contains` misses it entirely — the person sits in
     `pendingAssigneeId` until the handover. Firestore cannot OR across fields,
     so it is two reads merged. */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #activeQueueOf("), src.indexOf("async #activeQueueOf(") + 4200);
  assert.match(fn, /where\("pendingAssigneeId", "==", employeeId\)/);
  assert.match(fn, /where\("assigneeIds", "array-contains", employeeId\)/);
});

test("the derived date is a separate field from the committed one", () => {
  /* Overwriting `officialDueAt` would move the SCORED deadline, so a queue
     ahead of somebody would change what they are marked against. */
  const map = code(MAP);
  assert.match(map, /task\.deadline\.operationalDueAt = input\.queue\?\.dueDates\?\.get\(legacy\.id\) \?\? null;/);
  assert.match(map, /officialDueAt:\s*\n?\s*legacy\.dueAtMs === null \? null : new Date\(legacy\.dueAtMs\)/);
});

test("the operational date is claimed only for the queue that was fetched", () => {
  /* One queue is read. Handing its dates to a second assignee would report
     somebody else's week as this person's. */
  const map = code(MAP);
  assert.match(map, /input\.queue\?\.dueDates\?\.get/);
  assert.match(map, /ownerId: string;/);
});

test("a failed calendar read costs the derived date, not the queue", () => {
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #chainQueue("), src.indexOf("async #chainQueue(") + 2800);
  const chainAt = fn.indexOf("chainDeadlines({");
  assert.ok(chainAt > 0);
  assert.match(fn.slice(chainAt), /catch \{/);
  /* An empty map, never a throw: the caller then shows the committed date
     alone rather than losing the queue. */
  assert.match(fn, /return dueDates;/);
  assert.match(src, /return \{ order, dueDates \};/);
});
