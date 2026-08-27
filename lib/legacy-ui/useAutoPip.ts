"use client";

import { useEffect } from "react";

/**
 * Entering picture-in-picture BY ITSELF when you switch away.
 *
 * ## Why this cannot simply be done on `visibilitychange`
 *
 * `documentPictureInPicture.requestWindow()` requires a user gesture, and
 * switching tab is not one — calling it from a visibility handler throws
 * `NotAllowedError`. That is the browser refusing to let a page open a floating
 * window over everything else the moment you look away, which is the right
 * default.
 *
 * The sanctioned route is a media-session action. A page playing media
 * registers an `enterpictureinpicture` handler; Chrome then offers the reader
 * the choice — the "wants to enter picture-in-picture automatically" prompt —
 * and, once allowed, invokes the handler itself when the tab is hidden. The
 * gesture is the reader's answer to that prompt rather than a click on the
 * page, which is why it is allowed to open a window and a visibility listener
 * is not.
 *
 * So this registers the handler and stops there. It never prompts, never
 * pesters, and does nothing at all until somebody says yes to the browser's own
 * question. If they never do, the meeting still runs — it floats inside the tab
 * instead, which is the fallback everywhere this is unsupported.
 *
 * ## The media session has to be real
 *
 * Chrome only surfaces the prompt for a page it considers to be playing media.
 * A meeting is, but the audio arrives through WebRTC rather than a `<video>`
 * with a `src`, so the metadata is set explicitly to make the session
 * identifiable — otherwise the offer never appears and the handler is never
 * called.
 */

/**
 * `enterpictureinpicture` is not in `MediaSessionAction` yet.
 *
 * It is a real Chromium action and the whole mechanism here depends on it, so
 * the call is made through a widened signature rather than by casting at the
 * call site — one narrow admission that the type definitions are behind the
 * browser, in the place that explains why.
 */
type PipAction = MediaSessionAction | "enterpictureinpicture";

interface MediaSessionWithPip extends Omit<MediaSession, "setActionHandler"> {
  setActionHandler(action: PipAction, handler: (() => void) | null): void;
}

export function useAutoPip(input: {
  /** Off entirely when nobody is in a meeting. */
  active: boolean;
  /** The meeting's title, shown by the browser's own media controls. */
  title: string;
  /** Open the picture-in-picture window. Must not need a gesture of its own. */
  onEnter: () => void;
}) {
  const { active, title, onEnter } = input;

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;

    const session = navigator.mediaSession as unknown as MediaSessionWithPip;

    /* Identifies the session to the browser's own media UI, and is what makes
       Chrome treat this page as a media page at all. */
    const previousMetadata = session.metadata;
    try {
      session.metadata = new MediaMetadata({
        title,
        artist: "Cowork meeting",
      });
      session.playbackState = "playing";
    } catch {
      /* `MediaMetadata` is missing in older browsers. The handler below is the
         part that matters and is registered separately. */
    }

    try {
      session.setActionHandler("enterpictureinpicture", () => onEnter());
    } catch {
      /* The action is unsupported — Firefox, Safari. Nothing to clean up, and
         the caller's in-tab floating window is already the answer. */
      return;
    }

    return () => {
      try {
        session.setActionHandler("enterpictureinpicture", null);
        session.metadata = previousMetadata;
        session.playbackState = "none";
      } catch {
        /* Nothing registered. */
      }
    };
  }, [active, title, onEnter]);
}
