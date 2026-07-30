import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { currentSession } from "@/lib/server/session";

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
 * **KNOWN LIMITATION, and the same one the monitoring route carries.** The
 * meeting record lives in the client-side workspace store, so this route cannot
 * read it to check membership itself; the caller states which meeting and role
 * it is asking for. Verified here: that the caller is authenticated, that the
 * room name is a meeting room, and that the grants match the claimed role. Not
 * verified here: that this person is genuinely on that invitation. Closing it
 * needs the workspace/identity seam resolved — the same blocker recorded in
 * `/api/livekit/token`. Until then this is authentication-level, and the
 * membership rule is enforced in the repository through `joinRefusal`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Meetings live under one prefix, so a monitoring room can never be requested. */
const ROOM_PREFIX = "meet-";

export async function POST(request: Request) {
  /**
   * **This route still requires `cowork_session`, and that shuts real staff
   * out.** The Firebase sign-in path never issues one, so an employee who can
   * open every page gets 401 here — the same defect the presence token route
   * had, and it is NOT fixed here.
   *
   * It cannot be fixed the same way. The presence route takes its identity from
   * the query string and only needs to know somebody real is behind the
   * request; this route mints a token AS a named person, and reads
   * `session.employeeId` below to do it. A verified Firebase token carries a
   * Firebase uid, which is not the workspace employee id — resolving one to the
   * other server-side is the identity/workspace seam, and guessing it would put
   * one person into a meeting under another person's name.
   *
   * Left refusing rather than half-connected, which is the honest state until
   * that seam is resolved.
   */
  const session = await currentSession();
  if (!session) {
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
  const isOrganiser =
    typeof body === "object" &&
    body !== null &&
    (body as { isOrganiser?: unknown }).isOrganiser === true;

  if (!room.startsWith(ROOM_PREFIX) || room.length <= ROOM_PREFIX.length) {
    return NextResponse.json(
      { error: "That is not a meeting room." },
      { status: 400, headers: NO_STORE },
    );
  }

  /* Identity is the SESSION's employee, never the body's. A caller naming
     somebody else would appear in the room under their name, and the
     participant grid is how people know who is present. */
  const token = new AccessToken(apiKey, apiSecret, {
    identity: session.employeeId,
    name: displayName || session.displayName || session.employeeId,
    /* Long enough that a full-day workshop does not drop, and no longer. The
       meeting ends when the organiser ends it, not when a token expires. */
    ttl: "12h",
  });

  token.addGrant({
    room,
    roomJoin: true,
    /* Everybody invited may speak, be seen and share. A meeting where
       participants arrive muted by policy is a broadcast; this is not one. */
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    /* Only the organiser may remove somebody or close the room. */
    roomAdmin: isOrganiser,
  });

  return NextResponse.json(
    { token: await token.toJwt(), url },
    { headers: NO_STORE },
  );
}
