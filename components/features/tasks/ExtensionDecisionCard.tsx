"use client";

import { useEffect, useState } from "react";
import { Button, Field, InlineError, Panel, Textarea } from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { mayDecideBudgetEvent } from "@/lib/rules/tasks/extensionTimeline";
import {
  hierarchyKind,
  needsDeadlineEscalation,
} from "@/lib/rules/tasks/extensionActions";
import { deadlineExtension } from "@/lib/rules/tasks/extensionRecords";
import { routeExtensionRequest, type ExtensionRoute } from "@/lib/rules/tasks/extensionRouting";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * The manager's decision on an assignee's request for more time.
 *
 * **Hours first, and only then a date.** An assignee asking for two more hours
 * used to send a DATE proposal straight to the assignor — a question about one
 * person's week reaching somebody who cannot see it, while the manager who
 * could was not asked at all.
 *
 * So this card asks the manager's question: *if I give them these hours at this
 * queue position, do they still finish before the date that was committed?*
 * Usually the answer is yes, and then nobody's commitment moves — which is the
 * whole reason for asking in this order.
 *
 * **Nothing here decides.** The verdict comes from
 * `previewDeadlineFeasibility` — the same engine as the planner and the
 * operational due date — and `routeExtensionRequest` reads that verdict. The
 * component chooses which of two buttons to show and nothing else, so a screen
 * cannot offer a route the rule would refuse.
 */

