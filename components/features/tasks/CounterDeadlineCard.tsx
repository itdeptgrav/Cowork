"use client";

import { useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Panel,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { deadlineAction, isMyMove } from "@/lib/rules/tasks/extensionActions";
import { formatStamp } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * A different date came back. Accept it, or keep talking.
 *
 * **This is the card that did not exist.** When the approver answered with
 * another date, the turn passed correctly to whoever had asked — the record
 * said so and the timeline said so — and nothing rendered for them. The task
 * read "Waiting for Pramod" and Pramod had no button. The state machine moved
 * and the interface did not follow.
 *
 * So it renders wherever `deadlineAction` returns `accept_counter` and the
 * viewer is the one named. There is no second condition: if the rule says it is
 * your move, this is the move.
 *
 * **Accepting is not the only way out.** A counter that does not work has to be
 * answerable, or the only escape is to abandon the request — so "Discuss" posts
 * to the task chat and leaves the record open, which is honest about what it
 * does. It does not silently re-counter: proposing a third date is the
 * approver's move, not this person's.
 */

export function CounterDeadlineCard({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [discussing, setDiscussing] = useState(false);
  const [message, setMessage] = useState("");

  const records = useQuery(
    (r) => r.listDeadlineExtensionRecords(view.task.id),
    [view.task.id],
  );
  const record =
    records.data?.find(
      (r) => !r.isHistorical && r.status === "counter_proposed",
    ) ?? null;

  const action = deadlineAction(record);

  const [accept, acceptState] = useAction((r) =>
    /* Accepting the counter is approving the date that came back — the same
       write the approver would have made, from the other side of it. */
    r.decideDeadlineExtension(record!.id, "approved", {
      reason: message || undefined,
    }),
  );
  const [discuss, discussState] = useAction((r) =>
    r.sendTaskChat(view.task.id, "chat", message, []),
  );

  if (!record || !isMyMove(action, viewerId)) return null;

  const busy = acceptState.isPending || discussState.isPending;
  const error = acceptState.error ?? discussState.error;
  const decidedBy = record.decidedBy ?? record.approverId ?? "";
  const decidedByName =
    view.owner?.id === decidedBy
      ? view.owner.displayName
      : (view.budgetOwner?.id === decidedBy
          ? view.budgetOwner.displayName
          : decidedBy);

  return (
    <Panel data-help="counter-deadline">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Deadline revised
      </p>
      <p className="mt-1 text-sm text-ink">
        {decidedByName} proposed a different date.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <dt className="text-[11px] text-ink-faint">You asked for</dt>
          <dd data-figure className="text-[13px] text-ink-muted">
            {formatStamp(record.proposedDeadline)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">They proposed</dt>
          <dd data-figure className="text-[13px] text-ink">
            {formatStamp(record.counterDeadline ?? record.proposedDeadline)}
          </dd>
        </div>
      </dl>

      {record.reason && (
        <p className="mt-2 text-[12px] text-ink-muted">“{record.reason}”</p>
      )}

      {error && (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      )}

      {discussing ? (
        <div className="mt-3">
          <Field
            label="What would you like to say?"
            required
            hint="This goes to the task chat. The request stays open."
          >
            <Textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              tone="primary"
              size="sm"
              disabled={busy || message.trim().length === 0}
              data-help="counter-discuss-send"
              onClick={async () => {
                const r = await discuss();
                if (r.ok) {
                  setDiscussing(false);
                  setMessage("");
                  onChange();
                }
              }}
            >
              Send
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setDiscussing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              tone="primary"
              size="sm"
              disabled={busy}
              data-help="counter-accept"
              onClick={async () => {
                const r = await accept();
                if (r.ok) onChange();
              }}
            >
              Accept{" "}
              {formatStamp(record.counterDeadline ?? record.proposedDeadline)}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setDiscussing(true)}>
              Discuss
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Accepting sets the deadline and the task goes back to normal work.
            Nothing changes until you do.
          </p>
        </>
      )}
    </Panel>
  );
}
