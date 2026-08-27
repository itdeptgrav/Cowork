import { legacyFetch } from "./http.ts";
import type { LegacyResult } from "./envelope";

/**
 * The meetings surface of the engine — `/cowork/schedule-meet/*`.
 *
 * Five of these routes already existed and were never called from here: the new
 * page read the list and then went to Firestore, or to nothing at all, for
 * everything else. `create`, `get`, `edit` and `cancel` are those five, wired at
 * last rather than reinvented.
 *
 * `status`, `events`, `presence` and `for-task` are new on the engine, added for
 * this page. See `services/cowork.service.js` for what they write, and the note
 * there about `isCancelled` being kept in step with `status` — the live legacy
 * app reads the boolean and will never learn to read the string.
 */

export async function listMeets(input: {
  token: string;
}): Promise<LegacyResult<unknown[]>> {
  return legacyFetch<unknown[]>({
    path: "/cowork/schedule-meet/list",
    envelopeKey: "meets",
    token: input.token,
  });
}

export async function getMeet(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/schedule-meet/${encodeURIComponent(input.meetId)}`,
    envelopeKey: "meet",
    token: input.token,
  });
}

export async function listMeetsForTask(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown[]>> {
  return legacyFetch<unknown[]>({
    path: `/cowork/schedule-meet/for-task/${encodeURIComponent(input.taskId)}`,
    envelopeKey: "meets",
    token: input.token,
  });
}

export async function listMeetEvents(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<unknown[]>> {
  return legacyFetch<unknown[]>({
    path: `/cowork/schedule-meet/${encodeURIComponent(input.meetId)}/events`,
    envelopeKey: "events",
    token: input.token,
  });
}

/**
 * `POST /cowork/schedule-meet/create`.
 *
 * `dateTime` rather than `startsAt`: the engine's field is named for the single
 * instant legacy stored, and renaming it here would mean renaming it in the
 * live app too. `endsAt` is the new one and travels under its own name.
 */
export async function createMeet(input: {
  token: string;
  title: string;
  description: string | null;
  participants: string[];
  dateTime: string;
  endsAt: string | null;
  agenda: string[];
  taskId: string | null;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: "/cowork/schedule-meet/create",
    method: "POST",
    envelopeKey: "meet",
    body: {
      title: input.title,
      description: input.description,
      participants: input.participants,
      dateTime: input.dateTime,
      endsAt: input.endsAt,
      agenda: input.agenda,
      taskId: input.taskId,
    },
    token: input.token,
  });
}

/**
 * `PATCH /cowork/schedule-meet/:id/status`.
 *
 * Cancellation goes through here too, not through the older `/cancel` route:
 * one path for the whole lifecycle means one place that keeps `isCancelled` and
 * `status` in step. `/cancel` still exists for the legacy app.
 */
export async function setMeetStatus(input: {
  token: string;
  meetId: string;
  status: "waiting" | "live" | "completed" | "cancelled" | "archived";
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/schedule-meet/${encodeURIComponent(input.meetId)}/status`,
    method: "PATCH",
    body: { status: input.status },
    token: input.token,
  });
}

/** `PATCH /cowork/schedule-meet/:id/edit` — participants only, from here. */
export async function setMeetParticipants(input: {
  token: string;
  meetId: string;
  participants: string[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/schedule-meet/${encodeURIComponent(input.meetId)}/edit`,
    method: "PATCH",
    body: { participants: input.participants },
    token: input.token,
  });
}

/**
 * `POST /cowork/livekit/start` — open the room.
 *
 * **Not a `status` write.** This route creates the actual LiveKit room, mints a
 * name, issues a join code and only then sets `status: "live"` — so setting the
 * status directly would mark a meeting live that has no room behind it, and
 * everyone joining would meet "the room is not open".
 *
 * Open to any signed-in employee — `verifyEmployeeToken`. This said "CEO or TL
 * only, which the organiser of any meeting already is", and both halves were
 * wrong: the route has never carried `verifyCeoOrTL`, and since scheduling was
 * opened up the organiser is routinely neither.
 *
 * Idempotent: called again on a live meeting it returns the existing room
 * rather than creating a second one.
 */
export async function startMeetRoom(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: "/cowork/livekit/start",
    method: "POST",
    body: { meetId: input.meetId },
    token: input.token,
  });
}

/** `POST /cowork/schedule-meet/:id/presence` — arriving in or leaving the room. */
export async function recordMeetPresence(input: {
  token: string;
  meetId: string;
  joined: boolean;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/schedule-meet/${encodeURIComponent(input.meetId)}/presence`,
    method: "POST",
    body: { joined: input.joined },
    token: input.token,
  });
}
