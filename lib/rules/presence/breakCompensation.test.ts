import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dutyTransition } from "./duty.ts";

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
  assert.match(src, /#compensateActiveDeadlines\(employeeId, lostMs\)/);
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
  const body = src.slice(at, at + 2400);
  assert.match(body, /if \(approve\)/, "the shift is not gated on the decision");
  assert.match(body, /#compensateActiveDeadlines\(/, "approval shifts nothing");
  /* The span comes from the STORE, not from whatever the deciding client
     sends — a browser is not the authority on how much time to give back. */
  assert.match(body, /#emergencyRequestById\(requestId\)/);
});
