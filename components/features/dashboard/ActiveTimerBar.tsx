"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { workQueue } from "./signals";
import {
  TimerControl,
  useTicker,
} from "@/components/features/tasks/TimerControl";
import { nextAction } from "@/components/features/tasks/statusMeta";
import { DurationField } from "@/components/features/tasks/DurationField";
import { RequestMoreTime } from "@/components/features/tasks/RequestMoreTime";
import { Icon } from "@/components/ui/Icons";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { budgetTurn } from "@/lib/rules/tasks/budgetNegotiation";
import { getAssignmentActions } from "@/lib/rules/tasks/assignmentAcceptance";
import { blockedMessage, deadlineBlock } from "@/lib/rules/tasks/deadlineBlock";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { useNow } from "@/lib/hooks/useNow";
import type { ActionResult, TaskView } from "@/lib/repositories";

/**
 * The active-work BAR.
 *
 * One row for one task, read left to right: a priority PICKER, what the task is,
 * and whatever that task needs next. The picker chooses WHICH task the bar
 * shows — the work is ordered by priority, so P1 is what you are on and P2, P3…
 * are what is behind it. It is a view switch, not a reorder: selecting P2 shows
 * the P2 task; nothing is written and no queue moves.
 *
 * **It is always on the page.** Three states, and none of them is absence:
 *
 *  1. **Nothing assigned** — the bar says so. It used to `return null`, which
 *     left a hole where a fixed landmark should be: the page reflowed depending
 *     on whether you happened to have work, and somebody looking for their timer
 *     could not tell "you have nothing" from "this is broken". An empty state is
 *     an answer; a missing element is not.
 *  2. **Assigned, not started** — the task, its budget, and the decision it is
 *     actually waiting on. There is no clock yet because no session exists;
 *     offering one would start timing work nobody has agreed to do.
 *  3. **In progress** — the clock, the remaining budget and Submit.
 *
 * The action in state 2 is never invented here. `nextAction` is the product's
 * one authority on what a task needs and from whom, and it already words each
 * pre-start step precisely — "Accept or discuss the time", "Propose a deadline",
 * "Confirm receipt", "Start work". A second vocabulary on this bar would drift
 * from the task page's within a release.
 */
export function ActiveTimerBar() {
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "mine", sort: "rank" }).then((p) => p.items),
    [],
  );
  const active = useQuery((r) => r.getActiveTimer(), []);
  const viewerId = useViewerId();

  const all = tasks.data ?? [];
  const queue = workQueue(all, viewerId ?? "");
  const running = active.data
    ? (all.find((v) => v.task.id === active.data!.taskId) ?? null)
    : null;

  if (tasks.isLoading) {
    return (
      <div className="h-[64px] w-full animate-pulse rounded-full bg-[var(--surface-sunken)]" />
    );
  }
  if (queue.length === 0 && !running) return <EmptyBar />;

  return (
    <Bar
      queue={queue}
      running={running}
      viewerId={viewerId ?? ""}
      startedAtRealMs={active.data?.startedAtRealMs ?? null}
    />
  );
}

/**
 * The terms half of the bar, before work can run: the budget, and the one
 * decision that settles it.
 *
 * **One button, not two.** It used to offer "Discuss time" beside "Accept or
 * discuss the time", which is the same choice written twice — and neither
 * label said what pressing it would do. The dropdown IS the discussion now:
 * leave the figure alone and the button accepts it; change it and the button
 * becomes "Send for approval", because a changed figure is a counter-proposal
 * and needs the other side to agree.
 *
 * Both writes go through the same calls the budget panel uses —
 * `acceptBudget` and `counterBudget` — so the bar and the task page cannot
 * settle a figure two different ways. `budgetTurn` decides whether this viewer
 * holds the turn at all; when they do not, the bar states whose move it is and
 * offers nothing, because the engine would refuse the write.
 */
