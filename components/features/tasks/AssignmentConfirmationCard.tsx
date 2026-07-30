"use client";

import { useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Panel,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
import {
  getAssignmentActions,
  UNASSIGNED_ACCEPTANCE_NOTICE,
} from "@/lib/rules/tasks/assignmentAcceptance";
import { formatRankDisplay, rankFor } from "@/lib/rules/tasks/priorityDisplay";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * **The surface that did not exist.**
 *
 * A task said *"Waiting for Umung Arora — you"* and *"The assignee has not
 * accepted it yet."*, and offered Umung nothing to press. The acceptance control
 * was an inline condition in `TaskDetail` requiring
 * `deadline.state === "agreed"` — stricter than the engine, which skips that
 * requirement for budget tasks entirely — and the generic fallback link was
 * suppressed on `assigned` at the same time. All three branches false, so the
 * card rendered "Your move" above nothing.
 *
 * ## Why the whole assignment is restated here
 *
 * Because this is the moment somebody decides whether to take on the work, and
 * they should not have to go looking for the terms first. Who assigned it, where
 * it sits in their queue, when it is expected to finish, and how many hours it
 * carries — all four change the answer, and all four are already on the view.
 *
 * ## The refusal is named for what it does
 *
 * There is no "decline the task" transition in the engine, and this does not
 * pretend otherwise. What an assignee can do is refuse the TERMS — say the
 * proposed working time is not enough, with a reason, which reopens the
 * negotiation and leaves the task where it was. A button labelled "Decline" over
 * that write would describe an outcome nobody gets.
 */
export function AssignmentConfirmationCard({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");

  const actions = getAssignmentActions(viewerId, view);

  const [accept, acceptState] = useAction((r) => r.confirmTask(view.task.id));
  const [refuse, refuseState] = useAction((r) =>
    r.rejectAssignorWindow(view.task.id, reason),
  );

  if (actions.actionType === "none") return null;

  /* A live acceptance step naming nobody. Rendered as a FAULT rather than as a
     wait — no amount of waiting moves it, and the fix is an assignment. */
  if (actions.actionType === "unowned") {
    return (
      <Panel data-help="assignment-confirmation">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Assignment
        </p>
        <div className="mt-2">
          <InlineError message={UNASSIGNED_ACCEPTANCE_NOTICE} />
        </div>
      </Panel>
    );
  }

  const nameOf = (id: string | null) =>
    !id
      ? null
      : (view.assignees.find((a) => a.id === id)?.displayName ??
        view.pendingAssignees.find((p) => p.id === id)?.displayName ??
        (view.owner?.id === id ? view.owner.displayName : null));

  /* Everybody who is not the assignee is told whose move it is and nothing more.
     A control here would be a write the engine 403s — `confirmTaskReceipt`
     requires `assigneeIds.includes(employeeId)`. */
  if (actions.actionType === "await_assignee") {
    return (
      <Panel data-help="assignment-confirmation">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Assignment
        </p>
        <p className="mt-1.5 text-sm text-ink-muted">
          Waiting for {nameOf(actions.nextActor) ?? "the assignee"} to accept this
          task. Only they can — accepting on somebody&rsquo;s behalf would record
          their agreement to a deadline they never saw.
        </p>
      </Panel>
    );
  }

  const busy = acceptState.isPending || refuseState.isPending;
  const error = acceptState.error ?? refuseState.error;
  /* Already resolved by the mapper via `resolveTimeBudget` — the agreed window
     if there is one, else the figure the assignor proposed. Re-resolving here
     would need the legacy wire shape and would be a second answer to "how many
     hours is this worth". */
  const budgetSecs = view.task.estimatedEffortSecs ?? 0;
  const rank = rankFor(view, viewerId);
  const expected =
    view.task.deadline.operationalDueAt ?? view.task.deadline.dueAt ?? null;

  return (
    <Panel data-help="assignment-confirmation">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        You have been assigned this task
      </p>
      <p className="mt-1 text-[15px] leading-snug text-ink">
        {view.task.title}
      </p>

      {/* The terms, restated. This is the moment the decision is made, and the
          four figures below are what it turns on. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 deck:grid-cols-4">
        <Row label="Task" value={view.task.reference} figure />
        <Row label="Assigned by" value={view.owner?.displayName ?? "—"} />
        <Row label="Priority" value={formatRankDisplay(rank)} figure />
        <Row
          label="Time budget"
          value={budgetSecs > 0 ? formatDurationTimer(budgetSecs) : "Not set"}
          figure
        />
      </dl>

      <dl className="mt-2.5 border-t border-hairline pt-2.5">
        <Row
          label="Expected completion"
          value={expected ? formatStamp(expected) : "Not yet scheduled"}
          figure
        />
      </dl>

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
        {expected
          ? "Expected completion is when this will really be finished — everything ahead of it in your queue, then its own hours, through office hours and holidays. The committed deadline is separate and is what your score is measured against."
          : "No completion date yet. Accepting puts the work into your queue, and the date follows from the hours and what is already ahead of it."}
      </p>

      {error && (
        <div className="mt-3">
          <InlineError message={error} code={acceptState.errorCode ?? refuseState.errorCode} />
        </div>
      )}

      {refusing ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-[12px] leading-relaxed text-ink-muted">
            This sends the proposed working time back to{" "}
            {view.owner?.displayName ?? "whoever set it"} with your reason and
            opens the negotiation. The task stays with you and nothing else
            changes — there is no way to hand it back entirely.
          </p>
          <Field
            label="Why is the proposed time not enough?"
            hint="Required. Recorded on the task and shown to whoever answers."
            className="mt-2.5"
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. This needs a migration as well, which the estimate does not cover"
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              tone="primary"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={async () => {
                const r = await refuse();
                if (r.ok) {
                  setRefusing(false);
                  setReason("");
                  onChange();
                }
              }}
            >
              {busy ? "Sending…" : "Send it back"}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setRefusing(false)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <Button
            tone="primary"
            size="sm"
            disabled={busy}
            data-help="assignment-accept"
            onClick={async () => {
              const r = await accept();
              if (r.ok) onChange();
            }}
          >
            {acceptState.isPending ? "Accepting…" : "Accept task"}
          </Button>
          {/* Named for the write behind it. There is no transition that returns
              the work to the assignor, so a "Decline task" button here would
              promise an outcome nobody gets. */}
          {actions.canRefuseTerms && (
            <Button size="sm" disabled={busy} onClick={() => setRefusing(true)}>
              Ask for different terms
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function Row({
  label,
  value,
  figure,
}: {
  label: string;
  value: string;
  figure?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd
        {...(figure ? { "data-figure": true } : {})}
        className="mt-0.5 truncate text-[13px] text-ink"
      >
        {value}
      </dd>
    </div>
  );
}
