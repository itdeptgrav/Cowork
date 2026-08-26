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
  budgetTurn,
  waitingOnLabel,
} from "@/lib/rules/tasks/budgetNegotiation";
import { budgetAcceptAlsoConfirms } from "@/lib/rules/tasks/assignmentAcceptance";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import { DurationField } from "./DurationField";
import type { TaskView } from "@/lib/repositories";

/**
 * The time budget, and whoever's turn it is to answer.
 *
 * **One card for both sides.** There were two — an assignee's accept card and
 * an assignor's decision card — each with its own conditions, which is exactly
 * how an assignee came to be shown an accept control over their own proposal.
 * The move is symmetric now: whoever the engine is waiting on may accept what
 * stands or put a different figure forward, and everybody else is told whose
 * turn it is.
 *
 * **No refusal.** Disagreeing means countering. A reject that ended the
 * negotiation would leave work carrying a budget one side never agreed to,
 * which is the state the loop exists to prevent.
 */


export function BudgetNegotiationCard({
  view,
  viewerId,
  onChange,
  onFinishingAcceptance,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
  /**
   * Raised while this card is confirming the assignment behind a budget accept.
   *
   * The caller renders both cards and uses it to keep the assignment card shut
   * across the gap — `acceptBudget` refetches the view the moment the first
   * write lands, so without it "Accept task" appears for a second or two and
   * then removes itself. Optional: a caller that renders this card alone (the
   * Deadline tab) passes nothing and nothing changes.
   */
  onFinishingAcceptance?: (inFlight: boolean) => void;
}) {
  const [countering, setCountering] = useState(false);
  const [reason, setReason] = useState("");
  const turn = budgetTurn(view, viewerId);
  const negotiation = view.budgetNegotiation;

  /* Seeded one step above what is on the table: somebody opening this form
     wants a different number, so starting at the same one would make their
     first action undo a default. */
  /* Seeded one hour above what is on the table, in seconds now rather than whole
     hours, so the counter can be any hours:minutes figure. */
  const [secs, setSecs] = useState(() =>
    Math.max(3600, turn.currentSecs + 3600),
  );

  const [accept, acceptState] = useAction((r) => r.acceptBudget(view.task.id));
  /* The second half of the same decision — see the Accept button below. */
  const [confirmTask] = useAction((r) => r.confirmTask(view.task.id));
  const [counter, counterState] = useAction((r) =>
    r.counterBudget(view.task.id, secs, reason || undefined),
  );

  const busy = acceptState.isPending || counterState.isPending;
  const error = acceptState.error ?? counterState.error;

  if (turn.state === "none" || turn.state === "agreed") return null;

  const nameOf = (id: string) =>
    view.assignees.find((a) => a.id === id)?.displayName ??
    (view.owner?.id === id ? view.owner.displayName : null) ??
    /* The budget's approver — the manager on a self task, where they are neither
       an assignee nor the creator and so would otherwise go unnamed. */
    (view.budgetOwner?.id === id ? view.budgetOwner.displayName : null);
  const proposerName = negotiation
    ? (nameOf(negotiation.proposedById) ?? negotiation.proposedByName ?? null)
    : null;
  const history = negotiation?.history ?? [];

  return (
    <Panel data-help="budget-negotiation">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Time budget
      </p>

      <p className="mt-1 text-[22px] leading-none font-light tracking-[-0.02em] text-ink">
        <span data-figure>{formatDurationTimer(turn.currentSecs)}</span>
      </p>
      <p className="mt-1 text-[12px] text-ink-faint">
        {proposerName ? `Proposed by ${proposerName}` : "On the table"}
        {turn.round > 1 && (
          <>
            {" · round "}
            <span data-figure>{turn.round}</span>
          </>
        )}
      </p>

      {turn.canAccept ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Accepting settles the budget and the task moves forward. If it is not
          right, put a different figure forward — the task stays exactly where
          it is until you both agree.
        </p>
      ) : (
        /* The other side's turn. Said plainly rather than showing disabled
           buttons, which read as "you may do this" and then refuse. */
        <p className="mt-2 text-sm text-ink-muted">
          {waitingOnLabel(turn, nameOf)}
        </p>
      )}

      {error && (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      )}

      {turn.canAccept &&
        (countering ? (
          <div className="mt-3">
            <Field
              label="What do you think it is worth?"
              hint="This goes back to the other side. Nothing is settled until one of you accepts."
            >
              <DurationField
                secs={secs}
                onChange={setSecs}
                minSecs={60}
                aria-label="Working time you propose"
              />
            </Field>

            <Field label="Why?" className="mt-3" hint="Optional, and the other side sees it.">
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
            </Field>

            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                tone="primary"
                size="sm"
                disabled={busy}
                data-help="budget-counter-send"
                onClick={async () => {
                  const r = await counter();
                  if (r.ok) {
                    setCountering(false);
                    setReason("");
                    onChange();
                  }
                }}
              >
                Send {formatDurationTimer(secs)}
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
              data-help="budget-accept"
              onClick={async () => {
                /* Asked BEFORE the write: afterwards the view has moved on and
                   this would be reading a state it had just caused. */
                const alsoConfirm = budgetAcceptAlsoConfirms(viewerId, view);
                /* Raised BEFORE the first write, not between them. The refetch
                   that reveals the assignment card is triggered by the budget
                   write itself, so a flag set afterwards is already too late. */
                if (alsoConfirm) onFinishingAcceptance?.(true);

                const r = await accept();
                if (!r.ok) {
                  onFinishingAcceptance?.(false);
                  return;
                }

                /**
                 * **One decision, one press.**
                 *
                 * Settling the budget and taking on the work are separate
                 * writes and the engine chains neither — so an assignee pressed
                 * this, watched the card go, and was immediately asked "Accept
                 * task" for what felt like the same question.
                 *
                 * Only for somebody who owes the acceptance themselves; see
                 * `budgetAcceptAlsoConfirms`. An assignor or a manager settling
                 * a budget confirms nothing on anybody's behalf.
                 *
                 * Failure is deliberately quiet. The budget IS settled — that
                 * write succeeded — and the assignment card is about to render
                 * with its own button and its own error. Raising something here
                 * would report a failure of the thing that worked.
                 */
                if (alsoConfirm) await confirmTask().catch(() => {});
                /* Refetch FIRST, then lower the flag. Lowering it before the
                   view has caught up would show the assignment card against
                   stale data — the very frame this exists to prevent. */
                onChange();
                if (alsoConfirm) onFinishingAcceptance?.(false);
              }}
            >
              Accept {formatDurationTimer(turn.currentSecs)}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setCountering(true)}>
              Propose different time
            </Button>
          </div>
        ))}

      {history.length > 0 && (
        <ol className="mt-3 space-y-1.5 border-t border-[var(--hairline)] pt-3">
          {history.map((h, i: number) => (
            <li
              key={`${h.roundNumber}-${h.createdAt ?? i}`}
              className="text-[12px] text-ink-faint"
            >
              <span data-figure>
                {formatDurationTimer(h.previousSecs)} →{" "}
                {formatDurationTimer(h.proposedSecs)}
              </span>{" "}
              · {nameOf(h.proposedById) ?? (h.proposedByName || "someone")}
              {h.decision === "accepted" ? " accepted" : " proposed"}
              {h.createdAt && ` · ${formatStamp(h.createdAt)}`}
              {h.reason && (
                <span className="text-ink-muted"> — {h.reason}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
