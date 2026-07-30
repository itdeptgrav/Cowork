import type { DeadlineExtension, DeadlineProposal } from "@/lib/domain";
import type { EmployeeId, TaskId } from "@/lib/domain";
import { compositeId, taskIdOf } from "./compositeId.ts";

/**
 * `deadlineHistory[]`, as deadline proposals.
 *
 * **The array has two shapes, because two services write it.** Reading only
 * one silently drops half of a task's deadline history — and which half depends
 * on whether the change came through the task engine or the CEO's edit path:
 *
 * | Writer | Fields |
 * |---|---|
 * | `taskForward.service.js:1040` | `oldDueDate` · `newDueDate` · `editedBy` · `editedByName` · `editedAt` |
 * | `coworkEnhanced.service.js:295`, `taskTree.service.js:193` | `oldDeadline` · `newDeadline` · `changedBy` · `changedAt` |
 *
 * Both carry `reason`. Everything below reads both spellings, in that order,
 * and an entry matching neither is skipped rather than rendered with blanks —
 * a deadline card with no dates on it is not evidence of anything.
 *
 * **Ids are positional and that is deliberate.** Legacy stores these as array
 * members with no identity of their own, so `${taskId}#${index}` is the only
 * stable reference available. It is also decodable, which is what lets the
 * proposal-addressed repository methods (`decideProposal(proposalId, …)`)
 * reach legacy's task-addressed routes (`/task/:taskId/approve-deadline`)
 * without inventing a proposal collection to look ids up in.
 */

export function proposalId(taskId: string, index: number): string {
  return compositeId(taskId, index);
}

/**
 * The task a proposal id refers to.
 *
 * Delegates to the shared decoder — it used `lastIndexOf`, which is wrong for
 * any id carrying more than one discriminator, and having two decoding rules in
 * the adapter is how one of them ends up wrong. See `compositeId.ts`.
 */
export function taskIdOfProposal(id: string): string {
  return taskIdOf(id);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An ISO instant from either spelling, or null. */
function instant(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    /* Firestore Timestamps arrive as `{seconds, nanoseconds}` through the REST
       path and as objects with `toDate` through the SDK. */
    if (value && typeof value === "object") {
      const record = value as { seconds?: unknown; toDate?: unknown };
      if (typeof record.toDate === "function") {
        try {
          return (record.toDate as () => Date)().toISOString();
        } catch {
          /* Fall through. */
        }
      }
      if (typeof record.seconds === "number") {
        return new Date(record.seconds * 1000).toISOString();
      }
    }
  }
  return null;
}

/**
 * One history entry as a proposal.
 *
 * `state` is always `"approved"`: every entry in `deadlineHistory` is a change
 * that HAPPENED — legacy appends on commit, not on request — so presenting one
 * as pending would put a decide button on a decision already taken. A genuinely
 * pending request lives in `deadlineExtRequest` on the task, not here.
 */
/** A positive number of seconds, or null. Zero is an absence, not a duration. */
function secsOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function toDeadlineProposal(
  raw: unknown,
  taskId: string,
  index: number,
): DeadlineProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const proposedDueAt = instant(r.newDueDate, r.newDeadline);
  /* No new date means this entry describes nothing that can be rendered as a
     deadline change. Skipped rather than shown with an empty date. */
  if (!proposedDueAt) return null;

  const changedAt = instant(r.editedAt, r.changedAt);

  return {
    id: proposalId(taskId, index),
    taskId: taskId as TaskId,
    proposedById: (text(r.editedBy) ?? text(r.changedBy) ?? "") as string,
    proposedDueAt,
    /* The amounts, where the record carries them. Legacy historically stored
       only dates — an entry written before the request route carried seconds
       has nothing to report, and says so with nulls rather than a zero that
       reads as a measured duration. */
    windowSecs: secsOf(r.proposedWindowSecs) ?? 0,
    isExtension: secsOf(r.addedSecs) !== null,
    previousWindowSecs: secsOf(r.previousWindowSecs),
    addedSecs: secsOf(r.addedSecs),
    reason: text(r.reason),
    state: "approved",
    decidedById: (text(r.editedBy) ?? text(r.changedBy)) as string | null,
    decisionReason: text(r.reason),
    createdAt: changedAt ?? proposedDueAt,
    expiresAt: null,
    decidedAt: changedAt,
  };
}

