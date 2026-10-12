/**
 * Pure helpers for voice notes — the parts worth testing without a microphone.
 * The recorder hook (`useVoiceRecorder`) owns the browser MediaRecorder; this
 * owns the format choice and the duration label, so both are unit-testable.
 */

/** The audio container to record in, chosen from what the browser supports.
 *  Opus-in-WebM where it exists (Chrome/Firefox), else mp4/AAC (Safari), else
 *  a bare fallback. Returns "" when nothing is offered — the caller then omits
 *  the option and lets the browser pick. */
export function pickAudioMime(
  isSupported: (t: string) => boolean = defaultIsSupported,
): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((t) => isSupported(t)) ?? "";
}

function defaultIsSupported(t: string): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(t)
  );
}

/** The file extension for a recorded audio mime, so the saved note keeps a name
 *  the OS and the media proxy recognise. */
export function audioExtensionFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}

/** m:ss for a recording timer. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

/** A stable, human name for a recorded note. `stamp` is passed in (never read
 *  from the clock here) so the value is deterministic for a test. */
export function voiceNoteFilename(mime: string, stamp: string): string {
  return `voice-note-${stamp}.${audioExtensionFor(mime)}`;
}

/* ── Playing one back ──────────────────────────────────────────────────────── */

/**
 * The clock beside the seek bar.
 *
 * Before anything has played it is just the length ("1:03"), because "0:00 /
 * 1:03" over a note nobody has touched reads like a player that is stuck. Once
 * started it is position and length. A length the browser could not measure
 * (a recording with no duration in its header, served without range support)
 * falls back to the length measured while recording, and with neither it says
 * only where playback is — never "0:00", which would claim an empty note.
 */
export function audioClock(
  currentSecs: number,
  durationSecs: number | null,
  started: boolean,
): string {
  const total =
    durationSecs !== null && Number.isFinite(durationSecs) && durationSecs > 0
      ? durationSecs
      : null;
  if (!started) return total !== null ? formatDuration(total) : "";
  return total !== null
    ? `${formatDuration(currentSecs)} / ${formatDuration(total)}`
    : formatDuration(currentSecs);
}

/**
 * What an audio card is called.
 *
 * A note recorded here is saved as `voice-note-<stamp>.<ext>` — a name for the
 * file system, not for a person — so it reads "Voice note". Any other audio
 * keeps the name it was sent with ("Site meeting.m4a"), because that name is
 * how the people in the thread tell two recordings apart.
 */
export function audioTitle(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n || /^voice-note-/i.test(n)) return "Voice note";
  return n;
}
