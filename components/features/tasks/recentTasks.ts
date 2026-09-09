import type { TaskView } from "@/lib/repositories";

/**
 * The task each tab was last showing, so moving between the tabs of one task
 * does not dissolve the whole page into placeholders.
 *
 * ## What it fixes
 *
 * Every tab of a task is its own route — `/tasks/T1`, `/tasks/T1/files`,
 * `/tasks/T1/chat` — so switching tabs unmounts `TaskDetail` and its `getTask`
 * starts again from nothing. For the length of that round trip the page had no
 * task at all, so the loading branch replaced EVERYTHING: the title, the status
 * chips, the tab bar the reader had just clicked, and the rail. The one thing
 * that had not changed — which task you are looking at — was the thing that
 * disappeared, and it happened on every tab, every time.
 *
 * With the task already in hand the page draws immediately and only the parts
 * that genuinely belong to the new tab are still loading, which is what a tab
 * switch should look like.
 *
 * ## Why this cannot show a stale task
 *
 * It is not a cache. `useQuery` still fetches on every mount, and its answer
 * replaces this the moment it lands. What is held is only what this browser was
 * already displaying, so the worst case is seeing the task as it stood a moment
 * ago while the read that will correct it is in flight — instead of seeing
 * nothing. Nothing is served from here that a pending read is not already on
 * its way to confirm, which is why it needs no invalidation.
 *
 * In memory and bounded: a task view carries assignees, requirements and
 * approvals, and holding every task opened in a long session would be a real
 * amount of memory for a convenience worth a few hundred milliseconds.
 */

/** How many tasks to hold. A reader moves between a handful, not a hundred. */
const LIMIT = 8;

const tasks = new Map<string, TaskView>();

/** What this task last looked like, or null if it has not been open. */
export function recentTask(taskId: string): TaskView | null {
  return tasks.get(taskId) ?? null;
}

/** Record what is on screen now, evicting the least recently opened task. */
export function rememberTask(taskId: string, view: TaskView): void {
  /* Deleted first so re-remembering moves it to the back of the insertion
     order — otherwise the task somebody keeps returning to is evicted for
     having been opened first. */
  tasks.delete(taskId);
  tasks.set(taskId, view);
  while (tasks.size > LIMIT) {
    const oldest = tasks.keys().next();
    if (oldest.done) break;
    tasks.delete(oldest.value);
  }
}

/**
 * Drop everything. Called when the signed-in person changes: what one person
 * could see is not what the next one may, and the seed must never outlive the
 * session that earned it.
 */
export function forgetTasks(): void {
  tasks.clear();
}

/** How many tasks are held. For tests and for nothing else. */
export function heldTaskCount(): number {
  return tasks.size;
}
