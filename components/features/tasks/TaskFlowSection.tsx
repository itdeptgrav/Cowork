"use client";

import { taskFlow, type FlowStage } from "@/lib/rules/tasks/taskFlow";
import { waitingOnLabel } from "@/lib/rules/tasks/budgetNegotiation";
import type { BudgetTurn } from "@/lib/rules/tasks/budgetNegotiation";
import type { Approval, Employee, Task } from "@/lib/domain";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Where this task is, and whose turn it is — as a sequence rather than a label.
 *
 * "Pending approval" is a true statement that leaves the reader with every
 * question they arrived with: where is it, who has it, who has already agreed,
 * what happens after. All of that was already on the task and none of it was on
 * the screen.
 *
 * **This renders; it does not decide.** Every stage comes from
 * `lib/rules/tasks/taskFlow.ts`, which reads the engine's own approval array,
 * assignees and status. Nothing here advances a workflow, and where the record
 * is silent it stays silent — an unnamed approver is drawn as an unnamed
 * approver, never as a plausible guess.
 */

/* The rail is drawn per row rather than as one absolute line behind the list,
   so a row's segment can be coloured by its own state — a solid line up to
   where the task has reached, dashed for what has not happened yet. An absolute
   line cannot express that without a second overlay. */

function Node({ state }: { state: FlowStage["state"] }) {
  if (state === "done") {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--positive,#3f9d6b)]/15 text-[var(--positive,#3f9d6b)]">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "blocked") {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--danger,#c4553d)]/15 text-[var(--danger,#c4553d)]">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
          <path
            d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    /* The only animated element on the section, and deliberately so: it is the
       one thing the reader is looking for. `motion-safe` because a pulsing ring
       is exactly the sort of thing that should stop when somebody has asked for
       less motion. */
    return (
      <span className="relative grid h-6 w-6 place-items-center">
        <span className="absolute inset-0 rounded-full bg-ink/15 motion-safe:animate-ping" />
        <span className="relative grid h-6 w-6 place-items-center rounded-full bg-ink text-[var(--body-bg)]">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      </span>
    );
  }
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-[var(--hairline)]">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/40" />
    </span>
  );
}

/*
 * The shared formatter, not `toLocaleString(undefined, …)`.
 *
 * That call took BOTH the locale and the timezone from the viewer's machine, so
 * the same approval read differently depending on who opened it and where they
 * were — the one thing a shared timeline must not do.
 */
function when(iso: string | null): string | null {
  if (!iso) return null;
  const out = formatDateTime(iso);
  return out === "—" ? null : out;
}

