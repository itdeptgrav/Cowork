import type {
  DeadlineExtensionRecord,
  TimeBudgetExtensionRecord,
} from "./extensionRecords.ts";

/**
 * Every round of the time conversation, in one list.
 *
 * **The reported fault, 17 Aug 2026: "Negotiation history — No proposals
 * yet."** on a task with six real negotiation events behind it. The panel read
 * `cowork_task_proposals`, which the current flows stopped writing to: hours
 * requests go to `cowork_task_budget_extensions` and date escalations to
 * `cowork_task_deadline_extensions`. Both were invisible, so the audit trail
 * said nothing had ever been asked on a task that had been renegotiated four
 * times.
 *
 * Two record types, one account. They are different conversations — one about
 * HOURS and one about a DATE — and the list says which each row is rather than
 * flattening them into a single vocabulary, because "granted 30 minutes" and
 * "moved the deadline to 15:30" are not the same claim and a reader who cannot
 * tell them apart cannot check either.
 *
 * Pure: no formatting, no dates rendered, no component imports.
 */

export type NegotiationKind = "hours" | "deadline";

export interface NegotiationRow {
  id: string;
  kind: NegotiationKind;
  status: string;
  /** Sort key, ms. Null where the record carries no usable instant. */
  atMs: number | null;
  /** What was ASKED FOR, in the record's own terms. */
  asked: {
    /** Hours rounds: the addition requested, in seconds. */
    addedSecs?: number;
    /** Hours rounds: the budget it was measured against. */
    previousSecs?: number;
    /** Deadline rounds: ISO. */
    deadline?: string | null;
  };
  /**
   * What was actually GRANTED, when it differed from what was asked.
   *
   * Null when the answer matched the request — which is the common case and
   * must read differently from "granted nothing". The owner's requirement of
   * 17 Aug 2026: an assignee who asked for an hour and got thirty minutes has
   * to see both figures, never the smaller one alone.
   */
  granted: {
    totalSecs?: number;
    deadline?: string | null;
  } | null;
  reason: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Both conversations, newest last.
 *
 * Ordered by when each was RAISED, so a round and its answer stay adjacent;
 * sorting by the decision instead would scatter a negotiation across the list
 * as each round was answered.
 *
 * Records with no usable timestamp sort to the end rather than to 1970 — an
 * unknown time is not the beginning of time, and putting them first would
 * rewrite the order of everything that does have one.
 */
export function negotiationHistory(input: {
  budget: TimeBudgetExtensionRecord[];
  deadline: DeadlineExtensionRecord[];
}): NegotiationRow[] {
  const rows: NegotiationRow[] = [];

  for (const r of input.budget) {
    rows.push({
      id: r.id,
      kind: "hours",
      status: r.status,
      atMs: ms(r.createdAt),
      asked: {
        addedSecs: r.requestedAdditionalSecs,
        previousSecs: r.previousBudgetSecs,
      },
      /* `approvedSecs` is null when the manager granted exactly what was
         asked. Carrying that null through is what lets the row say "granted
         as asked" instead of restating the same figure as though it were a
         counter-offer. */
      /* Same guard on the hours side: a "grant" equal to what was asked is not
         a counter-offer, whatever the record happens to store. */
      granted:
        r.approvedSecs !== null && r.approvedSecs !== r.newBudgetSecs
          ? { totalSecs: r.approvedSecs }
          : null,
      reason: r.reason,
    });
  }

  for (const r of input.deadline) {
    rows.push({
      id: r.id,
      kind: "deadline",
      status: r.status,
      atMs: ms(r.createdAt),
      asked: { deadline: r.proposedDeadline },
      /* A counter equal to the request countered NOTHING, and reporting it as
         "granted 15:00, not the 15:00 asked for" states a difference that does
         not exist. Compared as instants rather than strings, so the same
         moment written two ways is still the same moment. */
      granted:
        r.counterDeadline != null &&
        ms(r.counterDeadline) !== ms(r.proposedDeadline)
          ? { deadline: r.counterDeadline }
          : null,
      reason: r.reason,
    });
  }

  return rows.sort((a, b) => {
    if (a.atMs === null && b.atMs === null) return 0;
    if (a.atMs === null) return 1;
    if (b.atMs === null) return -1;
    return a.atMs - b.atMs;
  });
}

/**
 * Did the answer differ from the request?
 *
 * The one question the audit trail exists to answer at a glance, and the
 * reason a row cannot simply print its latest figure.
 */
export function wasReduced(row: NegotiationRow): boolean {
  return row.granted !== null;
}
