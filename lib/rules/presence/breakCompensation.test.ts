import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dutyTransition } from "./duty.ts";
import { grantBreakCredit } from "./breakAllowance.ts";

/**
 * Break time has to reach the deadlines.
 *
 * The defect: a finished break credited nothing. `dutyTransition` measured the
 * span correctly, but the repository only applied it on `mode === "online"` —
 * and `derive()` states plainly that online is a live screen share and nothing
 * else. So ending a break without sharing lands on `offline`, the branch never
 * ran, and the minutes were measured and then dropped.
 */

const START = Date.parse("2026-08-01T10:00:00.000Z");
const HALF_HOUR = 30 * 60_000;

function afterBreak(next: "online" | "offline") {
  return dutyTransition({
    previous: {
      mode: "break",
      breakStartedAtMs: START,
      connectionId: "c1",
    } as never,
    next,
    nowMs: START + HALF_HOUR,
    connectionId: "c1",
    bankEvenWhenRaising: false,
  });
}

test("a finished break measures its span", () => {
  assert.equal(afterBreak("online").breakToCreditMs, HALF_HOUR);
});

test("the span is measured whether or not the person resumes sharing", () => {
  /* The heart of the bug. Somebody who takes a break and does not go back to
     screen sharing is still owed the thirty minutes — what they do next cannot
     change that the break happened. */
  assert.equal(afterBreak("offline").breakToCreditMs, HALF_HOUR);
});

test("the repository applies an ended break regardless of the mode it lands on", () => {
  /* The measurement above was always right; the application was not. Asserted
     against the source because the bug lived in a branch condition, which no
     amount of testing `dutyTransition` could have caught. Comments stripped so
     prose cannot satisfy it. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = src.indexOf("async setDutyMode");
  assert.ok(at > 0, "setDutyMode is gone");
  const body = src.slice(at, at + 4000);

  assert.doesNotMatch(
    body,
    /if \(input\.mode === "online"\) \{\s*const lostMs = offlineToCreditMs \+ breakToCreditMs/,
    "compensation is gated on returning online again — a break that ends any other way credits nothing",
  );
  assert.match(
    body,
    /endedSpanMs = creditedBreakMs;/,
    "an ended break is no longer credited on the event that ends it (creditedBreakMs is the allowance-capped span; emergency is gated on approval instead)",
  );
  /* Offline stays gated: that span has no end until somebody returns, so
     crediting it on the way out would credit time still running. */
  assert.match(
    body,
    /input\.mode === "online" \? offlineToCreditMs : 0/,
    "offline time is credited without waiting for a return",
  );
});

test("the shift is applied to every active task, which is what cascades it", () => {
  /* Task 1 at 2:30 and task 2 at 5:00 both move by the same thirty minutes, so
     the queue keeps its order and its gaps. One shared shift, not a
     recalculation per task. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  /* Tolerant of the trailing REASON argument and of the call being wrapped
     across lines — what is being asserted is that one shift is handed the whole
     lost span for the whole person, not that the call fits on one line. The
     reason itself is what the deadline history renders as
     "previous → why → current". */
  assert.match(
    src,
    /#compensateActiveDeadlines\(\s*employeeId,\s*lostMs\s*[,)]/,
  );
});

/* ── Emergency is gated on approval, break is not ─────────────────────────── */

