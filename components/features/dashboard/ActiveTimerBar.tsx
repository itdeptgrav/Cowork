"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { workQueue } from "./signals";
import { TimerControl, useTicker } from "@/components/features/tasks/TimerControl";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDate } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * The active-work BAR.
 *
 * One row for one task, read left to right: a priority PICKER, what the task is,
 * the clock, and the way to submit it. The picker chooses WHICH task the bar
 * shows — the work is ordered by priority, so P1 is what you are on and P2, P3…
 * are what is behind it. It is a view switch, not a reorder: selecting P2 shows
 * the P2 task; nothing is written and no queue moves.
 *
 * It renders nothing when there is no work in the queue and nothing running.
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
  if (queue.length === 0 && !running) return null;

  return (
    <Bar
      queue={queue}
      running={running}
      startedAtRealMs={active.data?.startedAtRealMs ?? null}
    />
  );
}

/** Whole hours and minutes only — never seconds, so this reads as a budget
    rather than a second clock ticking beside the timer. */
function hoursMinutes(secs: number): string {
  const total = Math.max(0, Math.floor(secs / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

const priorityLabel = (v: TaskView): string => (v.myRank ? `P${v.myRank}` : "P—");

function Bar({
  queue,
  running,
  startedAtRealMs: runningStartedAt,
}: {
  queue: TaskView[];
  running: TaskView | null;
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

  if (!displayed) return null;

  const logged = displayed.loggedSecs + ticked;
  const estimate = displayed.task.estimatedEffortSecs;
  const overBudget = estimate != null && logged >= estimate;
  /* The one place "time limit breached" is decided — over budget, or past the
     committed date. TimerControl is told the answer via `tone`. */
  const breached = displayed.isOverdue || overBudget;

  const details = [
    displayed.project?.name ?? "No project",
    displayed.task.deadline.dueAt
      ? `due ${formatDate(displayed.task.deadline.dueAt)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const timeLeft =
    estimate == null
      ? null
      : overBudget
        ? `Over by ${hoursMinutes(logged - estimate)}`
        : `${hoursMinutes(estimate - logged)} left`;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-full border border-hairline bg-[var(--surface-raised)] px-5 py-2.5 shadow-sm">
      {/* 1 · Priority picker — chooses which task the bar shows. */}
      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Show another priority"
          className="inline-flex items-center gap-1 rounded-full bg-[var(--control)] px-2.5 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
        >
          <span data-figure>{priorityLabel(displayed)}</span>
          <Icon.chevronDown className="h-3 w-3" />
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
                    on ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"
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
                  {on && <Icon.check className="h-3.5 w-3.5 shrink-0 text-ink-muted" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2 · Details on top, heading beneath. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-ink-faint">{details}</p>
        <Link
          href={`/tasks/${displayed.task.id}`}
          className="block truncate text-[15px] leading-snug font-medium tracking-[-0.02em] text-ink hover:underline hover:underline-offset-4"
        >
          {displayed.task.title}
        </Link>
      </div>

      {/* 3 · The clock — white under budget, amber over it — with the remaining
            budget to its right, in whole hours and minutes. */}
      <div className="flex shrink-0 items-center gap-3">
        <TimerControl
          key={displayed.task.id}
          view={displayed}
          size="bar"
          tone={breached ? "warn" : "default"}
        />
        {timeLeft && (
          <span
            data-figure
            className={`text-[13px] leading-none tabular-nums ${
              breached ? "text-[var(--state-warn-ink)]" : "text-ink-muted"
            }`}
          >
            {timeLeft}
          </span>
        )}
      </div>

      {/* 4 · Submit — straight to the submission page. */}
      <Link
        href={`/tasks/${displayed.task.id}/submission`}
        className="inline-flex shrink-0 items-center rounded-full bg-ink px-4 py-1.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
      >
        Submit
      </Link>
    </div>
  );
}
