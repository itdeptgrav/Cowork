"use client";

import { useState } from "react";
import { Button, Chip, InlineError, Panel, Textarea } from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";
import {
  hasOpenRequest,
  mayDecidePreAssignDeadline,
  mayRequestPreAssignDeadline,
} from "@/lib/rules/tasks/preAssignDeadline";

/**
 * The receiver-manager's deadline pushback, before the task is assigned.
 *
 * One card that decides for itself what to show, so the Deadline tab renders it
 * unconditionally and never grows a second copy of the who-may-do-what rule:
 *
 *  · the manager who is about to set the hours, at the budget gate, gets a form
 *    to propose a LATER date;
 *  · the creator, while a request is open, gets approve / counter / reject;
 *  · everyone else sees the state — pending, moved, declined, or countered.
 *
 * The gates come straight from `lib/rules/tasks/preAssignDeadline.ts`, the same
 * module the engine's route is written against, so the control offered here and
 * the action the server accepts cannot drift apart.
 */
export function PreAssignDeadlineCard({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const req = view.task.preAssignDeadline ?? null;
  const canRequest = mayRequestPreAssignDeadline(view, viewerId);
  const canDecide = mayDecidePreAssignDeadline(view, viewerId);
  const pending = hasOpenRequest(req);

  /* Nothing to say: not the manager's to raise, and no request on record. */
  if (!canRequest && !req) return null;

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Deadline pushback</h2>
        {pending && <Chip tone="overdue">Awaiting the creator</Chip>}
      </div>

      {/* The state of any request, first — so a decided one reads as history and
          a pending one as the thing in flight. */}
      {req && (
        <div className="mt-3 rounded-inset bg-[var(--surface-raised)] p-3.5 text-sm">
          <p className="text-ink">
            <span className="text-ink-muted">{req.requestedByName}</span> asked
            to move the deadline to{" "}
            <span data-figure className="text-ink">
              {formatDateTime(req.proposedDueAt)}
            </span>
            {req.previousDueAt && (
              <>
                {" "}
                <span className="text-ink-faint">
                  (was {formatDateTime(req.previousDueAt)})
                </span>
              </>
            )}
            .
          </p>
          <p className="mt-1 text-ink-muted">“{req.reason}”</p>
          {req.status === "approved" && (
            <p className="mt-2 text-[13px] text-[var(--state-positive-ink)]">
              Approved — the deadline moved to the new date.
            </p>
          )}
          {req.status === "rejected" && (
            <p className="mt-2 text-[13px] text-ink-muted">
              Declined — the deadline stands.
              {req.decisionReason ? ` “${req.decisionReason}”` : ""}
            </p>
          )}
          {req.status === "countered" && req.counterDueAt && (
            <p className="mt-2 text-[13px] text-[var(--state-rework-ink)]">
              A different date was offered back:{" "}
              <span data-figure>{formatDateTime(req.counterDueAt)}</span>.
            </p>
          )}
        </div>
      )}

      {/* The creator's decision, while a request is open. */}
      {canDecide && req && <DecidePushback view={view} onChange={onChange} />}

      {/* The manager's form — only when they may raise one and none is open. */}
      {canRequest && !pending && (
        <RequestPushback view={view} onChange={onChange} />
      )}
    </Panel>
  );
}

/* ── The receiver-manager's request form ──────────────────────────────────── */

function RequestPushback({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");

  const [request, state] = useAction((r) =>
    r.requestPreAssignDeadline(
      view.task.id,
      /* `datetime-local` gives a local wall-clock string; the Date turns it into
         the ISO instant the engine and the rule both expect. */
      when ? new Date(when).toISOString() : "",
      reason,
    ),
  );

  if (!open) {
    return (
      <div className="mt-3">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          The deadline looks too tight for the work? Ask the creator for a later
          one <b className="text-ink">before you set the hours</b> — the date
          moves only if they agree.
        </p>
        <Button size="sm" className="mt-2.5" onClick={() => setOpen(true)}>
          Request a different deadline
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <label className="block">
        <span className="block text-xs text-ink-faint">New deadline</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="mt-1 w-full rounded-inset bg-[var(--surface-raised)] px-3 py-2 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-xs text-ink-faint">Why</span>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. their queue is full until the 11th"
          className="mt-1"
        />
      </label>
      {state.error && <InlineError compact message={state.error} />}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          tone="primary"
          loading={state.isPending}
          disabled={state.isPending || !when || !reason.trim()}
          onClick={async () => {
            const r = await request();
            if (r.ok) {
              setOpen(false);
              setWhen("");
              setReason("");
              onChange();
            }
          }}
        >
          Send request
        </Button>
        <Button size="sm" tone="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── The creator's decision ───────────────────────────────────────────────── */

function DecidePushback({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: () => void;
}) {
  const [countering, setCountering] = useState(false);
  const [counterWhen, setCounterWhen] = useState("");
  const [reason, setReason] = useState("");

  const [decide, state] = useAction(
    (
      r,
      input: { decision: "approve" | "reject" | "counter"; counterDueAt?: string },
    ) =>
      r.decidePreAssignDeadline(view.task.id, input.decision, {
        counterDueAt: input.counterDueAt,
        reason: reason.trim() || undefined,
      }),
  );

  async function run(
    decision: "approve" | "reject" | "counter",
    counterDueAt?: string,
  ) {
    const r = await decide({ decision, counterDueAt });
    if (r.ok) {
      setCountering(false);
      setCounterWhen("");
      setReason("");
      onChange();
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-hairline pt-3">
      <p className="text-[13px] text-ink-muted">
        You set this deadline — approving moves it, countering offers a different
        date, declining keeps it.
      </p>
      <label className="block">
        <span className="block text-xs text-ink-faint">
          Note <span className="text-ink-faint">(optional)</span>
        </span>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1"
        />
      </label>

      {countering && (
        <label className="block">
          <span className="block text-xs text-ink-faint">Your date instead</span>
          <input
            type="datetime-local"
            value={counterWhen}
            onChange={(e) => setCounterWhen(e.target.value)}
            className="mt-1 w-full rounded-inset bg-[var(--surface-raised)] px-3 py-2 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
          />
        </label>
      )}

      {state.error && <InlineError compact message={state.error} />}

      <div className="flex flex-wrap items-center gap-2">
        {!countering ? (
          <>
            <Button
              size="sm"
              tone="primary"
              loading={state.isPending}
              disabled={state.isPending}
              onClick={() => run("approve")}
            >
              Approve — move the date
            </Button>
            <Button
              size="sm"
              disabled={state.isPending}
              onClick={() => setCountering(true)}
            >
              Counter
            </Button>
            <Button
              size="sm"
              tone="ghost"
              disabled={state.isPending}
              onClick={() => run("reject")}
            >
              Decline
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              tone="primary"
              loading={state.isPending}
              disabled={state.isPending || !counterWhen}
              onClick={() =>
                run(
                  "counter",
                  counterWhen ? new Date(counterWhen).toISOString() : undefined,
                )
              }
            >
              Send counter-offer
            </Button>
            <Button
              size="sm"
              tone="ghost"
              onClick={() => setCountering(false)}
            >
              Back
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
