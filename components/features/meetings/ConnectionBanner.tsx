"use client";

import { useEffect, useRef, useState } from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

/**
 * What the room says while it is putting itself back together.
 *
 * ## The gap this fills
 *
 * A dropped connection was completely silent. LiveKit reconnects on its own, so
 * the room usually came back — but for the seconds in between, everybody else
 * froze, audio stopped, and nothing on screen said why. The reader's own guess
 * is always the worst one available: that they have been thrown out, or that
 * the meeting ended. Several of the "the meeting just died" reports are this.
 *
 * ## Why it stays for a moment after recovering
 *
 * A banner that vanishes the instant the socket is back leaves somebody who
 * looked up mid-reconnect with no idea whether the thing they half-saw was
 * real. "Reconnected" for two seconds closes the loop, and is the difference
 * between a system that recovered and a system that flickered.
 *
 * `aria-live="assertive"` because losing the meeting is interrupting news; a
 * screen-reader user gets no equivalent of noticing the tiles have frozen.
 */
export function ConnectionBanner() {
  const state = useConnectionState();
  const [showRecovered, setShowRecovered] = useState(false);
  const wasDownRef = useRef(false);

  useEffect(() => {
    if (state === ConnectionState.Reconnecting) {
      wasDownRef.current = true;
      setShowRecovered(false);
      return;
    }
    if (state === ConnectionState.Connected && wasDownRef.current) {
      wasDownRef.current = false;
      setShowRecovered(true);
      const t = setTimeout(() => setShowRecovered(false), 2_500);
      return () => clearTimeout(t);
    }
  }, [state]);

  const reconnecting = state === ConnectionState.Reconnecting;
  /* `Connecting` is the ordinary wait on the way in, and the lobby already
     accounts for it — announcing it here would put a warning on every join. */
  if (!reconnecting && !showRecovered) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`pointer-events-none absolute inset-x-0 top-2 z-30 mx-auto w-fit rounded-full px-3.5 py-1.5 text-[12px] font-medium shadow-lg backdrop-blur-sm ${
        reconnecting
          ? "bg-amber-500/90 text-amber-950"
          : "bg-emerald-500/90 text-emerald-950"
      }`}
    >
      {reconnecting ? (
        <>
          <span aria-hidden className="mr-1.5 inline-block animate-pulse">
            ●
          </span>
          Trying to reconnect…
        </>
      ) : (
        <>
          <span aria-hidden className="mr-1.5">
            ●
          </span>
          Reconnected
        </>
      )}
    </div>
  );
}
