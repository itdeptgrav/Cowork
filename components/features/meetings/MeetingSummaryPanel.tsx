"use client";

/**
 * Post-meeting AI summary and Ask-AI panel.
 *
 * Shows in the "After the meeting" section of MeetingDetailArea for completed
 * meetings. Flow:
 *
 *  - If no summary exists → "Generate summary" button (visible to anyone who
 *    can view the meeting; organiser gating is enforced by the backend).
 *  - While generating → animated steps list (the pipeline is slow — Gemini
 *    File API, polling, generation).
 *  - When done → structured sections: Summary · Participants · Conversation ·
 *    Tasks · Deadlines · Action items.
 *  - Download .docx and Ask-AI are available whenever a summary exists.
 *
 * All data calls go through `meetingMedia.ts` → `legacyFetch`. The .docx
 * download bypasses legacyFetch (it returns a blob, not JSON) and hits the
 * engine directly with a Bearer token.
 */

import { useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/legacy-ui/coworkFirebase";
import {
  askMeetingAI,
  generateMeetingSummary,
  getMeetingSummary,
} from "@/lib/legacy/meetingMedia";
import { Button, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";

const BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_LEGACY_API_URL ||
  "http://localhost:5000";

// ── Domain shape ───────────────────────────────────────────────────────────────

interface SummaryData {
  meetTitle?: string;
  summary?: string;
  participants?: string[];
  conversationFlow?: string[];
  dialogue?: { speaker: string; text: string }[];
  tasksAssigned?: string[];
  deadlines?: string[];
  actionItems?: string[];
  audioFilesCount?: number;
  createdAtMs?: number;
}

async function getToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MeetingSummaryPanel({
  meetId,
  meetStatus,
}: {
  meetId: string;
  meetStatus: string;
}) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [dlLoading, setDlLoading] = useState(false);

  // Load existing summary on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        const res = await getMeetingSummary({ token, meetId });
        if (!cancelled && res.ok && res.data?.exists && res.data.summary) {
          setSummary(res.data.summary as SummaryData);
        }
      } catch {
        /* no summary yet — that's fine */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetId]);

  // Animate step counter while generating — reset is deferred so it never
  // fires synchronously inside the render that toggled `generating`.
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (generating) {
      const reset = setTimeout(() => setStep(0), 0);
      stepTimer.current = setInterval(
        () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
        4000,
      );
      return () => {
        clearTimeout(reset);
        if (stepTimer.current) clearInterval(stepTimer.current);
      };
    } else {
      if (stepTimer.current) {
        clearInterval(stepTimer.current);
        stepTimer.current = null;
      }
    }
  }, [generating]);

  async function generate(force = false) {
    setGenerating(true);
    setGenError(null);
    try {
      const token = await getToken();
      const res = await generateMeetingSummary({ token, meetId, force });
      if (!res.ok) throw new Error(res.error.message ?? "Generation failed");
      if (res.data?.summary) setSummary(res.data.summary as SummaryData);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function downloadDocx() {
    setDlLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE}/cowork/audio/summary/${encodeURIComponent(meetId)}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Meeting_Summary_${meetId}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setGenError(
        e instanceof Error ? e.message : "Download failed",
      );
    } finally {
      setDlLoading(false);
    }
  }

  if (loading) {
    return (
      <p className="mt-2 animate-pulse text-sm text-ink-muted">
        Checking for summary…
      </p>
    );
  }

  if (generating) {
    return <GeneratingState step={step} />;
  }

  if (!summary) {
    return (
      <EmptyState
        meetStatus={meetStatus}
        onGenerate={() => void generate()}
        error={genError}
      />
    );
  }

  return (
    <SummaryView
      summary={summary}
      meetId={meetId}
      onRegenerate={() => void generate(true)}
      onDownload={() => void downloadDocx()}
      dlLoading={dlLoading}
      error={genError}
    />
  );
}

// ── Empty / generate CTA ──────────────────────────────────────────────────────

const STEPS = [
  "Loading audio files from Drive…",
  "Uploading to Gemini File API…",
  "Waiting for files to activate…",
  "Sending to Gemini…",
  "Parsing response…",
  "Saving summary…",
];

