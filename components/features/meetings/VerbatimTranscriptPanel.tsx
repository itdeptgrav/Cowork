"use client";

/**
 * The Gemini transcript — exact words, or translated, but never the
 * summary's silent paraphrase.
 *
 * Sits next to `MeetingSummaryPanel` in "After the meeting," not inside it.
 * They answer different questions and must not be conflated: the summary's
 * own CONVERSATION section translates non-English speech and paraphrases
 * anything unclear (by its own prompt's explicit instruction — see
 * `routes/task_routes/meetingSummary.routes.js`'s `buildPrompt`), which is
 * the right call for a quick-scan summary and the wrong one for a record
 * someone needs to trust.
 *
 * Two independent modes, a tab each, not a single toggle on one result:
 *  - Verbatim: exact words, original language preserved (Hindi/Odia/etc.
 *    stay as spoken). For someone who needs to trust the record word-for-
 *    word, or who reads the original language.
 *  - Translated: renders everything into English, with translated lines
 *    marked so a reader who doesn't read Odia/Hindi script still knows a
 *    translation happened — not reading it as if it were said in English.
 * Generating one never erases the other; both are independently cached.
 *
 * Same generate → poll-style wait → render shape as `MeetingSummaryPanel`,
 * deliberately, so the two feel like one family of panel.
 */

import { useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/legacy-ui/coworkFirebase";
import {
  generateMeetingTranscriptGemini,
  getMeetingTranscriptGemini,
  type MeetingTranscript,
  type TranscriptMode,
} from "@/lib/legacy/meetingMedia";
import { Button, InlineError, Chip } from "@/components/ui/Primitives";

async function getToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

const STEPS_BY_MODE: Record<TranscriptMode, string[]> = {
  verbatim: [
    "Loading audio files from Drive…",
    "Uploading to Gemini File API…",
    "Waiting for files to activate…",
    "Transcribing verbatim…",
    "Saving transcript…",
  ],
  translate: [
    "Loading audio files from Drive…",
    "Uploading to Gemini File API…",
    "Waiting for files to activate…",
    "Translating to English…",
    "Saving transcript…",
  ],
};

const MODE_LABEL: Record<TranscriptMode, string> = {
  verbatim: "Verbatim",
  translate: "Translated to English",
};

export function VerbatimTranscriptPanel({
  meetId,
  meetStatus,
}: {
  meetId: string;
  meetStatus: string;
}) {
  const [record, setRecord] = useState<MeetingTranscript | null>(null);
  const [mode, setMode] = useState<TranscriptMode>("verbatim");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [dlLoading, setDlLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        const res = await getMeetingTranscriptGemini({ token, meetId });
        if (!cancelled && res.ok && res.data?.transcript) {
          setRecord(res.data.transcript);
        }
      } catch {
        /* nothing generated yet — that's fine */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetId]);

  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (generating) {
      const reset = setTimeout(() => setStep(0), 0);
      stepTimer.current = setInterval(
        () => setStep((s) => Math.min(s + 1, STEPS_BY_MODE[mode].length - 1)),
        4000,
      );
      return () => {
        clearTimeout(reset);
        if (stepTimer.current) clearInterval(stepTimer.current);
      };
    } else if (stepTimer.current) {
      clearInterval(stepTimer.current);
      stepTimer.current = null;
    }
  }, [generating, mode]);

  async function generate(force = false) {
    setGenerating(true);
    setGenError(null);
    try {
      const token = await getToken();
      const res = await generateMeetingTranscriptGemini({ token, meetId, mode, force });
      if (!res.ok) throw new Error(res.error.message ?? "Generation failed");
      if (res.data?.transcript) setRecord(res.data.transcript);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  /* Download the tab being read. `mode` is whichever is open, so Verbatim
     gives the verbatim document and Translated the translated one — the file
     matches the screen rather than being one fixed export. */
  async function downloadDocx() {
    setDlLoading(true);
    setGenError(null);
    try {
      const token = await getToken();
      const base =
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_LEGACY_API_URL ||
        "http://localhost:5000";
      const res = await fetch(
        `${base}/cowork/audio/transcript/${encodeURIComponent(meetId)}/download?mode=${mode}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        /* The engine answers errors as JSON even here, and its reason is more
           use than an HTTP number. */
        let reason = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) reason = body.error;
        } catch {
          /* Not JSON — the status is all there is. */
        }
        throw new Error(reason);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Meeting_Transcript_${mode === "translate" ? "Translated" : "Verbatim"}_${meetId}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDlLoading(false);
    }
  }

  const modeResult = record?.[mode];
  const canGenerate = meetStatus === "completed" || meetStatus === "archived";

  const ModeTabs = (
    <div className="mb-3 flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] p-0.5 text-xs">
      {(["verbatim", "translate"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          disabled={generating}
          className={`rounded-full px-3 py-1 transition-colors ${
            mode === m
              ? "bg-[var(--surface-raised)] text-ink shadow-sm"
              : "text-ink-faint hover:text-ink-muted"
          }`}
        >
          {MODE_LABEL[m]}
          {record?.[m] && mode !== m && (
            <span aria-hidden="true" className="ml-1">
              ✓
            </span>
          )}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <p className="mt-2 animate-pulse text-sm text-ink-muted">
        Checking for a transcript…
      </p>
    );
  }

  if (generating) {
    const steps = STEPS_BY_MODE[mode];
    return (
      <div className="mt-2">
        {ModeTabs}
        <div className="space-y-1.5">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-xs transition-opacity ${
                i < step
                  ? "text-[var(--state-positive-ink)]"
                  : i === step
                    ? "text-ink"
                    : "text-ink-faint opacity-40"
              }`}
            >
              <span aria-hidden="true" className="shrink-0 text-[10px]">
                {i < step ? "✓" : i === step ? "·" : " "}
              </span>
              {s}
            </div>
          ))}
          <p className="mt-3 text-xs text-ink-faint">
            {mode === "verbatim"
              ? 'This usually takes 1–3 minutes. Exact words, no translation — the model is told to say "unclear" rather than guess.'
              : "This usually takes 1–3 minutes. Non-English speech is rendered in English, with translated lines marked."}
          </p>
        </div>
      </div>
    );
  }

  if (!modeResult) {
    return (
      <div className="mt-2">
        {ModeTabs}
        {canGenerate ? (
          <>
            <p className="text-sm text-ink-muted">
              {mode === "verbatim"
                ? "No verbatim transcript yet. Unlike the summary above, this preserves exact wording and original language — no translation, no paraphrasing."
                : "No translated transcript yet. Renders everything in English, but marks exactly which lines were translated rather than blending it in silently."}
            </p>
            <div className="mt-3">
              <Button tone="secondary" size="sm" onClick={() => void generate()}>
                Generate {MODE_LABEL[mode].toLowerCase()} transcript
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-faint">
            Available once the meeting has ended.
          </p>
        )}
        {genError && (
          <div className="mt-2">
            <InlineError compact message={genError} />
          </div>
        )}
      </div>
    );
  }

  const reviewCount = modeResult.utterances.filter((u) => u.needsReview).length;

  return (
    <div className="mt-2">
      {ModeTabs}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          {modeResult.utterances.length} lines
          {reviewCount > 0 && ` · ${reviewCount} flagged for review`}
          {modeResult.unparsedLineCount > 0 &&
            ` · ${modeResult.unparsedLineCount} line(s) the parser couldn't structure`}
        </p>
        <div className="flex items-center gap-1">
          <Button
            tone="secondary"
            size="sm"
            disabled={dlLoading || generating}
            onClick={() => void downloadDocx()}
          >
            {dlLoading ? "Downloading…" : "Download .docx"}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            disabled={generating}
            onClick={() => void generate(true)}
          >
            Regenerate
          </Button>
        </div>
      </div>
      {genError && (
        <div className="mb-3">
          <InlineError compact message={genError} />
        </div>
      )}

      <div className="flex flex-col divide-y divide-hairline">
        {modeResult.utterances.map((u, i) => (
          <div
            key={i}
            className={`flex gap-3 py-2 ${u.needsReview ? "rounded-inset bg-[var(--surface-sunken)] px-2" : ""}`}
          >
            <span
              data-figure
              className="w-14 shrink-0 pt-0.5 font-mono text-[11px] text-ink-faint"
            >
              {formatTime(u.start)}–{formatTime(u.end)}
            </span>
            <span className="w-20 shrink-0 pt-0.5 text-[13px] font-medium text-ink">
              {u.speaker}
            </span>
            <span className="min-w-0 flex-1 text-[13px] text-ink-muted">
              {u.text}
              {u.needsReview && (
                <Chip tone="risk" className="ml-2 align-middle">
                  review
                </Chip>
              )}
              {mode === "translate" && u.translated && (
                <Chip tone="neutral" className="ml-2 align-middle">
                  translated
                </Chip>
              )}
            </span>
          </div>
        ))}
      </div>

      {genError && (
        <div className="mt-3">
          <InlineError compact message={genError} />
        </div>
      )}
    </div>
  );
}
