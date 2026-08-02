/**
 * Where a notification points.
 *
 * ## The gap this closes
 *
 * `toNotification` set `sourceType: null` and `sourceId: null` on every row,
 * with the note "legacy carries no source reference on the notification
 * itself". That is true of the FIELD and false of the record: the engine has
 * always written a `data` payload, and `data.taskId` is on almost every
 * notification it sends.
 *
 * The consequence was quiet. `NotificationsPage` renders an "Open" link when
 * `sourceType === "task"`, so the branch existed, was tested against the mock —
 * which sets the field — and could never once render against the real engine.
 * Every notification in production was a dead end: told something happened,
 * given nowhere to go.
 *
 * ## Order matters
 *
 * A payload can carry more than one id. `priority_reordered` carries the
 * employee whose queue moved AND the task now at the top; a task chat message
 * carries the task and the sender. The list below is in the order of what a
 * person most likely wants to open, not the order the fields happen to appear.
 */

export type NotificationSourceType =
  | "task"
  | "meeting"
  | "group"
  | "conversation"
  | "document"
  | "emergency"
  | "score";

export interface NotificationTarget {
  sourceType: NotificationSourceType;
  sourceId: string;
}

/**
 * The id fields the engine writes, in the order they should be preferred.
 *
 * `topTaskId` before `taskId` is deliberate and is the one non-obvious entry:
 * a priority reorder carries no `taskId`, and the thing worth opening is
 * whatever is now first in the queue.
 */
const FIELDS: ReadonlyArray<readonly [string, NotificationSourceType]> = [
  ["taskId", "task"],
  ["topTaskId", "task"],
  ["meetId", "meeting"],
  ["meetingId", "meeting"],
  ["documentId", "document"],
  ["conversationId", "conversation"],
  ["groupId", "group"],
];

/**
 * Types that resolve to a surface rather than to a record of their own.
 *
 * These are checked BEFORE the id fields, which matters for the score events: a
 * bleach applied from a task carries that task's id, and opening the task would
 * answer the wrong question. Somebody told points came off their score wants
 * the score — where the entry, its reason and the recheck control are.
 */
const TYPE_TARGETS: Readonly<Record<string, NotificationSourceType>> = {
  emergency_requested: "emergency",
  emergency_request: "emergency",
  sop_bleach_applied: "score",
  sop_goal_credit: "score",
  sop_recheck_requested: "score",
  sop_recheck_confirmed: "score",
  sop_recheck_rejected: "score",
};

function readId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  /* A number id is written by at least one legacy path. Rendering `[object
     Object]` into a URL is worse than not linking, so nothing else is
     coerced. */
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function notificationTarget(
  type: string,
  data: Record<string, unknown> | null | undefined,
): NotificationTarget | null {
  if (!data) return null;

  const byType = TYPE_TARGETS[type];
  if (byType) {
    /* Neither an emergency nor a score event has a record with a page of its
       own, so the type alone is the whole answer and the id is carried only
       where a surface can use it. */
    return { sourceType: byType, sourceId: readId(data.taskId) ?? "" };
  }

  for (const [field, sourceType] of FIELDS) {
    const id = readId(data[field]);
    if (id) return { sourceType, sourceId: id };
  }
  return null;
}

/**
 * The route to open, or null when there is nowhere useful to send somebody.
 *
 * Null rather than a guess: a link that lands on a 404 is worse than no link,
 * because the reader concludes the record is gone rather than that we never
 * knew where it was.
 */
export function notificationHref(
  target: NotificationTarget | null,
): string | null {
  if (!target) return null;
  const id = encodeURIComponent(target.sourceId);
  switch (target.sourceType) {
    case "task":
      return target.sourceId ? `/tasks/${id}` : null;
    case "meeting":
      return target.sourceId ? `/meetings/${id}` : null;
    case "document":
      return target.sourceId ? `/workspace?doc=${id}` : null;
    case "conversation":
      return target.sourceId ? `/messages/${id}` : null;
    case "group":
      return target.sourceId ? `/groups/${id}` : null;
    /* No id, and none needed — the decision lives in the approvals view. */
    case "emergency":
      return "/tasks?view=approvals";
    /* C3 is where a bleach, its reason and the recheck control all live. A
       goal credit is C2, but both land on the same decomposition page and
       sending somebody to the wrong band of the right page is recoverable in a
       way that sending them to a task is not. */
    case "score":
      return "/score/c3";
  }
}
