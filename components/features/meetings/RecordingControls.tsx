"use client";

import { useState } from "react";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import { Icon } from "@/components/ui/Icons";
import type { useMeetingRecording } from "@/lib/legacy-ui/useMeetingRecording";
import type {
  RecordingState,
  UploadState,
} from "@/lib/legacy-ui/coworkSocket";

/**
 * The recording control, on the meeting room's header.
 *
 * The host starts and stops it for everyone; a running recording is announced to
 * the room over the socket and each participant captures their own microphone.
 * So this shows two things: the host's start/stop (behind a confirm, because
 * stopping finalises every participant's audio to Drive and cannot be resumed),
 * and — for anyone — a live indicator plus a per-person status panel fed by the
 * `participant_status` broadcasts.
 */

type Recording = ReturnType<typeof useMeetingRecording>;

export function RecordingControls({
  recording,
  isHost,
  indicatorOnly = false,
}: {
  recording: Recording;
  isHost: boolean;
  /**
   * Just the REC light, for the corner and picture-in-picture windows.
   *
   * They have no room for the host buttons or the status panel, but they are
   * exactly where somebody most needs telling that the recording is still
   * running — it was their absence that made a reset timer read as a restart.
   */
  indicatorOnly?: boolean;
}) {
  const {
    isRecording,
    isUploading,
    uploadError,
    pendingUploads,
    participantStatuses,
  } = recording;

  return (
    <div className="flex items-center gap-2">
      {isRecording && (
        <RecIndicator
          paused={recording.isPaused}
          startedAtMs={recording.recordingStartedAtMs}
          pausedTotalMs={recording.pausedTotalMs}
          pauseStartedAtMs={recording.pauseStartedAtMs}
        />
      )}
      {isUploading && (
        <span className="text-[11px] text-slab-ink-muted">Uploading…</span>
      )}
      {uploadError && (
        /**
         * "Upload failed" read as "your recording is gone", and it never was:
         * a failed finalize leaves every chunk on the server, and a chunk that
         * fails to send is now written to disk here. Both are retried on a
         * timer and on the next page load. Say what is true — it is saved and
         * still going — and offer the manual nudge for someone who does not
         * want to wait for the timer.
         */
        <span className="flex items-center gap-1.5">
          <span
            className="text-[11px] text-[var(--state-overdue-ink)]"
            title={uploadError}
          >
            Upload failed — saved, retrying
            {pendingUploads > 0 ? ` (${pendingUploads})` : ""}
          </span>
          <button
            type="button"
            onClick={() => void recording.retryUpload()}
            className="rounded-md border border-slab-line px-1.5 py-0.5 text-[10px] text-slab-ink-muted hover:text-slab-ink"
          >
            Retry now
          </button>
        </span>
      )}
      {/**
       * **Audio held on this device, and the button to push it.**
       *
       * The count was here and the button was not: it only appeared alongside
       * an upload ERROR, so audio waiting quietly — a slow connection, a drain
       * between retries — could be seen and not sent. Somebody watching a
       * number they cannot act on has no way to tell waiting from stuck.
       *
       * Nothing is at risk either way: every clip is in IndexedDB before it is
       * uploaded and deleted only once the server has it, and the drain runs on
       * a timer and on the next page load regardless. This is for the person
       * who does not want to wait for either.
       */}
      {!uploadError && !isUploading && pendingUploads > 0 && (
        <span className="flex items-center gap-1.5">
          <span
            className="text-[11px] text-slab-ink-muted"
            title="Saved on this device. It uploads by itself; this is the manual nudge."
          >
            {pendingUploads} clip{pendingUploads === 1 ? "" : "s"} saved here
          </span>
          <button
            type="button"
            onClick={() => void recording.retryUpload()}
            className="rounded-md border border-slab-line px-1.5 py-0.5 text-[10px] text-slab-ink-muted hover:text-slab-ink"
          >
            Send to Drive
          </button>
        </span>
      )}

      {/* Everything past the REC light needs room the corner window does not
          have. It stops here rather than shrinking: a status panel squeezed
          into 340px is unreadable, and the light alone is the one fact that
          window has to carry. */}
      {indicatorOnly ? null : (
        <>
      <StatusPanel statuses={participantStatuses} />

      {/* **Pause is separate from Stop, and separate from the microphone.**
          Stopping finalises everybody's audio to Drive and cannot be undone;
          pausing keeps the file open and simply captures nothing. Muting is a
          third thing entirely — it decides who can hear you, not what is kept —
          so a paused recording captures nothing however many microphones are
          live. Offered only while recording, because pausing something that is
          not running is not a state. */}
      {isHost && isRecording && (
        <button
          type="button"
          onClick={
            recording.isPaused
              ? recording.hostResumeRecording
              : recording.hostPauseRecording
          }
          title={
            recording.isPaused
              ? "Resume recording for everyone"
              : "Pause recording for everyone — nothing said while paused is kept"
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-slab-ink transition-colors hover:bg-white/20"
        >
          {recording.isPaused ? (
            <>
              <Icon.play className="h-3.5 w-3.5" />
              Resume
            </>
          ) : (
            <>
              <Icon.pause className="h-3.5 w-3.5" />
              Pause
            </>
          )}
        </button>
      )}

      {isHost && (
        <HostButton
          isRecording={isRecording}
          onStart={recording.hostStartRecording}
          onStop={recording.hostStopRecording}
        />
      )}
        </>
      )}
    </div>
  );
}

/**
 * A pulsing red dot and the running time, the universal "we are recording".
 *
 * ## Why the figure is computed, not counted
 *
 * It used to be a counter in this component's own state. This component is
 * rendered inside the room's header, and the header is not rendered in the
 * corner window or the picture-in-picture one — so popping the meeting out
 * unmounted it, and coming back mounted a fresh one starting at 00:00.
 *
 * **The recording never stopped.** The recorder lives in `useMeetingRecording`,
 * which stays mounted through every presentation. But a REC timer that resets
 * says the recording restarted, and somebody watching it has no way to know it
 * did not — a person could reasonably have stopped and restarted a meeting over
 * that, losing the audio the timer was wrongly reporting.
 *
 * So it is derived from instants the hook holds: when recording began, and how
 * much of it has been paused. Those survive any component unmounting, and the
 * arithmetic gives what is IN the recording rather than wall-clock time.
 */
function RecIndicator({
  paused,
  startedAtMs,
  pausedTotalMs,
  pauseStartedAtMs,
}: {
  paused: boolean;
  startedAtMs: number | null;
  pausedTotalMs: number;
  pauseStartedAtMs: number | null;
}) {
  /* The shared wall clock, which seeds itself once and advances from an
     effect — reading `Date.now()` during render is impure and the compiler
     refuses it. `useLiveNow` is the codebase's answer to that and carries the
     reasoning; a second one here would be a second thing to keep right. */
  const now = useLiveNow();

  /* While paused, measure to the moment the pause began — the recording has
     not grown since, so the figure must not either. */
  const upTo = paused && pauseStartedAtMs !== null ? pauseStartedAtMs : now;
  const secs = startedAtMs
    ? Math.max(0, Math.floor((upTo - startedAtMs - pausedTotalMs) / 1000))
    : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slab-ink">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${paused ? "" : "animate-pulse"}`}
        style={{
          backgroundColor: paused
            ? "var(--state-risk)"
            : "var(--state-overdue)",
        }}
      />
      {paused ? "PAUSED" : "REC"}{" "}
      <span data-figure>
        {mm}:{ss}
      </span>
    </span>
  );
}

