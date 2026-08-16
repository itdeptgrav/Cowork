"use client";

import { useState } from "react";
import { Panel, SkeletonRows } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import {
  describeEvent,
  extensionTimeline,
  isBudgetEvent,
  visibleTo,
  type ExtensionEvent,
} from "@/lib/rules/tasks/extensionTimeline";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * Both extension conversations, in the order they happened.
 *
 * **Merged in time, never in substance.** A reader wants one account — asked at
 * 10:00, granted at 10:15, escalated at 11:00 — and chronology is the only
 * thing the two systems share. Each row speaks its own unit: an hours row shows
 * a budget and no date, a date row shows a deadline and no hours.
 *
 * That is enforced by the types rather than by this file being careful. A
 * `BudgetEvent` has nowhere to put a deadline, so no amount of editing here can
 * put one on screen — which matters, because a deadline shown beside "+2 hours"
 * invites the `oldDeadline + hours` sum that is always wrong.
 *
 * **What the assignor sees is narrower.** `visibleTo` keeps the hours to the
 * reporting line. Not because they are secret — because they are not the
 * assignor's decision, and showing them invites exactly that sum.
 */

function BudgetRow({
  event,
  nameOf,
}: {
  event: Extract<ExtensionEvent, { unit: "hours" }>;
  nameOf: (id: string) => string;
}) {
  return (
    <>
      <p data-figure className="mt-0.5 text-[13px] text-ink">
        {formatDurationTimer(event.previousBudgetSecs)} →{" "}
        {formatDurationTimer(event.newBudgetSecs)}
      </p>
      {event.kind === "budget_approved" && (
        <p className="text-[11px] text-ink-faint">Budget updated</p>
      )}
      {event.waitingOnId && (
        <p className="text-[11px] text-ink-faint">
          {nameOf(event.waitingOnId)} needs to review the request for additional
          working time
        </p>
      )}
    </>
  );
}

function DeadlineRow({
  event,
  nameOf,
}: {
  event: Extract<ExtensionEvent, { unit: "date" }>;
  nameOf: (id: string) => string;
}) {
  return (
    <>
      <dl className="mt-0.5 flex flex-wrap gap-x-5 gap-y-0.5">
        {event.previousDeadline && (
          <div>
            <dt className="text-[11px] text-ink-faint">Current</dt>
            <dd data-figure className="text-[13px] text-ink-muted">
              {formatStamp(event.previousDeadline)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-[11px] text-ink-faint">
            {event.kind === "deadline_approved" ? "Updated to" : "Proposed"}
          </dt>
          <dd data-figure className="text-[13px] text-ink">
            {formatStamp(event.proposedDeadline)}
          </dd>
        </div>
      </dl>
      {/* The action, not just the name. "Waiting for Umung" tells a reader
          somebody is blocking them and not what that person must do — and says
          nothing at all to Umung, who is often the one reading it. */}
      {event.waitingOnId && (
        <p className="text-[11px] text-ink-faint">
          {nameOf(event.waitingOnId)} needs to{" "}
          {event.kind === "deadline_counter_proposed"
            ? "accept the revised deadline"
            : "approve the revised deadline"}
        </p>
      )}
    </>
  );
}

export function ExtensionTimeline({
  view,
  viewerId,
}: {
  view: TaskView;
  viewerId: string | null;
}) {
  const taskId = view.task.id;
  /* Closed until asked for — see the header button below. */
  const [open, setOpen] = useState(false);
  const budget = useQuery((r) => r.listTimeBudgetExtensions(taskId), [taskId]);
  const dates = useQuery((r) => r.listDeadlineExtensionRecords(taskId), [taskId]);

  const nameOf = (id: string) =>
    view.assignees.find((a) => a.id === id)?.displayName ??
    view.pendingAssignees.find((a) => a.id === id)?.displayName ??
    (view.owner?.id === id ? view.owner.displayName : null) ??
    (view.budgetOwner?.id === id ? view.budgetOwner.displayName : null) ??
    id;

  if (budget.isLoading || dates.isLoading) return <SkeletonRows rows={3} />;

  const all = extensionTimeline({
    budget: budget.data ?? [],
    deadline: dates.data ?? [],
  });

  /* The reporting line sees the hours; the assignor sees only the dates. The
     rule decides, not this component — a screen that filtered for itself is
     how one surface came to disagree with another about who may see what. */
  const events = visibleTo(all, {
    id: viewerId,
    inReportingLine:
      viewerId !== null &&
      (view.assignees.some((a) => a.id === viewerId) ||
        view.pendingAssignees.some((a) => a.id === viewerId) ||
        view.budgetOwner?.id === viewerId),
    isAssignor: viewerId !== null && view.owner?.id === viewerId,
  });

  if (events.length === 0) return null;

  return (
    <Panel data-help="extension-timeline">
      {/* Collapsed by default, by the owner's choice: the history matters when
          it is looked for and is noise the rest of the time. The count keeps
          the closed state honest about what it is hiding. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Extension history
        </p>
        <span data-figure className="text-[11px] text-ink-faint">
          {events.length}
        </span>
        <span aria-hidden className="ml-auto text-[11px] text-ink-faint">
          {open ? "Hide ▴" : "Show ▾"}
        </span>
      </button>

      {open && (
      <ol className="mt-2 divide-y divide-hairline">
        {events.map((e) => (
          <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              {/* The unit, named. Two conversations on one list need telling
                  apart at a glance, not by reading the figures. */}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tracking-[0.06em] uppercase ${
                  isBudgetEvent(e)
                    ? "bg-[var(--control)] text-ink-muted"
                    : "bg-ink/10 text-ink-muted"
                }`}
              >
                {isBudgetEvent(e) ? "Time budget" : "Deadline"}
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-ink">
                {describeEvent(e, nameOf)}
              </span>
              {e.at && (
                <span data-figure className="text-[11px] text-ink-faint">
                  {formatStamp(e.at)}
                </span>
              )}
            </div>

            <div className="mt-0.5 pl-[calc(4.5rem)]">
              {isBudgetEvent(e) ? (
                <BudgetRow event={e} nameOf={nameOf} />
              ) : (
                <DeadlineRow event={e} nameOf={nameOf} />
              )}
              {e.reason && (
                <p className="mt-1 text-[12px] text-ink-muted">“{e.reason}”</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      )}
    </Panel>
  );
}
