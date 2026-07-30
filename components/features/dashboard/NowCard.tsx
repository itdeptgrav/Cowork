"use client";

import Link from "next/link";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { Card, Action } from "./Card";
import { workQueue } from "./signals";
import { TimerControl, useTicker } from "@/components/features/tasks/TimerControl";
import { statusMeta, nextAction } from "@/components/features/tasks/statusMeta";
import {
  Chip,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import {
  formatDate,
  formatTimer,
  formatDurationTimer,
} from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * "Right now" — the dashboard's one hero, and the answer to the only question
 * that is always being asked: what am I doing, and what do I do after it.
 *
 * It has exactly two faces, because a person has exactly two situations. Either
 * something is running, in which case this is the cockpit for it — the task,
 * how far in, how long left, and the controls that move it forward. Or nothing
 * is, in which case a dashboard that shows a chart has failed: it should hand
 * over the single next thing and a button that starts it.
 *
 * What it deliberately is not: a list of everything. Three follow-ups is the
 * most a person can hold, and `/tasks` is one click away for the rest.
 */

export function NowCard() {
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
  /* Whatever is running is the hero; otherwise the top of the queue is. */
  const hero = running ?? queue[0] ?? null;
  /* Two follow-ups, not three: the reference's lower-left card is 0.45 of its
     own width, and a third row pushes this one past that. */
  /* One follow-up. The reference's lower-left card is a single content block
     at 0.45 of its width; a list under the block is what pushed this card past
     the composition it sits in. The rest of the queue is one click away, and
     the header says how many are waiting. */
  const rest = queue.filter((v) => v.task.id !== hero?.task.id).slice(0, 1);

  return (
    <Card
      title={
        running
          ? "In progress now"
          : hero?.task.status === "in_progress"
            ? "Pick up where you left off"
            : "Start next"
      }
      href="/tasks?view=tasks"
      hrefLabel="Open all tasks"
      padded={false}
      className="min-w-0"
      headerRight={
        queue.length > 0 ? (
          <span data-figure className="text-[11px] text-ink-faint">
            {queue.length} waiting on you
          </span>
        ) : null
      }
    >
      {tasks.isLoading ? (
        <div className="px-5">
          <SkeletonRows rows={5} />
        </div>
      ) : tasks.error ? (
        <ErrorState body={tasks.error} onRetry={tasks.refetch} />
      ) : !hero ? (
        <div className="px-5">
          <EmptyState
            title="Nothing is waiting on you"
            body="Every open task is with someone else. This is the good state — check what is coming, or pick up something new."
            action={
              <Action href="/tasks/new" tone="strong" icon="plus">
                New task
              </Action>
            }
          />
        </div>
      ) : (
        <>
          <Hero
            view={hero}
            startedAtRealMs={
              running ? (active.data?.startedAtRealMs ?? null) : null
            }
          />

          {rest.length > 0 && (
            <div className="mt-4 border-t border-hairline">
              <p className="px-5 pt-3 pb-1 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Then
              </p>
              <div className="divide-y divide-hairline">
                {rest.map((v) => (
                  <QueueRow key={v.task.id} view={v} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * The hero block.
 *
 * Progress is drawn against the estimate rather than against the deadline: a
 * person asks "how much of this is left", and logged-against-estimated is the
 * only honest answer the data supports. With no estimate the bar is absent
 * rather than faked.
 *
 * Sized for the reference's lower-left card, which is 0.45 of its own width.
 * The clock therefore rides the meta line instead of taking a column of its
 * own — the same information, a third of the height.
 */
function Hero({
  view,
  startedAtRealMs,
}: {
  view: TaskView;
  /** Non-null only while this task's session is running. */
  startedAtRealMs: number | null;
}) {
  const meta = statusMeta(view);
  const viewerId = useViewerId();
  const action = nextAction(view, viewerId ?? "");
  const running = startedAtRealMs !== null;
  const ticked = useTicker(startedAtRealMs);
  const logged = view.loggedSecs + ticked;
  const estimate = view.task.estimatedEffortSecs;
  const percent = estimate ? Math.min(100, (logged / estimate) * 100) : null;

  return (
    <div className="px-5 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        {running && (
          <span className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.09em] text-ink-muted uppercase">
            <span
              aria-hidden="true"
              className="relative flex h-1.5 w-1.5 text-ink"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            Running
          </span>
        )}
        <Chip tone={meta.tone}>{meta.label}</Chip>
        {view.myRank && (
          <span
            data-figure
            className="rounded-full bg-[var(--control)] px-2 py-0.5 text-[11px] text-ink-muted"
          >
            P{view.myRank}
          </span>
        )}
        <span data-figure className="ml-auto text-lg leading-none text-ink">
          {formatTimer(logged)}
        </span>
      </div>

      <Link
        href={`/tasks/${view.task.id}`}
        className="mt-2.5 block text-[17px] leading-snug font-medium tracking-[-0.02em] text-ink hover:underline hover:underline-offset-4"
      >
        {view.task.title}
      </Link>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
        <span className="truncate">{view.project?.name ?? "No project"}</span>
        {view.task.deadline.dueAt && (
          <>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            <span
              data-figure
              className={
                view.isOverdue ? "text-[var(--state-overdue-ink)]" : ""
              }
            >
              due {formatDate(view.task.deadline.dueAt)}
            </span>
          </>
        )}
        {estimate && (
          <>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            <span data-figure>of {formatDurationTimer(estimate)}</span>
          </>
        )}
      </p>

      {percent !== null && (
        <span className="mt-2.5 block h-[5px] overflow-hidden rounded-full bg-[var(--control-active)]">
          <span
            className="band-fill block h-full rounded-full bg-ink"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </span>
      )}

      {view.task.isBlocked && view.task.blockedReason && (
        <p className="mt-3 flex items-start gap-1.5 rounded-inset bg-[var(--control)] px-3 py-2 text-[11px] text-ink-muted">
          <Icon.blocked className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0">{view.task.blockedReason}</span>
        </p>
      )}

      {/* Everything a person does to a running task, in one place, named. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TimerControl view={view} />
        {action.actor === "you" && action.href && (
          <Action href={action.href} tone="strong">
            {action.label}
          </Action>
        )}
        <Action href={`/tasks/${view.task.id}`} icon="chevronRight">
          Open task
        </Action>
      </div>
    </div>
  );
}

/** One follow-up. Enough to choose it, and a verb to take it. */
function QueueRow({ view }: { view: TaskView }) {
  const meta = statusMeta(view);
  const viewerId = useViewerId();
  const action = nextAction(view, viewerId ?? "");

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 transition-colors hover:bg-[var(--row-hover)]">
      <span
        data-figure
        className="w-7 shrink-0 rounded-full bg-[var(--control)] py-0.5 text-center text-[11px] text-ink-muted"
        title={view.myRank ? `Your priority ${view.myRank}` : "Unranked"}
      >
        {view.myRank ? `P${view.myRank}` : "—"}
      </span>

      <span className="min-w-0 flex-1">
        <Link
          href={`/tasks/${view.task.id}`}
          className="block truncate text-sm text-ink hover:underline hover:underline-offset-2"
        >
          {view.task.title}
        </Link>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
          {view.project?.name ?? "No project"}
          {view.task.deadline.dueAt &&
            ` · due ${formatDate(view.task.deadline.dueAt)}`}
        </span>
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Chip tone={meta.tone}>{meta.label}</Chip>
        {action.actor === "you" && (
          <Action href={action.href ?? `/tasks/${view.task.id}`} tone="strong">
            {shortAction(action.label)}
          </Action>
        )}
      </span>
    </div>
  );
}

/** "Submit when ready" is a status; "Submit" is a button. */
function shortAction(label: string): string {
  const map: Record<string, string> = {
    "Review submission": "Review",
    "Approve or reject": "Approve",
    "Decide deadline": "Decide",
    "Respond to counter": "Respond",
    "Propose a deadline": "Propose",
    "Confirm receipt": "Confirm",
    "Submit when ready": "Submit",
    "Start work": "Start",
  };
  return map[label] ?? label;
}
