import type {
  ExtensionStatus,
  TimeBudgetExtensionRecord,
} from "./extensionRecords.ts";

/**
 * What to say about a request for more time that has not been settled.
 *
 * "You've already asked for more time and it's with your manager" was the whole
 * panel. It answers the one question nobody asks — a person who just pressed
 * the button knows they asked — and none of the ones they do: **how much did I
 * ask for, when, and has this happened before?** All of it was already fetched
 * and thrown away: the panel reads the full record list to decide whether to
 * show itself, then renders a sentence.
 *
 * Nothing here is computed from the task. Every figure is a field the engine
 * wrote at the moment of the request, so the panel cannot drift from the record
 * it is describing.
 */

/** One settled round, as a reader needs it. */
export interface SettledRound {
  id: string;
  round: number;
  askedSecs: number;
  /** What was actually granted. Equal to `askedSecs` unless it was countered. */
  grantedSecs: number | null;
  status: ExtensionStatus;
  at: string | null;
  reason: string | null;
}

export interface ExtensionProgress {
  /** The request still outstanding, or null. */
  live: {
    round: number;
    askedSecs: number;
    /** Present once the manager has offered a different figure back. */
    counterSecs: number | null;
    status: ExtensionStatus;
    askedAt: string | null;
    reason: string | null;
    /** Whose answer it is waiting on — the assignee once a counter is offered. */
    waitingOn: "manager" | "you";
  } | null;
  /** Every settled round, newest first. */
  settled: SettledRound[];
  /** Totals across settled rounds only — nothing outstanding is counted. */
  approvedCount: number;
  rejectedCount: number;
  /** Seconds actually added by past requests. */
  grantedSecs: number;
}

const SETTLED = new Set<ExtensionStatus>(["accepted", "rejected"]);

/**
 * Summarise a task's budget-extension records.
 *
 * `counter_proposed` counts as LIVE, not settled: the manager has answered but
 * the loop has not exited — the assignee still owes a reply, and calling it
 * decided would tell somebody the matter was closed while it waited on them.
 */
export function extensionProgress(
  records: readonly TimeBudgetExtensionRecord[],
): ExtensionProgress {
  const live = records.find((r) => !SETTLED.has(r.status)) ?? null;
  const settled = records
    .filter((r) => SETTLED.has(r.status))
    .map((r) => ({
      id: r.id,
      round: r.round,
      askedSecs: r.requestedAdditionalSecs,
      /* What was granted, which is not always what was asked. Null on a
         rejection: nothing was granted, and rendering `0` there reads as an
         approval worth nothing rather than as a refusal. */
      grantedSecs:
        r.status === "rejected"
          ? null
          : (r.approvedSecs ?? r.requestedAdditionalSecs),
      status: r.status,
      at: r.confirmedAt ?? r.approvedAt ?? r.createdAt,
      reason: r.reason,
    }))
    .sort((a, b) => b.round - a.round);

  return {
    live: live
      ? {
          round: live.round,
          askedSecs: live.requestedAdditionalSecs,
          counterSecs:
            live.status === "counter_proposed" ? live.approvedSecs : null,
          status: live.status,
          askedAt: live.createdAt,
          reason: live.reason,
          /* A counter hands the turn back. Saying "with your manager" then
             would leave somebody waiting for an answer that is waiting for
             them. */
          waitingOn: live.status === "counter_proposed" ? "you" : "manager",
        }
      : null,
    settled,
    approvedCount: settled.filter((r) => r.status === "accepted").length,
    rejectedCount: settled.filter((r) => r.status === "rejected").length,
    grantedSecs: settled.reduce((n, r) => n + (r.grantedSecs ?? 0), 0),
  };
}

/**
 * The one-line history, or null when there is none.
 *
 * Written as a sentence rather than a pair of counters: "asked 3 times" alone
 * invites the reader to wonder how it went, and both halves fit in a line.
 */
export function extensionHistoryLine(
  progress: ExtensionProgress,
): string | null {
  const total = progress.settled.length;
  if (total === 0) return null;
  const parts = [];
  if (progress.approvedCount > 0) parts.push(`${progress.approvedCount} granted`);
  if (progress.rejectedCount > 0) parts.push(`${progress.rejectedCount} refused`);
  return `${total} earlier ${total === 1 ? "request" : "requests"} · ${parts.join(", ")}`;
}