function GeneratingState({ step }: { step: number }) {
  return (
    <div className="mt-2 space-y-1.5">
      {STEPS.map((s, i) => (
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
        This usually takes 1–3 minutes depending on how many participants
        recorded audio.
      </p>
    </div>
  );
}

function EmptyState({
  meetStatus,
  onGenerate,
  error,
}: {
  meetStatus: string;
  onGenerate: () => void;
  error: string | null;
}) {
  const canGenerate = meetStatus === "completed" || meetStatus === "archived";
  return (
    <div className="mt-2">
      {canGenerate ? (
        <>
          <p className="text-sm text-ink-muted">
            No summary yet. Generating one sends all recorded audio through
            Gemini and takes a minute or two.
          </p>
          <div className="mt-3">
            <Button tone="secondary" size="sm" onClick={onGenerate}>
              Generate summary
            </Button>
          </div>
          {error && (
            <div className="mt-2">
              <InlineError compact message={error} />
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-muted">
          Summary will be available after the meeting ends and audio is
          uploaded.
        </p>
      )}
    </div>
  );
}

// ── Summary display ────────────────────────────────────────────────────────────

function SummaryView({
  summary,
  meetId,
  onRegenerate,
  onDownload,
  dlLoading,
  error,
}: {
  summary: SummaryData;
  meetId: string;
  onRegenerate: () => void;
  onDownload: () => void;
  dlLoading: boolean;
  error: string | null;
}) {
  return (
    <div className="mt-2 space-y-4">
      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="ghost"
          size="sm"
          onClick={onDownload}
          disabled={dlLoading}
        >
          {dlLoading ? "Downloading…" : "Download .docx"}
        </Button>
        <button
          type="button"
          onClick={onRegenerate}
          className="text-[11px] text-ink-faint hover:text-ink-muted"
          title="Force-regenerate even if a recent summary exists"
        >
          Regenerate
        </button>
        {error && (
          <div className="w-full">
            <InlineError compact message={error} />
          </div>
        )}
      </div>

      {/* Summary */}
      {summary.summary && (
        <Section label="Overview">
          <p className="text-sm leading-relaxed text-ink-muted">
            {summary.summary}
          </p>
        </Section>
      )}

      {/* Participants */}
      {summary.participants && summary.participants.length > 0 && (
        <Section label="Participants">
          <ul className="flex flex-wrap gap-1.5">
            {summary.participants.map((name) => (
              <li
                key={name}
                className="rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted"
              >
                {name}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Tasks assigned */}
      {summary.tasksAssigned && summary.tasksAssigned.length > 0 && (
        <Section label="Tasks assigned">
          <ul className="space-y-1">
            {summary.tasksAssigned.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-muted">
                <Icon.tasks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                {t}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Action items */}
      {summary.actionItems && summary.actionItems.length > 0 && (
        <Section label="Action items">
          <ul className="space-y-1">
            {summary.actionItems.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-muted">
                <Icon.check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Conversation — collapsible */}
      {summary.conversationFlow && summary.conversationFlow.length > 0 && (
        <CollapsibleSection
          label={`Conversation (${summary.conversationFlow.length} turns)`}
        >
          <div className="max-h-64 overflow-y-auto scroll-slim rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
            {summary.conversationFlow.map((line, i) => {
              const colon = line.indexOf(":");
              const speaker = colon > 0 ? line.slice(0, colon) : null;
              const text = colon > 0 ? line.slice(colon + 1).trim().replace(/^"|"$/g, "") : line;
              return (
                <p key={i} className="mb-1.5 text-[11px] leading-snug last:mb-0">
                  {speaker && (
                    <span className="font-medium text-ink">{speaker}: </span>
                  )}
                  <span className="text-ink-muted">{text}</span>
                </p>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Ask AI */}
      <AskAIBox meetId={meetId} />
    </div>
  );
}

// ── Ask-AI inline box ─────────────────────────────────────────────────────────

function AskAIBox({ meetId }: { meetId: string }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setAsking(true);
    setAnswer(null);
    setError(null);
    try {
      const token = await getToken();
      const res = await askMeetingAI({ token, meetId, question: q });
      if (!res.ok) throw new Error(res.error.message ?? "Ask failed");
      setAnswer(res.data?.answer ?? "No answer returned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  return (
    <Section label="Ask AI">
      <p className="mb-2 text-[11px] text-ink-faint">
        Ask a question about what was said in this meeting.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !asking && void ask()}
          placeholder="What did we decide about…"
          maxLength={500}
          disabled={asking}
          className="min-w-0 flex-1 rounded-inset border border-hairline bg-[var(--surface-sunken)] px-3 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-ink/20"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={asking || !question.trim()}
          className="shrink-0 rounded-inset bg-[var(--control)] px-3 py-1.5 text-[12px] text-ink disabled:opacity-40"
        >
          {asking ? "…" : "Ask"}
        </button>
      </div>
      {answer && (
        <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5 text-sm leading-relaxed text-ink-muted">
          {answer}
        </div>
      )}
      {error && (
        <div className="mt-2">
          <InlineError compact message={error} />
        </div>
      )}
      {asking && (
        <p className="mt-2 animate-pulse text-[11px] text-ink-faint">
          Re-analysing audio via Gemini — this may take a minute…
        </p>
      )}
    </Section>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium tracking-[0.09em] text-ink-faint uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

function CollapsibleSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.09em] text-ink-faint uppercase hover:text-ink-muted"
      >
        <Icon.chevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
