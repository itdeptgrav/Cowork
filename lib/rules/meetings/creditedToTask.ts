import type { TaskMeetingSession } from "@/lib/domain";

/**
 * How much of a meeting session reached THIS task's deadline.
 *
 * **The reported fault, 17 Aug 2026.** A cross-department task (T067, Pramod →
 * Umung) listed three sessions under the heading *"Time counted for your
 * deadline"*:
 *
 * | Attendees | Shown | Actually credited to T067 |
 * |---|---|---|
 * | Pramod + Umung | 01:57 | **yes** — the budget grew by exactly 1:57 |
 * | Pramod + Rakesh | 02:42 | no — it went to T063 and T066 |
 * | Pramod + Rakesh + Rishee | 02:26 | no — same |
 *
 * The engine was right the whole time: only the session with both sides of the
 * work present credited this task, and `originalWindowSecs 04:00:00 →
 * deadlineWindowSecs 04:01:57` proves it. What was wrong was the panel, which
 * printed `creditedSecs` — the session's own figure, credited to whoever
 * attended, on THEIR tasks — under a heading that claimed it as this task's.
 *
 * So a reader looking at a task whose deadline had moved by two minutes saw
 * seven minutes of "counted" time and could not reconcile the two.
 *
 * `creditedTaskIds` is already on the session as the idempotency key. It is
 * also the honest answer to "did this reach me", and needs no new field.
 */
export function creditedToTask(
  session: Pick<TaskMeetingSession, "creditedSecs" | "creditedTaskIds">,
  taskId: string,
): number {
  const ids = Array.isArray(session.creditedTaskIds)
    ? session.creditedTaskIds
    : [];
  return ids.includes(taskId as never) ? (session.creditedSecs ?? 0) : 0;
}

/**
 * Did this session count for somebody, just not for this task?
 *
 * The three states are different and the screen must not collapse them:
 * credited here, credited elsewhere, credited nowhere. "Both sides were not in
 * the room together" said of a session two people plainly attended reads as a
 * defect in the product rather than a fact about this task.
 */
export function creditedElsewhere(
  session: Pick<TaskMeetingSession, "creditedSecs" | "creditedTaskIds">,
  taskId: string,
): boolean {
  return creditedToTask(session, taskId) === 0 && (session.creditedSecs ?? 0) > 0;
}

/**
 * What this task actually gained from every session on it.
 *
 * The total under the list must be the sum of the figures IN the list, or the
 * panel argues with itself.
 */
export function totalCreditedToTask(
  sessions: Pick<TaskMeetingSession, "creditedSecs" | "creditedTaskIds">[],
  taskId: string,
): number {
  return sessions.reduce((sum, s) => sum + creditedToTask(s, taskId), 0);
}
