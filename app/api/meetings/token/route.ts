import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { mailPrincipal } from "@/lib/server/mailPrincipal";
import { readFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { getMeet } from "@/lib/legacy/meetings";
import { getTask } from "@/lib/legacy/tasks";
import { toMeeting, type LegacyMeetingDoc } from "@/lib/repositories/legacy/workMap";
import { grantsFor, joinRefusal } from "@/lib/rules/meetings/access";
import {
  taskIdFromRoomName,
  taskJoinRefusal,
  taskPartyOf,
} from "@/lib/rules/meetings/taskRoom";

/**
 * A seat in a meeting room.
 *
 * **Separate credentials from the monitoring room.** This reads
 * `MEET_LIVEKIT_*`; `/api/livekit/token` reads `LIVEKIT_*` and serves screen
 * monitoring. Neither route touches the other's variables.
 *
 * As configured today the two API KEYS differ while the URL is the same host,
 * so the rooms share one namespace rather than living on isolated deployments.
 * That makes the `meet-` prefix check below load-bearing rather than cosmetic:
 * it is what stops this endpoint minting a token for `cowork-demo`, which is
 * somebody's screen. If the two are ever split onto separate projects the check
 * costs nothing and should stay.
 *
 * **The secret never leaves the server.** The client is handed a signed JWT and
 * the websocket URL, and nothing else. This is a Node-runtime route for that
 * reason — the Edge runtime cannot sign these.
 *
 * Adapted from legacy's `routes/task_routes/livekit.routes.js`, which had the
 * right grant shape (`roomJoin`, `canPublish`, `canSubscribe`,
 * `canPublishData`, `roomAdmin` for the host, 24h TTL) and the wrong entry
 * rule: it gated on `role !== "ceo" && role !== "tl"`, so seniority decided who
 * could start a meeting and a six-digit code decided who could enter one. Here
 * MEMBERSHIP decides. You are the organiser, or you are on the invitation, or
 * you get no token — an administrator with organisation-wide visibility can
 * read that a meeting happened and still cannot walk into it.
 *
 * **Membership is verified HERE, not merely upstream.** This route used to
 * record a known limitation: that the meeting lived in the client-side
 * workspace store, so it could authenticate the caller but not check whether
 * they were on the invitation — and it would therefore mint a seat in any
 * room named `meet-` that anybody asked for. That was the whole security of
 * the meeting product resting on the client choosing not to ask.
 *
 * The premise was wrong. The record is one authenticated `GET` away, on the
 * engine, through the same exchange `mailPrincipal` already makes to resolve
 * the caller. So the route now reads it — with the CALLER's own token, so the
 * engine's permissions bound this read too — and applies the same rules the
 * rest of the product applies:
 *
 *  · `meet-<meetingId>` → `joinRefusal`, which is membership and status.
 *  · `meet-task-<taskId>` → `taskJoinRefusal`, which is the parties to the work.
 *
 * Both are the modules the UI and the repository already use, so the three
 * enforcement points `access.ts` describes now genuinely share one rule
 * instead of two of them sharing it and this one trusting the caller.
 *
 * A seat that cannot be checked is refused rather than granted: a caller with
 * no Firebase token gets a 403, not a token.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Meetings live under one prefix, so a monitoring room can never be requested. */
const ROOM_PREFIX = "meet-";

export async function POST(request: Request) {
  const principal = await mailPrincipal(request);
  if (!principal) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401, headers: NO_STORE },
    );
  }

  const apiKey = process.env.MEET_LIVEKIT_API_KEY;
  const apiSecret = process.env.MEET_LIVEKIT_API_SECRET;
  const url = process.env.MEET_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "Meetings are not configured on this server." },
      { status: 503, headers: NO_STORE },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const room =
    typeof body === "object" && body !== null && "room" in body
      ? String((body as { room?: unknown }).room ?? "")
      : "";
  const displayName =
    typeof body === "object" && body !== null && "displayName" in body
      ? String((body as { displayName?: unknown }).displayName ?? "")
      : "";
  if (!room.startsWith(ROOM_PREFIX) || room.length <= ROOM_PREFIX.length) {
    return NextResponse.json(
      { error: "That is not a meeting room." },
      { status: 400, headers: NO_STORE },
    );
  }

  /* ── MEMBERSHIP ─────────────────────────────────────────────────────────
   *
   * The engine is asked, with the CALLER's own token, whether this person is
   * on the invitation. That is the whole fix for the limitation this route
   * used to document: the meeting record is not in the client store after all
   * — it is one authenticated GET away, the same exchange `mailPrincipal`
   * already makes to resolve the caller.
   *
   * Using the caller's token rather than a service credential is deliberate:
   * the engine's own permission checks then apply to the read as well, so this
   * route can never see more than the person it is acting for.
   */
  const idToken = readFirebaseCookie(request.headers.get("cookie"));
  if (!idToken) {
    /* Fails CLOSED. A caller authenticated by the server-session path carries
       no Firebase token, so membership cannot be checked for them — and an
       unverifiable join is a refused join, not a permitted one. */
    return NextResponse.json(
      {
        error:
          "Your session cannot be checked against this meeting's invitation. Sign in again to join.",
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const me = principal.employeeId;
  const taskId = taskIdFromRoomName(room);

  /* Grants are decided by the record, never by the request. For a scheduled
     meeting `grantsFor` gives the organiser `roomAdmin`; a task room has no
     organiser, so nobody gets it there. */
  let grants = {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: false,
  };

  if (taskId !== null) {
    /* `meet-task-<id>` — the room for a task, whose name is derivable from the
       task id and therefore secret from nobody. */
    const found = await getTask({ token: idToken, taskId });
    if (!found.ok) {
      return NextResponse.json(
        {
          error:
            found.error.status === 404
              ? "That task could not be found."
              : "This meeting's task could not be checked. Try again in a moment.",
        },
        { status: found.error.status === 404 ? 404 : 503, headers: NO_STORE },
      );
    }
    const refusal = taskJoinRefusal(taskPartyOf(found.data), me);
    if (refusal) {
      return NextResponse.json(
        { error: refusal },
        { status: 403, headers: NO_STORE },
      );
    }
  } else {
    const meetId = room.slice(ROOM_PREFIX.length);
    const found = await getMeet({ token: idToken, meetId });
    if (!found.ok) {
      return NextResponse.json(
        {
          error:
            found.error.status === 404
              ? "That meeting could not be found."
              : "This meeting could not be checked. Try again in a moment.",
        },
        { status: found.error.status === 404 ? 404 : 503, headers: NO_STORE },
      );
    }
    const meeting = toMeeting({
      id: meetId,
      ...(found.data as LegacyMeetingDoc),
    });
    if (!meeting) {
      return NextResponse.json(
        { error: "That meeting record is incomplete." },
        { status: 404, headers: NO_STORE },
      );
    }
    /* `joinRefusal` reads membership only — `seesOrganisation` and
       `hierarchyIds` widen `canView`, never `canJoin`, which is the point of
       the rule: an administrator may audit a meeting and still not walk into
       it. Passing the narrow viewer here states that rather than implying an
       administrator was considered and allowed. */
    const refusal = joinRefusal(meeting, {
      employeeId: me,
      seesOrganisation: false,
      hierarchyIds: [],
    });
    if (refusal) {
      return NextResponse.json(
        { error: refusal },
        { status: 403, headers: NO_STORE },
      );
    }
    grants = grantsFor(meeting, me);
  }

  /* Identity is the PRINCIPAL's employee, never the body's. A caller naming
     somebody else would appear in the room under their name, and the
     participant grid is how people know who is present. */
  const token = new AccessToken(apiKey, apiSecret, {
    identity: principal.employeeId,
    name: displayName || principal.displayName || principal.employeeId,
    /* Long enough that a full-day workshop does not drop, and no longer. The
       meeting ends when the organiser ends it, not when a token expires. */
    ttl: "12h",
  });

  /* Everybody invited may speak, be seen and share — a meeting where
     participants arrive muted by policy is a broadcast, and this is not one.
     `roomAdmin` is the organiser's alone, and it comes from `grantsFor`
     reading the meeting record.

     It used to be `roomAdmin: isOrganiser` with `isOrganiser` read straight
     from the request body, so `{"isOrganiser": true}` bought a token entitled
     to remove participants and close the room. The comment above it claimed
     only the organiser may do those things; the body decided. */
  token.addGrant({ room, roomJoin: true, ...grants });

  return NextResponse.json(
    { token: await token.toJwt(), url },
    { headers: NO_STORE },
  );
}
