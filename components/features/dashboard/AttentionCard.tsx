"use client";

import Link from "next/link";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { Card } from "./Card";
import { attentionSignals, interventionSignals, type Signal } from "./signals";
import {
  EmptyState,
  InlineError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";

/**
 * "Needs you" — the triage column.
 *
 * One row per kind of thing that is stuck on this person, ordered by
 * consequence and carrying the verb that clears it. Nothing here is a metric:
 * every row is a queue with a length, and every row leads somewhere that
 * shortens it.
 *
 * The lens changes the question, not the layout. An individual is asked what is
 * waiting on them; a manager is asked where they personally have to step in —
 * which is a different list, computed differently, and not the same rows with
 * the word "team" in front of them.
 */
export function AttentionCard() {
  const { lens } = useLens();
  const team = lens === "team";

  const viewerId = useViewerId();
  const tasks = useQuery(
    (r) =>
      r
        .listTasks({ scope: team ? "team" : "mine", sort: "rank" })
        .then((p) => p.items),
    [team],
  );
  const conflicts = useQuery(
    /* Keyed on `viewerId` — null on first render, so empty deps queried "" and
       never re-ran once the id resolved. */
    (r) => r.listPriorityConflicts(viewerId ?? ""),
    [viewerId],
  );
  const reviews = useQuery((r) => r.listReviewQueue(), []);
  const projects = useQuery(
    (r) =>
      r
        .listProjects({ status: ["active", "planning"], sort: "health" })
        .then((p) => p.items),
    [],
  );
  const notifications = useQuery((r) => r.listNotifications(), []);

  const loading = tasks.isLoading || conflicts.isLoading || reviews.isLoading;
  /* "Nothing needs you" and "we could not find out" are opposite messages, and
     only one of them lets someone stop looking. */
  const failure = tasks.error ?? conflicts.error ?? reviews.error;

  const signals: Signal[] = loading
    ? []
    : team
      ? interventionSignals({
          viewerId: viewerId ?? "",
          tasks: tasks.data ?? [],
          reviewQueue: reviews.data ?? [],
          conflicts: conflicts.data ?? [],
        })
      : attentionSignals({
          viewerId: viewerId ?? "",
          tasks: tasks.data ?? [],
          conflicts: conflicts.data ?? [],
          reviewQueue: reviews.data ?? [],
          projects: projects.data ?? [],
          notifications: notifications.data ?? [],
        });

  const critical = signals.filter((s) => s.urgency === "critical").length;

  return (
    <Card
      title={team ? "Where to step in" : "Needs you"}
      href="/tasks?view=tasks"
      hrefLabel="Open tasks"
      padded={false}
      className="min-w-0"
      headerRight={
        critical > 0 ? (
          <span
            data-figure
            className="rounded-full bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--state-overdue-ink)]"
          >
            {critical} urgent
          </span>
        ) : null
      }
    >
      {loading ? (
        <div className="px-5">
          <SkeletonRows rows={4} />
        </div>
      ) : failure ? (
        <div className="px-5 pb-1">
          <InlineError
            compact
            message="This list could not be loaded, so it is not safe to read it as empty."
            code={failure}
            onRetry={() => {
              tasks.refetch();
              conflicts.refetch();
              reviews.refetch();
            }}
          />
        </div>
      ) : signals.length === 0 ? (
        <div className="px-5">
          <EmptyState
            compact
            title={team ? "Nothing needs you" : "You are clear"}
            body={
              team
                ? "No blocked work, no approvals and no conflicts waiting on you."
                : "Nothing is blocked, overdue or waiting on a decision from you."
            }
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-hairline">
            {signals.slice(0, 4).map((s) => (
              <SignalRow key={s.id} signal={s} />
            ))}
          </ul>
          {signals.length > 4 && (
            /* Capped at five. The reference's tall card holds a fixed number of
               objects and then points onward; an unbounded list would grow the
               right-hand column past the composition it sits in. */
            <Link
              href="/tasks?view=tasks"
              className="block border-t border-hairline px-5 py-2.5 text-[11px] text-ink-faint transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
            >
              <span data-figure>{signals.length - 4}</span> more waiting — open
              the task list
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * One signal.
 *
 * The whole row is the target — a triage list is read by pointing at the line
 * you mean, not by hunting for a small link at the end of it. Colour appears
 * only on the critical tier, so it stays meaningful when it does.
 */
function SignalRow({ signal }: { signal: Signal }) {
  const critical = signal.urgency === "critical";

  return (
    <li>
      <Link
        href={signal.href}
        className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--row-hover)]"
      >
        <span
          data-figure
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ${
            critical
              ? "bg-[color-mix(in_srgb,var(--state-overdue)_22%,transparent)] text-[var(--state-overdue-ink)]"
              : "bg-[var(--control)] text-ink"
          }`}
        >
          {signal.count}
        </span>

        {/* Three lines, answering three questions: what is happening, which
            thing, and why it matters. The middle line used to be the whole
            row's context — a bare title that named the task and explained
            nothing about the cost of ignoring it. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink first-letter:uppercase">
            {signal.title ? (
              <>
                {signal.label}
                <span className="text-ink-muted">: {signal.title}</span>
              </>
            ) : (
              signal.label
            )}
          </span>
          {signal.detail && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
              {signal.detail}
            </span>
          )}
        </span>

        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors group-hover:bg-[var(--control)] group-hover:text-ink">
          {signal.action}
        </span>
      </Link>
    </li>
  );
}
