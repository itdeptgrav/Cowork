"use client";

import {
  EmptyState,
  Meter,
  Panel,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDate } from "@/lib/utils/format";
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

  const reports = useQuery((r) => r.listDailyReports(taskId), [taskId]);

  /* The worked-today and already-filed reads went with the composer — this
     panel no longer decides whether a report is owed, only lists the ones
     that were filed. */




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


  return (
    <div className="space-y-4">
      {/* **The composer has moved to the Submission tab.**
          A daily report and a submission are two outcomes of one act — you
          write what you did and attach the evidence — so they share one
          composer there, with a button each. This panel is the log: what was
          filed, when, and how long was worked. Nothing is written from here.

          The pending card that used to sit above the list, and the draft,
          timer and commit reads behind it, went with the composer. */}

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
