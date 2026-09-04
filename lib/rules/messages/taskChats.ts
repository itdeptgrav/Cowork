import type { TaskView } from "@/lib/repositories";
import type { TaskStatus } from "../../domain/tasks.ts";
import { rankFor } from "../tasks/priorityDisplay.ts";

/**
 * Which task discussions belong inside a direct message.
 *
 * ## The reach this closes
 *
 * A task's discussion lived at `/tasks/[id]/chat` — four hops from anywhere:
 * open Tasks, find the row, open the task, open the tab. Worse than the walk
 * was that **nothing told you to take it**: `chatCount` is hardcoded `0` in the
 * legacy mapper, so the one badge that could have said "somebody wrote to you
 * about this" has never rendered. People fell back to the direct message,
 * which is where the conversation was always going to happen anyway.
 *
 * So the discussion moves to where the people already are. A task is a thing
 * one person handed another, and this pairs the thread to exactly those two:
 * the DM between the assigner and the assignee carries a Task chat tab.
 *
 * ## What this is NOT
 *
 * **It is not a permission change.** `cowork_tasks/{id}/chat` is one thread per
 * TASK, shared with the older Cowork application, where a reviewer can still
 * read and post. This decides where a thread is SURFACED, not who may see it.
 * A task with two assignees therefore appears in each of their DMs with the
 * assigner, and all of them are looking at the same conversation. That is
 * honest for the common case — one assignee — and must not be described to
 * anybody as a private channel.
 */

export interface PairedTaskChat {
  taskId: string;
  title: string;
  /**
   * What to print after the `P`, or null where nothing usable is stored.
   *
   * From `rankFor`, never hand-derived. `TaskAssignment` carries two numbers on
   * two different scales — `rank` (stored, 1–10, what somebody SET) and
   * `queuePosition` (derived, 1..N, where the task actually IS) — and
   * `queuePosition` is null unless the read fetched THAT person's queue, which
   * a list read does only for the viewer. Substituting one for the other is the
   * exact defect `queuePosition` was introduced to fix: one manager saw two
   * different numbers for one task on two screens, both labelled `P{n}`.
   */
  rank: number | null;
  /** The rank counts work awaiting acceptance, not the live queue. */
  isProvisional: boolean;
  /**
   * Carried so the caller does not have to find the task again to render it.
   *
   * `ChatPanel` needs the status to decide whether the working thread exists
   * yet, and a second lookup by id in the component is a second place for the
   * two to disagree about which task is open.
   */
  status: TaskStatus;
  /** True where the viewer is the one doing the work, rather than the one who
   *  handed it over. Lets the picker say which way round the task runs. */
  mine: boolean;
  /**
   * What the task asks for, in the words of whoever raised it. Null where none
   * was written, which is ordinary rather than an error.
   *
   * Carried here rather than fetched when the brief is opened, because the
   * task list this is built from already holds it — a `getTask` per expand
   * would be a request to display text the page had in hand all along.
   */
  description: string | null;
  /**
   * What the task is meant to produce, in order.
   *
   * Just enough to list them. A deliverable's dependencies and approvals are
   * the task page's business; the brief in a message thread answers "what am I
   * being asked for", and a dependency graph in a 280px column answers nothing.
   */
  outputs: { id: string; label: string }[];
}

/**
 * Statuses that take a task out of the running order.
 *
 * Mirrors `isActiveRow` in `TaskTable`, deliberately rather than by import: a
 * closed task keeps the rank it finished with, so including one would put a
 * second P1 in the picker beside the live one — the same "two tasks have the
 * same priority" report that `isHistoric` exists to prevent.
 */
const CLOSED = new Set(["completed", "cancelled", "assignment_rejected"]);

/**
 * The task chats shared by two people, P1 first.
 *
 * Ordered by rank ascending so the work that matters most is what the picker
 * opens on. A task with no usable rank sorts last rather than first — an
 * unranked task is not urgent, it is unplaced, and `999` would be a number
 * nobody set.
 *
 * Ties break on title so the order is stable between reads. Without it two
 * equally-ranked tasks can swap places on a refetch, and a picker whose second
 * item moves under the cursor is worse than one that is merely arbitrary.
 */
export function pairedTaskChats(input: {
  tasks: readonly TaskView[];
  viewerId: string | null;
  otherId: string | null;
}): PairedTaskChat[] {
  const { tasks, viewerId, otherId } = input;
  /* Both ids are required. A DM with nobody resolved is a loading state, and
     answering it with every task the viewer has would be worse than nothing. */
  if (!viewerId || !otherId || viewerId === otherId) return [];

  const out: PairedTaskChat[] = [];
  for (const v of tasks) {
    if (CLOSED.has(v.task.status)) continue;

    const assignerId = v.assigner?.id ?? null;
    const assigneeIds = v.assignees.map((a) => a.id);

    /* Either direction: work I gave them, or work they gave me. */
    const theirsFromMe =
      assignerId === viewerId && assigneeIds.includes(otherId);
    const mineFromThem =
      assignerId === otherId && assigneeIds.includes(viewerId);
    if (!theirsFromMe && !mineFromThem) continue;

    const display = rankFor(v, viewerId);
    out.push({
      taskId: String(v.task.id),
      title: v.task.title,
      /* A closed task is filtered above, so `isHistoric` cannot reach here —
         but the rank is still taken from the resolver rather than the raw
         assignment, because the resolver is what knows which scale it read. */
      rank: display.rank,
      isProvisional: display.isProvisional,
      status: v.task.status,
      mine: mineFromThem,
      description: v.task.description,
      /* Sorted by `order`, not left in whatever order the read returned: the
         numbering somebody sees beside a deliverable has to be the numbering
         the task itself uses, or "the second one" means two different things
         on two screens. */
      outputs: [...v.task.outputs]
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ id: o.id, label: o.label })),
    });
  }

  return out.sort((a, b) => {
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.title.localeCompare(b.title);
  });
}

/**
 * How a task reads in the picker: `P1 · Redesign the deck`.
 *
 * The rank leads because it is what the list is ordered by, and a reader
 * scanning for their P1 should not have to read titles to find it. A task with
 * no usable rank simply shows its title — no `P—`, which would claim the
 * priority is missing when it is only unplaced.
 */
export function taskChatLabel(chat: PairedTaskChat): string {
  if (chat.rank === null) return chat.title;
  /* "to accept" rather than a bare P: work whose hours are not agreed is
     numbered among its own kind, so rendering it identically to a queue
     position is what puts two P1s on one screen. The same wording the task
     table uses for the same reason. */
  const tag = chat.isProvisional ? `P${chat.rank} to accept` : `P${chat.rank}`;
  return `${tag} · ${chat.title}`;
}
