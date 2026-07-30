import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  eventLabel,
  explanationFor,
  hasDataOn,
  periodLabel,
  pointsReconcile,
  presentChannel,
  presentLedgerEntry,
  presentOverview,
  totalMeasured,
  trendFrom,
} from "./scoreDisplay.ts";
import type { ChannelBreakdown, ScoreOverview } from "../../domain/index.ts";

/**
 * How a score READS. None of this decides a score.
 *
 * The faults these pin were all presentational, and all of the same kind:
 * showing a figure the data does not support.
 */

function channel(over: Partial<ChannelBreakdown> = {}): ChannelBreakdown {
  return {
    id: "c1", code: "C1", label: "Task Execution",
    earnedPoints: 0, possiblePoints: 0, percentage: 0, unitCount: null,
    direction: "up", extent: 0, caption: "", hasProvisionalRules: false,
    ...over,
  } as ChannelBreakdown;
}

function overview(channels: ChannelBreakdown[]): ScoreOverview {
  return {
    employeeId: "GR0002", periodKey: "2026-Q3", overallPercentage: 95,
    earnedPoints: 0, possiblePoints: 0, delta: 0, channels,
    hasProvisionalRules: false,
  } as ScoreOverview;
}

/* ── "0 units measured" beside a real percentage ──────────────────────────── */

test("an unreported count is unknown, never zero", () => {
  /* The engine sends no count. Writing 0 made the overview say nothing had been
     measured while showing a percentage derived from measurements. */
  const c = presentChannel(channel({ percentage: 90, possiblePoints: 100, earnedPoints: 90 }));
  assert.equal(c.measuredCount, null, "unknown must not be reported as zero");
});

test("a reported count of zero is preserved as a real zero", () => {
  /* The distinction has to work in both directions, or it is not a distinction. */
  const c = presentChannel(channel({ unitCount: 0, percentage: 0 }));
  assert.equal(c.measuredCount, 0);
});

test("the overall count is null when no channel reports one", () => {
  /* Summing nulls as zeros is how "0 measured" ends up under a real score. */
  assert.equal(totalMeasured(overview([channel(), channel({ code: "C4" })])), null);
});

test("the overall count sums only the channels that report", () => {
  const o = overview([
    channel({ unitCount: 2, percentage: 90, possiblePoints: 100, earnedPoints: 90 }),
    channel({ code: "C4", unitCount: null }),
  ]);
  assert.equal(totalMeasured(o), 2);
});

/* ── "90 / 40" ────────────────────────────────────────────────────────────── */

test("points are shown only when they actually produce the percentage", () => {
  /* The reported case. The engine's percentage is pre-normalised and is never
     earned/possible — 90 of 40 divides to 225%, not 90%. Showing both invites a
     division that contradicts the headline. */
  const c = presentChannel(
    channel({ earnedPoints: 90, possiblePoints: 40, percentage: 90 }),
  );
  assert.equal(c.state, "measured_points_unavailable");
  assert.equal(c.percentage, 90, "the engine's figure still leads");
  assert.equal(c.earnedPoints, null, "the misleading fraction is withheld");
  assert.equal(c.possiblePoints, null);
});

test("points ARE shown when they reconcile", () => {
  const c = presentChannel(
    channel({ earnedPoints: 90, possiblePoints: 100, percentage: 90 }),
  );
  assert.equal(c.state, "measured");
  assert.equal(c.earnedPoints, 90);
  assert.equal(c.possiblePoints, 100);
});

test("reconciliation tolerates rounding, not disagreement", () => {
  assert.equal(pointsReconcile({ earnedPoints: 1, possiblePoints: 3, percentage: 33 }), true);
  assert.equal(pointsReconcile({ earnedPoints: 90, possiblePoints: 40, percentage: 90 }), false);
  assert.equal(
    pointsReconcile({ earnedPoints: 5, possiblePoints: 0, percentage: 50 }),
    false,
    "a zero maximum can never explain a percentage",
  );
});

/* ── Empty states ─────────────────────────────────────────────────────────── */

