import type { ScoreUnit } from "@/lib/domain";

/**
 * Why a task scored what it scored, in the words of what happened.
 *
 * **Nothing here computes a score.** Every figure comes from the engine's own
 * per-task record — `taskScore`, and the counters beside it. What this does is
 * turn counters into sentences: "0 deadlines missed" is a field, "completed
 * before the deadline" is a reason, and only one of those tells somebody what
 * they did well.
 *
 * The counters arrive on the C1 breakdown and were being discarded along with
 * the rest of the array. They are the answer to the question the score page
 * exists to answer and could not: *why is my score this number*.
 */

/** The counters the engine sends per task, and nothing derived from them. */
export interface TaskFacts {
  taskScore: number | null;
  deadlinesMissed: number;
  extensionsFiled: number;
  reworksReceived: number;
  isRejected: boolean;
  c1Status: string;
}

export type ReasonTone = "positive" | "negative" | "neutral";

export interface Reason {
  text: string;
  tone: ReasonTone;
}

/**
 * What happened to this task, best news first.
 *
 * Order is deliberate: somebody scanning their own record should meet what
 * they did well before what cost them, and a list that opens with a penalty
 * reads as an accusation whatever it says further down. Within each side the
 * order is fixed rather than by size, so the same task always reads the same
 * way.
 */
export function reasonsFor(facts: TaskFacts): Reason[] {
  const out: Reason[] = [];

  if (facts.isRejected) {
    /* A rejection ends the story — the task is out of the quality rate
       entirely, so the counters beneath it describe work that no longer
       counts, and listing them would imply otherwise. */
    return [
      { text: "Submission was rejected", tone: "negative" },
      { text: "Not counted toward this quarter", tone: "neutral" },
    ];
  }

  if (facts.deadlinesMissed === 0) {
    out.push({ text: "Completed before the deadline", tone: "positive" });
  }
  if (facts.reworksReceived === 0) {
    out.push({ text: "Approved on the first submission", tone: "positive" });
  }
  if (facts.extensionsFiled === 0 && facts.deadlinesMissed === 0) {
    out.push({ text: "Finished without asking for more time", tone: "positive" });
  }

  if (facts.deadlinesMissed > 0) {
    out.push({
      text:
        facts.deadlinesMissed === 1
          ? "Missed the deadline"
          : `Missed the deadline ${facts.deadlinesMissed} times`,
      tone: "negative",
    });
  }
  if (facts.reworksReceived > 0) {
    out.push({
      text:
        facts.reworksReceived === 1
          ? "Sent back once for rework"
          : `Sent back ${facts.reworksReceived} times for rework`,
      tone: "negative",
    });
  }
  if (facts.extensionsFiled > 0) {
    out.push({
      text:
        facts.extensionsFiled === 1
          ? "An extension was requested"
          : `${facts.extensionsFiled} extensions were requested`,
      tone: "negative",
    });
  }

  /* A task the engine has not finished scoring has no story yet. Saying so
     beats an empty block, which reads as "nothing happened". */
  if (out.length === 0) {
    out.push({ text: "No scoring events recorded yet", tone: "neutral" });
  }
  return out;
}

/**
 * The one-line verdict, for a card header.
 *
 * Deliberately not a grade. A letter or a word like "excellent" is a judgement
 * the engine did not make, and inventing one on a performance record is the
 * sort of claim that follows somebody into a review.
 */
export function outcomeOf(facts: TaskFacts): {
  label: string;
  tone: ReasonTone;
} {
  if (facts.isRejected) return { label: "Rejected", tone: "negative" };
  if (facts.c1Status === "completed") {
    const clean =
      facts.deadlinesMissed === 0 &&
      facts.reworksReceived === 0 &&
      facts.extensionsFiled === 0;
    return clean
      ? { label: "Completed cleanly", tone: "positive" }
      : { label: "Completed", tone: "neutral" };
  }
  return { label: "In progress", tone: "neutral" };
}

/**
 * Read the facts off a score unit.
 *
 * The unit carries the engine's figures; the counters ride alongside it on the
 * same response. Kept as one reader so a component never picks at raw fields.
 */
export function factsOf(
  unit: ScoreUnit & Partial<TaskFacts>,
): TaskFacts {
  return {
    taskScore: unit.earnedPoints ?? null,
    deadlinesMissed: Number(unit.deadlinesMissed) || 0,
    extensionsFiled: Number(unit.extensionsFiled) || 0,
    reworksReceived: Number(unit.reworksReceived) || 0,
    isRejected: unit.isExcluded === true || unit.isRejected === true,
    c1Status: typeof unit.c1Status === "string" ? unit.c1Status : "",
  };
}
