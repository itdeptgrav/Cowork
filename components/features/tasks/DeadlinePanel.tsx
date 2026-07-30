"use client";

import { useState } from "react";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Input,
  Panel,
  ProvisionalBadge,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { BudgetNegotiationCard } from "./BudgetNegotiationCard";
import { BudgetConfirmationCard } from "./BudgetConfirmationCard";
import { extensionFromAddition, extensionOf } from "@/lib/rules/tasks/deadlineExtension";
import { hasLiveBudgetExtension } from "@/lib/rules/tasks/extensionAuthority";
import {
  deriveDueAt,
  describeWindow,
} from "@/lib/rules/tasks/workingWindow";
import { DurationField } from "./DurationField";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { windowOnOffer } from "./statusMeta";
import {
  formatDateTime,
  formatDurationTimer,
  formatPercent,
} from "@/lib/utils/format";
import { PROVISIONAL_RULES } from "@/lib/config/provisional";
import type { TaskView } from "@/lib/repositories";

/**
 * The deadline negotiation surface.
 *
 * Shows the whole chain at once — original, proposed, countered, current, and
 * the separate SCORED deadline — because the single most confusing thing in the
 * legacy system was that a waived extension moved one and a charged extension
 * moved the other, with nothing on screen saying so.
 */
