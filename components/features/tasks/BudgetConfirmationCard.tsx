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
import {
  agreedOrRequestedSecs,
  getExtensionActions,
  UNOWNED_TURN_NOTICE,
} from "@/lib/rules/tasks/extensionAuthority";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import { DurationField } from "./DurationField";
import type { TaskView } from "@/lib/repositories";

/**
 * **The surface that did not exist.**
 *
 * A manager answered a request for hours, the record moved on, and the assignee —
 * whose week the figure binds — was given a sentence saying they had to confirm
 * and nothing to press. The state machine advanced; the UI did not follow it.
 *
 * ## Why the assignee has to confirm at all
 *
 * Because approval is an **offer**, not a conclusion. A manager may grant four
 * hours where six were asked for, and applying that silently would commit
 * somebody to a figure they never agreed to and then measure them against it.
 * So the budget moves when this card is answered, and not before.
 *
 * ## Two ways forward, and no third
 *
 * Accept, or ask again. There is deliberately no decline: a refusal that ended
 * the negotiation would leave the work carrying a figure neither side settled,
 * which is the state the loop exists to make impossible. Asking again is how you
 * disagree, and it can run as many rounds as it takes — agreement is the only
 * exit.
 */

/** Totals a person actually asks for. Round numbers, because they are spoken. */

