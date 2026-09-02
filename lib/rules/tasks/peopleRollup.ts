import type { TaskView } from "@/lib/repositories/types";
import type { Employee } from "@/lib/domain/identity";

/**
 * The "Person-wise" view: one row per person, each carrying their tasks.
 *
 * This is a roll-up of the SAME task list the table already fetched — it moves
 * nothing and refetches nothing. A task shared by two people counts under both,
 * because a person's workload includes the shared work; a task counted twice
 * under ONE person (it named them in both `assignees` and `pendingAssignees`)
 * is de-duplicated, because that is one task, not two.
 *
 * "A person's tasks" means the people the task is FOR — its accepted assignees
 * plus anyone still held behind a cross-department gate (`pendingAssignees`).
 * That is the same notion the People column and the Workload view use, so the
 * count here agrees with what a row shows. A task with nobody on it falls into
 * a single "Unassigned" bucket rather than vanishing.
 */
export interface PersonBucket {
  /** Employee id, or "" for the Unassigned bucket. */
  id: string;
  /** The resolved person, or null for Unassigned. */
  person: Employee | null;
  /** Display name, or "Unassigned". */
  name: string;
  /** Every task this person is on, each appearing once. */
  tasks: TaskView[];
}

export function buildPeopleRollup(views: TaskView[]): PersonBucket[] {
  const byId = new Map<string, PersonBucket>();
  /* Per-person set of task ids already counted, so the same task named twice
     for one person (accepted AND pending, say) is not double-counted. */
  const seen = new Map<string, Set<string>>();

  const push = (person: Employee | null, v: TaskView) => {
    const id = person?.id ?? "";
    let bucket = byId.get(id);
    if (!bucket) {
      bucket = {
        id,
        person,
        name: person?.displayName ?? "Unassigned",
        tasks: [],
      };
      byId.set(id, bucket);
      seen.set(id, new Set());
    }
    const taskIds = seen.get(id)!;
    if (!taskIds.has(v.task.id)) {
      taskIds.add(v.task.id);
      bucket.tasks.push(v);
    }
  };

  for (const v of views) {
    const people = [...v.assignees, ...v.pendingAssignees];
    if (people.length === 0) push(null, v);
    else for (const p of people) push(p, v);
  }

  return [...byId.values()].sort((a, b) => {
    /* Unassigned last — it is a catch-all, not a person, and putting it under
       the people keeps the real names together at the top. */
    if ((a.id === "") !== (b.id === "")) return a.id === "" ? 1 : -1;
    /* Then the busiest first — the person carrying the most is the one a
       manager most wants to see — and ties broken by name so the order is
       stable rather than incidental. */
    if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
    return a.name.localeCompare(b.name);
  });
}