test("an unscored channel reports no score rather than a confident zero", () => {
  const c = presentChannel(channel());
  assert.equal(c.state, "no_data");
  assert.equal(c.percentage, null, "0% is a claim, and the wrong one");
});

test("a genuine zero score is not mistaken for absent data", () => {
  /* Scoring zero out of a real maximum IS a measurement, and hiding it would
     conceal a bad quarter. */
  const c = presentChannel(channel({ possiblePoints: 100, earnedPoints: 0, percentage: 0 }));
  assert.equal(c.state, "measured");
  assert.equal(c.percentage, 0);
});

test("an overview with nothing scored shows no overall percentage", () => {
  const p = presentOverview(overview([channel(), channel({ code: "C2" })]));
  assert.equal(p.isEmpty, true);
  assert.equal(p.percentage, null);
  assert.equal(p.contributing.length, 0);
  assert.equal(p.awaiting.length, 2, "the empty channels are still named");
});

test("contributing and awaiting channels are separated", () => {
  const p = presentOverview(
    overview([
      channel({ code: "C1", percentage: 90, possiblePoints: 100, earnedPoints: 90 }),
      channel({ code: "C2" }),
      channel({ code: "C4", percentage: 100, possiblePoints: 10, earnedPoints: 10 }),
    ]),
  );
  assert.deepEqual(p.contributing.map((c) => c.code), ["C1", "C4"]);
  assert.deepEqual(p.awaiting.map((c) => c.code), ["C2"]);
  assert.equal(p.percentage, 95, "the engine's overall figure is passed through");
});

test("hasDataOn agrees with presentChannel", () => {
  /* Two predicates that disagree would sort a channel into "awaiting" and then
     render it as measured. */
  for (const c of [
    channel(),
    channel({ percentage: 90, possiblePoints: 100, earnedPoints: 90 }),
    channel({ unitCount: 0 }),
    channel({ unitCount: 3 }),
    channel({ possiblePoints: 100 }),
  ]) {
    assert.equal(hasDataOn(c), presentChannel(c).state !== "no_data");
  }
});

/* ── Period ───────────────────────────────────────────────────────────────── */

test("a period key becomes months a person recognises", () => {
  assert.equal(periodLabel("2026-Q3"), "July–September 2026");
  assert.equal(periodLabel("2026Q1"), "January–March 2026");
});

test("an unrecognised period key is shown as-is, not guessed", () => {
  assert.equal(periodLabel("2026-13"), "2026-13");
  assert.equal(periodLabel(""), "");
});

/* ── The ledger ───────────────────────────────────────────────────────────── */

test("an entry says what happened, by how much, and why", () => {
  /* The reported fault: "Task approved · Score: 0.80" carried no reason and no
     subject, both of which the record already holds. */
  const e = presentLedgerEntry({
    eventType: "task_completed",
    credit: 0.8,
    deduction: 0,
    reason: "Completed before deadline",
    sourceLabel: "Fabric catalogue numbering",
    actorId: "GR0000",
    actorLabel: "Rishee Ray",
  });
  assert.equal(e.title, "Task approved");
  assert.equal(e.signedPoints, 0.8);
  assert.equal(e.direction, "credit");
  assert.equal(e.reason, "Completed before deadline");
  assert.equal(e.subject, "Fabric catalogue numbering");
  assert.equal(e.actor, "Rishee Ray");
});

test("a deduction is signed negative, not inferred from a colour", () => {
  const e = presentLedgerEntry({
    eventType: "deadline_missed",
    credit: 0,
    deduction: 0.2,
    reason: "Submitted after the deadline",
    sourceLabel: "Winter drop",
    actorId: "system",
    actorLabel: "System",
  });
  assert.equal(e.signedPoints, -0.2);
  assert.equal(e.direction, "deduction");
});

