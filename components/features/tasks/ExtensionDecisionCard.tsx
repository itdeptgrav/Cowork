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
import { formatDuration, formatStamp } from "@/lib/utils/format";
import { DurationField } from "./DurationField";
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
  /**
   * **The second choice, which this card never had.** OWNER DECISION, 17 Aug
   * 2026.
   *
   * The escalation branch offered one button — "Approve X and move the
   * deadline" — which granted the hours, filed a revised-date request and
   * approved it in a single press. The filed request rendered as
   * `DeadlineRevisionCard` for the instant before its own approval landed,
   * which is the card flashing on screen and vanishing that was reported.
   *
   * That card offers "Approve" AND "Propose another date"; this one offered
   * only the first, so a manager could accept the computed date and nothing
   * else. Granting LESS than was asked was unreachable from here — and the
   * message telling an assignee "granted +30m, not the +1h you asked for"
   * already exists in `BudgetConfirmationCard` and could therefore never
   * appear. The same two choices now live here, so the one-button step is
   * gone rather than followed by a second card.
   */
  const [countering, setCountering] = useState(false);
  /**
   * The addition the manager is granting, in seconds.
   *
   * **Hours AND minutes, not minutes alone.** A plain minutes box asks
   * somebody granting two hours to type 120, which is the same arithmetic the
   * rest of the product refuses to make people do — `DurationField` is the
   * control every other budget on this screen already uses.
   */
  const [grantSecs, setGrantSecs] = useState(0);

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
    record: record ?? { approverId: null, status: "pending", requestedBy: null },
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
        /* So the repository — the only layer with the office calendar — can
           answer where the deadline lands if this is granted. */
        grantedSecs: addedSecs,
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
      /* The date is the assignee's MANAGER's to move — the same person who owns
         the hours here — never the assignor. `record.approverId` is that manager,
         resolved from HR when the hours request was made. */
      approverId: record?.approverId ?? undefined,
    });
  });

  /**
   * The second half of "Approve X and move the deadline".
   *
   * `escalate` FILES the revised date; nothing approved it. The click granted
   * the hours, the deadline stayed put, the ⚠ misses-by warning stayed lit,
   * and the freshly filed request rendered as a second approval card back at
   * the same person — who owns both decisions and had just made them. Same
   * decide call the revision card uses, so no new rule is introduced: the one
   * owner simply answers their own record in the same press that raised it.
   */
  const [applyDate, applyDateState] = useAction((r, recordId: string) =>
    r.decideDeadlineExtension(recordId, "approved"),
  );

  /**
   * **Grant a different amount of time.**
   *
   * The first attempt at this filed a deadline record and then countered it,
   * which was wrong twice over: one press wrote two things, so the manager was
   * left facing a "revised deadline requested" card AND a "deadline revised"
   * card, both reading the same date on both sides — 15:00 → 15:00, a request
   * and its answer that differed in nothing.
   *
   * This card is about HOURS. Answering it with fewer hours is a decision on
   * the request in front of it, not a new conversation about dates: legacy
   * already carries the manager's own figure as `approvedSecs`, and the
   * assignee's confirmation card already reads it — "granted +30m, not the +1h
   * you asked for". That message existed and was unreachable, because this
   * card had no way to name a smaller figure. It has one now, and no record is
   * created to carry it.
   *
   * The deadline follows the budget, so a smaller grant produces an earlier
   * date without anybody proposing one.
   */
  const [grantLess, grantLessState] = useAction((r, grantedTotalSecs: number) =>
    r.decideTimeBudgetExtension(record!.id, "approved", {
      reason: reason || undefined,
      grantedSecs: grantedTotalSecs,
    }),
  );

  if (!record || addedSecs <= 0 || !subject) return null;

  const needsEscalation = needsDeadlineEscalation({
    kind,
    feasible: route?.outcome === "approve_budget",
  });
  const busy =
    decideState.isPending ||
    escalateState.isPending ||
    applyDateState.isPending ||
    grantLessState.isPending;
  const error =
    decideState.error ??
    escalateState.error ??
    applyDateState.error ??
    grantLessState.error;

  return (
    <Panel data-help="extension-decision">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Extra time requested
      </p>
      <p className="mt-1 text-sm text-ink">
        {subject.displayName} requested{" "}
        <span data-figure className="text-ink">
          +{formatDuration(addedSecs)}
        </span>
      </p>

      {/**
       * The arithmetic, spelled out. A total alone cannot answer "how much
       * more?", which is the question the decision turns on.
       *
       * The two time BUDGETS are labelled as hours and kept together; the
       * DEADLINE is a date and sits apart from them. They were three
       * equal-looking columns of `HH:MM:SS` and `9 Sep · 17:31 IST` before,
       * which is what made a seven-hour budget read as seven o'clock.
       */}
      {/**
       * **Before and after, on one line each.**
       *
       * Three separate columns — "Hours now", "Hours if granted", "Deadline" —
       * left the reader assembling the answer themselves: the amount asked for
       * was in the title, the budget in two of the columns, today's deadline in
       * the third, and the NEW deadline in a sentence further down. Reported
       * as "what is now deadline, what extra time asked, and after approved how
       * much it should be".
       *
       * Two rows answer all of it: what each thing is now, and what it becomes.
       */}
      {/**
       * **A real table, because three grids could not line up.**
       *
       * This was three sibling `grid-cols-[auto_1fr_1fr]` rows. Each computed
       * its OWN `auto` column: the header's first cell was empty so its column
       * was zero wide, "Hours" made a narrow one and "Deadline" a wide one — so
       * every row started its values at a different x. Reported as the padding
       * and alignment being wrong, and it was: sibling grids share no columns.
       *
       * A table shares them by construction, and the data is genuinely tabular
       * — two things, each with a before and an after — so the semantics are
       * right as well as the geometry. `w-full` with a content-width first
       * column keeps the two value columns equal.
       */}
      <div className="mt-2.5 overflow-hidden rounded-inset border border-hairline">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline">
              {/* Empty, but present: the row-label column needs a header cell
                  or the two value columns shift left by one. */}
              <th className="w-px px-3 py-1.5" />
              <th className="px-3 py-1.5 text-[11px] font-normal text-ink-faint">
                Now
              </th>
              <th className="px-3 py-1.5 text-[11px] font-normal text-ink-faint">
                If approved
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th
                scope="row"
                className="w-px px-3 py-2 text-[11px] font-normal whitespace-nowrap text-ink-faint"
              >
                Hours
              </th>
              <td data-figure className="px-3 py-2 text-[13px] text-ink-muted">
                {formatDuration(previousSecs)}
              </td>
              <td data-figure className="px-3 py-2 text-[13px] font-medium text-ink">
                {formatDuration(requestedTotal)}
                <span className="font-normal text-ink-faint">
                  {" "}
                  (+{formatDuration(addedSecs)})
                </span>
              </td>
            </tr>
            <tr className="border-t border-hairline">
              <th
                scope="row"
                className="w-px px-3 py-2 text-[11px] font-normal whitespace-nowrap text-ink-faint"
              >
                Deadline
              </th>
              <td data-figure className="px-3 py-2 text-[13px] text-ink-muted">
                {committed ? formatStamp(committed) : "None"}
              </td>
              <td data-figure className="px-3 py-2 text-[13px] font-medium text-ink">
                {/* Only an escalation moves it. When the hours fit, the
                    commitment stands — and saying so here is the whole point
                    of the row. */}
                {!route
                  ? "…"
                  : route.outcome === "escalate_deadline" && route.proposedDeadline
                    ? formatStamp(route.proposedDeadline)
                    : "unchanged"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
          {/**
           * **One conclusion, and the working folded away behind it.**
           *
           * This block grew until it said the same thing four times: the
           * queue's finish time, that finish measured against today's
           * deadline, the resolution once the deadline moves, and a sentence
           * restating all three — with the caption under the buttons saying it
           * a fifth time. Reported as "why show unnecessary data".
           *
           * The reader here decides two things: do they get the hours, and
           * does the deadline move. Everything else is HOW the card chose
           * which buttons to draw — real, worth keeping, and not a decision
           * input. So the conclusion is the line, and the arithmetic is one
           * press away for anybody who wants to check it.
           */}
          <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
            <p
              className={`text-[13px] ${
                route.outcome === "unknown"
                  ? "text-ink-muted"
                  : route.stillLateAfterMove
                    ? "text-[var(--danger,#c4553d)]"
                    : route.outcome === "approve_budget"
                      ? "text-[var(--state-positive-ink,#4a7c59)]"
                      : "text-ink"
              }`}
            >
              {route.outcome === "approve_budget" &&
                "✓ This fits. The deadline does not move."}
              {route.outcome === "escalate_deadline" &&
                (route.stillLateAfterMove
                  ? `⚠ This task is already behind. Moving the deadline to ${formatStamp(route.proposedDeadline)} does not on its own make it reachable.`
                  : `Approving moves the deadline to ${formatStamp(route.proposedDeadline)}, and it fits from there.`)}
              {route.outcome === "unknown" &&
                "The queue could not be measured, so this cannot be checked."}
            </p>

            {/**
             * **The queue's own arithmetic used to sit here, and is gone.**
             *
             * It read: "At 4h 30m in total, going by <name>'s real queue, this
             * task finishes 17:10 — 26m after the 16:45 deadline." Every
             * figure was true, and it was still the wrong thing to show.
             *
             * It was load-bearing once: the proposed new deadline USED to be
             * that finish time, rounded up, so printing it explained where the
             * date came from. That is no longer how the date is chosen — the
             * deadline now moves by exactly the time granted — so the finish
             * time explains nothing the reader is deciding. Worse, it compared
             * against the OLD deadline while the line above it talks about the
             * NEW one, putting two different comparisons side by side.
             *
             * The check itself still runs and still matters: it is what
             * decides whether this needs the assignor at all, and what the
             * line above reports. Only its raw output is no longer printed.
             * Asked about three times, then asked to remove it.
             */}
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
                  Approve {formatDuration(requestedTotal)} budget
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
              {countering ? (
                <>
                  <Field
                    label="Time to add instead"
                    required
                    hint={`They asked for ${formatDuration(addedSecs)}. Anything less is shown to them as less than they asked for.`}
                  >
                    {/* The same hours-and-minutes control every other budget on
                        this screen uses. A minutes-only box asked somebody
                        granting two hours to type 120. */}
                    <DurationField
                      secs={grantSecs}
                      onChange={setGrantSecs}
                      aria-label="Time to add instead"
                    />
                  </Field>
                  <Field
                    label="Why?"
                    className="mt-3"
                    hint="Optional, and they see it."
                  >
                    <Textarea
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={busy || grantSecs <= 0}
                      data-help="extension-grant-less"
                      onClick={async () => {
                        /* A TOTAL, which is what the record stores — the field
                           asks for the addition because that is what was asked
                           for, and showing totals where somebody typed an
                           addition is the confusion this whole area exists to
                           have fixed. */
                        const r = await grantLess(previousSecs + grantSecs);
                        if (r.ok) {
                          setCountering(false);
                          onChange();
                        }
                      }}
                    >
                      Grant{" "}
                      {grantSecs > 0 ? formatDuration(grantSecs) : "this"}{" "}
                      instead
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => setCountering(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={busy}
                      data-help="extension-grant-both"
                      onClick={async () => {
                        const granted = await decide("approved");
                        if (!granted.ok) return;
                        /* File AND answer in one press — the caption's promise.
                           A failure part-way leaves the pending card as the
                           fallback, which is the old behaviour, never
                           something worse. */
                        const filed = await escalate(Date.now());
                        if (filed.ok && filed.data?.id) {
                          await applyDate(filed.data.id);
                        }
                        onChange();
                      }}
                    >
                      Approve {formatDuration(requestedTotal)} and move the
                      deadline
                    </Button>
                    {/* The choice this card was missing. Without it a manager
                        could only accept the computed date, so granting less
                        than was asked had no surface at all. */}
                    <Button
                      size="sm"
                      disabled={busy}
                      data-help="extension-grant-different"
                      onClick={() => setCountering(true)}
                    >
                      Grant a different amount
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    You set the hours and you own the deadline on this task, so
                    both are yours to decide. Granting a different amount gives
                    them less than they asked for, and they are told so in those
                    words.
                  </p>
                  {/**
                   * **The one case the new rule cannot cover on its own.**
                   *
                   * The deadline now moves by exactly the time granted, which
                   * is what makes it predictable. But a task that was ALREADY
                   * running late stays late: the queue says it finishes after
                   * the new date too, so approving would set a deadline that
                   * is broken the moment it is set. Said plainly rather than
                   * left for somebody to notice next week.
                   */}
                  {/* The already-behind warning lives once, in the verdict
                      line above — it was being said twice. */}
                </>
              )}
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
