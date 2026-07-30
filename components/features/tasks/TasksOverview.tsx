"use client";

import Link from "next/link";
import { statusMeta, nextAction } from "./statusMeta";
import {
  formatRankDisplay,
  rankFor,
  rankTitle,
} from "@/lib/rules/tasks/priorityDisplay";
import { TimerControl, useTicker } from "./TimerControl";
import { ProjectSlab } from "@/components/features/projects/ProjectSlab";
import { Icon } from "@/components/ui/Icons";
import { Rail } from "@/components/ui/Rail";
import {
  Chip,
  EmptyState,
  ErrorState,
  Panel,
  Ring,
  SegmentBar,
  SkeletonRows,
  type BarSegment,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import {
  formatDate,
  formatTimer,
  formatDurationTimer,
} from "@/lib/utils/format";
import type { TaskScope, TaskView } from "@/lib/repositories";

/**
 * The Tasks overview.
 *
 * Structure comes from `Task_overview`, region for region — see
 * docs/specs/REFERENCE_MAPPING.md §3 for the full table. In band order:
 *
 *   1. section header — "Projects" plus a one-line census
 *   2. projects band — a rail of stepped-slab cards, the page's hero
 *   3. KPI strip — four cells that are deliberately NOT alike
 *
 * Two things an earlier pass got backwards, both now corrected against the
 * file itself rather than against my notes about it:
 *
 *  · The reference leads with PROJECTS and anchors with the metric strip. I had
 *    the strip on top, which turns the page into a dashboard fragment instead
 *    of the project-first overview the reference describes.
 *  · Its four metric cells have four different anatomies — composition bar,
 *    plain figure, figure plus an actionable row, ring plus context. Each cell
 *    uses the visualisation its data actually wants. I had built four identical
 *    cells, which is the low-information block the brief warns against.
 *
 * One addition beyond the reference: the action queue at the foot. The
 * reference Overview carries no task list at all, but brief §8 requires this
 * page to answer "what requires action now" and §9 requires the running and
 * paused sessions to be visible and operable. That is a Cowork requirement the
 * reference has no opinion about, so it is added rather than substituted.
 */
export function TasksOverview({ scope }: { scope: TaskScope }) {
  const tasks = useQuery(
    (r) => r.listTasks({ scope }).then((p) => p.items),
    [scope],
  );
  const projects = useQuery(
    (r) =>
      r
        .listProjects({ status: ["active", "planning"], sort: "health" })
        .then((p) => p.items),
    [],
  );
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const active = useQuery((r) => r.getActiveTimer(), []);
  const timers = useQuery((r) => r.listTimers(), []);
  // Called before the early returns: a hook cannot sit behind a loading branch.
  const ticked = useTicker(active.data?.startedAtRealMs ?? null);

  if (tasks.isLoading) return <SkeletonRows rows={8} />;
  if (tasks.error)
    return <ErrorState body={tasks.error} onRetry={tasks.refetch} />;

  const list = tasks.data ?? [];
  const viewerId = me.data?.id ?? "";
  const closed = (t: TaskView) =>
    t.task.status === "completed" ||
    t.task.status === "cancelled" ||
    t.task.status === "assignment_rejected";

  const open = list.filter((t) => !closed(t));
  const overdue = open.filter((t) => t.isOverdue);
  const blocked = open.filter((t) => t.task.isBlocked && !t.isOverdue);
  const inReview = open.filter(
    (t) => t.task.status === "in_review" && !t.isOverdue,
  );
  const running = open.filter(
    (t) => t.task.status === "in_progress" && !t.isOverdue && !t.task.isBlocked,
  );
  const waiting =
    open.length -
    overdue.length -
    blocked.length -
    inReview.length -
    running.length;

  /* Cell 1 — composition of the open workload. */
  const composition: BarSegment[] = [
    { label: "in progress", value: running.length, tone: "var(--color-ink)" },
    {
      label: "in review",
      value: inReview.length,
      tone: "var(--state-extension)",
    },
    { label: "overdue", value: overdue.length, tone: "var(--state-overdue)" },
    { label: "blocked", value: blocked.length, tone: "var(--state-blocked)" },
    {
      label: "not started",
      value: Math.max(0, waiting),
      tone: "var(--control-active)",
    },
  ];

  /* Cell 2 — effort actually spent, against what was estimated. */
  const logged = list.reduce((s, t) => s + t.loggedSecs, 0);
  const estimated = open.reduce(
    (s, t) => s + (t.task.estimatedEffortSecs ?? 0),
    0,
  );

  /* Cell 3 — decisions only. "Needs you" includes doing the work; this cell is
     narrower on purpose: things that are stalled until you rule on them. */
  const DECISIONS = new Set([
    "Review submission",
    "Approve or reject",
    "Decide deadline",
    "Respond to counter",
  ]);
  const decisions = open
    .map((t) => ({ view: t, action: nextAction(t, viewerId) }))
    .filter((x) => x.action.actor === "you" && DECISIONS.has(x.action.label));
  const topDecision = decisions[0];

  /* Cell 4 — the work session. §9: which task is active, for how long. */
  const activeView = active.data
    ? list.find((t) => t.task.id === active.data!.taskId)
    : undefined;
  const pausedCount = (timers.data ?? []).filter(
    (t) => !t.isActive && t.accumulatedSecs > 0,
  ).length;
  const activeEstimate = activeView?.task.estimatedEffortSecs ?? 0;
  const activeElapsed = active.data ? active.data.loggedSecs + ticked : 0;
  const activeRatio = activeEstimate
    ? (activeElapsed / activeEstimate) * 100
    : 0;

  /* The foot queue. */
  const queue = open
    .map((t) => ({ view: t, action: nextAction(t, viewerId) }))
    .filter((x) => x.action.actor === "you")
    .sort((a, b) => {
      const rank = (x: typeof a) =>
        (x.view.isOverdue ? 0 : x.view.task.isBlocked ? 1 : 2) * 100 +
        (x.view.myRank ?? 9);
      return rank(a) - rank(b);
    });

  const projectList = projects.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* ── R3: section header ─────────────────────────────────────────────
          Title plus a one-line census, left aligned, exactly as the reference
          states it. The "all projects" link is Cowork's — the reference relies
          on a tab for the same move. */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg leading-none font-light tracking-[-0.025em] text-ink">
            Projects
          </h2>
          {/* On the field: `ink-muted`, never `ink-faint`. */}
          <p className="text-xs text-ink-muted">
            <span data-figure>{projectList.length}</span> live ·{" "}
            <span data-figure>
              {projectList.reduce((s, p) => s + p.progress.totalTasks, 0)}
            </span>{" "}
            jobs between them
          </p>
          <Link
            href="/tasks/projects"
            className="ml-auto flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            Compare all projects
            <Icon.chevronRight className="h-3 w-3" />
          </Link>
        </div>

        {/* ── R4: projects band ───────────────────────────────────────────── */}
        {projects.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !projectList.length ? (
          <Panel>
            <EmptyState
              compact
              title="No active projects"
              body="Projects group connected tasks under one owner, deadline and progress figure."
              action={
                <Link
                  href="/tasks/projects/new"
                  className="text-ink underline-offset-4"
                >
                  Create a project
                </Link>
              }
            />
          </Panel>
        ) : (
          <Rail count={projectList.length} label="Active projects">
            {projectList.map((v, i) => (
              <div
                key={v.project.id}
                className="w-[300px] shrink-0 snap-start deck:w-[340px]"
              >
                <ProjectSlab view={v} delay={i * 70} />
              </div>
            ))}
          </Rail>
        )}
      </section>

      {/* ── R5: the metric strip ───────────────────────────────────────────
          Four cells, four anatomies. The reference's variety is the point:
          a composition wants a segmented bar, a duration wants a plain figure,
          a decision queue wants its top item inline, and a consumed budget
          wants a ring. */}
      <Panel padded={false}>
        {/* Separators are written per cell rather than with `divide-*`, because
            divide draws on DOM order and a 2×2 arrangement then puts a vertical
            rule at the start of the second row. Four cells, four literal rules. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 deck:grid-cols-4">
          {/* 1 · figure + composition bar + dot legend */}
          <div className="px-4 py-3.5">
            <p className="flex items-baseline gap-1.5">
              <span
                data-figure
                className="text-[28px] leading-none tracking-[-0.03em] text-ink"
              >
                {open.length}
              </span>
              <span className="text-xs text-ink-faint">
                open of {list.length}
              </span>
            </p>
            <SegmentBar className="mt-3" segments={composition} />
          </div>

          {/* 2 · label + large figure */}
          <div className="border-t border-hairline px-4 py-3.5 sm:border-t-0 sm:border-l">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Time logged
            </p>
            <p
              data-figure
              className="mt-2 text-[28px] leading-none tracking-[-0.03em] text-ink"
            >
              {formatTimer(logged)}
            </p>
            <p data-figure className="mt-2 text-[11px] text-ink-faint">
              {formatDurationTimer(estimated)} still estimated
            </p>
          </div>

          {/* 3 · label + figure + one actionable row */}
          <div className="flex flex-col border-t border-hairline px-4 py-3.5 deck:border-t-0 deck:border-l">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Awaiting your decision
            </p>
            <p
              data-figure
              className="mt-2 text-[28px] leading-none tracking-[-0.03em] text-ink"
            >
              {decisions.length}
            </p>
            {topDecision ? (
              <Link
                href={
                  topDecision.action.href ??
                  `/tasks/${topDecision.view.task.id}`
                }
                className="mt-2.5 flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] py-1.5 pr-2.5 pl-2 transition-colors hover:bg-[var(--control)]"
              >
                <span className="shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] tracking-[0.06em] text-ink-muted uppercase">
                  {topDecision.action.label.split(" ")[0]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                  {topDecision.view.task.title}
                </span>
                {topDecision.view.task.deadline.dueAt && (
                  <span
                    data-figure
                    className="shrink-0 text-[11px] text-ink-faint"
                  >
                    {formatDate(topDecision.view.task.deadline.dueAt)}
                  </span>
                )}
              </Link>
            ) : (
              <p className="mt-2.5 text-[11px] text-ink-faint">
                Nothing is stalled on you.
              </p>
            )}
          </div>

          {/* 4 · ring + figure + context — the work session */}
          <div className="flex items-center gap-3 border-t border-l-0 border-hairline px-4 py-3.5 sm:border-l deck:border-t-0">
            <Ring
              value={activeRatio}
              label={
                active.data
                  ? `Elapsed against estimate on ${active.data.taskTitle}`
                  : "No timer"
              }
            >
              <span className="text-ink-faint">
                {active.data ? (
                  <Icon.play className="h-3 w-3" />
                ) : (
                  <Icon.pause className="h-3 w-3" />
                )}
              </span>
            </Ring>
            <div className="min-w-0">
              <p
                data-figure
                className="text-[28px] leading-none tracking-[-0.03em] text-ink"
              >
                {formatTimer(active.data ? activeElapsed : 0)}
              </p>
              <p className="mt-1.5 truncate text-[11px] text-ink-faint">
                {active.data ? (
                  <>
                    Running ·{" "}
                    <Link
                      href={`/tasks/${active.data.taskId}`}
                      className="text-ink"
                    >
                      {active.data.taskTitle}
                    </Link>
                  </>
                ) : pausedCount > 0 ? (
                  `No timer running · ${pausedCount} paused`
                ) : (
                  "No timer running"
                )}
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Cowork addition: the action queue ──────────────────────────────
          Not in the reference. Required by brief §8 and §9. */}
      <Panel padded={false}>
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
          <h2 className="text-sm font-medium text-ink">Needs you now</h2>
          <span data-figure className="text-xs text-ink-faint">
            {queue.length}
          </span>
          <Link
            href="/tasks?view=tasks"
            className="ml-auto flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink"
          >
            All tasks
            <Icon.chevronRight className="h-3 w-3" />
          </Link>
        </div>

        {!queue.length ? (
          <EmptyState
            compact
            title="Nothing waiting on you"
            body="Every open task is with someone else right now."
          />
        ) : (
          <div className="divide-y divide-hairline">
            {queue.slice(0, 8).map(({ view, action }) => {
              const meta = statusMeta(view);
              return (
                <div
                  key={view.task.id}
                  className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-[var(--control)]"
                >
                  {/* The shared reader, not `myRank` inline: a closed task has
                      no live position and must read "Was P1" rather than
                      borrowing the chip a live P1 wears. */}
                  {(() => {
                    const rank = rankFor(view, viewerId);
                    return (
                      <span
                        data-figure
                        className={`min-w-7 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] whitespace-nowrap ${
                          !rank.isHistoric && rank.rank !== null && rank.rank <= 2
                            ? "bg-[color-mix(in_srgb,var(--state-risk)_22%,transparent)] text-ink"
                            : "bg-[var(--control)] text-ink-muted"
                        }`}
                        title={rankTitle(rank)}
                      >
                        {formatRankDisplay(rank)}
                      </span>
                    );
                  })()}

                  <Link
                    href={`/tasks/${view.task.id}`}
                    className="min-w-0 flex-1"
                  >
                    <span className="block truncate text-sm text-ink">
                      {view.task.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {view.project?.name ?? "No project"}
                      {view.task.deadline.dueAt &&
                        ` · due ${formatDate(view.task.deadline.dueAt)}`}
                      {view.loggedSecs > 0 &&
                        ` · ${formatTimer(view.loggedSecs)} logged`}
                    </span>
                  </Link>

                  <TimerControl
                    view={view}
                    onChange={() => {
                      active.refetch();
                      timers.refetch();
                      tasks.refetch();
                    }}
                  />

                  <Link
                    href={action.href ?? `/tasks/${view.task.id}`}
                    className="hidden w-[130px] shrink-0 truncate text-xs text-ink-muted transition-colors hover:text-ink deck:block"
                  >
                    {action.label}
                  </Link>

                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