test("an entry worth nothing is neutral, not a minus zero", () => {
  /* The old render inferred the sign from `credit > 0`, printing "−0" for an
     entry that is genuinely neither a credit nor a deduction. */
  const e = presentLedgerEntry({
    eventType: "extension_waived", credit: 0, deduction: 0,
    reason: "Waived by the reviewer", sourceLabel: "x",
    actorId: "GR0000", actorLabel: "Rishee Ray",
  });
  assert.equal(e.signedPoints, 0);
  assert.equal(e.direction, "neutral");
});

test("the engine acting on its own is not named as a person", () => {
  const e = presentLedgerEntry({
    eventType: "attendance_present", credit: 1, deduction: 0,
    reason: "Present", sourceLabel: "29 July",
    actorId: "system", actorLabel: "System",
  });
  assert.equal(e.actor, null, '"System" tells a reader nothing they can use');
});

test("every event type has a human label", () => {
  for (const type of [
    "task_completed", "rework_applied", "deadline_missed", "extension_charged",
    "extension_waived", "rejection_applied", "goal_activity_completed",
    "goal_activity_late", "conduct_breach", "attendance_present",
    "late_arrival", "early_departure", "absence", "manual_adjustment", "reversal",
  ]) {
    const label = eventLabel(type);
    assert.ok(label.length > 0);
    assert.equal(label.includes("_"), false, `${type} still reads as a field name`);
  }
});

/* ── No implementation detail on screen ───────────────────────────────────── */

test("channel explanations name behaviour, not internals", () => {
  for (const code of ["C1", "C2", "C3", "C4"]) {
    const text = explanationFor(code);
    assert.ok(text.length > 20, `${code} needs a real explanation`);
    for (const jargon of ["unit", "ledger", "component", "percentage", "field"]) {
      assert.equal(
        text.toLowerCase().includes(jargon),
        false,
        `${code} explanation exposes "${jargon}"`,
      );
    }
  }
});

test("this module computes no score", () => {
  /* The hard boundary. Presentation may decide what is SHOWN and must never
     decide what a score IS — `engine.ts` owns every formula, and a second
     implementation is how a screen and an appraisal come to disagree. */
  const src = readFileSync("lib/rules/scoring/scoreDisplay.ts", "utf8");
  assert.equal(
    /from "\.\/engine/.test(src),
    false,
    "presentation must not reach into the scoring engine",
  );
  /* The one multiplication present is the reconciliation CHECK, which compares a
     derived figure against the engine's and shows less when they disagree. */
  assert.equal((src.match(/\* 100/g) ?? []).length, 1);
});

/* ── Trend ────────────────────────────────────────────────────────────────── */

test("a trend compares two figures the engine reported", () => {
  /* `ScoreOverview.delta` is documented as always zero, so the overview used to
     render "↑0 since <last quarter>" on every score — a claim about a
     comparison nobody made. The annual strip carries real prior quarters. */
  const t = trendFrom(
    [
      { periodKey: "2026-Q2", overall: 91 },
      { periodKey: "2026-Q3", overall: 95 },
    ],
    "2026-Q3",
  );
  assert.equal(t.change, 4);
  assert.equal(t.direction, "up");
  assert.equal(t.previousLabel, "April–June 2026");
});

test("a fall is signed downward", () => {
  const t = trendFrom(
    [{ periodKey: "2026-Q2", overall: 95 }, { periodKey: "2026-Q3", overall: 92 }],
    "2026-Q3",
  );
  assert.equal(t.change, -3);
  assert.equal(t.direction, "down");
});

test("the first measured period has no trend at all", () => {
  /* An arrow here would compare against a period that does not exist. */
  const t = trendFrom([{ periodKey: "2026-Q3", overall: 95 }], "2026-Q3");
  assert.equal(t.change, null);
  assert.equal(t.direction, "unknown");
});

test("a period missing from the strip yields no trend rather than a guess", () => {
  /* The strip and the overview disagreeing about which period this is means one
     of them is wrong, and picking would put a wrong arrow on a record. */
  const t = trendFrom([{ periodKey: "2026-Q1", overall: 80 }], "2026-Q3");
  assert.equal(t.change, null);
  assert.deepEqual(trendFrom([], "2026-Q3").change, null);
});
