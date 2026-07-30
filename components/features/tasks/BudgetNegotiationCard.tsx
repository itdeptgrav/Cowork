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
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
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
  const [counter, counterState] = useAction((r) =>
    r.counterBudget(view.task.id, secs, reason || undefined),
  );

  const busy = acceptState.isPending || counterState.isPending;
  const error = acceptState.error ?? counterState.error;

  if (turn.state === "none" || turn.state === "agreed") return null;

  const nameOf = (id: string) =>
    view.assignees.find((a) => a.id === id)?.displayName ??
    (view.owner?.id === id ? view.owner.displayName : null);
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
                const r = await accept();
                if (r.ok) onChange();
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
