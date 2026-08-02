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
  const { isRecording, isUploading, uploadError, participantStatuses } =
    recording;

  return (
    <div className="flex items-center gap-2">
      {isRecording && <RecIndicator />}
      {isUploading && (
        <span className="text-[11px] text-slab-ink-muted">Uploading…</span>
      )}
      {uploadError && (
        <span
          className="text-[11px] text-[var(--state-overdue-ink)]"
          title={uploadError}
        >
          Upload failed
        </span>
      )}

      <StatusPanel statuses={participantStatuses} />

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
function RecIndicator() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(
      () => setSecs(Math.round((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slab-ink">
      <span
        aria-hidden="true"
        className="h-2 w-2 animate-pulse rounded-full"
        style={{ backgroundColor: "var(--state-overdue)" }}
      />
      REC <span data-figure>{mm}:{ss}</span>
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
  paused: "Muted",
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
