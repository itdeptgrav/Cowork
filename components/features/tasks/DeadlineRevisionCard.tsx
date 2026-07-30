"use client";

import { useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Input,
  Panel,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { assignorView, liveDeadline } from "@/lib/rules/tasks/extensionRecords";
import { formatStamp } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * The assignor's decision: may this commitment move?
 *
 * **Dates only, and that is a rule rather than a layout choice.** The hours
 * belong to the other conversation — the one between the assignee and their
 * manager, which has already happened by the time this card exists. What
 * reaches here is its conclusion: the manager could not fit the work inside the
 * date that was promised, and this is the earliest their employee can actually
 * deliver.
 *
 * Showing the hours here would be worse than noise. An assignor who can see
 * "+2 hours" beside a deadline will eventually add the two, and
 * `oldDeadline + extraHours` is always wrong — the work sits behind other work
 * and runs through an office calendar, so two extra hours of budget can move a
 * completion by a day or by nothing at all. The right answer already came from
 * the queue engine; presenting the ingredients invites somebody to recompute it
 * badly.
 *
 * Nor is the queue shown. Whose work sits where is not the assignor's business
 * and not their decision — theirs is only whether the commitment can move.
 */

export function DeadlineRevisionCard({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [countering, setCountering] = useState(false);
  const [counterDate, setCounterDate] = useState("");
  const [reason, setReason] = useState("");

  /* The pending DATE request, from its own store. `openProposal` is the old
     shared record and is not written by this flow any more. */
  const records = useQuery(
    (r) => r.listDeadlineExtensionRecords(view.task.id),
    [view.task.id],
  );
  const request =
    records.data?.find(
      (r) => !r.isHistorical && (r.status === "pending" || r.status === "counter_proposed"),
    ) ?? null;

  /* A commitment is the assignor's and nobody else's to move. The record names
     its own approver, so the control cannot be offered to somebody the write
     would then refuse. */
  const mayDecide =
    viewerId !== null && request !== null && request.approverId === viewerId;

  /*
   * `decideDeadlineExtension`, not `decideProposal`.
   *
   * The generic proposal decision writes `deadlineHistory` and knows nothing
   * about who asked, who owns the commitment, or that a counter-offer is an
   * answer rather than a refusal. This flow has its own record and its own
   * four states.
   */
  const [decide, decideState] = useAction(
    (r, decision: "approved" | "rejected") =>
      r.decideDeadlineExtension(request!.id, decision, {
        reason: reason || undefined,
      }),
  );
  const [counter, counterState] = useAction((r) =>
    /* A counter-offer moves the DATE and nothing else. The hours were settled
       by the manager and are not the assignor's to revise — there is no window
       parameter here to revise them with. */
    r.decideDeadlineExtension(request!.id, "counter_proposed", {
      counterDeadline: new Date(counterDate).toISOString(),
      reason: reason || undefined,
    }),
  );

  if (!request) return null;

  /* Only the three facts that are the assignor's business. */
  const shown = assignorView(request);

  const busy = decideState.isPending || counterState.isPending;
  const error = decideState.error ?? counterState.error;

  return (
    <Panel data-help="deadline-revision">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Revised deadline requested
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Your team cannot complete this by the date committed.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <dt className="text-[11px] text-ink-faint">Current deadline</dt>
          <dd data-figure className="text-[13px] text-ink-muted">
            {shown.previousDeadline ? formatStamp(shown.previousDeadline) : "None"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Requested deadline</dt>
          <dd data-figure className="text-[13px] text-ink">
            {formatStamp(shown.proposedDeadline)}
          </dd>
        </div>
      </dl>

      {shown.reason && (
        <p className="mt-2 text-[12px] text-ink-muted">“{shown.reason}”</p>
      )}

      {error && (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      )}

      {!mayDecide ? (
        <p className="mt-3 text-[12px] text-ink-muted">
          {view.owner
            ? `${view.owner.displayName} decides whether this deadline moves.`
            : "The task’s creator decides whether this deadline moves."}
        </p>
      ) : countering ? (
        <div className="mt-3">
          <Field
            label="A different date"
            required
            hint="This goes back to the assignee’s manager."
          >
            <Input
              type="datetime-local"
              value={counterDate}
              onChange={(e) => setCounterDate(e.target.value)}
            />
          </Field>
          <Field label="Why?" className="mt-3" hint="Optional, and they see it.">
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
              disabled={busy || !counterDate}
              data-help="deadline-counter-send"
              onClick={async () => {
                const r = await counter();
                if (r.ok) {
                  setCountering(false);
                  onChange();
                }
              }}
            >
              Send this date
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setCountering(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            tone="primary"
            size="sm"
            disabled={busy}
            data-help="deadline-approve"
            onClick={async () => {
              const r = await decide("approved");
              if (r.ok) onChange();
            }}
          >
            Approve {formatStamp(liveDeadline(request))}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setCountering(true)}>
            Propose another date
          </Button>
        </div>
      )}
    </Panel>
  );
}
