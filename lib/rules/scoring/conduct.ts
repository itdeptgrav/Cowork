/**
 * C3 — Conduct. **The only component that can only ever take points away.**
 *
 * ## What it is
 *
 * A manager writes a rule ("late to a client call — 5%"), their own manager
 * approves it, and from then on it can be applied to somebody who breaches it.
 * Each application takes its percentage off that person's score for the quarter
 * it falls in. There is no way to earn C3: it starts at zero and goes down.
 *
 * ## How it reaches the score
 *
 * C1, C2 and C4 are percentages. C3 is subtracted from their average:
 *
 *     score = average(C1, C2, C4) − Σ(breaches this quarter)
 *
 * So a rule costing 5 turns 80 into 75 — **percentage points off the total**,
 * not a percentage of it. That is the reading the engine has always used, and
 * it is the only one that is dimensionally consistent with the other three
 * components; a multiplicative cut would also mean two 50% breaches left 25%
 * rather than nothing, which is a strange thing for conduct to do.
 *
 * ## Who decides — the reporting line, not a job title
 *
 * The old engine gated all of this by role: any team lead could write a rule,
 * only the CEO could approve one, and any team lead could apply one to anybody
 * in their department. That let somebody who has never worked with a person
 * take points off their record, and made every conduct rule in the company wait
 * on one person.
 *
 * It is the line now, and one rule covers all three questions: **the person one
 * step above.** A rule is approved by its author's own manager; a breach is
 * applied by the employee's own manager; a dispute is decided by the same. An
 * administrator can act where the line cannot answer — somebody at the top has
 * nobody above them, and a named approver can leave.
 */

export interface ConductActor {
  employeeId: string;
  /** Administrators stand in for a line that cannot answer. */
  isAdmin: boolean;
}

/**
 * May this person decide something about that person?
 *
 * The question behind approving a rule, applying one, and settling a dispute —
 * asked once so the three cannot drift apart.
 *
 * **Nobody decides about themselves**, whatever their role. An author approving
 * their own rule makes the approval step a formality, and somebody clearing
 * their own deduction needs no explanation at all.
 */
export function mayDecideFor(input: {
  actor: ConductActor;
  subjectId: string;
  /** The subject's primary manager, or null where the line has run out. */
  subjectManagerId: string | null;
}): boolean {
  const { actor, subjectId, subjectManagerId } = input;
  if (!actor.employeeId || !subjectId) return false;
  if (actor.employeeId === subjectId) return false;
  if (actor.isAdmin) return true;
  return subjectManagerId !== null && subjectManagerId === actor.employeeId;
}

/** Why this rule cannot be decided by this person, or null. */
export function approvalRefusal(input: {
  actor: ConductActor;
  /** Who wrote it. */
  authorId: string;
  /** Who the engine named as its approver when it was written. */
  approverId: string | null;
  status: "pending" | "approved" | "rejected";
}): string | null {
  const { actor, authorId, approverId, status } = input;
  if (status !== "pending") return `This rule was already ${status}.`;
  if (actor.employeeId === authorId)
    return "You cannot approve a rule you wrote yourself.";
  if (approverId && approverId === actor.employeeId) return null;
  if (actor.isAdmin) return null;
  return "Only the author's own manager, or an administrator, can decide this rule.";
}

/** Why this rule cannot be applied to this person, or null. */
export function applyRefusal(input: {
  actor: ConductActor;
  subjectId: string;
  subjectManagerId: string | null;
  ruleStatus: "pending" | "approved" | "rejected";
}): string | null {
  if (input.ruleStatus !== "approved")
    return "Only an approved rule can be applied. This one is still waiting on its approver.";
  if (
    !mayDecideFor({
      actor: input.actor,
      subjectId: input.subjectId,
      subjectManagerId: input.subjectManagerId,
    })
  ) {
    return "Only their own primary manager, or an administrator, can apply a conduct rule to this person.";
  }
  return null;
}

/* ── The arithmetic ───────────────────────────────────────────────────────── */

