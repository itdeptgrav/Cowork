import { Track, type LocalParticipant } from "livekit-client";
import { isEntireScreen } from "./capture.ts";

/**
 * Screen capture and publishing — the single implementation in Cowork.
 *
 * This is the routine that used to live inside `/employee`'s `ShareScreen`,
 * lifted out unchanged in behaviour so that the top bar and the test page can
 * both call it. There is deliberately no second copy: a presence system whose
 * "is it sharing" answer comes from one code path and whose "start sharing"
 * comes from another will eventually disagree with itself.
 *
 * Capture and publish are separate functions on purpose. `getDisplayMedia` must
 * be called inside the click that asked for it — browsers require a live user
 * gesture — while publishing happens later, after a token has been fetched and
 * the room has connected. Splitting them is what lets the button ask for the
 * screen first and connect only once the person has actually agreed to share.
 * Capture lives in `capture.ts` so that it carries no LiveKit dependency; this
 * module re-exports it so callers still have one place to import from.
 */

export {
  ENTIRE_SCREEN_REQUIREMENT,
  SCREEN_CAPTURE,
  SURFACE_LABEL,
  ScreenShareCancelled,
  ScreenShareWrongSurface,
  isEntireScreen,
  isIOS,
  readSurface,
  requestScreenShare,
  type SharedSurface,
} from "./capture.ts";

/** The publish options the working implementation used. */
export const SCREEN_TRACK_NAME = "employee-screen";

/**
 * Publish a captured track to the room.
 *
 * Same call the working code made, with one correction: `source` is the
 * `Track.Source` enum rather than the string `"screen_share"`. The string was a
 * type error that failed `next build`, and — more importantly — it is what the
 * manager view filters on, so an unrecognised source is the difference between
 * a screen appearing there and not.
 */
export async function publishScreenTrack(
  localParticipant: LocalParticipant,
  track: MediaStreamTrack,
) {
  return localParticipant.publishTrack(track, {
    name: SCREEN_TRACK_NAME,
    source: Track.Source.ScreenShare,
  });
}

/**
 * Is this publication a live, unmuted, whole-screen share?
 *
 * Every clause is load-bearing, and the last one is why the entire-screen rule
 * is checked continuously rather than once at the picker: `displaySurface` is
 * read off the live track, so a share that stopped being an entire screen stops
 * satisfying this the moment it happens. Presence is derived from this
 * predicate, so the requirement holds for the whole session, not just at the
 * door.
 */
export function isLiveScreenShare(pub: {
  source?: Track.Source;
  trackName?: string;
  isMuted?: boolean;
  track?: { mediaStreamTrack?: MediaStreamTrack } | undefined;
}): boolean {
  const isScreen =
    pub.source === Track.Source.ScreenShare ||
    pub.trackName === SCREEN_TRACK_NAME;
  if (!isScreen) return false;
  if (pub.isMuted) return false;
  if (!pub.track) return false;
  const media = pub.track.mediaStreamTrack;
  if (!media) return false;
  // `readyState` is the only signal the browser's own "Stop sharing" bar gives:
  // it ends the track without necessarily unpublishing it.
  if (media.readyState !== "live") return false;
  return isEntireScreen(media);
}

/** Stop a captured track and take it off the room. Safe to call twice. */
export async function stopScreenShare(
  localParticipant: LocalParticipant | null,
  track: MediaStreamTrack | null,
) {
  if (localParticipant) {
    for (const pub of localParticipant.trackPublications.values()) {
      if (!isLiveScreenShare(pub) && pub.trackName !== SCREEN_TRACK_NAME)
        continue;
      try {
        if (pub.track) await localParticipant.unpublishTrack(pub.track);
      } catch {
        // The room may already be gone; stopping the track below is what
        // actually releases the capture.
      }
    }
  }
  try {
    track?.stop();
  } catch {
    // Already stopped.
  }
}
