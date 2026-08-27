"use client";

import { useEffect, useState } from "react";
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
}: {
  recording: Recording;
  isHost: boolean;
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
      {isRecording && <RecIndicator paused={recording.isPaused} />}
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
    </div>
  );
}

/** A pulsing red dot and the running time, the universal "we are recording". */
function RecIndicator({ paused }: { paused: boolean }) {
  const [secs, setSecs] = useState(0);
  /**
   * **The clock stops while paused, and so does the word.**
   *
   * It counted wall-clock time from the moment recording began and pulsed red
   * throughout — so a paused meeting went on saying REC with a rising figure
   * over a file that was not growing. That is the one thing this indicator
   * must never do: it exists to tell people they are being recorded, and it
   * was saying so while they were not.
   *
   * The counter measures what is IN the recording, which is why the paused
   * seconds are skipped rather than the whole thing restarted.
   */
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [paused]);
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