export function ExtensionDecisionCard({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const repo = useRepo();
  const [route, setRoute] = useState<ExtensionRoute | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState("");

  /* The pending HOURS request, from its own store. `openProposal` is the
     deadline negotiation and is a different conversation. */
  const pending = useQuery((r) => r.listTimeBudgetExtensions(view.task.id), [
    view.task.id,
  ]);
  /* **`counter_proposed` too.** The assignee asking again is still the manager's
     move, and reading only `pending` is what made the loop one-way: a second
     round arrived and this card did not render for it. */
  const record =
    pending.data?.find(
      (r) => r.status === "pending" || r.status === "counter_proposed",
    ) ?? null;
  /* The person who will do the work. A held cross-department task keeps them
     in `pendingAssignees` until the handover. */
  const subject = view.assignees[0] ?? view.pendingAssignees[0] ?? null;
  /* Hours are the primary manager's call — never a department lead, and never
     the assignor. The repository resolves this from HR. */
  /* The record names its own approver — resolved from HR when the request was
     made — so the control cannot be offered to somebody the write would then
     refuse. */
  const mayDecide = mayDecideBudgetEvent({
    viewerId,
    record: record ?? { approverId: null, status: "pending" },
  });

  const previousSecs = record?.previousBudgetSecs ?? 0;
  const addedSecs = record?.requestedAdditionalSecs ?? 0;
  const requestedTotal = record?.newBudgetSecs ?? previousSecs + addedSecs;
  const committed = view.task.deadline.dueAt;

  /* Internal or cross-department, decided by comparing the two owners rather
     than by a department field. A task assigned inside one department to
     somebody whose manager sits elsewhere is still two people. */
  const kind = hierarchyKind({
    assignorId: view.owner?.id ?? null,
    primaryManagerId: record?.approverId ?? view.budgetOwner?.id ?? null,
  });

  useEffect(() => {
    if (!record || !subject || addedSecs <= 0) return;
    let cancelled = false;
    void repo
      .previewDeadlineFeasibility({
        taskId: view.task.id,
        employeeId: subject.id,
        /* At the REQUESTED budget and wherever the task already sits — the
           question is whether the extra hours fit, not where to put it. */
        estimatedWorkSeconds: requestedTotal,
        committedDeadline: committed,
      })
      .then((f) => {
        if (cancelled) return;
        setRoute(
          routeExtensionRequest({
            feasibility: f,
            previousWindowSecs: previousSecs,
            addedSecs,
          }),
        );
      })
      .catch(() => {
        /* A verdict that cannot be computed must not become a silent
           "approve" — the card says so and offers neither route. */
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, view.task.id, subject, requestedTotal, previousSecs, addedSecs, committed, record]);

  /*
   * **Through the RECORD, not straight to the task.**
   *
   * This called `setEffortEstimate` directly, so the budget moved while the
   * request that asked for it stayed `pending` for ever — the audit trail said
   * nobody had decided anything. The record is the source of truth for what was
   * asked and what was answered; the task's budget is a consequence of it.
   *
   * `decideTimeBudgetExtension` writes the status and then raises the budget
   * through legacy's own endpoint. The queue, the operational due date and
   * every preview recompute from that on the next read — none of them is
   * updated here, because none of them is stored.
   */
  const [decide, decideState] = useAction(
    (r, decision: "approved" | "rejected", grantedSecs?: number) =>
      r.decideTimeBudgetExtension(record!.id, decision, {
        reason: reason || undefined,
        ...(grantedSecs !== undefined ? { grantedSecs } : {}),
      }),
  );
  /*
   * The escalation carries DATES ONLY.
   *
   * It used to send `additionalSecs` and `previousWindowSecs` — the hours from
   * the other conversation, riding along into one they have no part in. An
   * assignor shown "+2 hours" beside a deadline will eventually add the two,
   * and that answer is always wrong: the work sits behind other work and runs
   * through an office calendar, so two extra hours of budget can move a
   * completion by a day or by nothing.
   *
   * `deadlineExtension()` has nowhere to put a duration, which is the point.
   */
  const [escalate, escalateState] = useAction((r, fromMs: number) => {
    const rec = deadlineExtension({
      previousDeadline: committed,
      proposedDeadline: route?.proposedDeadline ?? new Date(fromMs).toISOString(),
      reason:
        reason ||
        "Additional time is required to complete this task. This is the earliest achievable completion from the assignee’s current workload.",
    });
    /* The typed collection, not `deadlineExtRequest`. The old record was
       shared with the hours conversation and had one status for both. */
    return r.requestDeadlineExtensionRecord({
      taskId: view.task.id,
      proposedDeadline: rec.proposedDeadline,
      reason: rec.reason ?? undefined,
    });
  });

  if (!record || addedSecs <= 0 || !subject) return null;

  const needsEscalation = needsDeadlineEscalation({
    kind,
    feasible: route?.outcome === "approve_budget",
  });
  const busy = decideState.isPending || escalateState.isPending;
  const error = decideState.error ?? escalateState.error;

  return (
    <Panel data-help="extension-decision">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Extra time requested
      </p>
      <p className="mt-1 text-sm text-ink">
        {subject.displayName} requested{" "}
        <span data-figure className="text-ink">
          +{formatDurationTimer(addedSecs)}
        </span>
      </p>

      {/* The arithmetic, spelled out. A total alone cannot answer "how much
          more?", which is the question the decision turns on. */}
      <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1">
        <div>
          <dt className="text-[11px] text-ink-faint">Current budget</dt>
          <dd data-figure className="text-[13px] text-ink-muted">
            {formatDurationTimer(previousSecs)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Requested</dt>
          <dd data-figure className="text-[13px] text-ink">
            {formatDurationTimer(requestedTotal)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Committed deadline</dt>
          <dd data-figure className="text-[13px] text-ink-muted">
            {committed ? formatStamp(committed) : "None"}
          </dd>
        </div>
      </dl>

      {record.reason && (
        <p className="mt-2 text-[12px] text-ink-muted">“{record.reason}”</p>
      )}

      {failed ? (
        <p className="mt-3 text-[12px] text-ink-faint">
          The workload check is unavailable, so whether this fits the deadline is
          not known. Nothing can be decided from here until it can be computed.
        </p>
      ) : !route ? (
        <p className="mt-3 text-[12px] text-ink-faint">
          Working out whether this fits {subject.displayName}’s queue…
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
            <p className="text-[11px] text-ink-faint">
              At {formatDurationTimer(requestedTotal)}, from{" "}
              {subject.displayName}’s real queue
            </p>
            <p className="mt-1 text-sm text-ink">
              <span data-figure>
                {route.earliestCompletion
                  ? formatStamp(route.earliestCompletion)
                  : "—"}
              </span>
            </p>
            <p
              className={`mt-1 text-[12px] ${
                route.outcome === "approve_budget"
                  ? "text-ink-faint"
                  : "text-[var(--danger,#c4553d)]"
              }`}
            >
              {route.outcome === "approve_budget" && "✓ Fits the committed deadline"}
              {route.outcome === "escalate_deadline" &&
                `⚠ Misses it by ${formatDurationTimer(Math.abs(route.bufferSeconds ?? 0))}`}
              {route.outcome === "unknown" && "Not measurable"}
            </p>
            <p className="mt-1.5 text-[12px] text-ink-muted">{route.explanation}</p>
          </div>

          {error && (
            <div className="mt-3">
              <InlineError message={error} />
            </div>
          )}

          {!mayDecide ? (
            /* Said plainly rather than shown as disabled buttons, which read as
               "you may do this" and then refuse. */
            <p className="mt-3 text-[12px] text-ink-muted">
              {view.budgetOwner
                ? `${view.budgetOwner.displayName} decides the hours for this work.`
                : "The assignee’s manager decides the hours for this work."}
            </p>
          ) : route.outcome === "approve_budget" ? (
            <div className="mt-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="primary"
                  size="sm"
                  disabled={busy}
                  data-help="extension-grant-budget"
                  onClick={async () => {
                    const r = await decide("approved");
                    if (r.ok) onChange();
                  }}
                >
                  Approve {formatDurationTimer(requestedTotal)} budget
                </Button>
                {/* Refusing is a real answer and belongs beside granting.
                    Without it the only way to say no was to ignore the
                    request, which leaves it pending for ever. */}
                <Button
                  size="sm"
                  disabled={busy}
                  data-help="extension-reject-budget"
                  onClick={async () => {
                    const r = await decide("rejected");
                    if (r.ok) onChange();
                  }}
                >
                  Decline
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                The deadline does not move either way. Declining leaves the
                budget, the queue and the dates exactly as they are.
              </p>
            </div>
          ) : route.outcome === "escalate_deadline" && !needsEscalation ? (
            /*
             * INTERNAL: the assignee's manager IS the assignor, so there is
             * nobody to escalate to. Sending a request here would have Rakesh
             * asking Rakesh — the loop that left the task "waiting" for
             * somebody with nothing to do.
             *
             * One person owns both decisions, so they make both in one step:
             * the hours are granted and the commitment moves to what the queue
             * can actually deliver.
             */
            <div className="mt-3">
              <Button
                tone="primary"
                size="sm"
                disabled={busy}
                data-help="extension-grant-both"
                onClick={async () => {
                  const granted = await decide("approved");
                  if (!granted.ok) return;
                  await escalate(Date.now());
                  onChange();
                }}
              >
                Approve {formatDurationTimer(requestedTotal)} and move the
                deadline
              </Button>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                You set the hours and you own the deadline on this task, so both
                are yours to decide. The new date is{" "}
                {route.proposedDeadline
                  ? formatStamp(route.proposedDeadline)
                  : "the earliest the queue can deliver"}
                .
              </p>
            </div>
          ) : route.outcome === "escalate_deadline" ? (
            <div className="mt-3">
              <Field
                label="What should the assignor be told?"
                hint="Sent with the request. A default is used if you leave this empty."
              >
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="mt-2">
                <Button
                  tone="primary"
                  size="sm"
                  disabled={busy}
                  data-help="extension-escalate-deadline"
                  onClick={async () => {
                    const r = await escalate(Date.now());
                    if (r.ok) onChange();
                  }}
                >
                  Ask for{" "}
                  {route.proposedDeadline
                    ? formatStamp(route.proposedDeadline)
                    : "a new deadline"}
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Moving the date is the assignor’s decision, so it is asked for
                rather than granted. The hours are not changed until they answer.
              </p>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
