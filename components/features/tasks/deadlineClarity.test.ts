import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { formatDuration, formatDurationTimer } from "@/lib/utils/format";
import { routeExtensionRequest } from "@/lib/rules/tasks/extensionRouting";

/**
 * The deadline and extension screens have to be readable by the person
 * deciding, not only correct.
 *
 * ## What was on screen
 *
 * Reported from the product, on a real task:
 *
 *   · The assignee's Deadline panel: "Original window 07:00:00", "Current
 *     window 07:00:00", beside "Working deadline 9 Sep · 17:31 IST".
 *   · The owner's decision card: "Current budget 07:00:00 / Requested
 *     07:30:00 / Committed deadline 9 Sep 2026 · 17:31 IST", then a bare
 *     timestamp and "⚠ Misses it by 00:17:52".
 *
 * Two faults, and the second is the one that drew the question "what is
 * this??":
 *
 *   1. **Durations were drawn in the shape of a time of day.** Seven hours of
 *      budget rendered as `07:00:00`, sitting in the same row as `17:31 IST`.
 *      Nothing distinguished a span from a clock reading, so a seven-hour
 *      budget read as seven in the morning.
 *
 *   2. **The verdict was arithmetic with no sentence around it.** "Misses it
 *      by 00:17:52" never said what "it" was, which direction the miss went,
 *      or what would happen if the request were granted.
 *
 * ## What did NOT change
 *
 * The feasibility arithmetic. `bufferSeconds` is still `deadline − estimated
 * completion` and the routing still turns on its sign; only the words and the
 * number's format are different. That boundary is deliberate — this was a
 * legibility fix, not a change to how deadlines are computed or moved.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PANEL = code("components/features/tasks/DeadlinePanel.tsx");
const CARD = code("components/features/tasks/ExtensionDecisionCard.tsx");

/* ── 1 · a duration no longer looks like a time of day ──────────────────── */

test("the two formatters really do differ, which is the whole point", () => {
  /* Run, not read: `formatDuration` is what makes a span self-describing. */
  assert.equal(formatDurationTimer(7 * 3600), "07:00:00");
  assert.equal(formatDuration(7 * 3600), "7h");
  assert.equal(formatDuration(7.5 * 3600), "7h 30m");
  assert.equal(formatDuration(30 * 60), "30m");
  /* The figure from the report: 00:17:52 of overrun. */
  assert.equal(formatDuration(1072), "18m");
});

