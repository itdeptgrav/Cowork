import { actingOrganisationId } from "./store";
/**
 * Projects the store's task, goal, conduct and attendance state into score
 * units and ledger entries.
 *
 * In production this is the rule engine writing an append-only ledger inside
 * the same transaction as the domain event. Here it is recomputed from state,
 * which is fine for a prototype and keeps the demo resettable — but the SHAPE
 * is the real one: every unit has a maximum, every deduction is an event with a
 * rule version and a config snapshot, and every figure traces to a source.
 */

import type { ScoreLedgerEntry, ScoreUnit } from "@/lib/domain";
import {
  REWORK_DEDUCTION,
  UNIT_MAXIMUM,
  clampPoints,
  deductionFor,
  makeLedgerEntry,
  periodKeyFor,
} from "@/lib/rules/scoring/engine";
import { PROVISIONAL_RULES } from "@/lib/config/provisional";
import type { Store } from "./store";

interface Projection {
  units: ScoreUnit[];
  ledger: ScoreLedgerEntry[];
}

export function projectScores(store: Store, employeeId: string): Projection {
  const units: ScoreUnit[] = [];
  const ledger: ScoreLedgerEntry[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${employeeId}-${++n}`;

  const rule = (key: string) => store.rules.find((r) => r.key === key)!;

  /* ── C1 · Task Execution ────────────────────────────────────────────────── */

  const scored = store.tasks.filter((t) => {
    if (!t.isScoreEligible || t.deletedAt) return false;
    if (t.status !== "completed" && t.status !== "cancelled") return false;
    const asg = store.assignments.find(
      (a) =>
        a.taskId === t.id && a.employeeId === employeeId && a.isScoreSubject,
    );
    return Boolean(asg);
  });

  for (const task of scored) {
    const effectiveDate = (task.updatedAt ?? task.createdAt).slice(0, 10);
    const periodKey = periodKeyFor(effectiveDate);
    const unitId = id("su-c1");

    // Cancelled tasks are EXCLUDED, not zeroed — legacy intended this but
    // never actually called the function that did it (O6 / provisional).
    if (task.status === "cancelled") {
      units.push({
        id: unitId,
        employeeId,
        component: "c1",
        sourceType: "task",
        sourceId: task.id,
        sourceLabel: task.title,
        periodKey,
        maximumPoints: UNIT_MAXIMUM,
        earnedPoints: 0,
        isExcluded: true,
        exclusionReason: "Task cancelled — excluded from scoring",
        finalisedAt: null,
        effectiveDate,
      });
      continue;
    }

    const reworks = store.reworkRequests.filter(
      (r) => r.taskId === task.id && !r.deductionWaived,
    );
    const rejections = store.rejections.filter((r) => r.taskId === task.id);
    const chargedExtensions = store.extensions.filter(
      (e) => e.taskId === task.id && !e.penaltyWaived,
    );
    const submission = store.submissions
      .filter((s) => s.taskId === task.id)
      .sort((a, b) => b.attempt - a.attempt)[0];
    const missedDeadline = submission?.wasLate ?? false;

    let running = UNIT_MAXIMUM;

    const push = (
      eventType: Parameters<typeof deductionFor>[0],
      amount: number,
      reason: string,
      ruleKey: string,
      isProvisional: boolean,
    ) => {
      const before = running;
      running = clampPoints(before - amount, UNIT_MAXIMUM);
      const r = rule(ruleKey);
      ledger.push(
        makeLedgerEntry(
          id("le"),
          {
            organisationId: actingOrganisationId(),
            employeeId,
            component: "c1",
            sourceType: "task",
            sourceId: task.id,
            sourceLabel: task.title,
            scoreUnitId: unitId,
            eventType,
            maximumPoints: UNIT_MAXIMUM,
            pointsBefore: before,
            deduction: amount,
            credit: 0,
            reason,
            actorId: "system",
            actorLabel: "Scoring engine",
            effectiveDate,
            periodKey,
            ruleId: r.id,
            ruleVersion: r.version.version,
            configSnapshot: r.version.parameters,
            isProvisional,
          },
          effectiveDate,
        ),
      );
    };

    // Base credit — the unit starts at its maximum.
    ledger.push(
      makeLedgerEntry(
        id("le"),
        {
          organisationId: actingOrganisationId(),
          employeeId,
          component: "c1",
          sourceType: "task",
          sourceId: task.id,
          sourceLabel: task.title,
          scoreUnitId: unitId,
          eventType: "task_completed",
          maximumPoints: UNIT_MAXIMUM,
          pointsBefore: 0,
          deduction: 0,
          credit: UNIT_MAXIMUM,
          reason: "Task completed",
          actorId: "system",
          actorLabel: "Scoring engine",
          effectiveDate,
          periodKey,
          ruleId: rule("c1.rework").id,
          ruleVersion: rule("c1.rework").version.version,
          configSnapshot: {},
          isProvisional: false,
        },
        effectiveDate,
      ),
    );

    for (const rw of reworks) {
      push(
        "rework_applied",
        REWORK_DEDUCTION,
        `Rework #${rw.occurrence} — ${rw.reason}`,
        "c1.rework",
        false,
      );
    }
    if (missedDeadline) {
      const d = deductionFor("deadline_missed");
      push(
        "deadline_missed",
        d.amount,
        "Submitted after the scored deadline",
        "c1.deadline_missed",
        true,
      );
    }
    for (let i = 0; i < chargedExtensions.length; i++) {
      const d = deductionFor("extension_charged");
      push(
        "extension_charged",
        d.amount,
        "Extension granted with the penalty charged",
        "c1.extension_charged",
        true,
      );
    }
    for (const rj of rejections) {
      const d = deductionFor("rejection_applied");
      push(
        "rejection_applied",
        d.amount,
        `Rejected — ${rj.reason}`,
        "c1.rejection",
        true,
      );
    }

    units.push({
      id: unitId,
      employeeId,
      component: "c1",
      sourceType: "task",
      sourceId: task.id,
      sourceLabel: task.title,
      periodKey,
      maximumPoints: UNIT_MAXIMUM,
      earnedPoints: running,
      isExcluded: false,
      exclusionReason: null,
      finalisedAt: null,
      effectiveDate,
    });
  }

  /* ── C2 · Goal Attainment ───────────────────────────────────────────────── */

  const myGoals = store.goals.filter(
    (g) => g.ownerId === employeeId && g.status === "active",
  );
  for (const goal of myGoals) {
    const acts = store.goalActivities.filter((a) => a.goalId === goal.id);
    for (const act of acts) {
      const effectiveDate = (act.dueAt ?? goal.createdAt).slice(0, 10);
      const periodKey = goal.periodKey;
      const unitId = id("su-c2");
      const max = act.points;
      const done = act.status === "approved";
      const late = act.submittedLate;

      let running = 0;
      const r = rule("c2.activity");

      if (done) {
        running = max;
        ledger.push(
          makeLedgerEntry(
            id("le"),
            {
              organisationId: actingOrganisationId(),
              employeeId,
              component: "c2",
              sourceType: "goal_activity",
              sourceId: act.id,
              sourceLabel: `${goal.title} — ${act.heading}`,
              scoreUnitId: unitId,
              eventType: "goal_activity_completed",
              maximumPoints: max,
              pointsBefore: 0,
              deduction: 0,
              credit: max,
              reason: "Goal activity approved",
              actorId: "system",
              actorLabel: "Scoring engine",
              effectiveDate,
              periodKey,
              ruleId: r.id,
              ruleVersion: r.version.version,
              configSnapshot: r.version.parameters,
              isProvisional: true,
            },
            effectiveDate,
          ),
        );
        if (late) {
          const before = running;
          running = 0;
          ledger.push(
            makeLedgerEntry(
              id("le"),
              {
                organisationId: actingOrganisationId(),
                employeeId,
                component: "c2",
                sourceType: "goal_activity",
                sourceId: act.id,
                sourceLabel: `${goal.title} — ${act.heading}`,
                scoreUnitId: unitId,
                eventType: "goal_activity_late",
                maximumPoints: max,
                pointsBefore: before,
                deduction: max,
                credit: 0,
                reason: "Submitted late — points forfeited",
                actorId: "system",
                actorLabel: "Scoring engine",
                effectiveDate,
                periodKey,
                ruleId: r.id,
                ruleVersion: r.version.version,
                configSnapshot: r.version.parameters,
                isProvisional: true,
              },
              effectiveDate,
            ),
          );
        }
      }

      units.push({
        id: unitId,
        employeeId,
        component: "c2",
        sourceType: "goal_activity",
        sourceId: act.id,
        sourceLabel: `${goal.title} — ${act.heading}`,
        periodKey,
        maximumPoints: max,
        earnedPoints: running,
        isExcluded: false,
        exclusionReason: null,
        finalisedAt: null,
        effectiveDate,
      });
    }
  }

  /* ── C3 · Conduct & Policy ──────────────────────────────────────────────── */

  const myConduct = store.conductEvents.filter(
    (c) => c.employeeId === employeeId && c.disputeStatus !== "overturned",
  );
  for (const ev of myConduct) {
    const periodKey = periodKeyFor(ev.occurredOn);
    const unitId = id("su-c3");
    const d = deductionFor("conduct_breach", { severity: ev.severity });
    const max = Math.max(UNIT_MAXIMUM, d.amount);
    const earned = clampPoints(max - d.amount, max);
    const r = rule("c3.conduct");

    ledger.push(
      makeLedgerEntry(
        id("le"),
        {
          organisationId: actingOrganisationId(),
          employeeId,
          component: "c3",
          sourceType: "conduct_event",
          sourceId: ev.id,
          sourceLabel: ev.policyName,
          scoreUnitId: unitId,
          eventType: "conduct_breach",
          maximumPoints: max,
          pointsBefore: max,
          deduction: d.amount,
          credit: 0,
          reason: ev.description,
          actorId: ev.appliedById,
          actorLabel: ev.appliedByName,
          effectiveDate: ev.occurredOn,
          periodKey,
          ruleId: r.id,
          ruleVersion: r.version.version,
          configSnapshot: r.version.parameters,
          isProvisional: true,
        },
        ev.appliedAt,
      ),
    );

    units.push({
      id: unitId,
      employeeId,
      component: "c3",
      sourceType: "conduct_event",
      sourceId: ev.id,
      sourceLabel: ev.policyName,
      periodKey,
      maximumPoints: max,
      earnedPoints: earned,
      isExcluded: false,
      exclusionReason: null,
      finalisedAt: null,
      effectiveDate: ev.occurredOn,
    });
  }

  /* ── C4 · Attendance ────────────────────────────────────────────────────── */

  const myDays = store.attendance.filter(
    (d) => d.employeeId === employeeId && d.isExpectedWorkingDay,
  );
  const r4 = rule("c4.attendance");

  for (const d of myDays) {
    const periodKey = periodKeyFor(d.date);
    const unitId = id("su-c4");
    let running = UNIT_MAXIMUM;

    const add = (
      eventType: Parameters<typeof deductionFor>[0],
      amount: number,
      reason: string,
    ) => {
      if (amount <= 0) return;
      const before = running;
      running = clampPoints(before - amount, UNIT_MAXIMUM);
      ledger.push(
        makeLedgerEntry(
          id("le"),
          {
            organisationId: actingOrganisationId(),
            employeeId,
            component: "c4",
            sourceType: "attendance_day",
            sourceId: d.id,
            sourceLabel: "Attendance",
            scoreUnitId: unitId,
            eventType,
            maximumPoints: UNIT_MAXIMUM,
            pointsBefore: before,
            deduction: amount,
            credit: 0,
            reason,
            actorId: "system",
            actorLabel: "Attendance engine",
            effectiveDate: d.date,
            periodKey,
            ruleId: r4.id,
            ruleVersion: r4.version.version,
            configSnapshot: r4.version.parameters,
            isProvisional: true,
          },
          d.date,
        ),
      );
    };

    if (d.status === "absent") {
      add("absence", deductionFor("absence").amount, "Absent");
    } else if (d.status === "half_day") {
      add(
        "early_departure",
        Number(PROVISIONAL_RULES.halfDayDeduction.value),
        "Half day",
      );
    } else if (d.status === "leave" || d.status === "holiday") {
      // Approved leave and holidays are not deductions. The day still counts as
      // a unit at full points so the denominator reflects the calendar.
    } else {
      if (d.lateMinutes > 0) {
        const dd = deductionFor("late_arrival", { lateMinutes: d.lateMinutes });
        add("late_arrival", dd.amount, `${d.lateMinutes} min late`);
      }
      if (d.earlyDepartureMinutes > 0) {
        const dd = deductionFor("early_departure", {
          earlyMinutes: d.earlyDepartureMinutes,
        });
        add(
          "early_departure",
          dd.amount,
          `${d.earlyDepartureMinutes} min early`,
        );
      }
    }

    units.push({
      id: unitId,
      employeeId,
      component: "c4",
      sourceType: "attendance_day",
      sourceId: d.id,
      sourceLabel: "Attendance",
      periodKey,
      maximumPoints: UNIT_MAXIMUM,
      earnedPoints: running,
      isExcluded: false,
      exclusionReason: null,
      finalisedAt: null,
      effectiveDate: d.date,
    });
  }

  return { units, ledger };
}
