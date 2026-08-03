/**
 * Which notification types belong to which part of the product.
 *
 * Ported from `CoworkingShell.js` in `cowork-old-frontend` — `TASK_NOTIF_TYPES`,
 * `MEET_NOTIF_TYPES` and `SECTION_NOTIF_TYPES`, transcribed rather than
 * reinvented, because these lists are the answer to a question nobody should
 * have to re-derive: what counts as "something happened in Tasks".
 *
 * Two things use them, and it matters that both use the SAME one:
 *
 *  - the **badge** on a nav entry counts unread notifications of those types;
 *  - **navigating** to that entry marks exactly those types read.
 *
 * If the two lists ever diverge, a badge appears that visiting the section
 * cannot clear — a number that follows you around with no way to dismiss it.
 * One table, both jobs.
 *
 * The new types added since the migration are folded into the sections they
 * belong to, so an event invented here is counted here too rather than firing a
 * notification nothing on the bar reflects.
 */

/**
 * Sections whose count does NOT come from notifications.
 *
 * Transcribed from `CoworkingShell.js`, which is explicit about it:
 *
 *     Messages → per-conversation onSnapshot on messages subcollection, readBy-based
 *     Groups   → per-group onSnapshot on messages subcollection, readBy-based
 *     Meetings → notification-based (meet_scheduled / cancelled / updated events)
 *
 * A message never produces a notification row, so a notification-based count
 * for Messages is permanently zero. It is counted from the conversations
 * instead — unread meaning "sent by somebody else and my id is not in
 * `readBy`", which is also what `#conversationUnread` already computes for the
 * conversation list.
 *
 * Named rather than left implicit because the mistake is invisible: a badge
 * wired to the wrong source does not error, it just never appears.
 */
export const MESSAGE_COUNT_IS_READ_BASED = "/messages" as const;

/** A nav entry that carries a count, keyed by its `href`. */
export type NotificationSection =
  | "/tasks"
  | "/messages"
  | "/meetings"
  | "/score"
  | "/workspace"
  | "/mrf";

export const SECTION_TYPES: Readonly<
  Record<NotificationSection, readonly string[]>
> = {
  /* Transcribed from `TASK_NOTIF_TYPES` + `SECTION_NOTIF_TYPES["/coworking/tasks"]`,
     which differ slightly in the original — the union is used, so nothing is
     counted that visiting Tasks cannot clear. */
  "/tasks": [
    "task_assigned",
    "task_update",
    "task_confirmed",
    "task_started",
    "task_chat",
    "task_forwarded",
    "task_declined",
    "task_deleted",
    "task_rework",
    "daily_report",
    "deadline_changed",
    "completion_submitted",
    "completion_tl_approved",
    "completion_ceo_approved",
    "completion_rejected",
    "completion_ceo_rejected",
    "deadline_extension_requested",
    "deadline_extension_reviewed",
    "deadline_proposed",
    "deadline_approved",
    "deadline_rejected",
    "deadline_counter_proposed",
    "deadline_accepted",
    "deadline_counter_rejected",
    "deadline_auto_extended",
    "self_assign_approved",
    "self_assign_rejected",
    "self_assign_pending",
    "department_approval_request",
    "department_approval_your_turn",
    "department_approval_rejected",
    "department_approval_completed",
    "department_draft_needs_hours",
    "department_draft_activated",
    "draft_chat",
    "subtask",
    /* Added by this migration. Each one is a task event, so it belongs to the
       Tasks count — otherwise it rings a bell no badge explains. */
    "task_budget_changed",
    "task_details_edited",
    "task_reset_to_draft",
    "task_moved",
    "task_priority_changed",
    "priority_reordered",
    "sender_timer_approved",
    "sender_timer_rejected",
    "budget_extension_requested",
    "budget_extension_decided",
    "deadline_extension_decided",
  ],
  /* Membership only — **messages themselves are deliberately absent.**
   *
   * `direct_message` and `group_message` look like they belong here and do not.
   * Sending a message writes it to Firestore and calls `/direct-message/notify`
   * (or `/group/:id/notify`), and those routes send push and email WITHOUT
   * writing a `cowork_notifications` row — the old app works the same way,
   * because the conversation is the durable record and a bell entry per message
   * would bury every task notification under chat.
   *
   * So counting them here produced a badge that could never be anything but
   * zero. The message count comes from the conversations themselves, readBy by
   * readBy, exactly as `dmUnreadCount` does in `CoworkingShell.js` — see
   * `MESSAGE_COUNT_IS_READ_BASED` below.
   *
   * Membership events DO write rows, so they are counted. */
  "/messages": [
    "group_added",
    "group_removed",
    "group_renamed",
    "group_admin_changed",
    "group_deleted",
  ],
  "/meetings": ["meet_scheduled", "meet_cancelled", "meet_updated", "meet_started"],
  /* No equivalent in the old bar — it had no Score entry. Added because this
     migration made a score deduction notify at all, and a notification about
     points coming off your record is the last one that should be silent on the
     bar. */
  "/score": [
    "sop_bleach_applied",
    "sop_goal_credit",
    "sop_recheck_requested",
    "sop_recheck_confirmed",
    "sop_recheck_rejected",
  ],
  /* Documents and sheets — a surface the old app did not have, so there is no
     entry to transcribe. Sharing one with somebody who is never told is
     sharing it with nobody: `/workspace` lists what you are a member of, and
     until they look, a document handed to them does not exist. */
  "/workspace": [
    "document_shared",
    "document_access_removed",
    "document_renamed",
    "document_deleted",
  ],
  /* MRF sends one type for every event it has — `mrfNotify.service.js` passes
     `type: "request"` throughout, and the distinction between submitted,
     approved, rejected and a chat reply lives in the title and body rather
     than the type. So the badge counts them together, which is all this type
     can support. */
  "/mrf": ["request"],
};

