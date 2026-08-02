"use client";

/**
 * Live-transcript sidebar for the meeting room.
 *
 * Rendered inside `LiveKitRoom` so it can call `useMeetingTranscript` which
 * needs `useRoomContext` / `useLocalParticipant` from the LiveKit context.
 *
 * The panel is always mounted but toggled with `display:none` so the hook's
 * state (and the Firestore subscription) is never torn down on hide — a late
 * show would otherwise lose the history that arrived while hidden.
 */

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  SUPPORTED_LANGS,
  useMeetingTranscript,
  type LangCode,
  type TranscriptLine,
} from "@/lib/legacy-ui/useMeetingTranscript";

// ── Panel shell ───────────────────────────────────────────────────────────────

export function TranscriptPanel({
  meetId,
  participantName,
  open,
}: {
  meetId: string;
  participantName: string;
  open: boolean;
}) {
  const { transcript, isTranscribing, speechSupported, activeLang, switchLanguage, clearTranscript } =
    useMeetingTranscript({ meetId, participantName });

  return (
    /* Always mounted; toggled via style so the hook stays alive. */
    <aside
      style={{ display: open ? undefined : "none" }}
      className="flex h-full w-64 shrink-0 flex-col border-l border-white/10 bg-[var(--slab)]"
      aria-label="Live transcript"
    >
      <Header
        isTranscribing={isTranscribing}
        speechSupported={speechSupported}
        activeLang={activeLang}
        onSwitch={switchLanguage}
        onClear={clearTranscript}
        transcript={transcript}
      />
      <ScrollArea transcript={transcript} />
    </aside>
  );
}

// ── Header with controls ──────────────────────────────────────────────────────

function Header({
  isTranscribing,
  speechSupported,
  activeLang,
  onSwitch,
  onClear,
  transcript,
}: {
  isTranscribing: boolean;
  speechSupported: boolean;
  activeLang: LangCode;
  onSwitch: (l: LangCode) => void;
  onClear: () => void;
  transcript: TranscriptLine[];
}) {
  return (
    <div className="shrink-0 border-b border-white/10 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* Title + mic indicator */}
        <span className="flex-1 text-[12px] font-medium text-slab-ink">
          Transcript
        </span>
        {isTranscribing && (
          <span
            aria-label="Transcribing"
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--state-positive)]"
          />
        )}
        {!speechSupported && (
          <span className="text-[10px] text-[var(--state-overdue-ink)]">
            Speech not supported
          </span>
        )}

        {/* Export as plain text */}
        {transcript.length > 0 && (
          <button
            type="button"
            title="Download transcript"
            onClick={() => exportTranscript(transcript)}
            className="grid h-6 w-6 place-items-center rounded text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
          >
            <Icon.attach className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Clear */}
        {transcript.length > 0 && (
          <button
            type="button"
            title="Clear"
            onClick={onClear}
            className="grid h-6 w-6 place-items-center rounded text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
          >
            <Icon.close className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Language switcher */}
      <div className="mt-1.5 flex gap-1">
        {(Object.values(SUPPORTED_LANGS) as (typeof SUPPORTED_LANGS)[keyof typeof SUPPORTED_LANGS][]).map(
          (lang) => (
            <button
              key={lang.code}
              type="button"
              title={lang.hint}
              onClick={() => onSwitch(lang.code)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                activeLang === lang.code
                  ? "bg-white/20 text-slab-ink"
                  : "text-slab-ink-muted hover:bg-white/10 hover:text-slab-ink"
              }`}
            >
              {lang.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ── Scrollable transcript list ────────────────────────────────────────────────

function ScrollArea({ transcript }: { transcript: TranscriptLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll to the newest line. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  if (transcript.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-4 py-8 text-center">
        <p className="text-[11px] text-slab-ink-muted">
          Transcript lines appear here as each participant speaks.
        </p>
      </div>
    );
  }

  return (
    <div className="scroll-slim flex-1 overflow-y-auto px-3 py-2">
      {transcript.map((line, i) => (
        <TranscriptRow key={i} line={line} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function TranscriptRow({ line }: { line: TranscriptLine }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-medium text-slab-ink">
          {line.name}
        </span>
        <span className="text-[10px] text-slab-ink-muted">{line.time}</span>
      </div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-slab-ink">
        {line.text}
      </p>
    </div>
  );
}

// ── Export helper ─────────────────────────────────────────────────────────────

function exportTranscript(transcript: TranscriptLine[]) {
  const lines = transcript
    .map((l) => `[${l.time}] ${l.name}: ${l.text}`)
    .join("\n");
  const blob = new Blob([lines], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