function Terms({
  view,
  viewerId,
  action,
}: {
  view: TaskView;
  viewerId: string;
  action: ReturnType<typeof nextAction>;
}) {
  /* What the ENGINE will let this viewer do, asked of the same function the
     acceptance card asks, so the bar never offers a write that comes back 403 —
     and never withholds one the engine would have allowed. */
  const actions = getAssignmentActions(viewerId, view);
  const turn = budgetTurn(view, viewerId);
  /* The figure on the table: the negotiation's own current value where there is
     one, else the estimate the task carries. */
  const offered =
    turn.currentSecs > 0 ? turn.currentSecs : view.task.estimatedEffortSecs;
  const [secs, setSecs] = useState<number | null>(offered);
  const [reason, setReason] = useState("");
  const changed = secs != null && offered != null && secs !== offered;

  /* The reason panel is asked for, not assumed. `asking` is only ever true
     while the figure differs from the one on the table — putting the stepper
     back where it was withdraws the request along with the box, so there is no
     way to have an open "why this much time?" over a time nobody changed. */
  const [asking, setAsking] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const open = asking && changed;
  useDismiss(open, () => setAsking(false), [panelRef, buttonRef]);

  /*
   * TWO stages settle a task, and they are not the same write.
   *
   *  · A budget NEGOTIATION is open — `budgetTurn` names whose move it is.
   *    Accepting is `acceptBudget`; a different figure is `counterBudget`,
   *    which carries the number and takes an optional reason.
   *  · The ASSIGNMENT is waiting to be accepted. That is `confirmTask`, and it
   *    is not a formality: it stamps the assignee's agreement, moves the task to
   *    `confirmed`, and is what puts the work INTO the priority queue — before
   *    it the task holds no slot at all. The assignor is told.
   *
   * **The accept stage is `actions.actionType`, not `windowOnOffer`.** It used
   * to be gated on the latter, which additionally requires the deadline to be
   * `unset` and in timer mode — so a task the engine was perfectly willing to
   * accept, but which did not match that shape, fell past this whole block and
   * surfaced as a bare "Confirm receipt" link: a second step, in different
   * words, for the thing the button beside it already claimed to do.
   * `getAssignmentActions` is the authority on whether acceptance is available,
   * so it is what decides.
   *
   * Refusing the terms is narrower than accepting them and has its own flag.
   * The engine requires a proposed window to refuse, so where there is none the
   * figure is shown but cannot be countered — and refusing needs a written
   * reason, which is why the button stays disabled until there is one. Composing
   * a sentence on somebody's behalf and attaching their name to it is the
   * failure this codebase has already corrected once.
   */
  const budgetStage = turn.canAccept || turn.canPropose;
  const acceptStage =
    !budgetStage && actions.actionType === "accept_assignment";
  const canSettle = budgetStage || acceptStage;
  const canCounter = budgetStage || (acceptStage && actions.canRefuseTerms);
  const reasonRequired = acceptStage && changed;

  /* The two stages' writes return different payloads and the bar wants none of
     them — it re-reads through the invalidated queries either way. */
  /**
   * **Approve is BOTH writes, in order.**
   *
   * Settling the budget does not take the task on — the assignment is still
   * waiting to be accepted, so the engine's next step is "Confirm receipt".
   * Pressing Approve and landing on another button asking essentially the same
   * question is not a step, it is the same step twice: on this bar "Approve
   * task" means "these are the terms and I am taking it", and that is two
   * records whether or not the reader should have to know it.
   *
   * Order matters and is not ours to choose — `getAssignmentActions` refuses
   * acceptance while a budget is unsettled, precisely so nobody takes work on
   * at a figure their manager never approved. So the budget goes first, and the
   * receipt only if that lands.
   */
  const [accept, acceptState] = useAction(async (r) => {
    if (!budgetStage) return discard(await r.confirmTask(view.task.id));
    const settled = await r.acceptBudget(view.task.id);
    if (!settled.ok) return discard(settled);
    return discard(await r.confirmTask(view.task.id));
  });
  const [propose, proposeState] = useAction(async (r) => {
    const result = discard(
      await (budgetStage
        ? r.counterBudget(view.task.id, secs ?? 0, reason.trim() || undefined)
        : r.rejectAssignorWindow(view.task.id, reason.trim())),
    );
    /* Closed on success only. A panel that shut on a refused write would take
       the typed reason with it and leave the row looking like the request had
       gone through. */
    if (result.ok) setAsking(false);
    return result;
  });
  const busy = acceptState.isPending || proposeState.isPending;

  return (
    <>
      {/* A refusal is reported where the control that caused it lives: the row
          carries Approve's, the panel carries Send's. One message in one place
          beats the same sentence in two, half a row apart from the button the
          reader just pressed. */}
      {acceptState.error ? (
        <span
          role="alert"
          className="ml-auto min-w-0 max-w-[280px] shrink truncate text-right text-[12px] text-[var(--state-overdue-ink)]"
        >
          {acceptState.error}
        </span>
      ) : (
        /* The reserved gap. Nothing lives here at rest — it is what keeps the
           two right-hand slots pinned to the same place on every row. */
        <span aria-hidden className="ml-auto" />
      )}

      <DeadlineCell view={view} />

      {/* 4′ · TIME. The budget, adjustable — not a countdown. "N left" against a
            clock that has not started reads as time already draining away;
            before the work begins this figure is what is being AGREED. */}
      <Slot className={COL_TIME}>
        {offered == null ? (
          <p className={`${BOX} text-ink-faint`}>Not set</p>
        ) : canCounter ? (
          /* The SAME control the budget panel uses, in its compact size.
             It was a pair of dropdowns here and a stepper there — two ways to
             say one figure, which is how the two surfaces drift. Sharing it
             also means the minutes roll into the hour in both places rather
             than only wherever somebody remembered to implement it. */
          <DurationField
            compact
            secs={secs ?? offered}
            onChange={setSecs}
            aria-label="Time budget"
          />
        ) : (
          <p data-figure className={`${BOX} tabular-nums text-ink`}>
            {hoursMinutes(offered)}
          </p>
        )}
      </Slot>

      {/* 4′ · ACTION. One white pill, the same box the timer will occupy once
            the terms are agreed. */}
      <Slot className={`relative ${COL_ACTION}`}>
        {canSettle ? (
          <button
            type="button"
            ref={buttonRef}
            disabled={busy}
            aria-haspopup={changed ? "dialog" : undefined}
            aria-expanded={changed ? asking : undefined}
            onClick={() => (changed ? setAsking((a) => !a) : void accept())}
            title={
              changed
                ? "Ask for this much time instead"
                : "Accept the time as it stands and take the task on"
            }
            className={PILL}
          >
            {busy ? "Saving…" : changed ? "Send for approval" : "Approve task"}
          </button>
        ) : action.actor === "you" ? (
          /* The turn is not a budget one — receipt to confirm, a deadline to
             propose. Named by `nextAction` and routed to where it happens. */
          <Link
            href={action.href ?? `/tasks/${view.task.id}`}
            className={`${PILL} truncate`}
          >
            {action.label}
          </Link>
        ) : (
          /* Waiting on somebody else. Stated, not offered — a button here would
             promise a move this reader does not have. */
          <span className={`${BOX} justify-center truncate text-ink-faint`}>
            {action.label}
          </span>
        )}

        {/* The reason — a panel the button OPENS, not a field the row wears.
            It used to appear inline the instant the stepper moved, which put a
            text box on a control row before anybody had said they wanted to
            send anything, and pushed the two right-hand slots off their marks
            while it was there. Changing a figure is not the same act as asking
            for it: the stepper states the number, the button says send, and
            this is where the sentence that goes with it is written. */}
        {open && (
          <div className={`${HOVER_BRIDGE} right-0`} ref={panelRef}>
            <div
              role="dialog"
              aria-label="Ask for this much time"
              className="frost-bar w-[300px] rounded-panel border border-hairline p-3.5 shadow-[var(--deck-seat)]"
            >
              <p className="text-[13px] font-medium text-ink">
                Ask for {hoursMinutes(secs ?? 0)}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {reasonRequired
                  ? "The engine will not record a refused window without a reason. Say what the work actually takes."
                  : "Optional, and worth writing — the person approving it sees this and nothing else."}
              </p>
              <textarea
                value={reason}
                autoFocus
                rows={3}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAsking(false);
                }}
                placeholder="Why this much time?"
                aria-label="Why this much time"
                className="mt-2.5 w-full resize-none rounded-panel bg-[var(--surface-sunken)] px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-muted)]"
              />
              {proposeState.error && (
                <p
                  role="alert"
                  className="mt-2 text-[11px] leading-relaxed text-[var(--state-overdue-ink)]"
                >
                  {proposeState.error}
                </p>
              )}
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  className={PILL_GREY}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || (reasonRequired && reason.trim() === "")}
                  onClick={() => void propose()}
                  className={PILL}
                >
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Slot>
    </>
  );
}