export function DeadlinePanel({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: () => void;
}) {
  const taskId = view.task.id;
  /* Names for the ids the negotiation records carry. The task view already
     holds everybody involved, so no extra query — an unknown id falls back to
     itself rather than to a blank, which would read as "nobody". */
  const nameOf = (id: string) =>
    view.assignees.find((a) => a.id === id)?.displayName ??
    (view.owner?.id === id ? view.owner.displayName : null) ??
    view.pendingAssignees.find((a) => a.id === id)?.displayName ??
    id;
  const proposals = useQuery((r) => r.listProposals(taskId), [taskId]);
  const extensions = useQuery((r) => r.listExtensions(taskId), [taskId]);
  /* The ACTING viewer. This panel had the seeded id written into it three
     times, so it answered "am I the assignee" for one person no matter who was
     signed in — the receiver never saw their own actions, which is precisely
     what this panel is for. */
  const me = useViewerId();
  const blocked = useQuery(
    (r) => r.listBlockedDates(me ?? "", "2026-07-25", "2026-08-31"),
    [me],
  );

  const isAssignee = view.assignments.some((a) => a.employeeId === me);
  const isCreator = view.task.createdById === me;
  const open = view.openProposal;
  const d = view.task.deadline;

  /* Shared with `nextAction`, so the label every list shows and the form this
     tab offers cannot describe different steps. */
  const offerOpen = windowOnOffer(view.task);

  return (
    <div className="flex flex-col gap-4">
      {/* The chain, stated plainly. */}
      <Panel>
        <h2 className="text-sm font-medium text-ink">Deadline</h2>
        <dl className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Row
            label="Mode"
            value={d.mode === "timer" ? "Negotiated timer" : "Fixed by creator"}
          />
          <Row
            label="State"
            value={<Chip>{d.state.replace(/_/g, " ")}</Chip>}
          />
          <Row
            label="Original window"
            value={
              d.originalWindowSecs ? formatDurationTimer(d.originalWindowSecs) : "—"
            }
          />
          <Row
            label="Current window"
            value={
              d.currentWindowSecs ? formatDurationTimer(d.currentWindowSecs) : "—"
            }
          />
          <Row label="Working deadline" value={formatDateTime(d.dueAt)} />
          <Row
            label="Scored against"
            value={
              <span className="flex items-center gap-1.5">
                {formatDateTime(d.officialDueAt)}
                {d.officialDueAt !== d.dueAt && (
                  <span
                    title="A charged extension moves the working deadline but not the scored one"
                    className="text-ink-faint"
                  >
                    <Icon.clock className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
            }
          />
        </dl>
      </Panel>

      {/* Whoever's move it is gets the form. */}
      {open && isCreator && (
        <DecideProposal proposal={open} onChange={onChange} />
      )}
      {open && !isCreator && (
        <Panel>
          <p className="text-sm text-ink-muted">
            {open.isExtension ? (
              <>
                An extension of{" "}
                <span className="text-ink" data-figure>
                  +{formatDurationTimer(open.addedSecs ?? 0)}
                </span>{" "}
                — a new total of{" "}
                <span className="text-ink" data-figure>
                  {formatDurationTimer(open.windowSecs)}
                </span>
              </>
            ) : (
              <>
                A deadline of{" "}
                <span className="text-ink" data-figure>
                  {formatDurationTimer(open.windowSecs)}
                </span>
              </>
            )}{" "}
            is with the task creator. You will be notified when they decide.
          </p>
        </Panel>
      )}
      {/* The offer itself is NOT rendered here. Legacy put it in the task
          detail body, not behind a tab, and it is the receiver's first action —
          see `TaskDetail`. This tab keeps what follows it: proposing an
          alternative, extensions, and the negotiation history. */}

      {/* What was said, if the offer was refused. Legacy records
          `senderTimerRejectionReason` and posts it into draft chat; without it
          on screen the task simply looks like it never had an offer. */}
      {d.assignorWindowRejection && d.state === "unset" && (
        <Panel>
          <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            Time refused
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {d.assignorWindowRejection.byName} said the proposed time was not
            enough: &ldquo;{d.assignorWindowRejection.reason}&rdquo;
          </p>
        </Panel>
      )}

      {/* **Case A — the assignor already named a window.**
          Shown instead of a proposal form, so the assignee accepts or counters
          the figure their manager chose rather than guessing at one that
          already exists. The same component serves the overview tab, so both
          surfaces offer one behaviour rather than two that drift. */}
      {/* The same card the overview shows, so both surfaces offer one
          behaviour rather than two that drift. It decides for itself whether
          this viewer may act, and renders the wait for everybody else. */}
      <BudgetNegotiationCard view={view} viewerId={me} onChange={onChange} />

      {/* The assignee's confirmation of an EXTENSION their manager answered. A
          different conversation from the opening negotiation above — that one
          settles the original figure, this one settles a request to raise it —
          and each renders only for its own live state. */}
      <BudgetConfirmationCard view={view} viewerId={me} onChange={onChange} />

      {/* Once the offer is refused — or none was made — the reader proposes
          their own, which is exactly what legacy fell back to. */}
      {!open && isAssignee && d.state === "unset" && !offerOpen && (
        <ProposeForm
          taskId={taskId}
          blockedCount={blocked.data?.length ?? 0}
          onChange={onChange}
        />
      )}
      {!open && isAssignee && d.state === "agreed" && (
        <ExtensionForm view={view} onChange={onChange} />
      )}

      {/* Audit trail. */}
      <Panel padded={false}>
        <div className="border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">Negotiation history</h2>
        </div>
        {proposals.isLoading ? (
          <div className="px-5 py-3">
            <SkeletonRows rows={3} />
          </div>
        ) : !proposals.data?.length ? (
          <p className="px-5 py-4 text-sm text-ink-faint">No proposals yet.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {proposals.data.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5"
              >
                <Chip
                  tone={
                    p.state === "approved"
                      ? "positive"
                      : p.state === "rejected"
                        ? "overdue"
                        : p.state === "pending"
                          ? "extension"
                          : "neutral"
                  }
                >
                  {p.state}
                </Chip>
                <span className="text-sm text-ink">
                  {p.isExtension ? "Extension" : "Proposal"} ·{" "}
                  {/* The addition first, because that is what was asked for.
                      A row showing only the total read as "an extension of two
                      hours" when the window was already two hours. */}
                  {/* The STORED amount, never a difference. Approving an
                      extension overwrites the window it was measured against,
                      so differencing gives zero for every granted one — which
                      is what this row used to show. A record written before the
                      amount was carried has nothing to report and says so. */}
                  {p.addedSecs !== null ? (
                    <span data-figure>
                      {formatDurationTimer(p.previousWindowSecs ?? 0)} +{" "}
                      {formatDurationTimer(p.addedSecs)} ={" "}
                      {formatDurationTimer(p.windowSecs)}
                    </span>
                  ) : p.windowSecs > 0 ? (
                    <span data-figure>{formatDurationTimer(p.windowSecs)}</span>
                  ) : (
                    /* Plain, and not a diagnosis. Each earlier attempt at
                       this wording described a fault: "amount not recorded"
                       read as a request that went wrong, "unavailable" as
                       something broken now, "Historical extension record" as a
                       category of thing rather than the ordinary older request
                       it is. */
                    <span className="text-ink-faint">
                      Previous extension request
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-faint">
                  {formatDateTime(p.proposedDueAt)}
                </span>
                {/* WHO asked. A negotiation row without a name cannot be
                    acted on — the reader has to open the chat to find out
                    whose request they are looking at. */}
                {p.proposedById && (
                  <span className="text-xs text-ink-faint">
                    · {nameOf(p.proposedById)}
                  </span>
                )}
                {p.reason && (
                  <span className="w-full text-xs text-ink-muted">
                    “{p.reason}”
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {(extensions.data?.length ?? 0) > 0 && (
          <>
            <div className="border-y border-hairline bg-[var(--surface-sunken)] px-5 py-1.5">
              <span className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Extension chain
              </span>
            </div>
            <div className="divide-y divide-hairline">
              {extensions.data?.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5"
                >
                  <span data-figure className="text-sm text-ink">
                    +{formatDurationTimer(e.addedSecs)}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {formatDurationTimer(e.previousWindowSecs)} →{" "}
                    {formatDurationTimer(e.newWindowSecs)}
                  </span>
                  <Chip tone={e.penaltyWaived ? "positive" : "rework"}>
                    {e.penaltyWaived ? "Penalty waived" : "Penalty charged"}
                  </Chip>
                  {/* Only where it was measured. `Math.round(undefined)` is
                      NaN, and it templated straight into the sentence. */}
                  {formatPercent(e.elapsedPercentAtRequest) !== null && (
                    <span className="text-xs text-ink-faint">
                      at {formatPercent(e.elapsedPercentAtRequest)} elapsed
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-32 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{value}</dd>
    </div>
  );
}

/* ── Propose ──────────────────────────────────────────────────────────────── */

function ProposeForm({
  taskId,
  blockedCount,
  onChange,
  /** The window the assignor offered, when countering rather than proposing. */
  counterTo,
  onCancel,
}: {
  taskId: string;
  blockedCount: number;
  onChange: () => void;
  counterTo?: number | null;
  onCancel?: () => void;
}) {
  /* A custom hours:minutes window, defaulting to one hour. The preset dropdown
     (1 working day, 3 days, …) is gone — the estimate is entered directly. */
  const [requestSecs, setRequestSecs] = useState(3600);
  const [reason, setReason] = useState("");

  const chosenSecs = Math.max(60, requestSecs);

  /*
   * **An extension is an addition; the wire wants a total.**
   *
   * This asked for an absolute window in both cases, so somebody extending a
   * two-hour task and choosing "2 hours" sent a total of two hours — adding
   * nothing, and the history honestly recorded 00:00:00. The number people
   * mean when they say "extension" is the one on top.
   *
   * With a settled window the control is an ADDITION and the total is derived;
   * with none it is the window itself. `extensionFromAddition` owns that sum —
   * nothing else in the app adds these two numbers together.
   */
  const extension = extensionFromAddition({
    previousWindowSecs: counterTo && counterTo > 0 ? counterTo : 0,
    addedSecs: chosenSecs,
  });
  const windowSecs = extension.isExtension ? extension.totalSecs : chosenSecs;

  /* The clock is read in the CLICK handler and passed in, never during render:
     a date derived while the form merely sat open would be stale by the time
     anybody pressed the button. The engine recalculates against the office
     schedule on approval anyway; see `workingWindow.ts`. */
  const [propose, state] = useAction((r, fromMs: number) =>
    r.proposeDeadline({
      taskId,
      proposedDueAt: deriveDueAt(windowSecs, fromMs),
      windowSecs,
      reason: reason || undefined,
    }),
  );

  return (
    <Panel>
      <h2 className="text-sm font-medium text-ink">
        {counterTo ? "Request a different window" : "How long do you need?"}
      </h2>
      {counterTo ? (
        <p className="mt-1 text-xs text-ink-faint">
          Currently offered: <strong>{describeWindow(counterTo)}</strong>. Your
          request goes back for approval.
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-faint">
          Goes to the task creator to approve, reject or counter. The deadline
          date is worked out from this against the office calendar —{" "}
          {blockedCount} non-working days in the next month are excluded
          automatically.
        </p>
      )}

      <Field
        label={extension.isExtension ? "Extra time needed" : "Working window"}
        hint="Hours and minutes of work."
        required
        className="mt-3"
      >
        <DurationField
          secs={requestSecs}
          onChange={setRequestSecs}
          minSecs={60}
          aria-label={
            extension.isExtension ? "Extra time needed" : "Working window"
          }
        />
      </Field>

      {/* The sum, spelled out. A control that says "+2 hours" and a request
          that carries "4 hours" must be reconcilable on screen, or the history
          will look like it recorded the wrong thing. */}
      {extension.isExtension && (
        <p className="mt-2 text-[12px] text-ink-faint">
          Current window{" "}
          <span data-figure className="text-ink-muted">
            {formatDurationTimer(extension.previousSecs)}
          </span>{" "}
          + <span data-figure className="text-ink-muted">
            {formatDurationTimer(extension.addedSecs)}
          </span>{" "}
          = new total{" "}
          <span data-figure className="text-ink">
            {formatDurationTimer(extension.totalSecs)}
          </span>
        </p>
      )}

      <Field label="Reason" className="mt-3">
        <Textarea
          data-help="deadline-reason-field"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      {state.error && (
        <div className="mt-3">
          <InlineError message={state.error} code={state.errorCode} />
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button
          data-help="deadline-request-button"
          tone="primary"
          disabled={state.isPending}
          onClick={async () => {
            const r = await propose(Date.now());
            if (r.ok) onChange();
          }}
        >
          {state.isPending ? "Sending…" : "Send request"}
        </Button>
      </div>
    </Panel>
  );
}

/* ── Decide ───────────────────────────────────────────────────────────────── */

function DecideProposal({
  proposal,
  onChange,
}: {
  proposal: import("@/lib/domain").DeadlineProposal;
  onChange: () => void;
}) {
  const [reason, setReason] = useState("");
  const [counterSecs, setCounterSecs] = useState(3 * 3600);
  const [mode, setMode] = useState<"decide" | "counter">("decide");
  const [waive, setWaive] = useState(true);

  /* The three figures from one reading. The card had only the total, which
     cannot answer "how much more?" — the question the decision turns on. */
  /* The stored amount leads; `extensionOf` only fills in the arithmetic where
     a record predates it being carried. */
  const read = extensionOf({
    requestedWindowSecs: proposal.windowSecs,
    previousWindowSecs: proposal.previousWindowSecs ?? 0,
  });
  const ext =
    proposal.addedSecs !== null
      ? { ...read, addedSecs: proposal.addedSecs }
      : read;

  // Both paths return different payloads; the caller only needs to know it
  // succeeded, so the result is normalised to void here.
  const [decide, decideState] = useAction(
    async (r, d: "approved" | "rejected") => {
      const result = proposal.isExtension
        ? await r.decideExtension(proposal.id, d, waive, reason || undefined)
        : await r.decideProposal(proposal.id, d, reason || undefined);
      return result.ok ? { ok: true as const, data: undefined } : result;
    },
  );
  const [counter, counterState] = useAction((r) =>
    r.counterProposal(
      proposal.id,
      new Date(Date.now() + counterSecs * 1000).toISOString(),
      counterSecs,
      reason,
    ),
  );

  const threshold = Number(
    PROVISIONAL_RULES.extensionPenaltyThresholdPercent.value,
  );

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-ink">
          {proposal.isExtension ? "Extension requested" : "Deadline proposed"}
        </h2>
        <Chip tone="extension">Your decision</Chip>
      </div>
      {/* Three figures, because a total alone cannot answer "how much more?"
          — the question the decision actually turns on. */}
      {ext.isExtension ? (
        <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1">
          <div>
            <dt className="text-[11px] text-ink-faint">Current window</dt>
            <dd data-figure className="text-[13px] text-ink-muted">
              {formatDurationTimer(ext.previousSecs)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-faint">Extra requested</dt>
            <dd data-figure className="text-[13px] text-ink">
              {ext.addedSecs >= 0 ? "+" : "\u2212"}
              {formatDurationTimer(Math.abs(ext.addedSecs))}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-faint">New total</dt>
            <dd data-figure className="text-[13px] text-ink">
              {formatDurationTimer(ext.totalSecs)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          <span data-figure className="text-ink">
            {formatDurationTimer(proposal.windowSecs)}
          </span>{" "}
          requested.
        </p>
      )}
      <p className="mt-2 text-sm text-ink-muted">
        Due {formatDateTime(proposal.proposedDueAt)}.
        {proposal.reason && <> Reason given: “{proposal.reason}”.</>}
      </p>

      {proposal.isExtension && (
        <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-ink">Penalty on this extension</p>
            <ProvisionalBadge
              decisionId="O14"
              label="Extension penalty threshold"
            />
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            Past {threshold}% elapsed the placeholder rule charges a C1
            deduction. Waiving moves the scored deadline with the working one;
            charging leaves the scored deadline where it was.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              tone={waive ? "primary" : "secondary"}
              onClick={() => setWaive(true)}
            >
              Waive
            </Button>
            <Button
              size="sm"
              tone={!waive ? "primary" : "secondary"}
              onClick={() => setWaive(false)}
            >
              Charge
            </Button>
          </div>
        </div>
      )}

      {mode === "counter" && (
        <Field
          label="Counter with"
          hint="Hours and minutes of working time."
          required
          className="mt-3"
        >
          <DurationField
            secs={counterSecs}
            onChange={setCounterSecs}
            minSecs={60}
            aria-label="Counter working time"
          />
        </Field>
      )}

      <Field
        label={mode === "counter" ? "Message" : "Note"}
        className="mt-3"
        hint="Required when rejecting."
        error={decideState.errorField === "reason" ? decideState.error : null}
      >
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      {(decideState.error && !decideState.errorField) || counterState.error ? (
        <div className="mt-3">
          <InlineError
            message={decideState.error ?? counterState.error ?? ""}
            code={decideState.errorCode ?? counterState.errorCode}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mode === "decide" ? (
          <>
            <Button onClick={() => setMode("counter")}>Counter</Button>
            <Button
              disabled={decideState.isPending}
              onClick={async () => {
                const r = await decide("rejected");
                if (r.ok) onChange();
              }}
            >
              Reject
            </Button>
            <Button
              tone="primary"
              disabled={decideState.isPending}
              onClick={async () => {
                const r = await decide("approved");
                if (r.ok) onChange();
              }}
            >
              {decideState.isPending ? "Saving…" : "Approve"}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setMode("decide")}>Back</Button>
            <Button
              tone="primary"
              disabled={counterState.isPending}
              onClick={async () => {
                const r = await counter();
                if (r.ok) onChange();
              }}
            >
              Send counter
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ── Extension ────────────────────────────────────────────────────────────── */

function ExtensionForm({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: () => void;
}) {
  const [addedSecs, setAddedSecs] = useState(2 * 3600);
  const [reason, setReason] = useState("");

  /* One extension in flight at a time. While a request is unanswered — waiting
     on the manager, or offered back for the assignee to accept — the form is
     replaced by a note rather than letting a second, third, fourth figure stack
     up. The repository refuses it too; this is so the reader is told why. */
  const inflight = useQuery(
    (r) => r.listTimeBudgetExtensions(view.task.id),
    [view.task.id],
  );
  const extensionInFlight = inflight.data
    ? hasLiveBudgetExtension(inflight.data)
    : false;

  /* The window being extended, from the one budget resolver. The request
     carries it so the record can store previous + added = total at the moment
     it is made — approving overwrites the window, and an amount derived
     afterwards is zero. */
  const previousWindowSecs = view.task.estimatedEffortSecs ?? 0;
  const extension = extensionFromAddition({
    previousWindowSecs,
    addedSecs,
  });

  /*
   * **An assignee asks for HOURS, never for a date.**
   *
   * This used to send a deadline proposal built as
   * `dueAt + addedSecs` — the one sum that is always wrong, because the work
   * sits behind other work and runs through an office calendar. It also sent
   * that date to the ASSIGNOR, skipping the only person who can tell whether
   * the extra hours need a new deadline at all.
   *
   * So the request goes down the budget channel: a new total in working
   * seconds, to whoever owns this person's hours. If it fits inside the date
   * already committed they simply grant it and nothing else moves. Only if it
   * does not does a date get discussed, and then the MANAGER raises it with a
   * figure from the queue engine rather than from arithmetic.
   */
  const [request, state] = useAction((r) =>
    /* Its OWN record, in its own store. This went through the deadline
       negotiation, so a capacity request shared a row and a status with a
       commitment change and approving either looked like approving both. */
    r.requestTimeBudgetExtension({
      taskId: view.task.id,
      requestedAdditionalSecs: extension.addedSecs,
      reason: reason || undefined,
    }),
  );
  const floor = Number(PROVISIONAL_RULES.extensionRequestFloorPercent.value);

  if (extensionInFlight) {
    return (
      <Panel>
        <h2 className="text-sm font-medium text-ink">Extension in progress</h2>
        <p className="mt-1 text-xs text-ink-faint">
          You&rsquo;ve already asked for more time and it&rsquo;s with your
          manager. Wait for them to answer — or respond to their offer — before
          requesting a different amount.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Request an extension</h2>
        <ProvisionalBadge decisionId="O14" label="Extension request floor" />
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        Extensions become available once {floor}% of the window has elapsed.
        You are asking for working time, not a new date: this goes to whoever
        sets your hours, and the deadline only changes if the extra time cannot
        fit inside it.
      </p>
      {/* The sum, spelled out where it is chosen. */}
      <p className="mt-2 text-[12px] text-ink-faint">
        Current window{" "}
        <span data-figure className="text-ink-muted">
          {formatDurationTimer(extension.previousSecs)}
        </span>{" "}
        + <span data-figure className="text-ink-muted">
          {formatDurationTimer(extension.addedSecs)}
        </span>{" "}
        = new total{" "}
        <span data-figure className="text-ink">
          {formatDurationTimer(extension.totalSecs)}
        </span>
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Additional time" hint="Hours and minutes to add." required>
          <DurationField
            secs={addedSecs}
            onChange={setAddedSecs}
            minSecs={60}
            aria-label="Additional time"
          />
        </Field>
        <Field
          label="Reason"
          required
          error={state.errorField === "reason" ? state.error : null}
        >
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why you need longer"
          />
        </Field>
      </div>
      {state.error && !state.errorField && (
        <div className="mt-3">
          <InlineError message={state.error} code={state.errorCode} />
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button
          disabled={state.isPending || !reason.trim()}
          onClick={async () => {
            const r = await request();
            if (r.ok) onChange();
          }}
        >
          {state.isPending ? "Sending…" : "Request extension"}
        </Button>
      </div>
    </Panel>
  );
}