function Row({ stage, last }: { stage: FlowStage; last: boolean }) {
  const dim = stage.state === "upcoming";
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <Node state={stage.state} />
        {!last && (
          <span
            className={`w-px flex-1 ${
              stage.state === "done"
                ? "bg-[var(--positive,#3f9d6b)]/30"
                : stage.state === "current"
                  ? "bg-gradient-to-b from-ink/40 to-[var(--hairline)]"
                  : "bg-[var(--hairline)]"
            }`}
            style={{ minHeight: 18 }}
          />
        )}
      </div>

      <div className={`min-w-0 flex-1 pb-4 ${dim ? "opacity-55" : ""}`}>
        <p
          className={`text-[15px] leading-snug ${
            stage.state === "current" ? "text-ink" : "text-ink-muted"
          }`}
        >
          {stage.label}
        </p>
        {stage.person && (
          <p className="mt-0.5 truncate text-[13px] text-ink">{stage.person}</p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-faint">
          {stage.role && <span>{stage.role}</span>}
          {stage.role && (stage.note || when(stage.at)) && <span>·</span>}
          {stage.note && (
            <span
              className={
                stage.state === "current" ? "text-ink-muted" : undefined
              }
            >
              {stage.note}
            </span>
          )}
          {when(stage.at) && (
            <>
              {stage.note && <span>·</span>}
              <span>{when(stage.at)}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

export function TaskFlowSection({
  task,
  approvals,
  pendingApprovals,
  budgetOwner,
  budgetTurn,
  acceptanceIsViewers = false,
  assignees,
  pendingAssignees,
  creator,
  viewerId,
  review,
}: {
  task: Task;
  approvals: Approval[];
  pendingApprovals: Approval[];
  /** Named on the budget stage so the wait is never anonymous. */
  budgetOwner?: Employee | null;
  /** Whose turn it is on a time budget, from the shared negotiation rule. */
  budgetTurn?: BudgetTurn | null;
  /**
   * Whether the reader is the person who owes the acceptance.
   *
   * From `getAssignmentActions`, passed in rather than derived here — this module
   * renders a diagram and takes only what it renders, exactly as `budgetTurn` is
   * passed in. Defaults to false so a caller that has not resolved it says
   * nothing about the reader rather than guessing.
   */
  acceptanceIsViewers?: boolean;
  /** From the latest submission where there is one; null on the legacy path. */
  review?: { chain: string[]; currentStage: number } | null;
  assignees: Employee[];
  /** Held off the task by an open gate — still who the work is for. */
  pendingAssignees: Employee[];
  creator: Employee | null;
  viewerId: string | null;
}) {
  /* One lookup over everybody the view already loaded. The rules module never
     fetches; it is handed a resolver and falls back to a role where a name is
     genuinely unknown. */
  const directory = new Map<string, string>();
  for (const e of [...assignees, ...pendingAssignees, creator]) {
    if (e) directory.set(e.id, e.displayName);
  }
  const nameOf = (id: string) => {
    const name = directory.get(id) ?? null;
    /* "you" is worth more than a name to the one person it applies to — it is
       the difference between reading a diagram and noticing a task is theirs. */
    if (id === viewerId) return name ? `${name} — you` : "You";
    return name;
  };

  const flow = taskFlow({
    task,
    /* Both lists: the gate's recorded stages, plus the budget entry which is
       synthesised for whoever may act on it. */
    approvals: [...approvals, ...pendingApprovals],
    budgetOwnerName: budgetOwner?.displayName ?? null,
    /* Whose turn it is on the time budget, in the words everybody else reads. */
    /* Whether the reader is the one who owes the acceptance, from the same
       resolver the confirmation card renders from — so the sentence and the
       control cannot disagree about whose move it is. */
    acceptanceIsViewers,
    budgetWaitingOn: budgetTurn
      ? waitingOnLabel(budgetTurn, (id) => directory.get(id) ?? null)
      : null,
    assigneeIds: assignees.map((a) => a.id),
    review,
    nameOf,
  });
  const stages = flow.stages;
  const current = stages.find((s) => s.state === "current") ?? null;
  if (stages.length === 0) return null;

  return (
    <section
      data-help="task-flow"
      className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-4 backdrop-blur-xl sm:p-5"
    >
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Task flow
      </p>

      {/* The two questions a reader arrives with, answered before the diagram —
          somebody who reads only the first line should still leave knowing
          whose turn it is. */}
      <p className="mt-1 text-[15px] leading-snug text-ink">
        {/* "No action is owed right now" was wrong wherever a stage IS current
            and simply belongs to somebody the viewer cannot see — a task
            waiting on its budget read as though nothing was outstanding. The
            current stage is the answer whenever there is one. */}
        {/* **"Your move" when it is, never "Waiting for you".** A person reading
            their own name after "Waiting for" is being told they are the delay,
            which reads as a report on them rather than as a prompt — and it was
            the sentence sitting above a card that offered nothing. The `— you`
            suffix that `nameOf` adds is what made it unmistakable. */
        acceptanceIsViewers
          ? "Your move — accept this task"
          : flow.whoseTurn
            ? `Waiting for ${flow.whoseTurn}`
            : flow.whatNext.startsWith("Nothing")
              ? flow.whatNext
              : current
                ? `Waiting for ${current.label.toLowerCase()}`
                : "No action is owed right now"}
      </p>
      {flow.whyWaiting && (
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          {flow.whyWaiting}
        </p>
      )}

      <ol className="mt-4">
        {stages.map((s, i) => (
          <Row key={s.key} stage={s} last={i === stages.length - 1} />
        ))}
      </ol>

      {/* Repeated at the foot because after reading a timeline the question is
          "and then?" — the answer should be where the eye already is. */}
      {!flow.whatNext.startsWith("Nothing") && (
        <p className="border-t border-[var(--hairline)] pt-3 text-[12px] text-ink-faint">
          Next: <span className="text-ink-muted">{flow.whatNext}</span>
        </p>
      )}
    </section>
  );
}