/**
 * When the work is due — on EVERY state of the bar, not only while the terms
 * are being agreed.
 *
 * It arrived beside the budget stepper, where it answers "four hours by when?",
 * and stopped the moment the task was accepted — so the deadline was on screen
 * while it was still a proposal and gone once it was a commitment, which is the
 * wrong way round. It is the same figure either way and it sits in the same
 * place, so accepting a task no longer changes what the row is telling you.
 *
 * The committed date where one exists, else the DERIVED completion date — the
 * same pair every other surface reads, and the figure the task page labels
 * "Expected completion". A budget-only task never gets a committed deadline, so
 * falling back is what stops this reading "Not set" on the majority of work.
 *
 * **With the clock on it, not just the day.** A deadline is an instant, and
 * "17 Aug" is a whole working day of ambiguity about an instant — the reader has
 * to guess whether it means first thing, close of play, or the moment their
 * hours happen to run out. `formatDateTime` is the product's existing way of
 * saying a date with its time and carries the zone, which the bar needs more
 * than most surfaces: the clock in the page header is IST too, and two times on
 * one screen meaning different zones is the kind of thing nobody catches until
 * they miss something.
 */
function DeadlineCell({ view }: { view: TaskView }) {
  const eta = formatDateTime(
    view.task.deadline.dueAt ?? view.task.deadline.operationalDueAt,
  );
  return (
    <div className="shrink-0 text-right whitespace-nowrap">
      <p className="text-[11px] leading-4 text-ink-faint">Task deadline</p>
      <p
        data-figure
        className="mt-0.5 text-[13px] leading-4 tabular-nums text-ink"
      >
        {eta}
      </p>
    </div>
  );
}

