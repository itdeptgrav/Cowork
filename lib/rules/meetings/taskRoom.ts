/**
 * Which LiveKit room a task's meeting happens in.
 *
 * **The prefix is load-bearing, not decoration.** `/api/meetings/token` refuses
 * any room name that does not start with it, and that refusal is what stops the
 * meetings endpoint minting a seat in `cowork-demo` — somebody's screen-
 * monitoring room. The two share a LiveKit host, so the name is the only thing
 * separating a meeting from a monitoring session.
 *
 * It lives here rather than inline at the call site because it was inline at the
 * call site and got it wrong: the room was built as `task-<id>`, the route
 * rejected every one of them, and Join meeting failed with a message that named
 * none of it. A constant two modules can share is a constant that can be tested
 * against the route, which is what `taskRoom.test.ts` now does.
 */

/** Mirrors `ROOM_PREFIX` in `app/api/meetings/token/route.ts`, which is authority. */
export const MEETING_ROOM_PREFIX = "meet-";

/**
 * The room for a task.
 *
 * Derived rather than stored: every task has a room from the moment it exists,
 * and a room id written into the task document would be a second thing to
 * create, migrate and keep in step for no gain. The task id is already unique.
 */
export function taskMeetingRoomName(taskId: string): string {
  return `${MEETING_ROOM_PREFIX}task-${taskId}`;
}

/** Reads the task back out of a room name, for the reverse lookup. */
export function taskIdFromRoomName(roomName: string): string | null {
  const head = `${MEETING_ROOM_PREFIX}task-`;
  if (!roomName.startsWith(head)) return null;
  const id = roomName.slice(head.length);
  return id.length > 0 ? id : null;
}

/** The people a task's meeting is between. */
export interface TaskMeetingParty {
  /** `createdBy ?? assignedBy` — who raised the work. */
  createdById: string | null;
  /**
   * The assigner OF RECORD, and the reason a self task was broken.
   *
   * On an ordinary task this is the creator again. On a SELF task the engine
   * makes it the assignee's primary manager, because nobody negotiates a budget
   * with, sets the priority of, or reviews their own work — the manager stands
   * on the other side of all three. A rule reading `createdById` alone therefore
   * refused the one person the meeting was with: the creator and the assignee
   * were the same human, so the room admitted exactly one participant and told
   * the approver "This meeting is for the people this task is between."
   */
  assignedById?: string | null;
  assigneeIds: string[];
  /**
   * The cross-department case, and the reason this field is here at all.
   *
   * On that path the assignee is NOT added to `assigneeIds` until the hours are
   * agreed — legacy's `/task/create` wrote `assigneeIds: gate ? [] : assigneeIds`
   * and parked the person here. A rule reading `assigneeIds` alone would lock
   * the one person the meeting is FOR out of their own kickoff, which is exactly
   * the conversation that settles those hours.
   */
  pendingAssigneeIds?: string[];
  /**
   * People the task itself NAMES as having to decide something about it: the
   * approver who must set the hours (`pending_tl_hours`), and the department
   * heads on a cross-department gate.
   *
   * Included because a task meeting is very often the conversation that settles
   * the thing they have to decide — the hours, or whether the work should cross
   * departments at all — and holding it without them is holding it without the
   * person who has to answer.
   *
   * This does NOT open the room to seniority. Nobody is here for being senior,
   * for managing somebody, or for administrative reach; they are here because
   * this task records that it is waiting on them. A manager who can merely SEE
   * their report's task is still refused, which is the rule
   * `lib/rules/meetings/access.ts` sets for scheduled meetings and the one this
   * follows.
   */
  approverIds?: (string | null | undefined)[];
}

/** Whether this person is one of the sides of the work. */
export function isTaskParty(task: TaskMeetingParty, employeeId: string): boolean {
  if (!employeeId) return false;
  if (task.createdById === employeeId) return true;
  if (task.assignedById === employeeId) return true;
  if ((task.pendingAssigneeIds ?? []).includes(employeeId)) return true;
  if ((task.approverIds ?? []).some((id) => id === employeeId)) return true;
  return task.assigneeIds.includes(employeeId);
}

/**
 * Why this person cannot enter a task's room, or null.
 *
 * **Membership, on the same principle scheduled meetings already use.** Being
 * able to SEE a task is not being in the conversation about it: a manager with
 * team visibility and an administrator with organisation reach can both read
 * that a meeting happened and neither may walk into it. Anything looser and
 * every task discussion in the company becomes joinable by seniority.
 *
 * It matters more here than it looks, because a task room's name is derivable
 * from the task id — `meet-task-<id>` — rather than being a random string.
 * Nothing about the room is secret, so this is the only thing between an
 * authenticated employee and any meeting in the organisation.
 *
 * **Where this is enforced, stated plainly.** In the repository, before the
 * token is requested — the same enforcement point and the same KNOWN LIMITATION
 * as `joinRefusal` for scheduled meetings: `/api/meetings/token` authenticates
 * the caller but cannot read the task to check membership itself, so it will
 * mint a seat for any room named `meet-` that a caller asks for. Closing that
 * needs the route able to read the workspace. Until then a caller who bypasses
 * the client can still reach a room, and the check below is what governs the
 * product.
 */
export function taskJoinRefusal(
  task: TaskMeetingParty,
  employeeId: string,
): string | null {
  if (!isTaskParty(task, employeeId))
    return "This meeting is for the people this task is between.";
  return null;
}
