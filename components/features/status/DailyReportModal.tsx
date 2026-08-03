"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import { Icon } from "@/components/ui/Icons";
import {
  ReportComposer,
  type ReportDraft,
} from "@/components/features/reports/ReportComposer";
import { istDayKey, workedToday } from "@/lib/rules/tasks/dailyReport";

/**
 * The end-of-day report.
 *
 * Opened two ways, and the difference is only in what pressing the button
 * afterwards means. Going **offline** routes through here first, because the
 * account of a day is owed before the day is closed. But a report is not the
 * property of the going-offline flow — it can be written at any point from the
 * status menu, and then `onComplete` simply closes it.
 *
 * Every task the timer ran on today gets its own card: its own note, its own
 * files, its own document, its own progress. One report per task, because a
 * task is the unit the work was tracked against and the unit it is read back
 * on.
 */
export function DailyReportModal({
  onComplete,
  mode = "offline",
}: {
  onComplete: () => void;
  /** `offline` — the caller goes offline afterwards. `standalone` — it closes. */
  mode?: "offline" | "standalone";
}) {
  /* `useLiveNow`, not `useNow` — `useNow` floors to the current MINUTE for
     coarse relative-time labels, which makes it always at or behind the real
     instant. A timer that started a few seconds ago (within this same
     minute) would then compute `nowMs - startedAtRealMs` as NEGATIVE, and
     `workedToday` drops anything non-positive — a task played moments ago
     would not appear until the minute rolled over. Reading Date.now() during
     render is impure; `useLiveNow` is a ticking clock in state, following the
     same pattern as `useTicker` in TimerControl.tsx. */
  const nowMs = useLiveNow();
  const today = istDayKey(nowMs);
  const commits = useQuery((r) => r.listDayCommits(today), [today]);
  const timers = useQuery((r) => r.listTimers(), []);
  const repo = useRepo();

  /* The parent re-renders on its own clock, handing us a new inline callback
     each time. Held in a ref so no effect has to depend on it. */
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  const worked = useMemo(
    () =>
      workedToday(
        commits.data ?? [],
        (timers.data ?? []) as Parameters<typeof workedToday>[1],
        nowMs,
      ),
    [commits.data, timers.data, nowMs],
  );

  const [drafts, setDrafts] = useState<ReportDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Seeded once, from the first settled read. A timer heartbeat bumps the
     repository version and re-fires both queries — without this guard that
     would wipe every note the person had typed. */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || commits.isLoading || timers.isLoading) return;
    seeded.current = true;
    setDrafts(
      worked.map((w) => ({
        taskId: w.taskId,
        taskTitle: w.taskTitle,
        totalSecs: w.totalSecs,
        message: "",
        progressPercent: 50,
        attachments: [],
        documentId: null,
        documentTitle: null,
      })),
    );
  }, [commits.isLoading, timers.isLoading, worked]);

  function patch(taskId: string, next: Partial<ReportDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.taskId === taskId ? { ...d, ...next } : d)),
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    /* Only cards that actually say something. A person who wrote up two of
       three tasks files two reports — the third is not padded with an empty
       one just to make the loop uniform. */
    const filled = drafts.filter((d) => d.message.trim() || d.documentId);
    const results = await Promise.all(
      filled.map((d) =>
        repo.submitDailyReport({
          taskId: d.taskId,
          message: d.message.trim(),
          progressPercent: d.progressPercent,
          attachmentIds: d.attachments.map((a) => a.url),
          attachments: d.attachments,
          documentId: d.documentId,
          documentTitle: d.documentTitle,
        }),
      ),
    );

    /* A failure used to be swallowed — `allSettled`, no check, straight to
       offline. So a report that never saved looked exactly like one that did.
       It is said out loud now, and the person stays on this screen. */
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) {
      setSubmitting(false);
      setError(failed.message);
      return;
    }
    onCompleteRef.current();
  }

  const isLoading = commits.isLoading || timers.isLoading;
  const isEmpty = !isLoading && drafts.length === 0;
  const canSubmit = drafts.some((d) => d.message.trim() || d.documentId);

  return (
    <div className="fixed inset-0 z-[98] flex items-start justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-sm">
      <div
        className="frost-panel flex w-full max-w-[640px] flex-col overflow-hidden rounded-[22px] shadow-[0_28px_72px_rgba(0,0,0,0.45)]"
        style={{ maxHeight: "min(82vh, 760px)" }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-4 px-6 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/8 dark:bg-white/10">
            <Icon.clock className="h-5 w-5 text-ink-muted" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
              Daily report
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              {isLoading
                ? "Reading today's work…"
                : isEmpty
                  ? "No timer activity today"
                  : `${drafts.length} task${drafts.length !== 1 ? "s" : ""} worked today`}
            </p>
          </div>
          {mode === "standalone" && (
            <button
              type="button"
              onClick={() => onCompleteRef.current()}
              aria-label="Close"
              className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/8 hover:text-ink dark:hover:bg-white/10"
            >
              <Icon.close className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="shrink-0 border-t border-black/8 dark:border-white/8" />

        {/* ── One card per task ──────────────────────────────────── */}
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-faint border-t-ink-muted" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Icon.clock className="h-8 w-8 text-ink-faint opacity-40" />
              <p className="text-[13px] text-ink-faint">
                No timer ran today, so there is nothing to report on.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {drafts.map((d) => (
                <ReportComposer
                  key={d.taskId}
                  draft={d}
                  disabled={submitting}
                  onChange={(next) => patch(d.taskId, next)}
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="shrink-0 bg-[var(--state-overdue)] px-6 py-2 text-[12px] text-[var(--state-overdue-ink)]"
          >
            {error}
          </p>
        )}

        <div className="shrink-0 border-t border-black/8 dark:border-white/8" />

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={() => onCompleteRef.current()}
            className="rounded-full px-4 py-2 text-[13px] text-ink-faint transition-colors hover:bg-black/6 hover:text-ink disabled:opacity-40 dark:hover:bg-white/8"
          >
            {mode === "offline"
              ? isEmpty
                ? "Go offline"
                : "Skip & go offline"
              : "Close"}
          </button>
          {!isEmpty && (
            <button
              type="button"
              disabled={submitting || isLoading || !canSubmit}
              onClick={() => void submit()}
              className="rounded-full bg-ink px-5 py-2 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              {submitting
                ? "Submitting…"
                : mode === "offline"
                  ? "Submit & go offline"
                  : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