/**
 * The clock, and what it does not have room to say.
 *
 * Dropping the row's captions took the remaining-budget figure off the bar. It
 * is not gone: hovering the clock opens a panel with the figure in words, and —
 * because "I am running out of time" and "I need more" are the same thought —
 * the way to ask for more, right beside it. Reaching that used to mean opening
 * the task and finding the deadline tab.
 *
 * **The request is made HERE**, in the same shape the terms were agreed in: a
 * stepper for how much, a box for why, and one button that sends it. It used to
 * be a link onto the task's deadline page — a different screen, a different
 * form and a different set of words for the identical negotiation the reader
 * had already been through once on this very row. `requestTimeBudgetExtension`
 * is the write, so the figure still goes to the manager and still comes back
 * for confirmation exactly as it does from the task page.
 */
function TimerCell({
  view,
  blocked,
  breached,
  running,
  timeLeft,
}: {
  view: TaskView;
  blocked: ReturnType<typeof deadlineBlock>;
  breached: boolean;
  running: boolean;
  timeLeft: string | null;
}) {
  const { open, show, hide } = useHoverPanel();
  /* The form is CLICK-opened, not hover-opened. A panel you have to keep the
     pointer inside is fine for a sentence and impossible for a text box —
     reaching the keyboard is leaving the trigger. The hover panel is suppressed
     while it is up so the two never stack. */
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLDivElement | null>(null);
  const askBtnRef = useRef<HTMLButtonElement | null>(null);
  useDismiss(asking, () => setAsking(false), [askRef, askBtnRef]);

  return (
    <div
      className={`relative ${COL_ACTION}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {/* **Whatever the clock renders fills the slot.**
          This targeted `button` only, and `TimerControl` does not always give
          you one: blocked, stale and not-yours are all non-interactive spans.
          Those fell back to their own content width and sat visibly narrower
          than every other control on the row — the blocked clock in particular,
          which is the one state where the row should look most like itself.
          `[&>*]` is the child whatever tag it turns out to be, so the slot's
          geometry stops depending on the branch inside it. */}
      <div
        className={`[&>*]:w-full [&>*]:justify-center ${running ? "" : FORCE_WHITE}`}
      >
        {/* Blocked is not a different control — `TimerControl`'s own bar branch
            keeps the figure and turns it amber. The bar used to swap in a
            "Blocked" pill here instead, which took the time off the row at the
            moment somebody most wanted to see it. */}
        <TimerControl
          key={view.task.id}
          view={view}
          size="bar"
          tone={breached || blocked ? "warn" : "default"}
        />
      </div>

      {open && !asking && (
        /* Right-aligned: this is the last column on the row, so a panel opening
           leftward from its left edge would hang off the page. */
        <div className={`${HOVER_BRIDGE} right-0`}>
          <div
            role="tooltip"
            className="frost-bar w-[260px] rounded-panel border border-hairline p-3.5 shadow-[var(--deck-seat)]"
          >
            <p
              className={`text-[13px] font-medium ${
                blocked || breached
                  ? "text-[var(--state-warn-ink)]"
                  : "text-ink"
              }`}
            >
              {blocked
                ? "The deadline has passed"
                : (timeLeft ?? "No time budget set")}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              {blocked
                ? blockedMessage(blocked)
                : breached
                  ? "The clock is past its budget. More time has to be agreed before this counts as on schedule."
                  : "Against the time agreed for this task."}
            </p>
            <button
              type="button"
              ref={askBtnRef}
              aria-haspopup="dialog"
              onClick={() => setAsking(true)}
              className={`${PILL_GREY} mt-3`}
            >
              Request more time
            </button>
          </div>
        </div>
      )}

      {asking && (
        <div className={`${HOVER_BRIDGE} right-0`} ref={askRef}>
          <RequestMoreTime view={view} onClose={() => setAsking(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * The task, in an inset the whole of which is the link.
 *
 * Hovering it opens the brief — reference, description and completion
 * requirements — so "what am I actually being asked to do" is answerable from
 * the bar without navigating away and losing your place. It is a `title`-free
 * panel rather than a native tooltip because requirements are a LIST, and a
 * browser tooltip renders one as a wall of text with no structure.
 *
 * Keyboard reaches it too: the inset is a link, so focus opens the same panel
 * that hover does. A brief that only mice can read is not a brief.
 */
function TaskCell({ view, details }: { view: TaskView; details: string }) {
  const { open, show, hide } = useHoverPanel();
  const requirements = view.task.requirements ?? [];
  const description = view.task.description?.trim() || null;
  /* Always worth opening: even with no description or requirements the panel
     carries the reference and the project/due line the row no longer shows. */
  const hasBrief = true;

  return (
    <div
      className={`relative ${COL_TITLE}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <Link
        href={`/tasks/${view.task.id}`}
        onFocus={show}
        onBlur={hide}
        className={`${BOX} bg-[var(--surface-sunken)] font-medium tracking-[-0.02em] text-ink hover:bg-[var(--control)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-muted)]`}
      >
        <span className="truncate">{view.task.title}</span>
      </Link>

      {open && hasBrief && (
        <div className={`${HOVER_BRIDGE} left-0`}>
          <div
            role="tooltip"
            className="frost-bar max-h-[300px] w-[380px] max-w-[80vw] overflow-y-auto rounded-panel border border-hairline p-3.5 shadow-[var(--deck-seat)] scroll-slim"
          >
            <p className="text-[11px] text-ink-faint">
              <span data-figure>{view.task.reference}</span>
              {details ? ` · ${details}` : ""}
            </p>
            {description && (
              <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">
                {description}
              </p>
            )}
            {requirements.length > 0 && (
              <>
                <p className="mt-3 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  To be complete
                </p>
                <ul className="mt-1.5 space-y-1">
                  {[...requirements]
                    .sort((a, b) => a.order - b.order)
                    .map((r) => (
                      <li
                        key={r.id}
                        className="flex items-start gap-2 text-[13px] text-ink"
                      >
                        <span
                          aria-hidden
                          className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                            r.satisfiedAt
                              ? "bg-[var(--state-positive)]"
                              : "bg-[var(--control-active)]"
                          }`}
                        />
                        <span
                          className={
                            r.satisfiedAt ? "text-ink-muted line-through" : ""
                          }
                        >
                          {r.text}
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The bar with nothing on it.
 *
 * Same shell as the real one — same radius, border, surface and vertical
 * padding — so the page does not move when work arrives. It is deliberately
 * quiet: this is the good state, and a call to action here would make an empty
 * queue feel like a problem to solve.
 */
function EmptyBar() {
  return (
    <div className={BAR_SHELL}>
      <Slot className={COL_LEAD}>
        <span
          aria-hidden
          className={`${BOX} justify-center bg-[var(--control)] px-0 text-ink-faint`}
        >
          <Icon.check className="h-4 w-4" />
        </span>
      </Slot>
      <Slot className={COL_TITLE}>
        <p
          className={`${BOX} truncate bg-[var(--surface-sunken)] font-medium tracking-[-0.02em] text-ink`}
        >
          Nothing assigned to you
        </p>
      </Slot>
      <span aria-hidden className="ml-auto" />
      <Slot className={COL_ACTION}>
        <Link href="/tasks?view=tasks" className={PILL}>
          Browse tasks
        </Link>
      </Slot>
    </div>
  );
}

/**
 * The shell every state of the bar wears.
 *
 * Shared rather than copied so the empty state cannot drift from the populated
 * one — the whole point of keeping the bar on the page in all three states is
 * that it is a fixed landmark, and a landmark that changes height as work
 * arrives still moves the page under the reader.  pins it at one 36px
 * control plus the row padding — the height every state now takes, with the
 * captions gone.
 */
const BAR_SHELL =
  "flex min-h-[58px] flex-wrap items-center gap-x-4 gap-y-3 rounded-full border border-hairline bg-[var(--surface-raised)] px-5 py-2.5 shadow-sm";

/**
 * The bar's CONTROL columns are fixed. The title is the one that gives.
 *
 * Everything on this row keeps its width and its place whatever state the task
 * is in, so accepting a budget or starting a clock changes what a slot contains
 * and never where it sits.
 *
 * `TIME` and `ACTION` are the same width, and that width is the timer's: the
 * bar variant of `TimerControl` is `h-9 min-w-[108px]`, so 150px holds it with
 * room for "Approve task" beside it. The three things that ever occupy these
 * slots — the budget stepper, the clock, and the white button — are therefore
 * interchangeable without the row moving.
 *
 * **The title GROWS from zero; every other column is `shrink-0`.** This bar was
 * only ever verified at full width, and it is never MOUNTED at full width: it
 * sits in the left 8 of 12 columns on Overview, which is 901px at the 1360px
 * cap and 685px by the time the deck breakpoint gives out. Five fixed columns
 * came to 864px, so the row wrapped onto four lines at every viewport below
 * 1440 — a landmark whose height depended on the window.
 *
 * Making one column elastic fixes it at every width instead of at one, and the
 * title is the right one: it is the only thing here that degrades gracefully,
 * because it already truncates and half a title still identifies the task. A
 * stepper or a button at 70% is unusable.
 *
 * It grows rather than shrinks, and the distinction is the whole fix. A 400px
 * basis with `shrink` does nothing on a wrapping row — **flex wraps before it
 * shrinks**, so an item that would have to give up 60px moves to the next line
 * instead, which is exactly the four-line bar this replaced. From a basis of
 * zero the line can never overflow, so it never wraps, and the title takes
 * whatever the fixed columns leave. `max-w` keeps it from running away on a
 * wider mount; `min-w` is the floor at which wrapping becomes the honest answer
 * rather than showing two characters of a title.
 */
/** The leading slot — the priority picker, or the empty state's glyph. Fixed so
    the title starts at the same x whatever is to its left, and so a "P—" tag
    does not sit the row two pixels off a "P1" one. */
const COL_LEAD = "w-[56px] shrink-0";
const COL_TITLE = "min-w-[140px] max-w-[400px] flex-1 basis-0";
const COL_TIME = "w-[150px] shrink-0";
const COL_ACTION = "w-[150px] shrink-0";
/** The box every control on the bar wears: same height, same corner, always. */
const BOX =
  "inline-flex h-9 w-full items-center rounded-full px-3.5 text-[13px] transition-colors";
/** The white pill — the decision, and the timer that replaces it. */
const PILL = `${BOX} justify-center bg-ink font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50`;
/** The grey pill — a real action, but the secondary one on the row. */
const PILL_GREY = `${BOX} justify-center bg-[var(--control)] font-medium text-ink hover:bg-[var(--control-hover)]`;
/* The amber pill that used to stand in for a blocked clock is gone with it —
   `TimerControl`'s own bar branch keeps the figure and turns it amber, so there
   is one blocked appearance rather than two that have to be kept in step. */

/**
 * Force the timer white while it is IDLE.
 *
 * `TimerControl` fills white only while a session is running and greys itself
 * at rest, which is right in a task row: there the clock is one cell among
 * many, and grey says "not counting". On this bar it is the row's whole point
 * and sits where the decision button was — a grey Start after a white Approve
 * reads as the control having been disabled by pressing it. Scoped here rather
 * than changed in `TimerControl`, because the row and the detail panel still
 * want the quiet version.
 *
 * Only applied when nothing is running, so the live clock keeps its own
 * colours — including the amber it turns over budget.
 */
const FORCE_WHITE =
  "[&_button]:bg-ink [&_button]:text-[var(--body-bg)] [&_button:hover]:bg-ink [&_button:hover]:text-[var(--body-bg)] [&_button:hover]:opacity-90";

/**
 * One column. A fixed width and nothing else.
 *
 * **No captions.** Every column used to carry an eyebrow — "Task detail",
 * "Time budget" — and the two with nothing to say carried a blank one purely
 * to keep the row level. That is a lot of structure spent on labels nobody
 * reads twice, and it made the alignment depend on all four captions staying
 * exactly one line tall. One row of controls and no text above them, and the
 * alignment is a property of the layout rather than something maintained.
 *
 * What the captions carried is not lost: the project and due date are in the
 * task's hover brief, and the remaining budget is in the timer's.
 */
function Slot({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={className}>{children}</div>;
}

/**
 * Hover state that does not slam shut on the way to the panel.
 *
 * A panel that opens 8px below its trigger has 8px of nothing between them, and
 * crossing that gap leaves the trigger — so reaching for the panel closed it,
 * every time. Two fixes, both needed:
 *
 *  · **The delay.** Leaving schedules a close rather than performing one, and
 *    re-entering anything in the group cancels it. 220ms is long enough to
 *    cross a gap and short enough that a panel never feels stuck to the cursor.
 *  · **The bridge.** `HOVER_BRIDGE` gives the panel top padding instead of a
 *    top offset, so the gap is INSIDE the hoverable element and the pointer
 *    never actually leaves. The delay then only has to cover the diagonal
 *    overshoot people make with a mouse.
 *
 * The timeout is cleared on unmount: a bar whose task changes while a panel is
 * closing would otherwise set state on a component that is gone.
 */
function useHoverPanel(closeDelayMs = 220) {
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closing.current !== null) clearTimeout(closing.current);
    },
    [],
  );

  function show() {
    if (closing.current !== null) {
      clearTimeout(closing.current);
      closing.current = null;
    }
    setOpen(true);
  }
  function hide() {
    if (closing.current !== null) clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      closing.current = null;
      setOpen(false);
    }, closeDelayMs);
  }
  return { open, show, hide };
}

/**
 * Escape, and a click anywhere that is not the panel or the thing that opened
 * it, close a CLICK-opened panel.
 *
 * The hover panels on this bar do not need it — leaving them is how they close.
 * A panel you opened deliberately has no such gesture: without this the only
 * way out of the reason box is to press the button that opened it again, which
 * nobody thinks to do while looking at an open dialog.
 *
 * The trigger is in `ignore` alongside the panel because it toggles. Without
 * that, its own click would be seen out here first, close the panel, and then
 * the button's handler would immediately reopen it — a control that cannot be
 * switched off.
 *
 * `pointerdown`, not `click`: a drag that starts inside the panel and ends
 * outside it is a text selection, and closing on the release would throw away
 * whatever the reader was in the middle of highlighting.
 */
function useDismiss(
  open: boolean,
  close: () => void,
  ignore: React.RefObject<HTMLElement | null>[],
) {
  /* Read through a ref so the effect depends on `open` alone: `ignore` is a
     fresh array every render, and depending on it would tear the listener down
     and rebuild it on every keystroke in the box it is protecting. */
  const latest = useRef({ close, ignore });
  useEffect(() => {
    latest.current = { close, ignore };
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const { close: fn, ignore: refs } = latest.current;
      if (refs.some((r) => r.current?.contains(target))) return;
      fn();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current.close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
}

/** Positions a hover panel so its 8px gap is part of its own hit area. */
const HOVER_BRIDGE = "absolute top-full z-50 pt-2";

/** Whole hours and minutes only — never seconds, so this reads as a budget
    rather than a second clock ticking beside the timer. */
function hoursMinutes(secs: number): string {
  const total = Math.max(0, Math.floor(secs / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}
/** Drop a write's payload, keeping only whether it worked and why not. The two
    settle paths return different records and the bar reads neither — it
    re-renders from the queries the write invalidates. */
function discard(res: ActionResult<unknown>): ActionResult<void> {
  return res.ok ? { ok: true, data: undefined } : res;
}

const priorityLabel = (v: TaskView): string =>
  v.myRank ? `P${v.myRank}` : "P—";

function Bar({
  queue,
  running,
  viewerId,
  startedAtRealMs: runningStartedAt,
}: {
  queue: TaskView[];
  running: TaskView | null;
  /** Whose bar this is — decides whether a pre-start task offers its decision. */
  viewerId: string;
  /** The running session's real start, or null when nothing is running. */
  startedAtRealMs: number | null;
}) {
  /* The tasks the picker offers, priority-ordered. The running task is included
     even on the rare occasion the queue has not surfaced it yet. */
  const options =
    running && !queue.some((v) => v.task.id === running.task.id)
      ? [running, ...queue]
      : queue;
  const ordered = [...options].sort(
    (a, b) => (a.myRank ?? 99) - (b.myRank ?? 99),
  );

  /* Which task is on the bar. Defaults to whatever is running, else the top
     priority; the picker overrides it. */
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const displayed =
    ordered.find((v) => v.task.id === selectedTaskId) ??
    running ??
    ordered[0] ??
    null;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isRunningShown =
    !!running && !!displayed && running.task.id === displayed.task.id;
  const startedAtRealMs = isRunningShown ? runningStartedAt : null;
  /* Feeds only the remaining-budget figure; the clock itself is TimerControl's,
     so the two never disagree. Called before the guard below so the hook order
     is stable whether or not there is a task to show. */
  const ticked = useTicker(startedAtRealMs);
  /* Resolved after mount, like every other clock read in this codebase. Null on
     the first paint, which reads as "not blocked" — the safe way round, since a
     task wrongly shown as blocked cannot be started. */
  const now = useNow();

  if (!displayed) return <EmptyBar />;

  /* **Settled**, not "started" — the terms are agreed, so a session may exist.
     `confirmed` counts as well as `in_progress`: accepting the budget is what
     turns this half of the bar into the timer, and on a confirmed task the
     timer is exactly the control that starts the work. Every EARLIER status is
     still a negotiation, and a clock over a negotiation would be timing work
     nobody has agreed to do. */
  const started =
    displayed.task.status === "in_progress" ||
    displayed.task.status === "confirmed";
  const action = nextAction(displayed, viewerId);

  const logged = displayed.loggedSecs + ticked;
  const estimate = displayed.task.estimatedEffortSecs;
  const overBudget = estimate != null && logged >= estimate;
  /* The one place "time limit breached" is decided — over budget, or past the
     committed date. TimerControl is told the answer via `tone`. */
  const breached = displayed.isOverdue || overBudget;
  /* The same rule the timer itself asks, so the bar and the task panel cannot
     disagree about whether a clock may run. `now` comes from the shared clock
     rather than `Date.now()` — reading the wall clock during render is impure
     and makes the first paint disagree with the server's. */
  const blocked = deadlineBlock({
    dueAt: displayed.task.deadline.dueAt,
    nowMs: now?.getTime() ?? 0,
    isActionable:
      displayed.task.status !== "completed" &&
      displayed.task.status !== "cancelled",
  });

  /* The label over the title. A project name when there IS one; otherwise
     "Task detail" — naming what the line below is, rather than "No project",
     which spent the row's only label saying what the task is not. A due date
     joins the project when both exist. */
  const details =
    [
      displayed.project?.name ?? null,
      displayed.task.deadline.dueAt
        ? `due ${formatDate(displayed.task.deadline.dueAt)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Task detail";

  const timeLeft =
    estimate == null
      ? null
      : overBudget
        ? `Over by ${hoursMinutes(logged - estimate)}`
        : `${hoursMinutes(estimate - logged)} left`;

  return (
    <div className={BAR_SHELL}>
      {/* 1 · Priority picker — chooses which task the bar shows. */}
      <div ref={rootRef} className={`relative ${COL_LEAD}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Show another priority"
          className={`${BOX} justify-center gap-1 bg-[var(--control)] px-2 font-medium text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink`}
        >
          <span data-figure>{priorityLabel(displayed)}</span>
          <Icon.chevronDown className="h-3 w-3 shrink-0" />
        </button>

        {open && ordered.length > 0 && (
          <div
            role="menu"
            aria-label="Pick a task by priority"
            className="frost-bar absolute top-[calc(100%+8px)] left-0 z-50 max-h-[280px] w-[240px] overflow-y-auto rounded-panel border border-hairline p-1.5 shadow-[var(--deck-seat)]"
          >
            {ordered.map((v) => {
              const on = v.task.id === displayed.task.id;
              return (
                <button
                  key={v.task.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => {
                    setSelectedTaskId(v.task.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors ${
                    on
                      ? "bg-[var(--control-active)]"
                      : "hover:bg-[var(--control)]"
                  }`}
                >
                  <span
                    data-figure
                    className="w-8 shrink-0 rounded-full bg-[var(--control)] py-0.5 text-center text-[11px] text-ink-muted"
                  >
                    {priorityLabel(v)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {v.task.title}
                  </span>
                  {on && (
                    <Icon.check className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2 · What this is, then which task. */}
      <TaskCell view={displayed} details={details} />

      {started ? (
        <>
          {/* The same reserved gap the terms state leaves, so nothing to its
              right moves when a task is accepted. */}
          <span aria-hidden className="ml-auto" />

          {/* And the same deadline, in the same place. Accepting a task changes
              what the two right-hand slots DO; it must not change what the row
              tells you about when the work is due. */}
          <DeadlineCell view={displayed} />

          {/* 3 · Submit, GREY and on the left. It is a real move but the
                secondary one while work is running — the clock is what the row
                is about — so it takes the quieter fill and the inner slot. */}
          <Slot className={COL_TIME}>
            <Link
              href={`/tasks/${displayed.task.id}/submission`}
              className={PILL_GREY}
            >
              Submit
            </Link>
          </Slot>

          {/* 4 · The clock, WHITE, in the slot the decision button occupied —
                which is what "approving turns into the timer" means on screen. */}
          <TimerCell
            view={displayed}
            blocked={blocked}
            breached={breached}
            running={isRunningShown}
            timeLeft={timeLeft}
          />
        </>
      ) : (
        <Terms
          key={displayed.task.id}
          view={displayed}
          viewerId={viewerId}
          action={action}
        />
      )}
    </div>
  );
}
