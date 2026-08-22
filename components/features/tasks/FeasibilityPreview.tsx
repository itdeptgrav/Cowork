"use client";

import { useEffect, useState } from "react";
import { Button, InlineError } from "@/components/ui/Primitives";
import { useAction, useRepo } from "@/lib/hooks/useRepository";
import { useListReorder } from "@/lib/hooks/useListReorder";
import { PriorityConfirmDialog } from "./PriorityConfirmDialog";
import type { QueueSnapshotRow } from "@/lib/rules/tasks/priorityPreview";
import { formatDurationTimer, formatStamp } from "@/lib/utils/format";
import type {
  Feasibility,
  SimulatedEntry,
} from "@/lib/rules/tasks/deadlineFeasibility";

/**
 * Will this land in time if it goes here?
 *
 * **This component calculates nothing.** It calls
 * `previewDeadlineFeasibility` and renders what comes back — the queue
 * simulation, the working calendar and the buffer all live in
 * `deadlineFeasibility.ts`, and a second opinion computed here would be a
 * second answer to the same question.
 *
 * It re-asks as the priority changes, debounced: somebody dragging through
 * five positions should not fire five queries, and an answer that arrives after
 * the one for the position they actually chose would render the wrong verdict.
 */

/** Long enough to skip the positions somebody passes through on the way. */
const SETTLE_MS = 350;

function Verdict({ result }: { result: Feasibility }) {
  const buffer = result.bufferSeconds;
  const ok = result.feasible;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span
        className={`inline-flex items-center gap-1.5 text-[13px] ${
          ok ? "text-ink" : "text-[var(--danger,#c4553d)]"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            ok ? "bg-[var(--positive,#3f9d6b)]" : "bg-[var(--danger,#c4553d)]"
          }`}
        />
        {ok ? "\u2713 Deadline achievable" : "\u26a0 Deadline risk"}
      </span>
      {buffer !== null && (
        <span data-figure className="text-[12px] text-ink-faint">
          {buffer >= 0
            ? `${formatDurationTimer(buffer)} buffer remaining`
            : `misses by ${formatDurationTimer(-buffer)}`}
        </span>
      )}
    </div>
  );
}

