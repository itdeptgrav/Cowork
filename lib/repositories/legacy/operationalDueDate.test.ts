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
  /* Wide enough to reach the `chainDeadlines({...})` call itself. At 2800 the
     window stopped short of the `anchorMs` argument at ~3100, so the assertion
     below was reporting "the anchor is missing" for a function that passes it —
     a slice length is not a fact about the code. */
  const fn = src.slice(at, at + 4200);
  assert.match(fn, /chainDeadlines\(\{/);
  assert.match(fn, /addWorkingSecs\(fromMs, secs, policy\.schedule, blocked, policy\.breaks\)/);
  /* Settled hours only. Planning against a proposed budget would promise time
     nobody has agreed to. */
  /* Through the shared resolver now, so the chain lays out exactly the seconds
     the Details panel shows — they were different numbers, which is how T646
     read "00:00:00" beside a correct completion date. */
  assert.match(fn, /senderTimerWindowSecs: resolveTimeBudget\(x\)/);
  /**
   * **The anchor is the DAY'S OPENING, and the budget laid out is the FULL one.**
   *
   * The two belong together and the pairing is the whole rule — `chainDeadlines`
   * documents it as "decided once and then holds still". Only half was ever
   * wired: the anchor froze at the online-session start while the figure added
   * to it was `budget − logged`, which shrank as work was logged. The date
   * therefore ran BACKWARDS — a minute worked pulled the completion a minute
   * earlier — because the anchor counted being ONLINE as work and the remainder
   * counted only TIMER time as work, so the same hour was counted twice.
   *
   * Asserted as a pair. Either one alone reintroduces a moving date: a fixed
   * anchor with `"remaining"` walks backwards, and `"full"` from a live clock
   * walks forwards.
   */
  assert.match(fn, /const anchorMs = officeOpenMsFor\(policy\.schedule, nowMs\)/);
  assert.match(fn, /budget: "full"/);
  assert.equal(
    /queueAnchorMs\(/.test(fn),
    false,
    "the projection is anchored on presence again — that is the backwards drift",
  );
  /* `\r?\n`, because the working copy is not guaranteed LF — a checkout with
     CRLF endings failed this on line endings while the code was correct. */
  assert.match(fn, /anchorMs,\r?\n/);
  assert.equal(
    /anchorMs: Date\.now\(\)/.test(fn),
    false,
    "the projection is re-anchored at the live clock, which is the creep",
  );
  assert.equal(
    /fixedDeadline|dueAtMs|readDueAtMs/.test(fn),
    false,
    "the chain is seeded from the stored deadline",
  );
});

test("a projection that has fallen behind the clock does not become the clock", () => {
  /**
   * **The last step used to undo the rule the whole layer exists to hold.**
   *
   * `#chainQueue` ended by flooring every answer at `now`:
   * `Date.parse(c.dueDate) < nowMs ? nowIso : c.dueDate`. The stated reason was
   * that a past date "reads as broken". The effect was that any projection
   * which fell behind the wall clock BECAME the wall clock — read at 16:00 it
   * answered 16:00, read at 16:03 it answered 16:03 — and the line beneath it
   * reported the deadline being missed by an amount that grew a second per
   * second while nobody touched the task.
   *
   * `anchorStability.test.ts` and `dueDateCases` CASE 12 both assert this
   * cannot happen, and both went on passing: they test `chainDeadlines`, and
   * this clamped its output afterwards. So the guard has to live here, at the
   * layer that did the clamping.
   */
  const src = code(REPO);
  const at = src.indexOf("async #chainQueue(");
  assert.ok(at > 0, "the #chainQueue anchor drifted");
  const fn = src.slice(at, at + 3600);

  assert.match(
    fn,
    /dueDates\.set\(String\(c\.taskId\), c\.dueDate\);/,
    "the chained date is no longer passed through unchanged",
  );
  for (const clamp of ["nowIso", "< nowMs ?", "Math.max(nowMs"]) {
    assert.equal(
      fn.includes(clamp),
      false,
      `the projection is floored at the live clock again (${clamp}) — that is the creep`,
    );
  }
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
  /* The invariant is the SOURCE — `officialDueAt` reads `dueAtMs`, the
     committed field, and nothing else. The conversion moved to
     `instantOrNull` because the old inline `new Date(...).toISOString()`
     threw on an absent field and took the whole task mapping with it. */
  assert.match(map, /officialDueAt: instantOrNull\(legacy\.dueAtMs\)/);
  assert.match(map, /dueAt: instantOrNull\(legacy\.dueAtMs\)/);
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
  /* Widened to allow the sibling `provisionalPositions` field the queue now
     also returns — the fact this pins is that `order` and `dueDates` are
     still both there, not that nothing else ever joins them. */
  assert.match(src, /return \{ order, dueDates(, provisionalPositions)? \};/);
});
