import { NextResponse } from "next/server";
import { authoriseSeat } from "@/lib/server/streamSeatAuth";
import {
  GravStreamError,
  GravStreamNotConfigured,
  PUBLISH_TTL_SECONDS,
  WATCH_TTL_SECONDS,
  mintSeat,
} from "@/lib/integrations/grav/stream";
import { embedUrlFor } from "@/lib/integrations/grav/embed";
import {
  presenceIdentityFor,
  presenceRoomName,
  watcherIdentity,
} from "@/lib/integrations/livekit/identity";

/**
 * A seat in one person's presence room, minted by Grav Stream.
 *
 * `GET /api/stream/token?subject=<employeeId>&role=publish|watch&seat=<id>`
 *
 * Answers `{roomId, token, embedUrl}` — never the API key, which stays on this
 * side of the wire. The browser loads `embedUrl` in an iframe; that is the only
 * way into their realtime service, and the reason is measured rather than
 * assumed (see `lib/integrations/grav/stream.ts`).
 *
 * ## What is different from the route this replaces
 *
 * `/api/livekit/token` minted a seat in ONE room shared by the whole company
 * and checked only that somebody was signed in. Its own comment recorded the
 * hole and why it could not be closed there: the reporting line lived in a
 * client-side store, so the route had no way to ask whether this caller was
 * entitled to watch this person. It is closed by `authoriseSeat`, and the room
 * is the SUBJECT's own — so a seat cannot be pointed at anybody else's screen.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const subject = (params.get("subject") ?? "").trim();
  const role = params.get("role") ?? "";
  const seat = (params.get("seat") ?? "").trim();

  if (role !== "publish" && role !== "watch")
    return NextResponse.json(
      { error: "Ask for a publish seat or a watch seat." },
      { status: 400 },
    );
  if (role === "watch" && !seat)
    return NextResponse.json(
      { error: "A watching seat needs an identifier." },
      { status: 400 },
    );

  const allowed = await authoriseSeat(request, { subject, role });
  if (!allowed.ok)
    return NextResponse.json(
      { error: allowed.message },
      { status: allowed.status },
    );

  try {
    const credentials = await mintSeat({
      roomName: presenceRoomName(subject),
      identity:
        role === "publish" ? presenceIdentityFor(subject) : watcherIdentity(seat),
      name: allowed.name,
      /**
       * **The role is the boundary, and the service enforces it.**
       *
       * There was a period when both seats had to carry publish rights, because
       * the only room type was a meeting whose embed published a camera and a
       * microphone as part of joining — a viewer-shaped token could not get in
       * at all, and a manager saw "This token does not grant publish permission"
       * where a screen should have been. That is gone. In a `screen` room a
       * `viewer` is never prompted for a device, and the SFU rejects any publish
       * attempt from that token, so a manager watching a screen cannot put
       * anything into the room they are watching. It is not a UI preference that
       * tampering with the client can defeat.
       *
       * The room is still the outer boundary — one per person, and
       * `authoriseSeat` mints a seat in it only for that person or their primary
       * manager — but the role is a real second one again.
       */
      role: role === "publish" ? "publisher" : "viewer",
      ttlSeconds: role === "publish" ? PUBLISH_TTL_SECONDS : WATCH_TTL_SECONDS,
    });

    return NextResponse.json({
      roomId: credentials.roomId,
      token: credentials.token,
      /* The realtime server the media connects to — what the publisher SDK
         takes as `serverUrl`, and explicitly NOT the embed page. */
      url: credentials.url,
      /* Built here rather than in the browser. The docs are explicit that the
         `url` field is the realtime server and NOT this page, and a component
         assembling it from two fields is a component that can assemble it
         wrongly — once, quietly, for everybody.

         No `parentOrigin` — see `embedUrlFor` for what naming one cost. */
      embedUrl: embedUrlFor({
        roomId: credentials.roomId,
        token: credentials.token,
      }),
    });
  } catch (error) {
    if (error instanceof GravStreamNotConfigured)
      return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof GravStreamError) {
      /* Their sentence, not a status code. A refusal about OUR key is not the
         caller's fault, so it reaches the browser as a 502 either way. */
      return NextResponse.json(
        { error: `Screen sharing is unavailable: ${error.message}` },
        { status: 502 },
      );
    }
    console.error("[stream] could not mint a seat:", error);
    return NextResponse.json(
      { error: "The screen-sharing room could not be reached." },
      { status: 502 },
    );
  }
}
