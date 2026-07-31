import {
  DEADLINE_EXTENSION,
  TIME_BUDGET_EXTENSION,
  type DeadlineExtensionRecord,
  type TimeBudgetExtensionRecord,
} from "./extensionRecords.ts";

/**
 * Both conversations on one timeline, still speaking their own languages.
 *
 * **Merged in time, never in substance.** A reader wants one chronological
 * account — Pramod asked at 10:00, Rakesh granted at 10:15, Rakesh escalated at
 * 11:00 — and that is the only thing the two systems share. Each event carries
 * exactly one unit: a budget event has seconds and no dates, a deadline event
 * has dates and no seconds.
 *
 * The separation is in the TYPES, not in a rendering convention. A budget event
 * has nowhere to put a deadline, so a component cannot accidentally show one.
 *
 * ## Why events rather than records
 *
 * A record has one status; a conversation has several moments. "Requested" and
 * "approved" are two things a reader needs to see separately, with different
 * people attached — the person who asked and the person who decided are not the
 * same, and a single row cannot say both.
 */

export type ExtensionEventKind =
  | "budget_requested"
  | "budget_approved"
  | "budget_counter_proposed"
  | "budget_accepted"
  | "budget_rejected"
  | "deadline_requested"
  | "deadline_approved"
  | "deadline_rejected"
  | "deadline_counter_proposed";

interface BaseEvent {
  id: string;
  taskId: string;
  at: string | null;
  /** Who did the thing this event describes. */
  actorId: string;
  /** Who it is waiting on, where it is still a question. */
  waitingOnId: string | null;
  reason: string | null;
}

/** Seconds only. */
export interface BudgetEvent extends BaseEvent {
  unit: "hours";
  kind:
    | "budget_requested"
    | "budget_approved"
    | "budget_counter_proposed"
    | "budget_accepted"
    | "budget_rejected";
  previousBudgetSecs: number;
  newBudgetSecs: number;
}

/** Dates only. */
export interface DeadlineEvent extends BaseEvent {
  unit: "date";
  kind:
    | "deadline_requested"
    | "deadline_approved"
    | "deadline_rejected"
    | "deadline_counter_proposed";
  previousDeadline: string | null;
  proposedDeadline: string;
  /** A record from before the typed collection. Shown, never decided on. */
  isHistorical: boolean;
}

export type ExtensionEvent = BudgetEvent | DeadlineEvent;

function budgetEvents(r: TimeBudgetExtensionRecord): BudgetEvent[] {
  const base = {
    taskId: r.taskId,
    previousBudgetSecs: r.previousBudgetSecs,
    newBudgetSecs: r.newBudgetSecs,
    unit: "hours" as const,
  };
  const out: BudgetEvent[] = [
    {
      ...base,
      id: `${r.id}#requested`,
      kind: "budget_requested",
      /* The assignee asked; the manager is who it waits on. Two people, and a
         single record row could name only one of them. */
      actorId: r.requestedBy,
      waitingOnId: r.status === "pending" ? r.approverId : null,
      at: r.createdAt,
      reason: r.reason,
    },
  ];
  /* **The manager's answer.** Present for every state past `pending`, including
     the settled ones — a record that reached `accepted` was approved on the way,
     and dropping that row would leave the account showing a request and an
     agreement with nothing in between. */
  if (r.status !== "pending") {
    const declined = r.status === "rejected";
    out.push({
      ...base,
      id: `${r.id}#${declined ? "rejected" : "approved"}`,
      kind: declined ? "budget_rejected" : "budget_approved",
      /* The MANAGER acted here, not the requester. */
      actorId: r.approverId ?? "",
      /* Approval hands the turn to the ASSIGNEE. It used to name nobody, which
         is what made the timeline agree with a state machine that had already
         ended the conversation — and left the person who still had to answer
         reading a row that said the matter was closed. */
      waitingOnId: r.status === "approved" ? r.requestedBy : null,
      at: r.approvedAt,
      reason: r.reason,
      /* What the manager actually granted, where it differs from the ask. The
         row has to be able to say "granted 4h of the 6h asked for". */
      newBudgetSecs: r.approvedSecs ?? r.newBudgetSecs,
    });
  }

  /* The assignee asking again — the round that keeps the loop open. */
  if (r.status === "counter_proposed") {
    out.push({
      ...base,
      id: `${r.id}#counter-${r.round}`,
      kind: "budget_counter_proposed",
      actorId: r.requestedBy,
      waitingOnId: r.approverId,
      at: null,
      reason: r.reason,
      newBudgetSecs: r.approvedSecs ?? r.newBudgetSecs,
    });
  }

  /* Agreement. The only row that means the budget actually moved. */
  if (r.status === "accepted") {
    out.push({
      ...base,
      id: `${r.id}#accepted`,
      kind: "budget_accepted",
      actorId: r.confirmedBy ?? r.requestedBy,
      waitingOnId: null,
      at: r.confirmedAt,
      reason: null,
      newBudgetSecs: r.approvedSecs ?? r.newBudgetSecs,
    });
  }
  return out;
}

