import type { GoalReportFile, GoalStepPerson } from "../../repositories/types";

/**
 * C2 · a goal carried by more than one person.
 *
 * A goal task can be assigned to several people, and then each of them walks
 * the SAME roadmap independently: their own report against each step, their own
 * approval, their own points. Two people on a three-step goal is six pieces of
 * work, not three.
 *
 * ## Each person earns the step's full points
 *
 * Not a share of them. This is the old Cowork's rule — `pointsAwarded` was set
 * to the node's whole `points` for whoever was marked done — and it is the one
 * that matches what the steps mean: a step is a thing each assignee has to do,
 * so each of them doing it is worth what it is worth. Splitting would make a
 * goal worth less per head the more people were put on it, which would make
 * adding a second person a punishment for both.
 *
 * ## What "the step is done" means
 *
 * Two different questions, and they are answered separately:
 *
 * - **Is it done for this person?** — `statusFor`. What they see, and what
 *   gates their next step.
 * - **Is it done, flatly?** — only when EVERY assignee is done, via
 *   `rollUpStatus`. That flat status is what the engine and the old app read,
 *   so it may not claim completion while somebody still owes work.
 *
 * ## Where per-person state lives
 *
 * On the step, under `perUserStatus[employeeId]` — the engine's own shape,
 * carried through `rest` on read and written back by the roadmap save. The
 * engine's `submit-report` endpoint writes a FLAT report and knows nothing
 * about any of this, so a per-person report is recorded IN ADDITION to that
 * call rather than instead of it: the flat report keeps the engine's emails,
 * its `reportSubmitted` flag and the old app working unchanged.
 *
 * A single-assignee goal never touches any of this. `perUserStatus` stays
 * absent and every read falls through to the flat fields, which is what makes
 * this additive rather than a second way to do the same thing.
 */

/**
 * One person's progress against one step.
 *
 * The repository's own shape, aliased rather than restated — a second
 * definition of the same row would be a second thing to keep in step.
 */
export type PersonStep = GoalStepPerson;

/** A step, as much of it as these rules need. */
export interface StepWithPeople {
  status: string;
  report: {
    text: string;
    submittedAt: string | null;
    submittedBy: string | null;
    files: GoalReportFile[];
  } | null;
  /** Keyed by employee id. Absent on a single-assignee goal. */
  perUserStatus?: Record<string, Partial<PersonStep>> | null;
}

const EMPTY: PersonStep = {
  status: "pending",
  report: null,
  doneAt: null,
  lateSubmission: false,
  pointsAwarded: 0,
};

/**
 * Whether this goal is carried by more than one person.
 *
 * The whole per-person layer turns on this. One assignee reads and writes the
 * flat fields exactly as before — there is no `perUserStatus` to consult and
 * none is written, so a goal that was never shared is byte-for-byte what it
 * always was.
 */
export function isShared(assigneeIds: readonly string[]): boolean {
  return assigneeIds.length > 1;
}

/**
 * One person's state against one step.
 *
 * On a shared goal, missing per-person state reads as `pending` rather than as
 * the flat status: somebody added to a goal after another person finished a
 * step has not done that step, and inheriting a stranger's `done` would credit
 * them for work they never did.
 */
export function personStep(input: {
  step: StepWithPeople;
  personId: string;
  assigneeIds: readonly string[];
}): PersonStep {
  const { step, personId, assigneeIds } = input;

  if (!isShared(assigneeIds)) {
    /* Not shared: the flat fields ARE this person's state. */
    return {
      ...EMPTY,
      status: step.status || "pending",
      report: step.report,
    };
  }

  const held = step.perUserStatus?.[personId];
  if (!held) return { ...EMPTY };
  return {
    status: typeof held.status === "string" && held.status ? held.status : "pending",
    report: held.report ?? null,
    doneAt: held.doneAt ?? null,
    lateSubmission: held.lateSubmission === true,
    pointsAwarded: Number.isFinite(held.pointsAwarded)
      ? Number(held.pointsAwarded)
      : 0,
  };
}

