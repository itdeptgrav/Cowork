"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";

/**
 * The two shortcuts everybody already has in their hands.
 *
 * `ctrl`/`cmd` + `d` toggles the microphone, `ctrl`/`cmd` + `e` the camera —
 * the same pair Google Meet uses, chosen because people arrive with the habit
 * rather than because the letters mean anything.
 *
 * ## Why the guards matter more than the feature
 *
 * A global key handler in a room that also contains a chat box is a way to make
 * typing unpredictable. `cmd+d` while composing a message must insert nothing
 * and mute nobody, so anything originating in an input, textarea or
 * contenteditable is left alone entirely.
 *
 * `preventDefault` is deliberate on the ones that are handled: `ctrl+d` is
 * "bookmark" in some browsers and end-of-input in a terminal-shaped context,
 * and a shortcut that mutes you AND opens a bookmark dialog is worse than no
 * shortcut.
 *
 * ## The toast
 *
 * A shortcut with no feedback is indistinguishable from a shortcut that did not
 * work — particularly muting, whose only other signal is a small icon change in
 * a control bar the reader is not looking at. It also announces politely, so
 * this is the confirmation for somebody who cannot see the control bar at all.
 */
export function RoomShortcuts() {
  const { localParticipant } = useLocalParticipant();
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!localParticipant) return;

    const say = (message: string) => {
      setToast(message);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setToast(null), 1_600);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          el.isContentEditable
        ) {
          return;
        }
      }

      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        const next = !localParticipant.isMicrophoneEnabled;
        void localParticipant
          .setMicrophoneEnabled(next)
          .then(() => say(next ? "Microphone on" : "Microphone muted"))
          .catch(() => say("The microphone could not be changed"));
      } else if (key === "e") {
        e.preventDefault();
        const next = !localParticipant.isCameraEnabled;
        void localParticipant
          .setCameraEnabled(next)
          .then(() => say(next ? "Camera on" : "Camera off"))
          .catch(() => say("The camera could not be changed"));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [localParticipant]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-16 z-30 mx-auto w-fit"
    >
      {toast && (
        <span className="rounded-full bg-black/75 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-sm">
          {toast}
        </span>
      )}
    </div>
  );
}