const SECTION_LOOKUP: ReadonlyMap<string, NotificationSection> = new Map(
  Object.entries(SECTION_TYPES).flatMap(([section, types]) =>
    types.map((t) => [t, section as NotificationSection] as const),
  ),
);

/** The section a type belongs to, or null when it belongs to none. */
export function sectionOf(type: string): NotificationSection | null {
  return SECTION_LOOKUP.get(type) ?? null;
}

/**
 * How far back a badge counts.
 *
 * Unread is not the same as new, and a badge that ignores the difference stops
 * being information. Measured against live data: one employee holds 73 unread
 * MRF notifications and 17 meeting ones going back to July, another has unread
 * from May. Those sections showed `9+` permanently — a number that had been
 * true for months, could not be acted on, and never changed whatever anybody
 * did. People read that as decoration, and then miss the one that matters.
 *
 * Seven days is the span in which "you have not looked at this yet" is still a
 * fact about the present.
 *
 * **Nothing is hidden or marked read.** The notifications list still shows
 * every one of them, in full, oldest included. This bounds what the BADGE
 * counts, and nothing else.
 */
export const BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CountableNotification {
  type: string;
  read: boolean;
  /** ISO instant. An unparseable or absent value is treated as too old. */
  createdAt?: string;
}

/**
 * Unread notifications of the types this section owns, within the badge window.
 *
 * `nowMs` is passed rather than read from the clock so this stays a pure
 * function — the same inputs give the same answer, which is what makes it
 * testable at a fixed instant.
 */
export function unreadForSection(
  section: NotificationSection,
  notifications: readonly CountableNotification[],
  nowMs?: number,
): number {
  const types = new Set(SECTION_TYPES[section]);
  /* No clock supplied means no window — every unread of this type counts. That
     is the shape the pure tests use, and it keeps the cutoff a decision the
     caller makes rather than one buried here. */
  const cutoff = nowMs === undefined ? null : nowMs - BADGE_WINDOW_MS;

  return notifications.filter((n) => {
    if (n.read || !types.has(n.type)) return false;
    if (cutoff === null) return true;
    const at = n.createdAt ? Date.parse(n.createdAt) : Number.NaN;
    /* An unparseable timestamp is excluded rather than counted. A notification
       we cannot date is one we cannot claim is recent, and guessing in favour
       of showing a number is how the permanent `9+` happened. */
    return Number.isFinite(at) && at >= cutoff;
  }).length;
}

/**
 * What to print in the badge.
 *
 * `99+` and `9+` are the old app's own thresholds, kept exactly: a two-digit
 * number fits the pill and a three-digit one does not, and a person with 140
 * unread does not read the difference between 140 and 99+ — only that it is
 * "lots".
 *
 * Zero returns null rather than "0", because a badge showing nothing to do is
 * worse than no badge: it draws the eye to say there is no news.
 */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count > 99) return "99+";
  if (count > 9) return "9+";
  return String(count);
}