function HostButton({
  isRecording,
  onStart,
  onStop,
}: {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!isRecording) {
    return (
      <button
        type="button"
        onClick={onStart}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-slab-ink transition-colors hover:bg-white/20"
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: "var(--state-overdue)" }}
        />
        Record
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setConfirming((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--state-overdue)_30%,transparent)] px-3 py-1.5 text-[12px] font-medium text-slab-ink transition-colors hover:bg-[color-mix(in_srgb,var(--state-overdue)_45%,transparent)]"
      >
        <span aria-hidden="true" className="grid h-2.5 w-2.5 place-items-center">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-slab-ink" />
        </span>
        Stop
      </button>
      {confirming && (
        <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-panel border border-white/10 bg-[var(--slab)] p-3 text-slab-ink shadow-lg">
          <p className="text-[12px] font-medium">Stop the recording?</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slab-ink-muted">
            Every participant&rsquo;s audio is finalised to Drive. It cannot be
            resumed for this meeting.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onStop();
              }}
              className="flex-1 rounded-inset bg-[var(--state-overdue)] px-2 py-1.5 text-[11px] font-medium text-white"
            >
              Stop &amp; save
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-inset bg-white/10 px-2 py-1.5 text-[11px] text-slab-ink hover:bg-white/20"
            >
              Keep recording
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const REC_LABEL: Record<RecordingState, string> = {
  recording: "Recording",
  /* "Muted" was right when muting was what paused a recorder. It is not any
     more: pausing is its own control and a muted person is still recorded, so
     this said the wrong thing about both of them. */
  paused: "Paused",
  not_rec: "Idle",
  failed: "Mic failed",
};
const REC_TONE: Record<RecordingState, string> = {
  recording: "var(--state-positive)",
  paused: "var(--state-risk)",
  not_rec: "var(--ink-faint)",
  failed: "var(--state-overdue)",
};
const UP_LABEL: Record<UploadState, string> = {
  idle: "",
  uploading: "uploading",
  uploaded: "saved",
  /* Said plainly, because it is the state somebody has to act on WHILE the
     meeting is still running. It used to read "saved" — a folder with one file
     in it and two people both told their audio was safe. */
  none: "no audio",
  failed: "upload failed",
};

/** The per-participant record/upload panel, from the socket broadcasts. */
function StatusPanel({
  statuses,
}: {
  statuses: Recording["participantStatuses"];
}) {
  const [open, setOpen] = useState(false);
  const rows = [...statuses.entries()];
  if (rows.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Recording status"
        title="Recording status"
        className="grid h-8 w-8 place-items-center rounded-full text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
      >
        <Icon.overview className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 max-h-72 w-64 overflow-y-auto rounded-panel border border-white/10 bg-[var(--slab)] p-2 shadow-lg scroll-slim">
          <p className="px-1.5 pb-1.5 text-[10px] tracking-wide text-slab-ink-muted uppercase">
            Recording status
          </p>
          <ul className="space-y-0.5">
            {rows.map(([id, s]) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-inset px-1.5 py-1 text-[11px]"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.recordingState === "recording" ? "animate-pulse" : ""}`}
                  style={{ backgroundColor: REC_TONE[s.recordingState] }}
                />
                <span className="min-w-0 flex-1 truncate text-slab-ink">
                  {s.employeeName}
                </span>
                <span className="shrink-0 text-slab-ink-muted">
                  {UP_LABEL[s.uploadState] || REC_LABEL[s.recordingState]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