export function FeasibilityPreview({
  employeeId,
  employeeName,
  taskId,
  proposedPriority,
  estimatedWorkSeconds,
  committedDeadline,
  selectable = false,
  subjectTitle,
  budgetControl,
}: {
  /** Whose week this is measured against — the assignee, never the viewer. */
  employeeId: string | null;
  /** Named on the card, so it is never ambiguous whose workload was used. */
  employeeName?: string | null;
  /**
   * Whether the reader may move the task while previewing.
   *
   * Off where the position is decided elsewhere in the flow — offering a
   * control that does not persist would read as setting the priority.
   */
  selectable?: boolean;
  /**
   * The subject task's real name.
   *
   * The queue renders it as "This task", which is right in a list the reader is
   * placing it into — but wrong in a confirmation captioned as their whole
   * queue, where every other row carries a name. Optional, because the panel is
   * also used where there is no task yet.
   */
  subjectTitle?: string;
  /**
   * The budget selector, rendered by whoever owns the number.
   *
   * **A slot rather than a callback, because there is now exactly ONE budget
   * control.** This panel used to draw its own row of hour chips while the form
   * above it drew a dropdown — two controls for one value, kept in step by
   * wiring both to the same `hours`. They could not disagree, but a reader had
   * no way to know that: two controls side by side is a promise that they do
   * different things. The set they offered was not even the same (`1 2 4 8 12
   * 16` against `1 2 3 4 6 8 12 16 24 40`), so the dropdown could show a number
   * no chip could reach.
   *
   * Passing the control in means the panel cannot grow a second one. It renders
   * where the decision belongs — beside the dates the choice moves — and the
   * priority dialog, which changes an order rather than an estimate, simply
   * passes nothing.
   */
  budgetControl?: React.ReactNode;
  taskId?: string;
  /**
   * Where the reader is CONSIDERING putting it, 1-based.
   *
   * Optional, and omitting it is right wherever nobody is choosing. The rule
   * then uses where the task already sits in the assignee's queue, or the back
   * for one not in it yet. Passing a stand-in — `myRank ?? myStoredRank ?? 1`
   * was the one that shipped, and both are null unless the VIEWER is an
   * assignee — previewed every cross-department task at P1, so nothing was
   * ahead of it and it appeared to start immediately.
   */
  proposedPriority?: number | null;
  estimatedWorkSeconds: number;
  committedDeadline: string | null;
}) {
  const repo = useRepo();
  /* The position being PREVIEWED, which is not necessarily the one that will be
     saved — this card asks "what if", and the answer must be explorable
     without committing to it. Reset by the prop changing, so a real priority
     change elsewhere still leads. */
  const [tryPosition, setTryPosition] = useState<number | null>(null);
  /* Null means "wherever it really is" — passed straight through, never
     replaced with a guess. Only a reader who has pressed a chip or dragged a
     row has expressed a position. */
  const position = tryPosition ?? proposedPriority ?? null;

  /* The DRAGGED order: task ids front to back, or null for "however the engine
     ranks them". Null rather than a copy of the engine's order, so a queue that
     changes underneath — somebody finishes a task while this is open — is
     picked up instead of being pinned to a stale list. */
  const [order, setOrder] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [applied, setApplied] = useState(false);
  /* The confirmation standing between a dragged order and the write. Null until
     somebody presses Apply; nothing is saved while it is open. */
  const [confirming, setConfirming] = useState(false);
  const subjectId = taskId ?? "__proposed__";

  /* Keyed by the inputs. A verdict computed for four hours must never be shown
     beside a dropdown reading twelve — so the answer carries the question it
     answers, and anything else reads as "still checking". */
  const key = `${employeeId}|${position}|${estimatedWorkSeconds}|${committedDeadline}|${order?.join(",") ?? ""}`;
  const [answer, setAnswer] = useState<{
    key: string;
    result: Feasibility;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  /**
   * The engine's last answer, and whether it is still the answer to what is on
   * screen.
   *
   * **The panel no longer empties itself between answers.** It used to drop to
   * `null` the instant an input changed, which meant every single drop replaced
   * the whole card — verdict, dates, queue, chips, reason field — with one line
   * of text for the settle delay plus a four-way Firestore read. That blank was
   * the largest part of the reported lag, and it also destroyed the very DOM
   * nodes a reorder animation needs.
   *
   * The rule at the top of this file still holds: an answer must never be shown
   * beside inputs it does not answer. `stale` is how it holds. The ORDER stays
   * live because it is the reader's own arrangement rather than a computed
   * figure; everything derived from it is marked and dimmed until the engine
   * has caught up. `useRepository` already draws this distinction — stale is not
   * the same as absent.
   */
  const result = answer?.result ?? null;
  const stale = answer !== null && answer.key !== key;

  /* What "apply" would write: the employee's REAL tasks in the order on
     screen. A task not yet assigned to them cannot be in their queue, so it is
     dropped — its position is carried by the estimate this form is setting,
     not by a reorder of work it is not yet part of. Derived, not held: a stale
     copy would send an order the reader is no longer looking at. */
  const applyIds = (
    order ??
    result?.simulatedQueue.map((e) => e.taskId) ??
    []
  ).filter((id) => id !== "__proposed__");

  /* The ONE write this panel can make, and only from the button below.
     `reorderPriorities` is the same call the priority dialog uses, so a manager
     reordering from here goes through the same permission check, the same
     cascade and the same acknowledgement as anywhere else. */
  const [applyOrder, applyState] = useAction((r) =>
    r.reorderPriorities(employeeId ?? "", applyIds, reason.trim()),
  );
  const applying = applyState.isPending;
  const applyError = applyState.error;

  /* The order ON SCREEN: the reader's arrangement if they have made one, else
     the engine's. Derived before any early return, because the drag hook below
     is a hook and cannot sit behind one. */
  const rowIds = order ?? result?.simulatedQueue.map((e) => e.taskId) ?? [];

  /* Dragging is offered only where trying a position is — the same rule, since
     both do the same thing by different means. A queue of one has no order to
     rearrange, so the handles would be decoration. */
  const reorderable = selectable && rowIds.length > 1;

  /* The drag itself lives in `useListReorder`: one state change per gesture, an
     insertion line moved outside React, and the drop bound to the LIST so a
     release between two rows cannot be swallowed. The arithmetic is
     `lib/rules/ui/dragReorder.ts`, which is where the downward off-by-one is
     tested rather than asserted against this file's source. */
  const {
    dragId,
    listProps: dragListProps,
    itemProps,
    setListNode,
    setIndicatorNode,
    setRowNode,
  } = useListReorder({
    ids: rowIds,
    enabled: reorderable,
    onReorder: (next) => {
      setOrder(next);
      /* The chips read the same order, so the two controls cannot disagree
         about where this task now sits. */
      setTryPosition(next.indexOf(subjectId) + 1);
    },
  });

  useEffect(() => {
    if (!employeeId || estimatedWorkSeconds <= 0) return;
    /* Not while a drag is in flight. A preview landing mid-gesture re-renders the
       list, which invalidates the row offsets measured at `dragstart` — and an
       answer for an order the reader has not settled on is noise anyway. */
    if (dragId !== null) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      void repo
        .previewDeadlineFeasibility({
          taskId,
          employeeId,
          proposedPriority: position,
          estimatedWorkSeconds,
          committedDeadline,
          orderOverride: order,
        })
        .then((r) => {
          if (!cancelled) setAnswer({ key, result: r });
        })
        .catch(() => {
          /* A preview is an aid, not a gate. If it cannot be computed the form
             still works — saying so is better than a spinner that never
             resolves or a verdict nothing produced. */
          if (!cancelled) setFailedKey(key);
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    repo,
    key,
    employeeId,
    taskId,
    position,
    estimatedWorkSeconds,
    committedDeadline,
    order,
    dragId,
  ]);

  if (!employeeId || estimatedWorkSeconds <= 0) return null;

  const failed = failedKey === key;

  /* **Both waiting states still carry the budget control.** It is the one thing
     on this card that is not a preview: dropping it while the engine is thinking
     would take the form's only input away for the length of a round trip, and
     dropping it on failure would strand a reader who has just been told the
     preview is the part that is broken. */
  if (failed) {
    return (
      <div className="mt-3 rounded-inset border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3.5 py-3">
        <p className="text-[12px] text-ink-faint">
          The deadline preview is unavailable. You can still set the priority.
        </p>
        {budgetControl && <div className="mt-3">{budgetControl}</div>}
      </div>
    );
  }

  if (!result) {
    /* FIRST load only. Once there is an answer the panel keeps it and marks the
       order-dependent figures as recomputing — see `stale`. Emptying the card on
       every drop is what made this feel slow. */
    return (
      <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
        <p className="text-[12px] text-ink-faint">Checking deadline impact…</p>
        {budgetControl && <div className="mt-3">{budgetControl}</div>}
      </div>
    );
  }

  /* Rows in the order on screen, each hydrated from the last answer. Title and
     duration do not depend on the order and stay exact; the date and the delay
     do, and are dimmed while `stale`. */
  /* "This task" is the right label inside the queue the reader is placing it
     into, and the wrong one in a confirmation listing their whole week. */
  const taskTitleFor = (e: SimulatedEntry) =>
    e.taskId === subjectId ? (subjectTitle ?? e.title) : e.title;

  const entryById = new Map(result.simulatedQueue.map((e) => [e.taskId, e]));
  const rows = rowIds
    .map((id) => entryById.get(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  /* A chip is a drag by other means. It must move the task within whatever
     order is currently on screen — setting `tryPosition` alone would be
     ignored the moment an override exists, so the button would look broken. */
  const moveSubjectTo = (p: number) => {
    setTryPosition(p);
    if (!order) return;
    const from = order.indexOf(subjectId);
    if (from === -1) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, p - 1)), 0, subjectId);
    setOrder(next);
  };

  /* What "apply" would actually write: the employee's REAL tasks in the dragged
     order. A task not yet assigned to them cannot be in their queue, so it is
     dropped from the payload — its position is carried by the estimate this
     form is setting, not by a reorder of work it is not part of yet. */
  const changed = order !== null;

  /* Bars are drawn against the longest task, so the queue reads as relative
     effort. Against the TOTAL, every bar on a busy queue becomes a sliver. */
  const longest = Math.max(
    1,
    ...result.simulatedQueue.map((e) => e.estimatedDuration),
  );

  /* Whether there is a right-hand half at all. With no queue to place the task
     into, a two-column grid would be one column of content beside a hole. */
  const hasQueue = result.simulatedQueue.length > 0;

  /**
   * The left half's facts, in the order somebody reads them: when it starts,
   * when it lands, and what it has to beat.
   *
   * Built as data rather than three near-identical blocks so the row markup —
   * label left, figure right, hairline between — is written once and cannot
   * drift between the three.
   */
  const facts: { label: string; value: string; lead?: boolean }[] = [
    ...(result.estimatedStartTime
      ? [
          {
            label: "Estimated start",
            value: formatStamp(result.estimatedStartTime),
          },
        ]
      : []),
    ...(result.estimatedCompletionTime
      ? [
          {
            label: "Estimated completion",
            value: formatStamp(result.estimatedCompletionTime),
            /* The one figure the budget actually moves, so it carries full ink
               while the other two stay muted context. */
            lead: true,
          },
        ]
      : []),
    ...(result.deadline
      ? [{ label: "Required deadline", value: formatStamp(result.deadline) }]
      : []),
  ];

  return (
    <div
      data-help="feasibility-preview"
      /* `@container` so the split below measures THIS panel rather than the
         window — see the grid's own note. */
      className="@container mt-3 rounded-inset border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3.5 py-3"
    >
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Deadline feasibility
      </p>

      {/* WHOSE week. On a cross-department task the reader is a manager in a
          different department, and "based on the workload" without a name
          invites them to assume it is their own. */}
      <p className="mt-0.5 text-[12px] text-ink-faint">
        Based on{" "}
        {employeeName ? `${employeeName}\u2019s` : "the assignee\u2019s"}{" "}
        workload · queue position{" "}
        <span data-figure>P{result.simulatedPosition}</span>
      </p>

      {/*
        The two halves.

        LEFT is the commitment: the dates this budget produces, the verdict on
        them, and the budget control itself. RIGHT is the placement: the
        assignee's real queue and where this task sits in it.

        That is the actual seam in the decision — set a number and read its
        consequence on one side, decide what it displaces on the other. Before
        this the two were stacked in a single ribbon down the middle of a panel
        twice as wide as it needed, so the question and its context could not be
        held in one glance.

        **The split is a CONTAINER query, not a viewport one.** This same panel
        is mounted inside `PriorityDialog` at ~512px, where two columns would be
        two cramped ones. `@3xl` measures the panel's OWN width, so the dialog
        stays a single column and the detail page splits — neither has to be told
        which it is.
      */}
      <div
        className={`mt-3 grid items-start gap-x-6 gap-y-5 ${
          hasQueue ? "@3xl:grid-cols-2" : ""
        }`}
      >
        <section>
          {/* Label left, figure right, hairline between — the house's own
              separation language, and it stands all three figures on one
              optical edge so they can be compared by eye rather than hunted
              for. */}
          {facts.length > 0 && (
            <dl className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
              {facts.map((f) => (
                <div
                  key={f.label}
                  className="flex items-baseline justify-between gap-4 py-1.5"
                >
                  <dt className="text-[11px] text-ink-faint">{f.label}</dt>
                  <dd
                    data-figure
                    className={`text-[12px] ${f.lead ? "text-ink" : "text-ink-muted"}`}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-2.5">
            <Verdict result={result} />
          </div>

          {/* The budget sits UNDER its own consequence, not above it. The dates
              and the verdict are what the number is for, and a control placed
              after them reads as "and this is how you change that". */}
          {budgetControl && (
            <div className="mt-4 border-t border-[var(--hairline)] pt-3">
              {budgetControl}
            </div>
          )}
        </section>

        {/*
          THE ASSIGNEE'S REAL QUEUE, in the order this placement would produce.
          Straight from `simulatedQueue`, which the engine built from
          `assigneePriorities[employeeId]` through the same builder production
          sorts on — no second list is assembled here, and none could be, because
          the component never sees a raw task.

          This is the context the decision actually needs: a buffer figure says
          whether it fits, and only the queue says what it displaces.
        */}
        {hasQueue && (
          <section
            /* A hairline rule, and only once the columns are actually side by
             side — stacked, the gap already separates them and a line across
             the panel would read as a divider between sections. */
            className="@3xl:border-s @3xl:border-[var(--hairline)] @3xl:ps-6"
          >
            <p className="text-[11px] text-ink-faint">
              {employeeName ? `${employeeName}\u2019s queue` : "Priority queue"}
            </p>

            <ol
              /* `relative`, because the insertion line is positioned inside it.
               The line is OUT OF FLOW on purpose: the version this replaces
               pushed the rows apart with a real element, which moved the very
               rows whose measurements decided where it should be drawn — so it
               chased itself and stalled. Nothing moves during a drag now. */
              className="relative mt-1.5 space-y-1"
              ref={setListNode}
              {...dragListProps}
            >
              <div
                aria-hidden
                /* Written to imperatively by the hook. Do NOT give this a `style`
                 prop — it would silently fight those writes. */
                ref={setIndicatorNode}
                className="drop-line pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 -mt-px rounded-full bg-ink/45"
              />
              {rows.map((e, i) => {
                const isThis = e.taskId === subjectId;
                const width =
                  longest > 0 ? (e.estimatedDuration / longest) * 100 : 0;
                const dragging = dragId === e.taskId;
                return (
                  <li
                    key={e.taskId}
                    ref={setRowNode(e.taskId)}
                    className="flip-row"
                  >
                    <div
                      {...itemProps(e.taskId)}
                      className={`rounded-[6px] px-1.5 py-1 transition-opacity duration-150 ${
                        isThis ? "bg-[var(--control)]" : ""
                      } ${dragging ? "opacity-40" : ""} ${
                        reorderable ? "cursor-grab active:cursor-grabbing" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {reorderable && (
                          <span
                            aria-hidden
                            className="w-2 shrink-0 self-center text-[11px] leading-none text-ink-faint/60 select-none"
                          >
                            {"\u22ee\u22ee"}
                          </span>
                        )}
                        <span
                          data-figure
                          className={`w-7 shrink-0 text-[11px] ${
                            isThis ? "text-ink" : "text-ink-faint"
                          }`}
                        >
                          P{i + 1}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[12px] ${
                            isThis ? "text-ink" : "text-ink-muted"
                          }`}
                        >
                          {isThis ? "This task" : e.title}
                        </span>
                        <span
                          data-figure
                          className="text-[11px] text-ink-faint"
                        >
                          {formatDurationTimer(e.estimatedDuration)}
                        </span>
                      </div>

                      <div
                        className={`mt-0.5 flex flex-wrap items-center gap-x-2 ${
                          reorderable
                            ? "pl-[calc(2.25rem+1rem)]"
                            : "pl-[calc(1.75rem+0.5rem)]"
                        }`}
                      >
                        {/* Effort as a bar, so the queue reads as a shape rather
                          than a column of numbers. Scaled rather than resized:
                          animating `width` re-lays out the whole list for the
                          length of the transition, and a transform composites. */}
                        <span
                          aria-hidden
                          className="h-1 w-[45%] max-w-[45%] overflow-hidden rounded-full"
                        >
                          <span
                            className={`block h-full w-full origin-left rounded-full transition-transform duration-200 ${
                              isThis ? "bg-ink/70" : "bg-ink/20"
                            }`}
                            style={{
                              transform: `scaleX(${Math.max(0.04, width / 100)})`,
                            }}
                          />
                        </span>
                        {/* WHEN it lands — the column the table was missing.
                          Dimmed while the engine is recomputing for an order the
                          reader has just built, because a date is the one figure
                          here that the order changes. */}
                        {e.completionTime && (
                          <span
                            data-figure
                            className={`text-[11px] text-ink-faint ${stale ? "opacity-45" : ""}`}
                          >
                            {formatStamp(e.completionTime)}
                          </span>
                        )}
                        {/* Said either way: "no change" is the reassurance a reader
                          weighing a placement is actually looking for.

                          Worded "delayed", because the figure is WALL-CLOCK slip
                          and not extra effort. Six more hours of budget can delay
                          the task behind it by twenty-one — it spills past 18:00
                          and resumes next morning. That is the honest answer, but
                          a bare "+21:00:00" beside a four-hour task reads as the
                          budget having tripled. */}
                        {isThis ? (
                          <span className="text-[11px] text-ink-faint/70">
                            Added here
                          </span>
                        ) : (
                          <span
                            data-figure
                            className={`text-[11px] ${stale ? "opacity-45" : ""} ${
                              e.movedLaterSeconds > 0
                                ? "text-[var(--danger,#c4553d)]"
                                : "text-ink-faint/70"
                            }`}
                          >
                            {e.movedLaterSeconds > 0
                              ? `delayed +${formatDurationTimer(e.movedLaterSeconds)}`
                              : "no change"}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Said once, under the list, rather than as a spinner over it. The
              order on screen is the reader's own and is never wrong; only the
              dates hanging off it are being redone. */}
            {stale && (
              <p aria-live="polite" className="mt-1 text-[11px] text-ink-faint">
                Recomputing the dates for this order…
              </p>
            )}

            {selectable && (
              <div className="mt-2 space-y-1.5">
                {result.simulatedQueue.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-14 shrink-0 text-[11px] text-ink-faint">
                      Priority
                    </span>
                    {result.simulatedQueue.map((_, i) => {
                      const p = i + 1;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => moveSubjectTo(p)}
                          data-figure
                          /* Lit from the ENGINE's answer, not from `position` —
                           which is null until somebody chooses, and would
                           otherwise leave every chip dark on a task that
                           plainly sits somewhere. */
                          className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                            result.simulatedPosition === p
                              ? "bg-ink text-[var(--body-bg)]"
                              : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)]"
                          }`}
                        >
                          P{p}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* **The budget chips that used to sit here are gone.** They were
                  a second control for a number the form above already had a
                  dropdown for — one value, two widgets, and two different sets
                  of offered hours. The single control now lives in the left
                  column as `budgetControl`, beside the dates it moves. */}

                {/* Nothing above this line has been saved. The panel is a
                  "what if" — and a planner who has just rearranged somebody's
                  week needs telling which of the two states they are in. */}
                {reorderable && (
                  <div className="mt-1 border-t border-[var(--hairline)] pt-2">
                    {changed ? (
                      <>
                        <p className="text-[12px] text-ink-muted">
                          This order is a preview.{" "}
                          {employeeName ? `${employeeName}\u2019s` : "The"} real
                          queue is unchanged until you apply it.
                        </p>
                        {applyError && (
                          <div className="mt-2">
                            <InlineError message={applyError} />
                          </div>
                        )}
                        {applied ? (
                          <p className="mt-2 text-[12px] text-ink">
                            {"\u2713"} Priority applied.
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {/* Opens the confirmation. It writes NOTHING — the
                              reason and the write both live in the dialog, which
                              is where legacy put them too, so nobody reorders
                              somebody else's week without first seeing what it
                              does to their dates. */}
                            <Button
                              tone="primary"
                              size="sm"
                              data-help="feasibility-apply-order"
                              disabled={applying}
                              onClick={() => setConfirming(true)}
                            >
                              Apply this priority
                            </Button>
                            <Button
                              size="sm"
                              disabled={applying}
                              onClick={() => {
                                setOrder(null);
                                setTryPosition(null);
                                setReason("");
                              }}
                            >
                              Reset
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[12px] text-ink-faint">
                        Drag a row to try a different order. Nothing is saved
                        until you apply it.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Named consequences, because a reader deciding between P1 and P3 is
          weighing exactly this. Kept as a sentence rather than only the "+4h"
          markers above, which are easy to miss while scanning. Full width under
          both halves: it is a sentence about the placement AND the budget. */}
      {result.affectedTasks.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Placing it at P{result.simulatedPosition} delays{" "}
          {result.affectedTasks
            .slice(0, 3)
            .map(
              (t) => `${t.title} +${formatDurationTimer(t.movedLaterSeconds)}`,
            )
            .join(", ")}
          {result.affectedTasks.length > 3 &&
            ` and ${result.affectedTasks.length - 3} more`}
          .
        </p>
      )}

      {/* Only where it misses — a feasible placement needs no advice, and
          offering some would imply something is wrong with it. */}
      {!result.feasible && result.suggestions.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--hairline)] pt-2">
          {result.suggestions.map((s) => (
            <li key={s.action} className="text-[12px] text-ink-muted">
              · {s.reason}
            </li>
          ))}
        </ul>
      )}

      {result.calculationTrace.length > 0 && (
        <div className="mt-2 border-t border-[var(--hairline)] pt-2">
          <button
            type="button"
            onClick={() => setShowTrace((v) => !v)}
            className="text-[11px] text-ink-faint underline decoration-[var(--hairline)] underline-offset-2 hover:text-ink-muted"
          >
            {showTrace ? "Hide" : "Why?"}
          </button>
          {showTrace && (
            <ol className="mt-1.5 space-y-0.5">
              {result.calculationTrace.map((line, i) => (
                <li key={`${i}-${line}`} className="text-[11px] text-ink-faint">
                  {line}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Nothing is written until this is confirmed. Both columns come from the
          SAME engine answer — one call, one clock — so the before and the after
          cannot drift apart, and the dialog reads `diffQueues`, which is also
          what the person whose queue this is will be shown afterwards. */}
      {confirming && (
        <PriorityConfirmDialog
          subjectName={employeeName ?? null}
          before={snapshotOf(result.baselineQueue, taskTitleFor)}
          after={snapshotOf(rows, taskTitleFor)}
          reason={reason}
          onReason={setReason}
          pending={applying}
          error={applyError}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const r = await applyOrder();
            if (r.ok) {
              setConfirming(false);
              setApplied(true);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * A queue as the confirmation reads it.
 *
 * The date is `completionTime` — when the work actually finishes in this order.
 * That is the figure a reorder changes, and on this backend it is also what gets
 * written: confirming re-chains the queue and rewrites each task's due date from
 * exactly these numbers.
 */
function snapshotOf(
  entries: readonly SimulatedEntry[],
  titleFor: (entry: SimulatedEntry) => string,
): QueueSnapshotRow[] {
  return entries.map((e, i) => ({
    taskId: e.taskId,
    title: titleFor(e),
    /* The index, not `position`: the rows on screen may be an order the engine
       has not answered for yet, and a rank from the previous answer beside a
       list in a new order is the one figure that would be wrong. */
    rank: i + 1,
    dueAt: e.completionTime,
  }));
}