test("emergency time is NOT credited when the emergency ends", () => {
  /* `dutyTransition` names the two spans with different verbs: break is
     "credit NOW", emergency is "raise for approval NOW". Summing them treated
     an unreviewed emergency as an approved one, so leaving Emergency Mode
     moved every deadline before a manager had seen the reason or the document
     — approving and rejecting then had the same effect on the work. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = src.indexOf("async setDutyMode");
  const body = src.slice(at, at + 4000);
  assert.doesNotMatch(
    body,
    /endedSpanMs = [^;]*emergencyToRaiseMs/,
    "an unreviewed emergency still moves deadlines",
  );
  assert.match(body, /endedSpanMs = creditedBreakMs;/);
});

test("approving an emergency is what moves the deadlines", () => {
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = src.indexOf("async decideEmergencyRequest");
  assert.ok(at > 0, "decideEmergencyRequest is gone");
  const body = src.slice(at, at + 2600);

  /* CHANGED ON PURPOSE — this pinned `if (approve)`, which was the whole of the
     gate and was not enough. `approve` is a boolean the CALLER supplies; it says
     nothing about who the caller is or whether the request has already been paid
     out. The shift is now gated on the amount the RULE returns, which is zero
     unless the actor is the manager the record names, the request is still
     pending, and nothing has been applied yet. */
  assert.match(body, /const lostMs = emergencyCompensationMs\(/);
  assert.match(body, /if \(lostMs > 0\) \{/, "the shift is not gated on the rule");
  assert.doesNotMatch(
    body,
    /if \(approve\) \{[\s\S]{0,200}#compensateActiveDeadlines/,
    "a bare `approve` flag reaches the shift again",
  );

  /* Refused before anything is written, so a rejected decision leaves no trace
     of having been attempted. */
  const refusalAt = body.indexOf("emergencyDecisionRefusal");
  const writeAt = body.indexOf("updateDoc");
  assert.ok(refusalAt > 0 && writeAt > refusalAt, "the write happens before the check");

  assert.match(body, /#compensateActiveDeadlines\(/, "approval shifts nothing");
  /* The span comes from the STORE, not from whatever the deciding client
     sends — a browser is not the authority on how much time to give back. */
  assert.match(body, /#emergencyRequestById\(requestId\)/);
  /* And the banked claim is spent whatever was decided, so the old app cannot
     turn it into a second request and a second shift. */
  assert.match(body, /#clearPendingEmergencyGap\(/);
});


/* ── How far a deadline actually moves ────────────────────────────────────────
 *
 * The pieces above are each tested and the COMPOSITION was not, so the one
 * question somebody actually asks — *my deadline moved; by how much?* — had no
 * answer anywhere that a regression could fail.
 *
 * This walks the production chain end to end: `dutyTransition` measures the
 * span, `grantBreakCredit` applies the day's allowance, and the repository adds
 * the granted milliseconds to the stored date (`#compensateActiveDeadlines`
 * writes `currentMs + lostMs`, pinned by source above). The deadline arithmetic
 * is reproduced here as that one addition, so the numbers below are the numbers
 * a person sees.
 */

/** The whole chain, as the repository runs it. Returns the shift in minutes. */
function deadlineShiftMinutes(input: {
  breakMinutes: number;
  allowanceMinutes?: number;
  alreadyCreditedMinutes?: number;
  endedAtMs?: number;
}): number {
  const endedAt = input.endedAtMs ?? START + input.breakMinutes * 60_000;
  const { breakToCreditMs } = dutyTransition({
    previous: {
      mode: "break",
      breakStartedAtMs: endedAt - input.breakMinutes * 60_000,
    } as never,
    next: "online",
    nowMs: endedAt,
    connectionId: "c1",
    bankEvenWhenRaising: false,
  });
  const grant = grantBreakCredit({
    spanMs: breakToCreditMs,
    maxMinutesPerDay: input.allowanceMinutes,
    ledger: {
      /* Stamped with the day the break ENDS, which is the day its credit is
         charged against. */
      dayKey: dayKeyLocal(endedAt),
      creditedMs: (input.alreadyCreditedMinutes ?? 0) * 60_000,
    },
    nowMs: endedAt,
  });
  const before = Date.parse("2026-08-01T17:00:00.000Z");
  const after = before + grant.grantedMs;
  return Math.round((after - before) / 60_000);
}

function dayKeyLocal(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test("a deadline moves by exactly the length of the break", () => {
  /* The plain case, and the answer to the question people ask: thirty minutes
     of break, thirty minutes of deadline. Not rounded, not scaled, not
     recalculated from the queue — the same span, added once. */
  assert.equal(deadlineShiftMinutes({ breakMinutes: 30 }), 30);
  assert.equal(deadlineShiftMinutes({ breakMinutes: 7 }), 7);
  assert.equal(deadlineShiftMinutes({ breakMinutes: 45 }), 45);
});

test("but never by more than the day's allowance", () => {
  /* A ninety-minute break against a sixty-minute allowance moves deadlines by
     SIXTY. The allowance bounds the credit, not the break — somebody may take
     as long as they need, and the policy decides how much of it the company
     moves commitments for. */
  assert.equal(deadlineShiftMinutes({ breakMinutes: 90, allowanceMinutes: 60 }), 60);
  assert.equal(deadlineShiftMinutes({ breakMinutes: 90 }), 60, "the default is sixty");
});

test("the allowance is spent across the day, not per break", () => {
  /* Two breaks, each under the cap, together over it. The second gets only the
     remainder — which is what makes the cap a cap rather than a per-break
     limit that three short breaks walk straight past. */
  assert.equal(
    deadlineShiftMinutes({ breakMinutes: 40, allowanceMinutes: 60, alreadyCreditedMinutes: 30 }),
    30,
  );
  assert.equal(
    deadlineShiftMinutes({ breakMinutes: 40, allowanceMinutes: 60, alreadyCreditedMinutes: 60 }),
    0,
    "an exhausted allowance moves nothing",
  );
});

test("an allowance of zero moves no deadline at all", () => {
  /* Zero means zero. It is a deliberate setting — "we do not extend deadlines
     for breaks" — and must not fall back to the default sixty. */
  assert.equal(deadlineShiftMinutes({ breakMinutes: 30, allowanceMinutes: 0 }), 0);
});

test("a break is credited in WALL-CLOCK time, unlike an offline span", () => {
  /* Worth stating because the two are deliberately asymmetric and the asymmetry
     surprises people. An offline span is bounded to office hours — going home
     at 18:00 and returning at 10:00 lost no working time and shifts nothing
     (§17.4). A break is not bounded: it is a claim about a person being away
     from work they were otherwise doing, and the DAILY ALLOWANCE is what bounds
     it instead.

     The consequence, stated so it is a decision rather than a discovery: a
     break left running overnight credits the allowance in full — sixty minutes
     by default — rather than nothing. Raising `maxBreakMinutesPerDay` widens
     exactly that exposure. */
  const overnight = deadlineShiftMinutes({
    breakMinutes: 16 * 60,
    allowanceMinutes: 60,
  });
  assert.equal(overnight, 60, "the allowance is the only thing bounding a break");

  const generousAllowance = deadlineShiftMinutes({
    breakMinutes: 16 * 60,
    allowanceMinutes: 8 * 60,
  });
  assert.equal(
    generousAllowance,
    8 * 60,
    "with a wide allowance an overnight break credits non-working hours",
  );
});