/** The whole array, newest first — a history reads backwards from now. */
export function toDeadlineProposals(
  history: readonly unknown[],
  taskId: string,
): DeadlineProposal[] {
  return history
    .map((entry, index) => toDeadlineProposal(entry, taskId, index))
    .filter((p): p is DeadlineProposal => p !== null)
    .reverse();
}

/**
 * The one pending extension request, from `deadlineExtRequest`.
 *
 * Separate from the history above because it is the only deadline record that
 * is still a QUESTION. `review-deadline-extension` refuses unless
 * `deadlineExtRequest.status === "pending"` (`taskForward.js:1996`), so this is
 * exactly the set of things a manager can still decide.
 */
export function toPendingExtension(
  doc: Record<string, unknown>,
  taskId: string,
): DeadlineProposal | null {
  const raw = doc.deadlineExtRequest;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (text(r.status) !== "pending") return null;

  const proposedDueAt = instant(r.proposedDate, r.newDate);
  if (!proposedDueAt) return null;

  return {
    id: proposalId(taskId, -1),
    taskId: taskId as TaskId,
    proposedById: text(r.requestedBy) ?? "",
    proposedDueAt,
    /*
     * The three figures, read from the record rather than derived.
     *
     * All three were hardcoded — `windowSecs: 0`, `previousWindowSecs: null` —
     * so the screen showed "00:00:00 + 00:00:00 = 00:00:00" for a request that
     * really did ask for two more hours. The amounts were never sent, never
     * stored and never read; the display was the last of four places the
     * number went missing, not the first.
     */
    windowSecs: secsOf(r.proposedWindowSecs) ?? 0,
    isExtension: true,
    previousWindowSecs: secsOf(r.previousWindowSecs),
    addedSecs: secsOf(r.addedSecs),
    reason: text(r.reason),
    state: "pending",
    decidedById: null,
    decisionReason: null,
    createdAt: instant(r.requestedAt) ?? proposedDueAt,
    expiresAt: null,
    decidedAt: null,
  };
}


/**
 * Granted extensions — the record of time actually added.
 *
 * **`listExtensions` used to return `DeadlineProposal[]` while its contract
 * says `DeadlineExtension[]`.** Different shapes: the renderer reads
 * `newWindowSecs`, `penaltyWaived` and `elapsedPercentAtRequest`, and a
 * proposal carries none of them. Every one arrived `undefined`, so the chain
 * read "+00:00:00 · 00:00:00 → 00:00:00 · Penalty charged", and
 * `Math.round(undefined)` printed the NaN.
 *
 * The chain is the GRANTED record. A request still being decided is a
 * question, not a record, and already appears under negotiation history — so
 * it is not repeated here with an approver it does not have.
 *
 * Entries without amounts are skipped rather than shown as zeroes: legacy
 * stored only dates until the request route began carrying seconds, and a row
 * of 00:00:00 reads as an extension that added nothing.
 */
export function toGrantedExtensions(
  history: readonly unknown[],
  taskId: string,
): DeadlineExtension[] {
  const out: DeadlineExtension[] = [];
  history.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const addedSecs = secsOf(r.addedSecs);
    if (addedSecs === null) return;

    const previousWindowSecs = secsOf(r.previousWindowSecs) ?? 0;
    const approvedAt = instant(r.editedAt, r.changedAt);
    const elapsed = Number(r.elapsedPercent);

    out.push({
      id: proposalId(taskId, index),
      taskId: taskId as TaskId,
      proposalId: null,
      addedSecs,
      previousWindowSecs,
      newWindowSecs: secsOf(r.proposedWindowSecs) ?? previousWindowSecs + addedSecs,
      /* Never NaN. An unreadable figure is zero here and the caller decides
         whether to render it — see `isMeasured` below. */
      elapsedPercentAtRequest: Number.isFinite(elapsed) ? elapsed : 0,
      penaltyWaived: r.isPenaltyWaived !== false,
      waiverDecidedById: null,
      approvedById: (text(r.editedBy) ?? text(r.changedBy) ?? "") as EmployeeId,
      approvedAt: approvedAt ?? "",
    });
  });
  return out.reverse();
}

/** Was the elapsed figure actually measured, or defaulted? */
export function hasMeasuredElapsed(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return Number.isFinite(Number((raw as Record<string, unknown>).elapsedPercent));
}
