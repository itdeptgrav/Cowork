"use client";

import { Icon } from "@/components/ui/Icons";
import { useVoiceRecorder } from "@/lib/hooks/useVoiceRecorder";
import { formatDuration } from "@/lib/rules/messages/voiceNote";

/**
 * The mic control for a composer. Idle, it is one round button; recording, it
 * becomes a compact bar — a pulsing dot, the running time, discard, and send.
 * On send it hands the recorded `File` to `onRecorded`, which stages it exactly
 * as a picked file, so the whole upload/send/render path is reused unchanged.
 *
 * Renders nothing where the browser cannot record, so a composer never shows a
 * mic it cannot honour.
 */
export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: File) => void;
  disabled?: boolean;
}) {
  const rec = useVoiceRecorder(onRecorded);
  if (!rec.supported) return null;

  if (rec.recording) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--control)] px-2 py-1">
        <span
          aria-hidden
          className="h-2 w-2 animate-pulse rounded-full bg-[var(--state-overdue,#d1495b)]"
        />
        <span
          className="min-w-[3ch] text-[12px] tabular-nums text-ink"
          aria-live="polite"
        >
          {formatDuration(rec.seconds)}
        </span>
        <button
          type="button"
          onClick={rec.cancel}
          aria-label="Discard voice note"
          title="Discard"
          className="grid h-6 w-6 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
        >
          <Icon.close className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={rec.stop}
          aria-label="Attach voice note"
          title="Attach"
          className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[var(--body-bg)] transition-opacity hover:opacity-90"
        >
          <Icon.check className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => void rec.start()}
        aria-label="Record a voice note"
        title="Record a voice note"
        className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
      >
        <Icon.mic className="h-[18px] w-[18px]" />
      </button>
      {rec.error && (
        <span role="alert" className="ml-1 text-[11px] text-[var(--state-overdue-ink)]">
          {rec.error}
        </span>
      )}
    </span>
  );
}
