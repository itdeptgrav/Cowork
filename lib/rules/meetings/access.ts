/* Relative and extensioned where a runtime value is needed: the test runner is
   plain `node --test`, which resolves neither the `@/` alias nor an
   extensionless path. These are type-only and therefore erased. */
import type { Meeting, MeetingStatus } from "@/lib/domain";

/**
 * Who may see, join and run a meeting.
 *
 * Pure and separate from the repository for the usual reason — the page decides
 * whether to render a Join button from these, the repository decides whether to
 * accept the call, and the token route decides whether to mint a JWT. Three
 * enforcement points, one rule, so a control can never appear for something the
 * server refuses and a token can never be issued for a room the UI would not
 * have offered.
 *
 * **No new permission.** Membership decides everything: you are the organiser,
 * you are on the invitation, or you are neither. That is the same identity
 * routing `DeadlineChangeRequest` and the emergency request use, and it is what
 * makes "an administrator does not silently join a meeting" true without
 * writing that as a special case.
 *
 * Since 21 September 2026 it decides SEEING as well. Administrators and
 * managers used to get organisation and team visibility through `canView` — the
 * meeting's existence and its audit, without the room — and that is gone by
 * owner decision; see the note on `canView` for why.
 */

/** Live in the sense that a room exists to enter. */
const OPEN: MeetingStatus[] = ["waiting", "live"];

export interface MeetingViewer {
  employeeId: string;
  /** `task.view` at organisation scope — the existing administrative reach. */
  seesOrganisation: boolean;
  /** Transitive reports, from the reporting tree. */
  hierarchyIds: string[];
}

/** Whether this person is on the invitation at all. */
export function isMember(meeting: Meeting, employeeId: string): boolean {
  return (
    meeting.organiserId === employeeId ||
    meeting.participantIds.includes(employeeId)
  );
}

export function isOrganiser(meeting: Meeting, employeeId: string): boolean {
  return meeting.organiserId === employeeId;
}

/**
 * Whether this person may see that the meeting exists.
 *
 * **Membership, and nothing else.** OWNER DECISION, 21 September 2026.
 *
 * This used to be wider: members, plus administrators with organisation reach
 * for audit, plus managers for meetings their own reports were in — on the
 * reasoning that seeing is not joining, and that meetings should not be the one
 * place the hierarchy stops applying.
 *
 * It was reported as a fault, with the meetings page as evidence. A manager
 * opened a report's meeting from their own list and was told *You are not on
 * this meeting's invitation* — so the row was an invitation to a dead end. The
 * distinction the old rule drew is real, and it was invisible: nothing on the
 * row said "you are watching this, not attending it", so a list that was
 * supposed to be *your* meetings read as a list of everybody's.
 *
 * Asked directly, the owner chose: a meeting shows only if you made it or you
 * are on it. So seeing and joining are now the same question of membership, and
 * `canJoin` differs from this only by the meeting's status.
 *
 * `MeetingViewer` keeps `seesOrganisation` and `hierarchyIds` rather than
 * shedding them: every caller builds one, the token route and the repository
 * read the same shape, and a narrowed permission is the thing most likely to be
 * widened again. Leaving the fields costs nothing and keeps that a one-line
 * change rather than a signature change across four files.
 */
export function canView(meeting: Meeting, viewer: MeetingViewer): boolean {
  return isMember(meeting, viewer.employeeId);
}

/**
 * Why this person cannot enter the room, or null.
 *
 * Membership only, and since 21 September 2026 so is `canView` — a manager no
 * longer SEES a report's meeting either, so this is the only door and there is
 * no longer a second, wider one behind it. The refusal text is unchanged: it is
 * what the guest link and the token route both read.
 */
export function joinRefusal(
  meeting: Meeting,
  viewer: MeetingViewer,
): string | null {
  if (!isMember(meeting, viewer.employeeId))
    return "You are not on this meeting's invitation.";
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  if (meeting.status === "completed" || meeting.status === "archived")
    return "This meeting has ended.";
  if (!OPEN.includes(meeting.status))
    return "The room is not open yet. The organiser opens it when they are ready.";
  return null;
}

export function canJoin(meeting: Meeting, viewer: MeetingViewer): boolean {
  return joinRefusal(meeting, viewer) === null;
}

/**
 * Why this person cannot change the meeting, or null.
 *
 * The organiser, and nobody else. Editing, inviting, removing, starting, ending
 * and cancelling are all this one question — an administrator with organisation
 * visibility can read the meeting and its audit trail, and cannot end somebody
 * else's call.
 */
export function manageRefusal(
  meeting: Meeting,
  employeeId: string,
): string | null {
  if (!isOrganiser(meeting, employeeId))
    return "Only the person who organised this meeting can change it.";
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  if (meeting.status === "archived") return "This meeting has been archived.";
  return null;
}

export function canManage(meeting: Meeting, employeeId: string): boolean {
  return manageRefusal(meeting, employeeId) === null;
}

/**
 * What a person may do inside the room, expressed as LiveKit grants.
 *
 * The token route mints from exactly this, so the answer cannot differ between
 * what the UI offers and what the JWT permits. Everybody invited may speak,
 * be seen and share a screen — a meeting where participants are muted by
 * default is a broadcast, and this is not one. Only the organiser gets
 * `roomAdmin`, which is what lets them remove somebody or close the room.
 */
export interface MeetingGrants {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  roomAdmin: boolean;
}

export function grantsFor(
  meeting: Meeting,
  employeeId: string,
): MeetingGrants {
  return {
    canPublish: true,
    canSubscribe: true,
    /* Chat and any future in-room signalling ride this channel. */
    canPublishData: true,
    roomAdmin: isOrganiser(meeting, employeeId),
  };
}

/**
 * The LiveKit room a meeting occupies.
 *
 * Derived from the id so it is stable and unguessable-by-accident, and stored on
 * the meeting the first time the room opens. Deliberately prefixed: this
 * project's rooms must never collide with the monitoring room, which lives on a
 * different LiveKit deployment entirely.
 */
export function meetingRoomName(meetingId: string): string {
  return `meet-${meetingId}`;
}
