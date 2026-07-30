import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { isSignedInRequest } from "@/lib/server/apiAuth";
import {
  ROOM_NAME,
  isPresenceIdentity,
  isWatcherIdentity,
} from "@/lib/integrations/livekit/identity";

/**
 * A seat in the monitoring room.
 *
 * This route previously took `identity` and `room` straight off the query
 * string, minted a token for whatever it was handed, and granted every caller
 * `canPublish` AND `canSubscribe` with no authentication at all. Three things
 * followed from that, and all three are closed here:
 *
 *  1. **Anyone who could reach the URL got a token.** No session was required,
 *     so the room was open to anything that could make a GET request.
 *  2. **A watcher could publish.** A manager's seat carried publish rights, so
 *     a viewer could push a track into the room under a name of their choosing.
 *  3. **An employee could watch.** A publisher's seat carried subscribe rights,
 *     so an employee's own token was enough to watch colleagues' screens.
 *
 * The two seats are now distinct and neither can do the other's job:
 *
 *  · `manager`       — subscribe only. Cannot publish anything, ever.
 *  · `employee-<id>` — publish only. Cannot subscribe to anyone else's track.
 *
 * The room is pinned to `ROOM_NAME` rather than accepted from the caller: this
 * prototype has exactly one room, and honouring an arbitrary `room` parameter
 * let a caller mint credentials for a room the product does not have.
 *
 * **KNOWN LIMITATION, deliberately recorded rather than papered over.** The
 * route verifies that the caller is signed in; it does NOT verify that this
 * caller is entitled to publish as that particular employee, nor that a manager
 * may watch the employee whose profile they are on. It cannot today: the
 * reporting hierarchy that `#monitorable()` checks lives only in the
 * client-side mock store, and the identity layer's `employeeId` is not the
 * workspace employee id that presence identities are derived from. Closing that
 * needs the workspace/identity seam resolved, which is a larger change than
 * this fix. Until then the room's authorisation is authentication-level, not
 * per-subject.
 */

export async function GET(request: Request) {
  if (!(await isSignedInRequest(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  /* A missing key used to surface as a `!` assertion failing inside the SDK,
     which reached the browser as an opaque 500. Naming the cause is the
     difference between "the room will not connect" and a config file nobody
     thought to check. */
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LiveKit is not configured on this server." },
      { status: 503 },
    );
  }

  const identity = new URL(request.url).searchParams.get("identity") ?? "";

  const isWatcher = isWatcherIdentity(identity);
  const isPublisher = isPresenceIdentity(identity);
  if (!isWatcher && !isPublisher) {
    return NextResponse.json(
      { error: "Unknown room identity." },
      { status: 400 },
    );
  }

  const token = new AccessToken(apiKey, apiSecret, { identity });

  token.addGrant({
    room: ROOM_NAME,
    roomJoin: true,
    /* Exactly one of these is true. A seat that could do both is the hole
       described above. */
    canPublish: isPublisher,
    canSubscribe: isWatcher,
  });

  return NextResponse.json({ token: await token.toJwt(), url });
}
