import { NextResponse } from "next/server";
import { authoriseSeat } from "@/lib/server/streamSeatAuth";
import {
  GravStreamError,
  GravStreamNotConfigured,
  ensureRoom,
  readRoom,
} from "@/lib/integrations/grav/stream";
import {
  presenceIdentityFor,
  presenceRoomName,
} from "@/lib/integrations/livekit/identity";

/**
 * Is this person actually in their presence room?
 *
 * `GET /api/stream/presence?subject=<employeeId>&role=publish|watch`
 *
 * **This is what Online is anchored to, and it is why presence is not simply a
 * browser's word.** A tab claiming "I am sharing" can be wrong, can be stale,
 * and is exactly the claim a screen-monitoring feature must not take at face
 * value. `participants[].sharing.screen` is the service's own answer, present
 * only while a screen is actually live, and it is the same field a monitoring
 * dashboard reads — so "online" means one thing on every screen.
 *
 * **It answers the real question now.** An earlier release could only report who
 * was in the room, so this route said "present" and the gap between that and
 * "sharing" had to be written down as a limitation. A `screen` room reports the
 * live surface, so `sharing` here means a screen is going out, and `surface`
 * says which kind.
 *
 * The same authorisation as the token route, from the same function: you may ask
 * about yourself, or about somebody whose primary manager you are.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const subject = (params.get("subject") ?? "").trim();
  const role = params.get("role") === "watch" ? "watch" : "publish";

  const allowed = await authoriseSeat(request, { subject, role });
  if (!allowed.ok)
    return NextResponse.json(
      { error: allowed.message },
      { status: allowed.status },
    );

  try {
    const roomId = await ensureRoom(presenceRoomName(subject));
    const room = await readRoom(roomId);
    const identity = presenceIdentityFor(subject);
    /* Their identity, not merely a head count: a room with somebody in it is
       not the same fact as a room with THIS person in it, and the watching
       manager is a participant too. */
    const them = room.participants.find((p) => p.identity === identity) ?? null;
    return NextResponse.json({
      roomId,
      live: room.live,
      /** In the room at all. Not the same as sharing, and no longer what Online
       *  is decided on — kept because "connected but not sharing" is a state
       *  worth being able to name. */
      present: them !== null,
      /** A screen is going out RIGHT NOW. This is what Online means. */
      sharing: them?.screen != null,
      /** "monitor", "window" or "browser" — what they actually picked. */
      surface: them?.screen?.displaySurface ?? null,
      participantCount: room.participantCount,
    });
  } catch (error) {
    if (error instanceof GravStreamNotConfigured)
      return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof GravStreamError)
      return NextResponse.json(
        { error: `Screen sharing is unavailable: ${error.message}` },
        { status: 502 },
      );
    console.error("[stream] could not read the room:", error);
    return NextResponse.json(
      { error: "The screen-sharing room could not be reached." },
      { status: 502 },
    );
  }
}
