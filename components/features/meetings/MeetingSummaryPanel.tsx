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
  generationMayStillBeRunning,
  waitForMeetingSummary,
  getMeetingSummary,
} from "@/lib/legacy/meetingMedia";
import { Button, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import {
  needsActionCount,
  needsActionGroups,
} from "@/lib/rules/meetings/needsAction";

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

/** Long enough for finalize to land the tail of the recording. */
const AUTO_DELAY_MS = 60_000;

// ── Component ──────────────────────────────────────────────────────────────────

export function MeetingSummaryPanel({
  meetId,
  meetStatus,
  autoGenerateAfter = null,
}: {
  meetId: string;
  meetStatus: string;
  /**
   * Generate without being asked, once, when this changes to a new non-empty
   * value.
   *
   * For a task meeting, which has no "End for everyone": the meeting is over
   * when the last person leaves, and asking somebody to come back and press a
   * button for the summary of a conversation they have already walked away
   * from is asking for a summary nobody will ever have.
   *
   * The value is the session that just ended, so leaving twice generates twice
   * and a re-render generates nothing. Deliberately NOT "generate whenever a
   * summary is missing" — that would put every past meeting through Gemini the
   * first time anybody opened the tab.
   */
  autoGenerateAfter?: string | null;
}) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  /* Which format is downloading, or null. A boolean could not say WHICH, so
     both buttons would have read Downloading… at once. */
  const [dlLoading, setDlLoading] = useState<"docx" | "pdf" | null>(null);

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

  /**
   * The one automatic run, for a meeting that ends by everybody leaving.
   *
   * Keyed on the session id so it fires once per meeting rather than once per
   * render. It waits before asking: finalize is still uploading the tail of the
   * recording as the room closes, and a summary generated against half the
   * audio is worse than one generated a minute later — Gemini would answer
   * confidently from whatever had landed.
   *
   * `firedFor` is a ref rather than state because nothing renders differently
   * for having fired; it exists only so a re-render cannot fire again.
   */
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!autoGenerateAfter) return;
    if (firedFor.current === autoGenerateAfter) return;
    firedFor.current = autoGenerateAfter;
    const t = setTimeout(() => void generateRef.current(false), AUTO_DELAY_MS);
    return () => clearTimeout(t);
    /* Only the session id. `generate` is reached through a ref precisely so
       this cannot re-run when its identity changes — that would start a second
       generation while the first was still in flight. */
  }, [autoGenerateAfter]);

  const generateRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  generateRef.current = generate;

  async function generate(force = false) {
    setGenerating(true);
    setGenError(null);
    /* See the transcript panel: read before asking, so Regenerate is not
       satisfied by the summary already on screen. */
    const newerThanMs = summary?.createdAtMs ?? 0;
    try {
      const token = await getToken();
      const res = await generateMeetingSummary({ token, meetId, force });
      if (res.ok) {
        if (res.data?.summary) setSummary(res.data.summary as SummaryData);
        return;
      }
      /**
       * **A broken connection is not a failed generation.**
       *
       * The engine does the slow work first and answers last — Gemini runs,
       * the result is written to Firestore, and only then does the response
       * go out. On a long meeting that can outlast whatever sits in front of
       * the engine, and the answer is lost while the work is not.
       *
       * Reported with a 45–50 minute meeting: *Could not reach the Cowork
       * server.* on a transcript that had in fact been generated and saved.
       *
       * So we wait for it instead of reporting a failure. 429 is included
       * because that is the engine's own lock telling us it is already
       * working on this one. Anything else is a real answer and is shown.
       */
      if (!generationMayStillBeRunning(res.error)) {
        throw new Error(res.error.message ?? "Generation failed");
      }
      const waited = await waitForMeetingSummary({
        getToken,
        meetId,
        newerThanMs,
      });
      if (waited) {
        setSummary(waited as SummaryData);
        return;
      }
      throw new Error(
        "This is taking longer than usual. The summary is still being made — leave this open, or come back to the meeting in a few minutes.",
      );
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  /**
   * **The same document, in whichever format.**
   *
   * One route, one permission check, one set of contents — `format=pdf` only
   * changes how the engine renders it. A second route would have been a
   * second place for the two to drift apart.
   *
   * `which` is tracked rather than a single boolean so the two buttons can say
   * which one is working: two buttons both reading Downloading… is worse than
   * no feedback at all.
   */
  async function download(format: "docx" | "pdf") {
    setDlLoading(format);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE}/cowork/audio/summary/${encodeURIComponent(meetId)}/download${
          format === "pdf" ? "?format=pdf" : ""
        }`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        /* The engine answers its refusals as JSON, and its reason is more use
           than the number — a server with no Chromium says so in words. */
        let reason = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) reason = body.error;
        } catch {
          /* Not JSON — the status is all there is. */
        }
        throw new Error(reason);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Meeting_Summary_${meetId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setGenError(
        e instanceof Error ? e.message : "Download failed",
      );
    } finally {
      setDlLoading(null);
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
      onDownload={(format) => void download(format)}
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
  onDownload: (format: "docx" | "pdf") => void;
  dlLoading: "docx" | "pdf" | null;
  error: string | null;
}) {
  return (
    <div className="mt-2 space-y-4">
      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onDownload("docx")}
          disabled={dlLoading !== null}
        >
          {dlLoading === "docx" ? "Downloading…" : "Download .docx"}
        </Button>
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onDownload("pdf")}
          disabled={dlLoading !== null}
        >
          {dlLoading === "pdf" ? "Rendering…" : "PDF"}
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

      {/**
       * **What somebody has to do, before anything else on the page.**
       *
       * Asked for 21 Sep 2026: there was nowhere that answered "what do I have
       * to do". Tasks and action items sat in two separate blocks partway down,
       * deadlines were produced by the engine and rendered NOWHERE, and the
       * reader had to work out which of the three concerned them.
       *
       * First, because it is the only part of a summary anybody is obliged to
       * act on. Grouped by person, because the question is asked about oneself
       * and is answered by finding your own name.
       *
       * This REPLACED the separate "Tasks assigned" and "Action items"
       * sections rather than joining them. It holds everything they held and
       * the deadlines besides, so keeping them would have printed the same
       * commitments twice under three headings — which is the kind of
       * duplication this panel was reported for in the first place.
       */}
      {needsActionCount(summary) > 0 && (
        <div className="rounded-inset border border-hairline bg-[var(--control)] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium tracking-[0.09em] text-ink uppercase">
            <Icon.flag className="h-3.5 w-3.5 text-ink-muted" />
            Needs action
            <span data-figure className="text-ink-faint">
              {needsActionCount(summary)}
            </span>
          </p>

          <div className="flex flex-col gap-2.5">
            {needsActionGroups(summary).map((group) => (
              <div key={group.owner ?? "everyone"}>
                <p className="mb-1 text-[11px] font-medium text-ink">
                  {/* Null is the room's own list — work the meeting agreed
                      without naming anybody to do it. */}
                  {group.owner ?? "Everyone"}
                </p>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li
                      key={item.source}
                      className="flex gap-2 text-sm leading-relaxed text-ink-muted"
                    >
                      <Icon.check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span>
                        {item.what}
                        {item.due && (
                          <>
                            {" "}
                            {/* The date in the model's own words — "28th",
                                "next Tuesday" — never reformatted into a date
                                the meeting did not say. */}
                            <span className="rounded-full bg-[var(--surface-raised)] px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink">
                              {item.due}
                            </span>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Tasks assigned and Action items were two separate sections here.
          Both are inside Needs action above, with the deadlines the page never
          used to show at all — see the note on it. */}

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