function deadlineEvents(r: DeadlineExtensionRecord): DeadlineEvent[] {
  const base = {
    taskId: r.taskId,
    previousDeadline: r.previousDeadline,
    proposedDeadline: r.proposedDeadline,
    unit: "date" as const,
    isHistorical: r.isHistorical,
  };
  const out: DeadlineEvent[] = [
    {
      ...base,
      id: `${r.id}#requested`,
      kind: "deadline_requested",
      /* The MANAGER escalated. Never the assignee — they do not negotiate
         dates with the assignor. */
      actorId: r.requestedBy,
      waitingOnId: r.status === "pending" ? r.approverId : null,
      at: r.createdAt,
      reason: r.reason,
    },
  ];
  if (r.status === "approved" || r.status === "rejected") {
    out.push({
      ...base,
      id: `${r.id}#${r.status}`,
      kind: r.status === "approved" ? "deadline_approved" : "deadline_rejected",
      /* Who ANSWERED. `decidedBy` where it was recorded, falling back to the
         nominated approver on rows that predate the field. */
      actorId: r.decidedBy ?? r.approverId ?? "",
      waitingOnId: null,
      at: r.approvedAt,
      reason: r.reason,
    });
  }
  if (r.status === "counter_proposed" && r.counterDeadline) {
    out.push({
      ...base,
      id: `${r.id}#counter`,
      kind: "deadline_counter_proposed",
      actorId: r.decidedBy ?? r.approverId ?? "",
      /* Back to the manager who asked — the conversation is not finished. */
      waitingOnId: r.requestedBy,
      at: r.approvedAt,
      reason: r.reason,
      /* The row shows what was asked for AGAINST what came back, so the
         counter is the proposed figure here. */
      proposedDeadline: r.counterDeadline,
      previousDeadline: r.proposedDeadline,
    });
  }
  return out;
}

/**
 * Both sets, oldest first.
 *
 * Undated events sort LAST rather than first: a record whose timestamp failed
 * to write is not the oldest thing that happened, and putting it at the top
 * would rewrite the account of who moved first.
 */
export function extensionTimeline(input: {
  budget: TimeBudgetExtensionRecord[];
  deadline: DeadlineExtensionRecord[];
}): ExtensionEvent[] {
  const all: ExtensionEvent[] = [
    ...input.budget.flatMap(budgetEvents),
    ...input.deadline.flatMap(deadlineEvents),
  ];
  return all.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : Number.POSITIVE_INFINITY;
    const tb = b.at ? Date.parse(b.at) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    /* Total, so one timeline never renders two ways. */
    return a.id.localeCompare(b.id);
  });
}

/**
 * What this person may see.
 *
 * **The assignor sees the date conversation only.** Not because the hours are
 * secret, but because they are not their decision and showing them invites the
 * `oldDeadline + hours` sum that is always wrong. Everyone in the reporting
 * line sees the hours, since that is the conversation they are in.
 */
export function visibleTo(
  events: ExtensionEvent[],
  viewer: {
    id: string | null;
    /** True for the assignee and for anybody managing them. */
    inReportingLine: boolean;
    /** True for whoever created the task. */
    isAssignor: boolean;
  },
): ExtensionEvent[] {
  if (!viewer.id) return [];
  return events.filter((e) => {
    if (e.unit === "date") {
      /* A commitment change concerns both sides — the assignor decides it and
         the line that asked for it needs to see the answer. */
      return viewer.isAssignor || viewer.inReportingLine;
    }
    /* Hours: the reporting line only. An assignor who is ALSO the manager sees
       them in that capacity, which `inReportingLine` already covers. */
    return viewer.inReportingLine;
  });
}

/** May this person decide the hours on this record? */
export function mayDecideBudgetEvent(input: {
  viewerId: string | null;
  record: {
    approverId: string | null;
    status: string;
    /** The requester — you never decide your OWN. Optional so the "no record
        yet" placeholder can omit it. */
    requestedBy?: string | null;
  };
}): boolean {
  if (!input.viewerId) return false;
  if (input.record.status !== "pending") return false;
  /* You never decide your OWN request for more time — granting yourself time is
     the absence of an approval, not one. So even if the approver resolved to the
     requester (a flat team, stale data, or a misconfigured routing rule), the
     "accept" is not offered to them; it belongs to their manager. */
  if (input.record.requestedBy === input.viewerId) return false;
  return input.record.approverId === input.viewerId;
}

/** The one-line description, so screen and help corpus cannot drift. */
export function describeEvent(
  event: ExtensionEvent,
  nameOf: (id: string) => string,
): string {
  const who = nameOf(event.actorId);
  switch (event.kind) {
    case "budget_requested":
      return `${who} requested additional working time`;
    case "budget_approved":
      return `${who} approved additional working time`;
    case "budget_counter_proposed":
      return `${who} asked for a different amount of working time`;
    case "budget_accepted":
      return `${who} accepted the working time granted`;
    case "budget_rejected":
      return `${who} rejected the request for additional working time`;
    case "deadline_requested":
      return `${who} requested a deadline revision`;
    case "deadline_approved":
      return `${who} approved the revised deadline`;
    case "deadline_rejected":
      return `${who} declined the revised deadline`;
    case "deadline_counter_proposed":
      return `${who} proposed a different deadline`;
  }
}

/** Is this the hours conversation? Narrows the union for a renderer. */
export function isBudgetEvent(e: ExtensionEvent): e is BudgetEvent {
  return e.unit === "hours";
}

export { DEADLINE_EXTENSION, TIME_BUDGET_EXTENSION };