test("neither deadline screen renders a duration in the clock shape", () => {
  for (const [name, src] of [
    ["DeadlinePanel", PANEL],
    ["ExtensionDecisionCard", CARD],
  ] as const) {
    assert.doesNotMatch(
      src,
      /formatDurationTimer/,
      `${name} draws a budget in HH:MM:SS again, which reads as a time of day beside the dates on the same row`,
    );
    assert.match(src, /formatDuration\(/, `${name} stopped formatting durations`);
  }
});

test("the clock shape is kept where it belongs — a running timer", () => {
  /* The fix must not delete the format; a live timer needs a fixed width so
     the figure does not jump sideways as it ticks. */
  const fmt = readFileSync("lib/utils/format.ts", "utf8");
  assert.match(fmt, /export function formatDurationTimer/);
  assert.match(fmt, /export function formatTimer/);
  assert.match(
    code("components/features/tasks/TimerControl.tsx"),
    /formatTimer|formatDurationTimer/,
    "the live timer lost its fixed-width clock",
  );
});

/* ── 2 · the verdict is a sentence ──────────────────────────────────────── */

test("the card states ONE conclusion, not the arithmetic behind it", () => {
  /**
   * Reported as "why show unnecessary data". The block had grown to say the
   * same thing four times — the queue's finish time, that finish measured
   * against today's deadline, the resolution once the deadline moves, and a
   * sentence restating all three — with the caption repeating it a fifth.
   *
   * The reader decides two things: do they get the hours, and does the
   * deadline move. One line answers that.
   */
  assert.match(CARD, /Approving moves the deadline to \$\{formatStamp\(route\.proposedDeadline\)\}, and it fits from there\./);
  assert.match(CARD, /✓ This fits\. The deadline does not move\./);
  assert.match(CARD, /already behind\. Moving the deadline to \$\{formatStamp\(route\.proposedDeadline\)\} does not on its own make it reachable\./);
  /* And the older, noisier phrasings are gone. */
  assert.doesNotMatch(CARD, /Misses it by/, "the bare arithmetic is back");
  assert.doesNotMatch(CARD, /AFTER the \$\{formatStamp\(committed\)\} deadline/, "the redundant comparison line is back");
  assert.doesNotMatch(CARD, /and then it fits\./, "the duplicated resolution line is back");
});

test("the queue's raw arithmetic is not printed at all", () => {
  /**
   * **This asserted the opposite — that the working was kept behind a
   * disclosure — and the owner asked for it gone.**
   *
   * It read "this task finishes 17:10 — 26m after the 16:45 deadline". Every
   * figure was true and it was still the wrong thing to show: the finish time
   * used to BE the proposed deadline (rounded up), so printing it explained
   * where the date came from. The date is now the old deadline plus the time
   * granted, so the finish explains nothing the reader decides — and it
   * compared against the OLD deadline directly beneath a line about the NEW
   * one.
   *
   * The check still runs. It is what chooses between the two routes and what
   * the headline reports. Only its raw output is gone.
   */
  assert.doesNotMatch(CARD, /How was this worked out\?/);
  assert.doesNotMatch(CARD, /Hide the queue check/);
  assert.doesNotMatch(CARD, /showWorking/);
  assert.doesNotMatch(CARD, /real queue, this task finishes/);
  assert.doesNotMatch(CARD, /route\.bufferSeconds >= 0 \? "before" : "after"/);
  /* And the conclusion it feeds is still there — the check is not what was
     removed. */
  assert.match(CARD, /route\.stillLateAfterMove/);
  assert.match(CARD, /routeExtensionRequest\(\{/);
});

test("the caption no longer repeats the date change", () => {
  /* The verdict line says where the deadline lands; the caption said it
     again, immediately underneath. */
  const cap = CARD.slice(CARD.indexOf("You set the hours and you own the deadline"));
  assert.doesNotMatch(cap.slice(0, 400), /Approving moves the deadline by/);
  assert.match(cap.slice(0, 400), /Granting a different amount gives/);
});

test("an unmeasurable queue says so in words", () => {
  assert.doesNotMatch(CARD, /"Not measurable"/);
  assert.match(CARD, /The queue could not be measured, so this cannot be checked/);
});

test("the card shows before and after for BOTH things being decided", () => {
  /**
   * Reported as "what is now deadline, what extra time asked, and after
   * approved how much it should be". The three facts were scattered — the ask
   * in the title, the budget across two columns, today's deadline in a third,
   * and the NEW deadline in a sentence further down — so the reader had to
   * assemble the answer themselves.
   *
   * Two rows, each Now → If approved, carry all of it.
   */
  /**
   * A real TABLE, not sibling grids. It was three `grid-cols-[auto_1fr_1fr]`
   * rows, and each computed its OWN `auto` column — zero-wide in the header,
   * narrow for "Hours", wide for "Deadline" — so no column lined up with the
   * one above it. Reported as the padding and alignment being wrong, and it
   * was: sibling grids share no columns. A table shares them by construction.
   */
  assert.match(CARD, /<table className="w-full border-collapse text-left">/);
  assert.doesNotMatch(
    CARD,
    /grid-cols-\[auto_1fr_1fr\]/,
    "back to sibling grids, which cannot align",
  );
  assert.match(CARD, />\s*Now\s*<\/th>/);
  assert.match(CARD, />\s*If approved\s*<\/th>/);
  assert.match(CARD, />\s*Hours\s*<\/th>/);
  assert.match(CARD, />\s*Deadline\s*<\/th>/);
  /* Row labels are row headers, so a screen reader says which row a figure
     belongs to rather than reading four values in a row. */
  assert.match(CARD, /scope="row"/);
  /* The ask, beside what it becomes. */
  assert.match(CARD, /\(\+\{formatDuration\(addedSecs\)\}\)/);
  /* And the deadline row says "unchanged" rather than repeating today's date
     when the hours fit inside the commitment. */
  assert.match(CARD, /: "unchanged"/);
});

test("the history row shows the total, not just the sum to do", () => {
  const row = PANEL.slice(PANEL.indexOf("Extra time ·"));
  /**
   * The total, not only the addition — "7h + 30m" leaves the reader doing the
   * arithmetic the row exists to report.
   *
   * This pinned the literal `previousSecs + addedSecs`, which was the sum of
   * what was ASKED FOR on both sides. A manager granting five minutes of the
   * twenty requested then had the row announce "2h 40m + 20m = 3h" and correct
   * itself in the line underneath. `settledTotalSecs` is the same sum wherever
   * the answer matched the request, and the granted figure where it did not —
   * so the property this test is about is unchanged and the numbers are now
   * ones that happened.
   */
  assert.match(row.slice(0, 900), /settledTotalSecs\(row\)/);
  assert.match(row.slice(0, 900), /settledAddedSecs\(row\)/);
});

/* ── 3 · the feasibility CHECK is untouched ─────────────────────────────── */

test("whether the extra time fits is still decided the same way", () => {
  /* The check that routes the request — does it fit inside the deadline
     already committed? — is unchanged. What changed is only the date PROPOSED
     when it does not fit; see the next block. */
  const rule = code("lib/rules/tasks/deadlineFeasibility.ts");
  assert.match(rule, /const bufferSeconds = Math\.round\(\(deadlineMs - completionMs\) \/ 1000\)/);
  assert.match(rule, /const feasible = bufferSeconds >= 0/);
});

/* ── 4 · the new deadline is the old one plus what was granted ──────────── */

/**
 * The owner's decision, run for real rather than read off the source.
 *
 * Reported: "deadline is 17:31, after approving 30 min extra it should be
 * 18:01". It was proposing 18:00 — the queue's own completion (17:49) rounded
 * up to the half hour. That was defensible and unexplainable: the task had
 * twelve minutes of slack, so thirty minutes granted moved the deadline by
 * eighteen, and nothing on screen said so. Told both readings and their costs,
 * the owner chose the plain one.
 */
const REPORTED = {
  committed: "2026-09-09T12:01:00.000Z", // 17:31 IST
  completion: "2026-09-09T12:19:00.000Z", // 17:49 IST — 18m past it
  granted: 30 * 60,
};

function route(over: Partial<Parameters<typeof routeExtensionRequest>[0]["feasibility"]> = {}) {
  return routeExtensionRequest({
    feasibility: {
      feasible: false,
      estimatedCompletionTime: REPORTED.completion,
      deadline: REPORTED.committed,
      bufferSeconds: -18 * 60,
      /* What the repository computes, in working seconds: 17:31 + 30m. */
      deadlineAfterGrant: "2026-09-09T12:31:00.000Z", // 18:01 IST
      ...over,
    },
    previousWindowSecs: 7 * 3600,
    addedSecs: REPORTED.granted,
  });
}

test("granting 30m moves the deadline by exactly 30m", () => {
  const r = route();
  assert.equal(r.outcome, "escalate_deadline");
  const moved =
    (Date.parse(r.proposedDeadline!) - Date.parse(REPORTED.committed)) / 1000;
  assert.equal(moved, REPORTED.granted, "the deadline no longer moves by what was granted");
  /* The reported case, in the reader's own terms: 17:31 → 18:01. */
  assert.equal(r.proposedDeadline, "2026-09-09T12:31:00.000Z");
});

test("it is NOT the queue's completion rounded up any more", () => {
  const r = route();
  assert.notEqual(r.proposedDeadline, "2026-09-09T12:30:00.000Z", "still rounding to the half hour");
  assert.notEqual(r.proposedDeadline, REPORTED.completion);
});

test("a backend that cannot compute it still proposes something", () => {
  /* The old date is the fallback, because a proposal from the queue beats no
     proposal at all. */
  const r = route({ deadlineAfterGrant: null });
  assert.equal(r.proposedDeadline, "2026-09-09T12:30:00.000Z");
});

test("a task already behind is told so, rather than given a broken date", () => {
  /**
   * The cost of the owner's model, made visible. Moving the deadline by
   * exactly what was granted does not rescue a task that was ALREADY late —
   * the queue still finishes after the new date, so the new date is broken the
   * moment it is set. The card must say that rather than let somebody find out
   * next week.
   */
  const late = route({
    estimatedCompletionTime: "2026-09-09T13:00:00.000Z", // 18:30, past the new 18:01
  });
  assert.equal(late.stillLateAfterMove, true);
  /* And the ordinary case does not cry wolf. */
  assert.equal(route().stillLateAfterMove, false);
});

test("the flag is false wherever nothing moves", () => {
  const fits = routeExtensionRequest({
    feasibility: {
      feasible: true,
      estimatedCompletionTime: "2026-09-09T11:00:00.000Z",
      deadline: REPORTED.committed,
      bufferSeconds: 3600,
      deadlineAfterGrant: null,
    },
    previousWindowSecs: 7 * 3600,
    addedSecs: REPORTED.granted,
  });
  assert.equal(fits.outcome, "approve_budget");
  assert.equal(fits.proposedDeadline, null, "a fitting request must not move the deadline");
  assert.equal(fits.stillLateAfterMove, false);
});

test("the working-hours walk is what adds the time, not raw clock arithmetic", () => {
  /**
   * The repository does the sum because it is the only layer holding the
   * office schedule. Raw clock time would put 18:15 + 30m at 18:45 — past the
   * 18:30 close, a deadline nobody can meet.
   */
  const legacy = code("lib/repositories/legacy/index.ts");
  const at = legacy.indexOf("const deadlineAfterGrant =");
  assert.ok(at > 0, "the legacy repository stopped computing it");
  assert.match(
    legacy.slice(at, at + 500),
    /addWorkingSecs\(\s*Date\.parse\(input\.committedDeadline\),\s*input\.grantedSecs,\s*policy\.schedule,\s*blocked,\s*policy\.breaks,?\s*\)/,
  );
});

test("the already-behind warning is said once, not twice", () => {
  /* It was in the verdict line AND under the buttons. */
  const hits = CARD.split("already behind").length - 1;
  assert.equal(hits, 1, "the already-behind warning appears " + hits + " times");
});

test("the budget history can explain a granted extension", () => {
  /**
   * Reported: the Time budget panel said "Nothing has been credited — this is
   * the budget it was given" on a task whose budget had grown 7h → 7h 30m.
   * Two faults met there, and both are fixed:
   *
   *   1. Nothing ever wrote a receipt. The engine changed the window and filed
   *      no row, so the list had nothing to list.
   *   2. "Given" read `etcHours`, which the engine rewrites on every settled
   *      budget — so the baseline was overwritten by the very event it was
   *      meant to be measured against, and Given always equalled Now.
   */
  const legacy = code("lib/repositories/legacy/index.ts");
  const at = legacy.indexOf("async getBudgetHistory");
  const body = legacy.slice(at, at + 2500);
  assert.match(body, /const original = Number\(data\.originalWindowSecs\)/);
  assert.match(body, /const sender = Number\(data\.senderTimerWindowSecs\)/);
  /* Precedence: the preserved baseline, then the assignor's opening figure,
     then the creator's estimate as a last resort. */
  const o = body.indexOf("original > 0");
  const s2 = body.indexOf("sender > 0");
  const h = body.indexOf("hours > 0");
  assert.ok(o > 0 && s2 > o && h > s2, "the baseline precedence changed");
});

test("the card reads the verdict and compares nothing itself", () => {
  /* `the card decides nothing itself` forbids `Date.parse` there — the whole
     comparison lives in the rule. */
  /* Read as a ternary now that the verdict is one line with three cases —
     what matters is that the card USES the rule's flag and computes none of
     it. */
  assert.match(CARD, /route\.stillLateAfterMove/);
  assert.doesNotMatch(CARD, /Date\.parse/);
  assert.match(CARD, /grantedSecs: addedSecs,/, "the repository is never told what was granted");
});

/* ── 4 · the card that must show NO hours still shows none ──────────────── */

test("the assignor's revision card is still free of hours, in either format", () => {
  /**
   * Two existing tests forbid `formatDurationTimer` there as a proxy for "this
   * card shows no workload". Introducing a second duration formatter into this
   * area would have let hours in through the side door, so the ban names both.
   */
  const revision = code("components/features/tasks/DeadlineRevisionCard.tsx");
  for (const forbidden of ["formatDurationTimer", "formatDuration", "addedSecs"]) {
    assert.equal(
      revision.includes(forbidden),
      false,
      `the assignor's card exposes "${forbidden}"`,
    );
  }
});

/* ── the help corpus, per CLAUDE.md ─────────────────────────────────────── */

test("help: the verdict line is explained in the reader's words", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /would finish after the deadline/);
  assert.match(help, /"what does misses it by mean"/);
});
