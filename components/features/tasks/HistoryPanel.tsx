"use client";

import {
  EmptyState,
  Panel,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";

/**
 * The task event stream.
 *
 * One append-only sequence, replacing the seven separate history array shapes
 * legacy scattered across the task document plus system chat messages.
 */
export function HistoryPanel({ taskId }: { taskId: string }) {
  const events = useQuery((r) => r.listTaskEvents(taskId), [taskId]);
  const { data, isLoading } = events;
  const priority = useQuery((r) => r.listPriorityChanges(taskId), [taskId]);
  /**
   * **Every move of the deadline, and why.**
   *
   * The engine keeps no task event log — `listTaskEvents` refuses outright and
   * says so, pointing at the deadline history instead. So against the real
   * backend this panel showed "This history could not be loaded." and nothing
   * else, and the one question people bring to it — *why is this due later than
   * we agreed?* — had no answer anywhere in the product.
   *
   * These rows carry the date before, the reason and the date after, whether
   * the move was a negotiated extension or the absence rule applying itself.
   */
  const deadlines = useQuery(
    (r) => r.listDeadlineExtensionRecords(taskId),
    [taskId],
  );

  if (isLoading) return <SkeletonRows rows={6} />;
  /* A refused event log is not a failure of this panel — it is this engine
     saying it has no such thing. Only report an error when NOTHING could be
     read; otherwise show what there is. */
  if (events.error && deadlines.error && priority.error)
    return (
      <QueryError
        queries={[events]}
        message="This history could not be loaded."
      />
    );

  const merged = [
    ...(data ?? []).map((e) => ({
      id: e.id,
      at: e.occurredAt,
      actor: e.actorLabel,
      summary: e.summary,
      kind: e.type as string,
    })),
    ...(priority.data ?? []).map((p) => ({
      id: p.id,
      at: p.changedAt,
      actor: "Priority",
      summary: `P${p.previousRank} → P${p.newRank} — ${p.reason}`,
      kind: "priority_changed",
    })),
    /* Read as one line: what it was, why it moved, what it is now. Only
       APPROVED rows appear — a request that was declined or is still open moved
       nothing, and listing it here would read as though it had. */
    ...(deadlines.data ?? [])
      .filter((d) => d.status === "approved")
      .map((d) => ({
        id: d.id,
        at: d.approvedAt ?? d.createdAt ?? "",
        actor: "Deadline",
        summary: `${
          d.previousDeadline ? formatDateTime(d.previousDeadline) : "—"
        } → ${d.reason ?? "moved"} → ${formatDateTime(d.proposedDeadline)}`,
        kind: "deadline_change_decided",
      }))
      .filter((r) => r.at !== ""),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Panel padded={false}>
      <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
        <h2 className="text-sm font-medium text-ink">Activity</h2>
        <span data-figure className="text-xs text-ink-faint">
          {merged.length}
        </span>
      </div>
      {!merged.length ? (
        <EmptyState compact title="No activity yet" />
      ) : (
        <ol className="divide-y divide-hairline">
          {merged.map((e) => (
            <li key={e.id} className="flex gap-3 px-5 py-2.5">
              {/* A timeline rail, not a bullet list — the sequence is the point. */}
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--control-active)]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{e.summary}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {e.actor} · {formatDateTime(e.at)} ·{" "}
                  <span className="opacity-70">
                    {e.kind.replace(/_/g, " ")}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
