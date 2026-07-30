import { isActivePriorityTask } from "./activeQueue.ts";
import { chainDeadlines, windowSecsFor } from "./priorityDeadline.ts";
import { resolveTaskPriority } from "./resolveTaskPriority.ts";

/**
 * Why each task in a queue lands where it does.
 *
 * One row per task, showing every value the placement turned on — so
 * "why is this due then?" is answered by reading a table rather than by
 * re-deriving the chain by hand.
 *
 * It is deliberately a RULE and not a script: the same functions the product
 * runs produce the rows, so a diagnostic cannot quietly disagree with the
 * behaviour it is explaining. Nothing here reads a stored deadline.
 *
 * Nothing secret is exposed. Ids, ranks, seconds and statuses — the same
 * fields the screen already shows.
 */

export interface WorkloadRow {
  taskId: string;
  assignee: string;
  resolvedPriority: number;
  budgetSeconds: number;
  status: string;
  includedInWorkload: boolean;
  /** 1-based, or null when the task is not in the live queue. */
  queuePosition: number | null;
  calculatedStart: string | null;
  calculatedCompletion: string | null;
  /** Why it was left out, when it was. */
  excludedBecause: string | null;
}

export function explainWorkload(input: {
  employeeId: string;
  tasks: {
    taskId: string;
    status?: string;
    budgetState?: string | null;
    assigneeIds?: string[];
    assigneePriorities?: unknown;
    priority?: unknown;
    deadlineWindowSecs?: number | null;
    senderTimerWindowSecs?: number | null;
  }[];
  nowMs: number;
  addWorkingSecs: (anchorMs: number, windowSecs: number) => string;
}): WorkloadRow[] {
  const judged = input.tasks.map((t) => {
    const budgetSeconds = windowSecsFor(t as never);
    const active = isActivePriorityTask({
      task: { status: t.status ?? "" },
      budgetNegotiation: t.budgetState ? { state: t.budgetState } : null,
    });
    /* Both gates, named separately — "it has no hours" and "its hours are not
       agreed" are different problems with different fixes, and a single
       "excluded" would send somebody looking in the wrong place. */
    const excludedBecause = !active
      ? t.budgetState && t.budgetState !== "ACCEPTED"
        ? `budget not settled (${t.budgetState})`
        : `status ${t.status ?? "unknown"} is not active workload`
      : budgetSeconds <= 0
        ? "no time budget set"
        : null;
    return { t, budgetSeconds, included: excludedBecause === null, excludedBecause };
  });

  const queue = judged
    .filter((j) => j.included)
    .sort((a, b) => {
      const ra = resolveTaskPriority(a.t, input.employeeId);
      const rb = resolveTaskPriority(b.t, input.employeeId);
      if (ra !== rb) return ra - rb;
      return String(a.t.taskId).localeCompare(String(b.t.taskId));
    });

  const chained = chainDeadlines({
    queue: queue.map((j) => j.t) as never,
    anchorMs: input.nowMs,
    addWorkingSecs: input.addWorkingSecs,
  });
  const dueBy = new Map(chained.map((c) => [String(c.taskId), c.dueDate]));

  /* A task starts where the previous one ended; the first starts now. */
  const startBy = new Map<string, string>();
  let cursor = new Date(input.nowMs).toISOString();
  for (const j of queue) {
    startBy.set(String(j.t.taskId), cursor);
    cursor = dueBy.get(String(j.t.taskId)) ?? cursor;
  }

  const positionOf = new Map(queue.map((j, i) => [String(j.t.taskId), i + 1]));

  return judged.map((j) => ({
    taskId: String(j.t.taskId),
    assignee: input.employeeId,
    resolvedPriority: resolveTaskPriority(j.t, input.employeeId),
    budgetSeconds: j.budgetSeconds,
    status: j.t.status ?? "unknown",
    includedInWorkload: j.included,
    queuePosition: positionOf.get(String(j.t.taskId)) ?? null,
    calculatedStart: startBy.get(String(j.t.taskId)) ?? null,
    calculatedCompletion: dueBy.get(String(j.t.taskId)) ?? null,
    excludedBecause: j.excludedBecause,
  }));
}

/** The same rows as a fixed-width table, for a log or a terminal. */
export function formatWorkload(rows: WorkloadRow[]): string {
  const head = [
    "task",
    "assignee",
    "prio",
    "budget",
    "status",
    "in",
    "pos",
    "start",
    "completion",
    "excluded because",
  ];
  const body = rows.map((r) => [
    r.taskId,
    r.assignee,
    String(r.resolvedPriority),
    `${Math.round(r.budgetSeconds / 360) / 10}h`,
    r.status,
    r.includedInWorkload ? "yes" : "no",
    r.queuePosition === null ? "—" : `P${r.queuePosition}`,
    r.calculatedStart ?? "—",
    r.calculatedCompletion ?? "—",
    r.excludedBecause ?? "",
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join(
    "\n",
  );
}
