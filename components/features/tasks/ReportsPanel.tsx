"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EmptyState,
  Meter,
  Panel,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDate, formatDuration } from "@/lib/utils/format";
import {
  ReportComposer,
  type ReportDraft,
} from "@/components/features/reports/ReportComposer";
import { istDayKey, hasReportFor, workedToday } from "@/lib/rules/tasks/dailyReport";
import type { TaskView } from "@/lib/repositories";

/**
 * Daily reports on one task.
 *
 * Progress written down while the work is still running, as distinct from the
 * submission, which is the work being handed over.
 *
 * **A report can be filed from here, but only when one is actually owed.** The
 * rule is the same one the end-of-day flow applies: a report is owed on a task
 * the timer ran on today and has not yet been reported on. So this panel is
 * read-only on a task nobody worked today, and read-only again the moment the
 * report is in — it never offers a form for a report the product would not
 * have asked for. That is why the pending card and the modal share both the
 * rule (`isReportPending`) and the control (`ReportComposer`).
 */
export function ReportsPanel({ view }: { view: TaskView }) {
  const taskId = view.task.id;
  const viewerId = useViewerId();
  const repo = useRepo();
  /* `useLiveNow`, not `useNow` — `useNow` floors to the current MINUTE for
     coarse relative-time labels, always at or behind the real instant. A
     timer started a few seconds ago (within this same minute) would then
     compute a NEGATIVE elapsed against it, and `workedToday` drops anything
     non-positive: a task played moments ago would not show as worked until
     the minute rolled over. See lib/hooks/useLiveNow.ts. */
  const nowMs = useLiveNow();
  const today = istDayKey(nowMs);

  const reports = useQuery((r) => r.listDailyReports(taskId), [taskId]);
  /* The same two sources the modal reads: banked commits, and a timer that is
     still running and has therefore banked nothing yet. */
  const commits = useQuery((r) => r.listDayCommits(today), [today]);
  const timers = useQuery((r) => r.listTimers(), []);

  const worked = useMemo(
    () =>
      workedToday(
        commits.data ?? [],
        (timers.data ?? []) as Parameters<typeof workedToday>[1],
        nowMs,
      ),
    [commits.data, timers.data, nowMs],
  );
  const workedThis = worked.find((w) => w.taskId === taskId) ?? null;

  const alreadyFiled = hasReportFor(
    reports.data ?? [],
    String(viewerId ?? ""),
    today,
  );
  const pending = Boolean(viewerId) && workedThis !== null && !alreadyFiled;

  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Seeded once. Re-firing on every repository version bump — which a timer
     heartbeat causes — would wipe whatever had been typed. */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !pending || !workedThis) return;
    seeded.current = true;
    setDraft({
      taskId,
      taskTitle: workedThis.taskTitle || view.task.title,
      totalSecs: workedThis.totalSecs,
      message: "",
      progressPercent: 50,
      attachments: [],
      documentId: null,
      documentTitle: null,
    });
  }, [pending, workedThis, taskId, view.task.title]);

  async function submit() {
    if (!draft) return;
    setSubmitting(true);
    setError(null);
    const r = await repo.submitDailyReport({
      taskId,
      message: draft.message.trim(),
      progressPercent: draft.progressPercent,
      attachmentIds: draft.attachments.map((a) => a.url),
      attachments: draft.attachments,
      documentId: draft.documentId,
      documentTitle: draft.documentTitle,
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    /* The list re-reads on its own — every mutation bumps the repository
       version — and the pending card falls away because the rule that put it
       there is no longer true. */
    setDraft(null);
    seeded.current = false;
  }

  if (reports.isLoading) return <SkeletonRows rows={4} />;
  if (reports.error)
    return (
      <QueryError
        queries={[reports]}
        message="These reports could not be loaded."
      />
    );

  /* Newest first: the last thing said about this task is the thing being
     looked for. */
  const rows = [...(reports.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  /* Names come from the people already on the task rather than a second read.
     Anyone not among them — somebody who reported before being taken off it —
     is left unnamed rather than shown as a record identifier, which tells the
     reader nothing they can act on. */
  const people = new Map(
    [...view.assignees, ...(view.owner ? [view.owner] : [])].map((p) => [
      p.id,
      p,
    ]),
  );

  const canSubmit = Boolean(draft?.message.trim() || draft?.documentId);

  return (
    <div className="space-y-4">
      {/* ── Owed today ─────────────────────────────────────────────
          Only rendered when the timer actually ran on this task today and
          nothing has been filed since. */}
      {pending && draft && (
        <Panel padded={false}>
          <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--state-risk)]"
            />
            <h2 className="text-sm font-medium text-ink">Report pending</h2>
            <span className="text-[11px] text-ink-faint">
              {formatDuration(workedThis?.totalSecs ?? 0)} worked today
            </span>
          </div>

          <div className="p-4">
            <ReportComposer
              draft={draft}
              disabled={submitting}
              onChange={(next) =>
                setDraft((d) => (d ? { ...d, ...next } : d))
              }
            />
            {error && (
              <p
                role="alert"
                className="mt-2 text-[12px] text-[var(--state-overdue-ink)]"
              >
                {error}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={submitting || !canSubmit}
                onClick={() => void submit()}
                className="rounded-full bg-ink px-5 py-2 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Filed ──────────────────────────────────────────────── */}
      <Panel padded={false}>
        <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">Daily reports</h2>
          <span data-figure className="text-xs text-ink-faint">
            {rows.length}
          </span>
        </div>

        {!rows.length ? (
          <EmptyState
            compact
            title="No daily reports yet"
            body="A report is written at the end of a day, when you go offline: Cowork lists the tasks your timer ran on and asks what you got done and how far along it is. Anything filed against this task appears here."
          />
        ) : (
          <ol className="divide-y divide-hairline">
            {rows.map((r) => {
              const who = people.get(r.employeeId);
              return (
                <li key={r.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    {who && (
                      <Avatar
                        initials={who.initials}
                        hue={who.hue}
                        src={who.profilePictureUrl}
                        name={who.displayName}
                        size="sm"
                      />
                    )}
                    <span className="truncate text-sm text-ink">
                      {who?.displayName ?? "Daily report"}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {formatDate(r.reportDate)}
                    </span>
                    <span
                      data-figure
                      className="ml-auto shrink-0 text-xs text-ink"
                    >
                      {r.progressPercent}%
                    </span>
                  </div>

                  {/* The figure and the bar say the same thing, deliberately:
                      the number is the fact, the bar is how a column of them
                      reads at a glance. */}
                  <Meter
                    className="mt-2"
                    value={r.progressPercent}
                    label={`Progress reported on ${r.reportDate}`}
                  />

                  {r.message && (
                    <p className="mt-2 max-w-[68ch] text-sm text-ink-muted">
                      {r.message}
                    </p>
                  )}

                  {/* The document written as the long form of this report. */}
                  {r.documentId && (
                    <a
                      href="/workspace"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-black/6 px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-black/10 dark:bg-white/8 dark:hover:bg-white/12"
                    >
                      <Icon.overview className="h-3 w-3 shrink-0" />
                      <span className="max-w-[280px] truncate">
                        {r.documentTitle ?? "Document"}
                      </span>
                    </a>
                  )}

                  {/* Named and openable. These were counted before, which told
                      the reader a number and nothing about what the files
                      were. */}
                  {r.attachments.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {r.attachments.map((a) => (
                        <li key={a.url}>
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-lg bg-black/6 px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-black/10 dark:bg-white/8 dark:hover:bg-white/12"
                          >
                            <Icon.attach className="h-3 w-3 shrink-0" />
                            <span className="max-w-[180px] truncate">
                              {a.name}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
