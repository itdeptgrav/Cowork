import type { ShareFacts } from "../../status/employeeStatus.ts";
import type { SharedSurface } from "../../integrations/livekit/capture.ts";

/**
 * What the room's state means for presence — and, above all, what a RECONNECT
 * means.
 *
 * ## The bug this exists to stop
 *
 * `ScreenShareBridge` computed `connected` as `room.state === Connected` and
 * reported `sharing: !!live && connected`. `Reconnecting` is not `Connected`, so
 * the instant LiveKit began a reconnect both went false, `derive` returned
 * `offline`, and `DutySync` published that to `cowork_duty_status` — where every
 * manager reads it.
 *
 * LiveKit enters `Reconnecting` for entirely ordinary reasons: a wifi blip, a
 * VPN hop, switching from wifi to ethernet, a laptop sleeping for a moment. It
 * resumes by itself a second or two later and republishes the same track. So the
 * person went Offline and back Online without touching anything, repeatedly,
 * all day — which is the reported symptom, and which also writes a stream of
 * junk into the duty record everybody else is reading.
 *
 * ## Why HOLDING is correct rather than optimistic
 *
 * A reconnect is not evidence that sharing stopped. The local track is still
 * captured — LiveKit keeps it and republishes on resume — so the honest reading
 * of "reconnecting" is "the last known facts still stand, we are momentarily out
 * of touch". Reporting `offline` asserts something nobody observed.
 *
 * This does not paper over a real disconnection. When LiveKit gives up it emits
 * `Disconnected`, `room.state` leaves `Reconnecting`, and the ordinary path below
 * reports the truth — `PresenceRoom.onDisconnected` ends the session on the same
 * event. The hold lasts exactly as long as the uncertainty does.
 *
 * It is the same judgement `shareInterrupted` already makes for the iOS lock
 * case: do not publish a change you have not observed, and let the durable claim
 * lapse on its own if the person really has gone.
 */

/** Only the states presence cares about. Keeps this file free of the SDK. */
export type RoomPhase = "connected" | "reconnecting" | "disconnected";

export const RECONNECTING_DETAIL = "Reconnecting to the room…";

export function shareFactsFor(input: {
  /** What was last reported. Held, unchanged, through a reconnect. */
  previous: ShareFacts;
  phase: RoomPhase;
  /** A screen-share track that passes the whole-screen check. */
  live: boolean;
  /** Any screen-share track, including a window or tab. */
  any: boolean;
  surface: SharedSurface | null;
  /** The sentence for a share of the wrong surface — the caller owns wording. */
  wrongSurfaceDetail: string;
}): ShareFacts {
  if (input.phase === "reconnecting") {
    /* The facts are held. Only the sentence changes, so the person is told what
       is happening without their presence — or anybody else's view of it —
       moving on evidence that does not exist. */
    return { ...input.previous, detail: RECONNECTING_DETAIL };
  }

  const connected = input.phase === "connected";
  return {
    sharing: input.live && connected,
    connected,
    surface: input.live || input.any ? input.surface : null,
    detail: !connected
      ? "Not connected to a room."
      : input.live
        ? "Sharing your entire screen."
        : input.any
          ? input.wrongSurfaceDetail
          : "Connected, but nothing is being shared.",
  };
}
