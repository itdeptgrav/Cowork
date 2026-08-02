"use client";

import { useEffect, useState } from "react";
import { useRepo } from "./useRepository";
import type { EmployeeId, TaskId, TimerSession } from "@/lib/domain";

/**
 * Watch somebody else's clock on one task.
 *
 * The live channel a manager observes through — `watchTimerSession` listens to
 * the same document the working person's own browser writes, so a start or a
 * pause reaches the manager's screen without a refresh. Observation only:
 * nothing here writes, and there is no route that would let it.
 *
 * It lived inside `TimerControl` as a private helper. The status-tracking
 * surface needs exactly the same subscription against a person rather than a
 * task's assignee, and a second copy of a listener is a second place for one to
 * be left unsubscribed.
 */
export function useWatchedTimerSession(
  employeeId: EmployeeId | string | null,
  taskId: TaskId | string | null,
): TimerSession | null {
  /*
   * Keyed by subject, so a change of person discards the previous clock without
   * an effect that sets state. Storing the key ALONGSIDE the session and
   * comparing on read is what keeps a previous person's timer from lingering
   * under a new one while the first snapshot is still in flight — the same
   * guarantee a `setSession(null)` in an effect gives, without the extra render
   * and without the lint rule it breaks.
   */
  const key = employeeId && taskId ? `${employeeId}:${taskId}` : "";
  const [entry, setEntry] = useState<{
    key: string;
    session: TimerSession | null;
  }>({ key: "", session: null });
  const repo = useRepo();

  useEffect(() => {
    if (!employeeId || !taskId) return;
    return repo.watchTimerSession(String(employeeId), String(taskId), (session) =>
      setEntry({ key: `${employeeId}:${taskId}`, session }),
    );
  }, [repo, employeeId, taskId]);

  return entry.key === key ? entry.session : null;
}
