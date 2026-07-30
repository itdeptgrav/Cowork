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
 * writing that as a special case. Administrators get ORGANISATION VISIBILITY
 * through `canView` — they can see that a meeting exists and read its audit —
 * which is a different thing from being in the room.
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
 * Members always. Administrators with organisation reach, for audit. Managers
 * for meetings their own reports are in — the same `#closure()` that governs
 * every other team surface, so meetings do not become a place where the
 * hierarchy stops applying.
 *
 * Seeing is not joining. `canJoin` is a strictly narrower question.
 */
export function canView(meeting: Meeting, viewer: MeetingViewer): boolean {
  if (isMember(meeting, viewer.employeeId)) return true;
  if (viewer.seesOrganisation) return true;
  return [meeting.organiserId, ...meeting.participantIds].some((id) =>
    viewer.hierarchyIds.includes(id),
  );
}

/**
 * Why this person cannot enter the room, or null.
 *
 * Membership only. A manager who can SEE their report's meeting does not get to
 * walk into it, and neither does an administrator: being able to audit a
 * meeting is not being invited to it. Anything else would make every private
 * conversation in the organisation joinable by seniority.
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