export function BudgetConfirmationCard({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [countering, setCountering] = useState(false);
  const [reason, setReason] = useState("");

  const records = useQuery((r) => r.listTimeBudgetExtensions(view.task.id), [
    view.task.id,
  ]);
  /* The one awaiting the assignee. `approved` is that state — it is no longer
     terminal, and reading it as such is what closed the conversation early. */
  const record = records.data?.find((r) => r.status === "approved") ?? null;

  const actions = getExtensionActions(viewerId, { budget: record });

  const agreedSecs = record ? agreedOrRequestedSecs(record) : 0;
  const [secs, setSecs] = useState<number | null>(null);
  /* Seeded from what is on the table, one option up: somebody opening this form
     wants MORE than they were granted, so starting at the same figure would make
     their first action undo a default. Derived rather than stored in an effect —
     `hours` of 0 means "not chosen yet". */
  /* Null means "not chosen yet" — the default is one hour above what was
     granted, since somebody opening this wants more than that. */
  const chosenSecs = secs ?? agreedSecs + 3600;

  const [accept, acceptState] = useAction((r) =>
    r.confirmTimeBudgetExtension(record!.id, "accept"),
  );
  const [counter, counterState] = useAction((r) =>
    r.confirmTimeBudgetExtension(record!.id, "counter", {
      counterSecs: chosenSecs,
      reason: reason || undefined,
    }),
  );

  if (!record) return null;

  /* A live turn the record assigns to nobody. Rendered as a FAULT rather than as
     a wait, because no amount of waiting resolves it — this is the misleading
     "waiting for the assignee" sentence, given its real cause. */
  if (actions.actionType === "unowned") {
    return (
      <Panel data-help="budget-confirmation">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Time budget
        </p>
        <div className="mt-2">
          <InlineError message={UNOWNED_TURN_NOTICE} />
        </div>
      </Panel>
    );
  }

  const busy = acceptState.isPending || counterState.isPending;
  const error = acceptState.error ?? counterState.error;
  const requestedSecs = record.newBudgetSecs;
  /* Whether the manager changed the figure. "They granted what you asked" and
     "they granted four hours" are different messages, and the second is the one
     that needs explaining. */
  const wasReduced = record.approvedSecs !== null;
  const approverName =
    view.assignees.find((a) => a.id === record.approverId)?.displayName ??
    (view.owner?.id === record.approverId ? view.owner.displayName : null) ??
    view.budgetOwner?.displayName ??
    null;

  /* The ADDITION is what the assignee actually asked for — "+10 minutes", not
     the new total of 40. Showing only totals made a request to add ten minutes
     read as a grant of forty, which is the confusion this card is fixing. */
  const previousSecs = record.previousBudgetSecs;
  const grantedAddedSecs = Math.max(0, agreedSecs - previousSecs);
  const askedAddedSecs = Math.max(0, requestedSecs - previousSecs);

  /* Not this viewer's turn. Everybody else is told whose it is and nothing more —
     a control offered here is a write the repository would refuse. */
  if (!actions.canAccept) {
    return (
      <Panel data-help="budget-confirmation">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Time budget
        </p>
        <p className="mt-1.5 text-sm text-ink-muted">
          Waiting for{" "}
          {view.assignees.find((a) => a.id === actions.nextActor)?.displayName ??
            "the assignee"}{" "}
          to confirm the working time that was granted.
        </p>
        <p className="mt-1 text-[12px] text-ink-faint">
          <span data-figure>{formatDurationTimer(agreedSecs)}</span> on the table
          {actions.round > 1 && (
            <>
              {" · round "}
              <span data-figure>{actions.round}</span>
            </>
          )}
        </p>
      </Panel>
    );
  }

  return (
    <Panel data-help="budget-confirmation">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Your manager has reviewed your request
      </p>

      <p className="mt-1.5 text-sm text-ink">
        {approverName ? `${approverName} granted ` : "You have been granted "}
        <span data-figure>+{formatDurationTimer(grantedAddedSecs)}</span> more
        {" — "}
        <span className="text-ink-muted">
          <span data-figure>{formatDurationTimer(agreedSecs)}</span> in total
        </span>
        {wasReduced && (
          <>
            {", not the "}
            <span data-figure>+{formatDurationTimer(askedAddedSecs)}</span> you
            asked for
          </>
        )}
        . Confirm it to put it in force.
      </p>

      {/* The arithmetic, spelled out. A total alone cannot answer "what changed",
          which is the question the decision turns on. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] text-ink-faint">Current budget</dt>
          <dd data-figure className="text-[13px] text-ink-muted">
            {formatDurationTimer(previousSecs)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">You asked to add</dt>
          <dd data-figure className="text-[13px] text-ink-muted">
            +{formatDurationTimer(askedAddedSecs)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">New budget</dt>
          <dd data-figure className="text-[13px] text-ink">
            {formatDurationTimer(agreedSecs)}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-[11px] text-ink-faint">
        {approverName && <>Approved by {approverName}</>}
        {record.approvedAt && (
          <>
            {approverName ? " · " : ""}
            {formatStamp(record.approvedAt)}
          </>
        )}
        {actions.round > 1 && (
          <>
            {" · round "}
            <span data-figure>{actions.round}</span>
          </>
        )}
      </p>

      {record.reason && (
        <p className="mt-2 rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
          &ldquo;{record.reason}&rdquo;
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Accepting recalculates your queue and the expected completion of the work
        behind this task. The committed deadline does not move on its own.
      </p>

      {error && (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      )}

      {countering ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-[12px] text-ink-muted">
            Ask for a different total. This goes back to{" "}
            {approverName ?? "your manager"}.
          </p>
          <div className="mt-2">
            <DurationField
              secs={chosenSecs}
              onChange={setSecs}
              minSecs={60}
              aria-label="Total working time you want"
            />
          </div>
          <Field
            label="Why (optional)"
            hint="Shown to whoever answers next."
            className="mt-3"
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The integration turned out to need a migration too"
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              tone="primary"
              size="sm"
              disabled={busy}
              onClick={async () => {
                const r = await counter();
                if (r.ok) {
                  setCountering(false);
                  setReason("");
                  setSecs(null);
                  onChange();
                }
              }}
            >
              {busy
                ? "Sending…"
                : `Ask for ${formatDurationTimer(chosenSecs)} in total`}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setCountering(false)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
          <Button
            tone="primary"
            size="sm"
            disabled={busy}
            onClick={async () => {
              const r = await accept();
              if (r.ok) onChange();
            }}
          >
            {busy ? "Confirming…" : `Accept ${formatDurationTimer(agreedSecs)}`}
          </Button>
          {/* No decline. Disagreeing means asking again — a refusal would leave
              the work carrying a figure neither side settled. */}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => setCountering(true)}
          >
            Propose different time
          </Button>
        </div>
      )}
    </Panel>
  );
}