export interface ConductBreach {
  /** Percentage points taken off. Always positive. */
  percent: number;
  /** `YYYY-MM-DD`. Entries without one cannot be placed in a quarter. */
  date: string | null;
  /**
   * A dispute that was upheld — the deduction was reversed.
   *
   * The engine's word for it is `"confirmed"`, which reads like the deduction
   * was confirmed and means the opposite: the EMPLOYEE was right. Converted at
   * the wire boundary so that word never reaches a reader.
   */
  reversed: boolean;
}

/** The quarter (1–4) a `YYYY-MM-DD` falls in, or null. */
export function quarterOf(date: string | null): number | null {
  if (!date || date.length < 7) return null;
  const month = Number(date.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return Math.floor((month - 1) / 3) + 1;
}

export function yearOf(date: string | null): number | null {
  if (!date || date.length < 4) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * What C3 costs somebody in one quarter, as a negative percentage.
 *
 * Reversed entries are excluded rather than negated: a deduction that was
 * overturned did not happen, and leaving it in as an offsetting credit would
 * make the ledger add up while telling the wrong story about both entries.
 *
 * **Uncapped — owner decision.** There is a `c3Max` per band in the old
 * configuration and it has never been applied. Enough breaches can take a score
 * below zero, and that is the intended reading: conduct is not a budget of
 * misconduct that runs out.
 */
export function conductNet(
  breaches: readonly ConductBreach[],
  period: { quarter: number; year: number },
): number {
  const total = breaches.reduce((sum, b) => {
    if (b.reversed) return sum;
    if (quarterOf(b.date) !== period.quarter) return sum;
    if (yearOf(b.date) !== period.year) return sum;
    const pct = Number(b.percent);
    return Number.isFinite(pct) && pct > 0 ? sum + pct : sum;
  }, 0);
  /* Negative, because it is only ever a deduction. Rounded to two places to
     match the engine, so the figure shown and the figure computed agree. */
  return -Number(total.toFixed(2));
}

/**
 * The overall score, with conduct applied.
 *
 * The average of whatever components are measurable, plus C3 — which is zero or
 * negative. A component with nothing to measure yet is left out of the average
 * rather than counted as zero, because a person with no reviewed work has not
 * scored nought on it.
 */
export function scoreWithConduct(input: {
  c1: number | null;
  c2: number | null;
  c4: number | null;
  conduct: number;
}): number | null {
  const measured = [input.c1, input.c2, input.c4].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  if (measured.length === 0 && input.conduct === 0) return null;
  const average =
    measured.length > 0
      ? measured.reduce((s, v) => s + v, 0) / measured.length
      : 0;
  return Number((average + input.conduct).toFixed(2));
}

/* ── The argument about a deduction ───────────────────────────────────────── */

/** What has happened to a dispute, in words a reader can act on. */
export interface DisputeOutcome {
  /** Has this deduction been argued about at all? */
  raised: boolean;
  /** Is it still with the reviewer? */
  pending: boolean;
  /** Was it decided, and which way? Null while pending or never raised. */
  removed: boolean | null;
  /** One line for the row, already in the reader's vocabulary. */
  label: string;
}

/**
 * A deduction's dispute, read.
 *
 * **The engine's words are inverted and must never reach a screen.** It stores
 * `"confirmed"` for a dispute that was UPHELD — the deduction is reversed and
 * the employee was right — and `"rejected"` for one that failed, leaving the
 * deduction standing. Rendered raw, "confirmed" reads as the deduction being
 * confirmed, which is the opposite of what happened. Every surface goes through
 * here so that word is translated exactly once.
 *
 * This exists because the row could not tell the truth about itself: it offered
 * "Ask for a recheck" to somebody who had already asked, and a reviewer's
 * written reason reached nobody. Both reported.
 */
export function disputeOutcome(status: string | null | undefined): DisputeOutcome {
  const s = (status ?? "none").toLowerCase();
  if (s === "pending") {
    return {
      raised: true,
      pending: true,
      removed: null,
      label: "Recheck requested — with your manager",
    };
  }
  if (s === "confirmed") {
    return {
      raised: true,
      pending: false,
      removed: true,
      label: "Recheck upheld — this deduction was removed",
    };
  }
  if (s === "rejected") {
    return {
      raised: true,
      pending: false,
      removed: false,
      label: "Recheck decided — this deduction stands",
    };
  }
  return { raised: false, pending: false, removed: null, label: "" };
}