/**
 * What the step's FLAT status should become.
 *
 * `done` only once every assignee is done. The flat status is what the engine
 * reads for its progress counts and what the old Cowork renders, so it must
 * never say the step is finished while somebody still owes a report.
 *
 * An assignee list that is empty or unshared leaves the flat status alone —
 * there is nothing to roll up from.
 */
export function rollUpStatus(input: {
  step: StepWithPeople;
  assigneeIds: readonly string[];
  /** The per-person state as it will be AFTER the write being made. */
  next: Record<string, Partial<PersonStep>>;
}): string {
  const { step, assigneeIds, next } = input;
  if (!isShared(assigneeIds)) return step.status;

  const everyone = assigneeIds.every((id) => next[id]?.status === "done");
  if (everyone) return "done";

  /* Somebody is still owed. `pending_approval` where anybody is waiting, so a
     head scanning the flat list still sees there is something to decide. */
  const anyWaiting = assigneeIds.some(
    (id) => next[id]?.status === "pending_approval",
  );
  return anyWaiting ? "pending_approval" : "pending";
}

/**
 * The per-person map after one person hands a step in.
 *
 * Returned rather than mutated, and everything already held for that person is
 * kept: a re-submission after a send-back must not wipe the `pointsAwarded`
 * history of an earlier attempt.
 */
export function withReport(input: {
  step: StepWithPeople;
  personId: string;
  report: PersonStep["report"];
}): Record<string, Partial<PersonStep>> {
  const held = { ...(input.step.perUserStatus ?? {}) };
  held[input.personId] = {
    ...(held[input.personId] ?? {}),
    status: "pending_approval",
    report: input.report,
  };
  return held;
}

/**
 * The per-person map after a head decides one person's step.
 *
 * A refusal clears that person's report so they can hand in another — and only
 * theirs. Approving records what they earned, which is the step's full points
 * unless it was late.
 */
export function withDecision(input: {
  step: StepWithPeople;
  personId: string;
  approve: boolean;
  /** The step's full points. Each person earns these, not a share of them. */
  points: number;
  late: boolean;
  nowIso: string;
}): Record<string, Partial<PersonStep>> {
  const held = { ...(input.step.perUserStatus ?? {}) };
  const before = held[input.personId] ?? {};

  if (!input.approve) {
    held[input.personId] = {
      ...before,
      status: "pending",
      report: null,
      doneAt: null,
    };
    return held;
  }

  held[input.personId] = {
    ...before,
    status: "done",
    doneAt: input.nowIso,
    lateSubmission: input.late,
    /* Late earns nothing, and that is the engine's rule too — it re-checks the
       deadline and answers `skipped`. This records the same outcome so the
       roadmap does not show points the engine refused to pay. */
    pointsAwarded: input.late ? 0 : input.points,
  };
  return held;
}

/** How far one person has got through a whole roadmap. */
export interface PersonProgress {
  personId: string;
  doneCount: number;
  totalCount: number;
  /** What they have actually banked. */
  pointsEarned: number;
  /** What is still open to them. */
  pointsRemaining: number;
  /** Whether anything of theirs is waiting on a decision. */
  waiting: boolean;
}

/**
 * Each person's progress across the roadmap.
 *
 * The head's view of a shared goal: who is where, and who is owed a decision.
 * Points remaining counts every step this person has not banked, INCLUDING one
 * that was approved late — late earns nothing, but the step is finished, so
 * counting it as still available would promise points nobody can now get.
 */
export function progressFor(input: {
  steps: { points: number; step: StepWithPeople }[];
  assigneeIds: readonly string[];
}): PersonProgress[] {
  const { steps, assigneeIds } = input;
  return assigneeIds.map((personId) => {
    let doneCount = 0;
    let pointsEarned = 0;
    let pointsRemaining = 0;
    let waiting = false;

    for (const { points, step } of steps) {
      const mine = personStep({ step, personId, assigneeIds });
      if (mine.status === "done") {
        doneCount += 1;
        pointsEarned += mine.pointsAwarded;
      } else {
        pointsRemaining += points;
        if (mine.status === "pending_approval") waiting = true;
      }
    }

    return {
      personId,
      doneCount,
      totalCount: steps.length,
      pointsEarned,
      pointsRemaining,
      waiting,
    };
  });
}
