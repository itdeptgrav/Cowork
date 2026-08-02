/**
 * When a play request has to be issued again.
 *
 * The bug this exists to stop: changing track and asking for playback happen in
 * the SAME commit — `playNow` sets the queue and the intent together, and so
 * does the advance at the end of a track. The player is told to cue the new
 * video first and to play second, so `playVideo()` arrives while the iframe is
 * still tearing down the old video. YouTube drops it silently. The track sits
 * there cued, the button looks dead, and pressing play a second time works.
 *
 * The same shape breaks autoplay: every advance is a track change plus a play
 * request, so every track after the first needed a human to press play.
 *
 * So a play request is remembered rather than fired once and forgotten. It is
 * held until playback actually starts, and re-issued at the two moments the
 * player becomes able to honour it: when it finishes cueing, and when it first
 * becomes ready. `awaitingCue` exists for the other half — the stall watchdog
 * must not call a track switch "your browser blocked audio".
 *
 * Pure and separate from the hook because it is a rule, not a side effect, and
 * because a race that only reproduces against a real iframe is one nobody can
 * re-test by hand.
 */

export interface TransportState {
  /** Somebody asked for playback and it has not started yet. */
  wantsPlay: boolean;
  /** A track switch is in flight; the player is loading a different video. */
  awaitingCue: boolean;
}

export const IDLE_TRANSPORT: TransportState = {
  wantsPlay: false,
  awaitingCue: false,
};

export type TransportEvent =
  /** Someone pressed play, or an intent asked for it. */
  | "play_requested"
  | "pause_requested"
  /** A different video was handed to the player. */
  | "track_changed"
  /** The player finished loading a cued video and is sitting on it. */
  | "video_cued"
  /** The player exists and can take instructions for the first time. */
  | "player_ready"
  | "playing"
  | "paused"
  | "ended"
  | "failed"
  /** The watchdog gave up and told the reader the browser refused. */
  | "declared_blocked";

export interface TransportStep {
  state: TransportState;
  /**
   * Issue `playVideo()` now, for a request the caller has NOT already made.
   *
   * False for `play_requested` on purpose: the caller is the one making that
   * request and calls the player itself. This flag only ever means "an earlier
   * request is still outstanding and the player can finally take it".
   */
  reissue: boolean;
}

export function advance(
  state: TransportState,
  event: TransportEvent,
): TransportStep {
  switch (event) {
    case "play_requested":
      return { state: { ...state, wantsPlay: true }, reissue: false };

    case "pause_requested":
      return { state: { ...state, wantsPlay: false }, reissue: false };

    case "track_changed":
      return { state: { ...state, awaitingCue: true }, reissue: false };

    /* The two moments a held request can finally be honoured. */
    case "video_cued":
      return {
        state: { ...state, awaitingCue: false },
        reissue: state.wantsPlay,
      };
    case "player_ready":
      return { state, reissue: state.wantsPlay };

    /* Playback started — the request is spent. */
    case "playing":
      return {
        state: { wantsPlay: false, awaitingCue: false },
        reissue: false,
      };

    /* Stopped, for any reason. The request does not survive: re-issuing after
       somebody pressed pause would fight them, and re-issuing after a failure
       would retry a track the player has already refused. A track that ended
       leads to an advance, which asks again in its own right. */
    case "paused":
    case "ended":
    case "declared_blocked":
      return { state: { ...state, wantsPlay: false }, reissue: false };

    case "failed":
      return {
        state: { wantsPlay: false, awaitingCue: false },
        reissue: false,
      };
  }
}

/**
 * Whether the stall watchdog may blame the browser.
 *
 * Mid-switch there is nothing to blame: the player has not been given a chance
 * to start yet, and "your browser would not start audio" is both wrong and
 * unactionable at that moment.
 */
export function canDeclareBlocked(state: TransportState): boolean {
  return !state.awaitingCue;
}
