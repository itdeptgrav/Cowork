"use client";

import Link from "next/link";
import { formatRankDisplay, rankFor } from "@/lib/rules/tasks/priorityDisplay";
import { awaitsApprovalFrom } from "@/lib/rules/tasks/actionable";
import { isBudgetSettled } from "@/lib/rules/tasks/activeQueue";
import { usePermissions, useViewerId } from "@/lib/hooks/usePermissions";
import { reorderableAssignees } from "@/lib/rules/tasks/priorityAffordance";
import { buildTaskTree } from "@/lib/rules/tasks/tree";
import { useMemo, useState, type ReactNode } from "react";
import { statusMeta, nextAction, ALL_STATUSES } from "./statusMeta";
import { PriorityDialog } from "./PriorityDialog";
import { PriorityReorderConfirm } from "./PriorityReorderConfirm";
import { TimerControl } from "./TimerControl";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  MenuDivider,
  MenuItem,
  Popover,
  ToolButton,
} from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Segmented,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import {
  formatDate,
  formatRelative,
  formatTimer,
  formatDurationTimer,
} from "@/lib/utils/format";
import { useNow } from "@/lib/hooks/useNow";
import type { TaskScope, TaskView } from "@/lib/repositories";
import type { TaskStatus } from "@/lib/domain";

/**
 * The operational task table.
 *
 * Carries every field the brief names: rank, title, project, owner→assignee,
 * status, pending action, progress, deadline, effort, plus overdue, blocked and
 * rework read at a glance. Supports search, filter, sort, grouping, selection
 * with bulk actions, and a per-row menu.
 *
 * Chrome is deliberately thin. The earlier build spent ~450px before row one;
 * this spends ~40px on a column header and gets straight to data.
 */

type Grouping = "none" | "status" | "project" | "assignee" | "deadline";
type Sort = "rank" | "due" | "updated" | "title";

/**
 * The whole filter, and it is one question: is this work still live?
 *
 * It was four options naming states — Overdue, Blocked, In review. Each was a
 * real question, but they were three of the ten a task can be in, and picking
 * three meant the row was answering "which of these particular problems" rather
 * than the question people actually arrive with. Overdue and blocked work is
 * still open work, and the row itself already says which is which — the status
 * chip, the amber deadline, the pending-action line under it.
 *
 * **Open and closed, and nothing between.** Everything under way, waiting on
 * somebody, or past its deadline is open; everything finished is closed.
 */
type FilterId = "all" | "open" | "closed";

/**
 * Terminal, and the same three the rest of the product calls terminal —
 * `signals.ts`'s `isOpen` is this list negated, and `deadlineShift.ts` carries
 * it as `UNSHIFTABLE`, transcribed from legacy's `TERMINAL_STATUSES`.
 *
 * "Closed" therefore holds a cancelled or refused task as well as a completed
 * one. They are finished by every rule in the codebase, and a task reachable
 * from neither Open nor Closed would be a task the filter simply lost.
 */
const CLOSED_STATUSES: TaskStatus[] = [
  "completed",
  "cancelled",
  "assignment_rejected",
];

/* Derived, never listed. A status added to the engine later is open work until
   somebody declares it terminal above — the safe direction, and it is one edit
   rather than two that can disagree. */
const OPEN_STATUSES: TaskStatus[] = ALL_STATUSES.filter(
  (s) => !CLOSED_STATUSES.includes(s),
);

const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  {
    id: "all",
    label: "All",
    hint: "Everything in this scope, in priority order",
  },
  {
    id: "open",
    label: "Open",
    hint: "Under way, waiting on somebody, or past its deadline",
  },
  { id: "closed", label: "Closed", hint: "Finished work" },
];

/**
 * Eleven columns. The brief names task, status, priority, assignee, owner,
 * project, deadline, timer, progress, play/pause state and pending action as
 * things a person must be able to compare — owner and assignee share one cell
 * as "owner → assignee", status and pending action share one as "status ·
 * next", and the timer cell is both the elapsed figure and the control.
 */
/* The priority column is 84px, not the 38px a bare "P1" needs. Two of the four
   things it renders are longer than the chip: "Was P3" on a closed task, and
   "P2 to accept" on work whose hours are not agreed. Both are deliberate — a
   number from a different sequence must not wear the live queue's chip — and
   at 38px both overflowed into the title beside them.

   The number in "P2 to accept" is the rank whoever assigned it CHOSE, not a
   derived position: the suffix alone marks the sequence. See `priority.ts`. */
/* **Every column is sized for its HEADER as well as its values.** The widths
   were once fitted to the figures alone, so "Time budget" wrapped to two lines
   in a 62px column while "of 03:06:31" — 58px of tabular figures — spilled left
   over the deadline beside it. Each track below is the wider of what the value
   needs and what the column heading needs, plus the 16px of cell padding that
   keeps neighbouring columns apart.

   Measured against the real Geist metrics rather than guessed. Content width is
   the track less that padding: P 80 (fits "P2 to accept", 77) · People 78 (two
   28px monograms, the chevron and their gaps, 76) · Status 136 (fits
   "Assignment rejected", 133) · Progress 72 · Deadline 64 · Time budget 84
   (fits the heading, 82 — the widest thing in that column) · Timer 76 (the 74px
   control) · Activity 60. */
/**
 * **Ten columns on the task list, eleven inside a project.**
 *
 * The eleventh was a headerless 48px track holding a hover-only `···` menu, and
 * four of that menu's five items were already reachable in one click from the
 * row itself — the title opens the task, the P chip changes priority, and the
 * task page carries Deadline and History. So on the ordinary list it was a
 * permanently empty column bought for nothing, which is what it looked like.
 *
 * The fifth item is not redundant: "Remove from project" exists nowhere else,
 * and only a project supplies the `onUnlink` that renders it. So the track is
 * spent exactly where it buys something and dropped everywhere else, rather
 * than deleting an action with no other home.
 */
const COLS =
  "grid-cols-[38px_96px_minmax(0,1fr)_152px_88px_80px_100px_92px_84px]";
const COLS_MENU =
  "grid-cols-[38px_96px_minmax(0,1fr)_152px_88px_80px_100px_92px_76px_52px]";

/**
 * One cell.
 *
 * No rule between columns: at eleven of them the verticals stopped reading as
 * structure and started reading as a spreadsheet, boxing in every value on the
 * screen. The 8px of padding either side is what separates the columns now —
 * 16px of clear space between any two neighbours, which is more air than the
 * ruled version had and needs no ink to do it. The row rules stay: those
 * separate things a reader actually scans between.
 */
const CELL = "flex min-w-0 flex-col gap-0.5 px-2 py-2.5";
/** The leading and trailing cells carry the panel's own 16px inset. */
const CELL_LEAD = "flex min-w-0 flex-col gap-0.5 py-2.5 pr-2 pl-4";
const CELL_TAIL = "flex min-w-0 flex-col gap-0.5 py-2.5 pr-4 pl-2";

/**
 * The first line of every cell — one height, in every column.
 *
 * This is the whole of the alignment fix. The row was `items-center`, so a
 * one-line cell floated to the vertical middle while a two-line cell started at
 * the top: the deadline sat in the GAP between the title and its reference, the
 * timer between the two halves of the time budget, and eleven columns each
 * found their own baseline. Now every primary value sits on the same 28px line
 * at the top of its cell — the height an avatar needs, which is the tallest of
 * them — and every secondary value on the 16px line beneath it.
 */
const LINE = "flex h-7 items-center";
/** The second line: the quiet half of a cell. */
const SUB = "block truncate text-[11px] leading-4 text-ink-faint";

/**
 * Header cells, inset to match the rows exactly.
 *
 * **A heading lines up with the GLYPHS under it, not with the cell box.** Six
 * columns need nothing for that — their content starts at the content edge. The
 * other four each hold something whose visible left edge is inset from the box
 * it sits in, and a heading flush to the box therefore sat to the left of every
 * value it named:
 *
 *   · Task, +24px — the fold gutter (`w-5` plus its margin) that every title
 *     clears so a subtask's elbow has somewhere to go.
 *   · Status, +10px — the chip's own `px-2.5`.
 *   · P, +6px — the rank chip's `px-1.5`.
 *   · Timer, centred — the figure is centred inside a fixed 74px control, so
 *     this is the one column where matching an edge is the wrong move and
 *     sharing a centre line is the right one.
 *
 * Written as whole class strings rather than as `HEAD` plus a `pl-*` override:
 * `px-2` and `pl-8` both set `padding-left`, and which one wins would be down
 * to the order Tailwind emits them in rather than to anything stated here.
 */
const HEAD = "flex items-center px-2 py-2.5";
const HEAD_P = "flex items-center py-2.5 pr-2 pl-3.5";
const HEAD_TASK = "flex items-center py-2.5 pr-2 pl-8";
const HEAD_STATUS = "flex items-center py-2.5 pr-2 pl-[18px]";
const HEAD_TIMER = "flex items-center justify-center px-2 py-2.5";
const HEAD_LEAD = "flex items-center justify-center py-2.5 pr-2 pl-4";
const HEAD_TAIL = "flex items-center py-2.5 pr-4 pl-2";

export function TaskTable({
  scope,
  projectId,
  onUnlink,
  scopeControl,
}: {
  scope: TaskScope;
  /** When set, the table is scoped to one project and hides the project column. */
  projectId?: string;
  /** Supplied by a project, which can remove a task's link without deleting it. */
  onUnlink?: (taskId: string) => Promise<void>;
  /**
   * The "whose work" switch, owned by the caller and rendered in this toolbar.
   *
   * A node rather than the state itself: `scope` is a prop here, and the thing
   * that sets it lives a level up because the board reads the same value. This
   * only decides where it appears — beside the filter that answers the next
   * question about the same list. Absent inside a project, which has no scope
   * to choose.
   */
  scopeControl?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [sort, setSort] = useState<Sort>("rank");
  /* **Ungrouped, and no longer switchable.**
     It used to arrive grouped by status, on the reasoning that a flat list of
     forty rows makes a person do triage the product already knows how to do.
     The flaw is that grouping by status breaks the list into buckets and
     destroys the one order this product spends all its rules establishing —
     P1 stops being the first row on the page, which is the whole point of a
     priority queue. The state stays because the grouping machinery below still
     reads it; nothing sets it any more. */
  const [grouping, setGrouping] = useState<Grouping>("none");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priorityFor, setPriorityFor] = useState<TaskView | null>(null);
  /* Collapsed groups, by group key. Purely presentational — nothing is
     filtered, sorted or refetched by collapsing a section. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  /* Collapsed PARENTS, by task id — the tree's own fold state, separate from
     the group headers above. Empty on arrival, so a task that has been broken
     down shows what it was broken into without a click: the breakdown is the
     point of the row, and a tree that arrives shut looks like a flat list with
     an extra control. */
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(
    new Set(),
  );
  const toggleParent = (id: string) =>
    setCollapsedParents((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const tableViewerId = useViewerId();
  const tablePerms = usePermissions();
  const tableViewer = useQuery((r) => r.getViewer(), []);
  /* Per row: is there anybody on THIS task whose priority this viewer may
     change? Resolved from the same predicate the repository refuses with, so a
     row never offers a control that would be denied. */
  const mayReorderOn = (v: TaskView) =>
    reorderableAssignees({
      assignees: v.assignees,
      actorId: tableViewer.data?.employeeId ?? "",
      actorHasManager: tableViewer.data?.hasManager ?? true,
      canReorder: (id) => tablePerms.can("task.priority.change", id),
    }).length > 0;

  /* ── Drag-to-reorder, in the list itself ─────────────────────────────────── */
  /* The queue is set the way it reads — drag a row up or down within a person's
     group and everything shifts to make room. It is an INSERT, not a swap: the
     whole new order is handed to `reorderPriorities`, which renumbers 1..N, so
     dragging P5 above P2 pushes the old P2/P3/P4 each down one. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /* The order a drop produced, waiting to be confirmed. Nothing is written
     while this is set — see `PriorityReorderConfirm`. */
  const [pendingReorder, setPendingReorder] = useState<{
    employeeId: string;
    employeeName: string | null;
    subject: {
      taskId: string;
      title: string;
      workSecs: number;
      committedDeadline: string | null;
    };
    orderedTaskIds: string[];
  } | null>(null);

  /* A completed, cancelled or rejected task keeps the rank it finished with — a
     record, not live workload — so it never joins a reorder. */
  const isActiveRow = (v: TaskView) =>
    v.task.status !== "completed" &&
    v.task.status !== "cancelled" &&
    v.task.status !== "assignment_rejected";

  /* The person's own position where it is known (derived, unique), else the
     stored rank — enough to lay the group out in queue order for the drag. */
  const rankNum = (v: TaskView, subjectId: string): number => {
    const a = v.assignments.find((x) => x.employeeId === subjectId);
    return a?.queuePosition ?? a?.rank ?? 999;
  };

  /* Whether THIS person's queue actually contains the task — the same rule the
     deadline chain uses (`isActiveWorkload`): the budget must be settled AND
     they must have accepted it. A task that fails this still carries a stored
     rank, but that rank drives nothing — it is not in the chain, so reordering
     it would move a P-tag and no deadline. So it must not be draggable or
     numbered as if it were. This is the fix for "the priority changes but the
     time does not": you can no longer reorder something that has no queue slot. */
  const inActiveQueue = (v: TaskView, subjectId: string): boolean =>
    isActiveRow(v) &&
    isBudgetSettled(v.budgetNegotiation?.state ?? null) &&
    (v.assignments.find((a) => a.employeeId === subjectId)?.confirmedAt ?? null) !==
      null;

  /* Why a still-open task is out of the queue, for the reader. Null when it is
     in the queue, or when it is closed (which already reads as "was P3"). */
  const queueHoldReason = (v: TaskView, subjectId: string): string | null => {
    if (!isActiveRow(v)) return null;
    if (!isBudgetSettled(v.budgetNegotiation?.state ?? null))
      return "Not in the queue yet — the time budget isn't settled. Priority takes effect once it's agreed.";
    const a = v.assignments.find((x) => x.employeeId === subjectId);
    if ((a?.confirmedAt ?? null) === null)
      return "Not in the queue yet — not accepted yet. Priority takes effect once it's accepted.";
    return null;
  };

  /**
   * A drop STAGES a reorder; it no longer performs one.
   *
   * This used to write immediately, with a reason nobody typed — so an
   * accidental drag rearranged somebody's week and sent them a receipt citing a
   * sentence no human had written. The new order now goes to a confirmation
   * showing what it does to every date, and the reason is given there.
   */
  function commitReorder(
    assigneeId: string,
    assigneeName: string | null,
    activeIds: string[],
    rows: TaskView[],
  ) {
    const held = dragId;
    const target = overId;
    setDragId(null);
    setOverId(null);
    if (!held || !target || held === target) return;
    const from = activeIds.indexOf(held);
    const to = activeIds.indexOf(target);
    if (from === -1 || to === -1) return;
    const without = activeIds.filter((id) => id !== held);
    /* Land just above the target, or just below it when the move is downward —
       which is what lets a task reach the very bottom of the queue. */
    let at = without.indexOf(target);
    if (from < to) at += 1;
    const next = [...without.slice(0, at), held, ...without.slice(at)];

    const moved = rows.find((v) => v.task.id === held);
    if (!moved) return;
    setPendingReorder({
      employeeId: assigneeId,
      employeeName: assigneeName,
      subject: {
        taskId: held,
        title: moved.task.title,
        /* The preview is anchored on the dragged task's own budget — the same
           figure the queue chain uses for it. */
        workSecs:
          moved.task.deadline.currentWindowSecs ??
          moved.task.estimatedEffortSecs ??
          0,
        committedDeadline: moved.task.deadline.dueAt,
      },
      orderedTaskIds: next,
    });
  }

  const { data, isLoading, error, refetch } = useQuery(
    (r) =>
      r
        .listTasks({
          scope,
          projectId,
          search: search || undefined,
          status: statuses.length ? statuses : undefined,
          sort,
          overdueOnly: onlyOverdue || undefined,
          blockedOnly: onlyBlocked || undefined,
          assigneeId: onlyMine ? (tableViewerId ?? undefined) : undefined,
          /* This table nests, so it asks for the children. Every other caller
             leaves this off and keeps the rolled-up counts — see
             `TaskQuery.includeSubtasks`. */
          includeSubtasks: true,
        })
        .then((p) => p.items),
    [
      scope,
      projectId,
      search,
      statuses.join(","),
      sort,
      onlyOverdue,
      onlyBlocked,
      onlyMine,
    ],
  );

  const conflicts = useQuery(
    (r) => r.listPriorityConflicts(tableViewerId ?? ""),
    [data, tableViewerId],
  );
  const conflictRanks = new Set((conflicts.data ?? []).map((c) => c.rank));

  /* The fix for a duplicate rank is the same renumber a drag or a rank change
     triggers — `normalizePriorities` rewrites this person's active queue to
     1..N, unique and gap-free, and touches no closed task. Offered right beside
     the warning so seeing the problem and resolving it are one step. */
  const [fixConflicts, fixState] = useAction((r) =>
    r.normalizePriorities(tableViewerId ?? ""),
  );

  /**
   * Four questions, where there were twenty-two answers.
   *
   * The toolbar carried three popovers: a filter holding three quick toggles
   * and all ten engine statuses, a grouping menu, and a sort menu. Between them
   * that is twenty-two controls over a list whose order is already decided —
   * and three of them actively worked against it. Sorting by title, or grouping
   * by status, takes a priority queue and returns a list where P1 is not at the
   * top, which is the one thing the queue exists to guarantee.
   *
   * What is left answers what a person actually arrives asking: everything, or
   * one side of the open/closed line. Priority order is permanent rather than
   * the default of four.
   *
   * The query is UNCHANGED — `statuses` is the same field it has always read,
   * and this only decides what goes in it. `onlyOverdue` and `onlyBlocked` are
   * no longer set by anything: overdue and blocked work is open work, the row
   * says which it is, and a filter that carves one problem out of "open" was
   * answering a narrower question than anybody asked.
   */
  /* Unchanged, and still read by the empty state below: "did a filter cause
     this emptiness, or is there genuinely nothing here" is a different question
     from which filter is on, and it wants the same answer it always gave. */
  const filterCount =
    statuses.length +
    (onlyOverdue ? 1 : 0) +
    (onlyBlocked ? 1 : 0) +
    (onlyMine ? 1 : 0);

  /* Which side is showing, read back off the one field that carries it. Only
     `setFilter` writes `statuses`, so a list containing a terminal status can
     only have come from Closed. */
  const filter: FilterId =
    statuses.length === 0
      ? "all"
      : statuses.includes("completed")
        ? "closed"
        : "open";

  function setFilter(next: FilterId) {
    /* Cleared, not merely unset. These two are still read by the query, so a
       flag left standing from an earlier session state would quietly narrow a
       list whose control no longer shows it. */
    setOnlyOverdue(false);
    setOnlyBlocked(false);
    setStatuses(
      next === "open"
        ? OPEN_STATUSES
        : next === "closed"
          ? CLOSED_STATUSES
          : [],
    );
  }

  /**
   * **"My team" separates by person; every other scope does not.**
   *
   * A manager's list is a different object from an assignee's. Looking at your
   * own work, one flat run in priority order is the answer — P1 first, and the
   * next thing under it. Looking at six people's work, that same flat run
   * interleaves six queues into one column and the first question a manager has
   * — what is this person carrying — takes reading every row to answer.
   *
   * Derived from the scope rather than chosen, because it is not really a
   * preference: it follows from whose list you asked for. That is also why the
   * grouping control is gone and nothing else sets it.
   *
   * Within each person the priority order is untouched, so a manager still
   * reads each queue top-down the way its owner does.
   */
  const separateBy: Grouping = scope === "team" ? "assignee" : grouping;

  const groups = useMemo(
    () => groupTasks(data ?? [], separateBy, tableViewerId ?? ""),
    [data, separateBy, tableViewerId],
  );

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allIds = (data ?? []).map((v) => v.task.id);
  const allSelected =
    allIds.length > 0 && allIds.every((id) => selected.has(id));

  /* Whether the trailing menu column is worth its width — see `COLS`. Derived
     from the same prop `Row` reads, and in one place, because a header that
     spends the track while its rows do not (or the reverse) is a table whose
     columns no longer line up. */
  const hasRowMenu = Boolean(onUnlink);

  return (
    <>
      {/* Toolbar — one row, right-aligned, no empty gutter. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <SearchBox value={search} onChange={setSearch} />

        {/* One row of named filters, in the same segmented control the scope
            switch uses — so the two questions this page asks about a list,
            whose work and which of it, are asked the same way. */}
        <Segmented
          label="Task filter"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={FILTERS}
        />

        {/* The scope switch takes the right end on its own now. The row count
            that shared it is gone: every scope pill already carries its own
            figure, so the row said the same number twice — "My tasks 17" and
            "17 tasks", a few hundred pixels apart. */}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {scopeControl}
        </div>
      </div>

      {/* Bulk bar replaces the column header while a selection exists. */}
      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-full bg-[var(--control)] px-3 py-1.5">
          <span data-figure className="text-sm text-ink">
            {selected.size} selected
          </span>
          <span className="h-3.5 w-px bg-hairline" />
          <ToolButton icon="flag" label="Change priority">
            Priority
          </ToolButton>
          <ToolButton icon="projects" label="Add to project">
            Project
          </ToolButton>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-ink-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}

      {conflicts.data && conflicts.data.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-inset bg-[color-mix(in_srgb,var(--state-risk)_18%,transparent)] px-3 py-2">
          <span className="text-sm text-[var(--state-risk-ink)]">
            <span className="font-medium">
              {conflicts.data.length} priority conflict
              {conflicts.data.length > 1 ? "s" : ""}
            </span>{" "}
            — {conflicts.data.map((c) => `P${c.rank}`).join(", ")} held by more
            than one task.
          </span>
          <button
            type="button"
            onClick={() => setGrouping("status")}
            className="ml-auto shrink-0 text-xs text-[var(--state-risk-ink)] underline-offset-2 hover:opacity-80"
          >
            Show
          </button>
          <button
            type="button"
            disabled={fixState.isPending}
            onClick={async () => {
              const r = await fixConflicts();
              if (r.ok) {
                refetch();
                conflicts.refetch();
              }
            }}
            className="shrink-0 rounded-full bg-[var(--state-risk-ink)] px-2.5 py-1 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {fixState.isPending ? "Fixing…" : "Fix"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="frost-panel rounded-panel px-4 py-3">
          <SkeletonRows rows={8} />
        </div>
      ) : error ? (
        <div className="frost-panel rounded-panel">
          <ErrorState body={error} onRetry={refetch} />
        </div>
      ) : !data?.length ? (
        <div className="frost-panel rounded-panel">
          <EmptyState
            title={search || filterCount ? "No tasks match" : "No tasks here"}
            body={
              search || filterCount
                ? "Try a different search, or clear the filters."
                : "Tasks assigned to you appear here."
            }
            action={
              search || filterCount ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    setStatuses([]);
                    setOnlyOverdue(false);
                    setOnlyBlocked(false);
                    setOnlyMine(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button tone="primary">
                  <Link href="/tasks/new">New task</Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="frost-panel overflow-hidden rounded-panel">
          {/* Desktop */}
          <div className="hidden deck:block">
            {/* Headings sit in the same cells the values do, on the same inset,
                so each label is visibly the head of ITS column rather than a
                word floating near one. `truncate` rather than wrapping: a
                heading that runs long clips inside its own cell instead of
                growing a second line and shunting the row taller than its
                neighbours. */}
            <div
              className={`grid ${hasRowMenu ? COLS_MENU : COLS} border-b border-hairline text-[11px] tracking-[0.09em] text-ink-faint uppercase`}
            >
              <span className={HEAD_LEAD}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(allIds))
                  }
                  className="h-3.5 w-3.5 accent-[var(--color-ink)]"
                />
              </span>
              <span className={HEAD_P}>
                <span className="truncate">P</span>
              </span>
              <span className={HEAD_TASK}>
                <span className="truncate">Task</span>
              </span>
              <span className={HEAD}>
                <span className="truncate">People</span>
              </span>
              <span className={HEAD_STATUS}>
                <span className="truncate">Status · next</span>
              </span>
              {/* **Which date this column shows, said in the column.**
                  It is the REQUESTED deadline — the commitment the assignor
                  asked for — not the expected completion, which is when the
                  work will actually finish once it is laid through the queue.
                  A list cannot compute expected completion without one
                  feasibility query per row, so it shows the fact it has and
                  names it honestly. That disclosure used to live in the sort
                  menu, as the option labelled "Requested"; the menu is gone
                  and the header is where it always belonged. */}
              <span className={HEAD}>
                <span className="truncate">Deadline · requested</span>
              </span>
              <span className={`${HEAD} justify-end`}>
                <span className="truncate">Time budget</span>
              </span>
              <span className={HEAD_TIMER}>
                <span className="truncate">Timer</span>
              </span>
              <span className={hasRowMenu ? HEAD : HEAD_TAIL}>
                <span className="truncate">Activity</span>
              </span>
              {hasRowMenu && <span className={HEAD_TAIL} />}
            </div>

            {/* Each group is a section, not a band in a table.
                The header used to be a `py-1` tinted strip between rows, which
                made four statuses read as one continuous list with tint marks
                in it. A reader scanning for "where does In progress end" had to
                read the strip rather than see the break. The gap does that work
                instead: 32px between sections, 16px from header to its rows,
                and row spacing untouched. */}
            {groups
              .filter((g) => g.items.length > 0)
              .map((g) => {
                const isCollapsed = collapsedGroups.has(g.key);
                /* Drag-to-reorder is offered per PERSON, so it lives in the
                   assignee grouping — each group is one queue. Active tasks are
                   laid out in that person's rank order so the drag reads as the
                   priority list it is. */
                /* Whoever `groupTasks` grouped this by — see `Group.ownerId`. */
                const groupAssigneeId = g.ownerId;
                const isAssigneeGroup = groupAssigneeId !== null;
                /* Reordering needs permission; the gap-free NUMBERING does not.
                   Whether or not this viewer may drag, an assignee's active queue
                   is shown 1..N by index — which is why a completed task leaving a
                   hole (stored 1, 2, 4) reads as 1, 2, 3 here, with no missing P3. */
                const canDrag =
                  isAssigneeGroup && g.items.some(mayReorderOn);
                const items = isAssigneeGroup
                  ? [...g.items].sort((a, b) => {
                      /* In-queue work first, then everything held out of it
                         (budget pending, not accepted, closed) — so the numbered
                         queue is contiguous at the top. */
                      const aa = inActiveQueue(a, groupAssigneeId!);
                      const ba = inActiveQueue(b, groupAssigneeId!);
                      if (aa !== ba) return aa ? -1 : 1;
                      return (
                        rankNum(a, groupAssigneeId!) - rankNum(b, groupAssigneeId!)
                      );
                    })
                  : g.items;
                /* The derived queue: tasks actually in the active queue, in rank
                   order, numbered by index — unique and gap-free by construction,
                   the same thing the queue owner sees. A task whose budget is not
                   settled or which is unaccepted is NOT here, so it holds no
                   position and cannot be dragged. */
                const activeIds = isAssigneeGroup
                  ? items
                      .filter((v) => inActiveQueue(v, groupAssigneeId!))
                      .map((v) => v.task.id)
                  : [];
                return (
                  <div key={g.key} className={g.label ? "mt-8 first:mt-0" : ""}>
                    {g.label && (
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedGroups((c) => {
                            const next = new Set(c);
                            if (next.has(g.key)) next.delete(g.key);
                            else next.add(g.key);
                            return next;
                          })
                        }
                        aria-expanded={!isCollapsed}
                        /**
                         * **No rule under the name.**
                         *
                         * It was `border-b border-hairline` — the same token, at
                         * the same weight, as the rules dividing the rows. So
                         * the one element on the page that had to read as a
                         * SECTION HEADING was drawn exactly like a row
                         * separator, and the name ended up looking like the
                         * first row of the table rather than the title of the
                         * group under it. It also underlined the person, not
                         * their queue: the line sat between the name and the
                         * work it belongs to, cutting the two apart.
                         *
                         * Proximity does the job instead, and does it better —
                         * 32px above the heading against 6px below it, so the
                         * name is unambiguously nearer its own rows than the
                         * section before. No ink required.
                         */
                        className="mb-1.5 flex w-full items-center gap-2 px-4 pb-1.5 text-left text-ink-muted transition-colors hover:text-ink"
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60"
                        />
                        {/* Inherits the button's colour rather than pinning its
                            own, so the whole heading answers the hover — the
                            border used to be the only thing that did, and it is
                            gone. */}
                        <span className="text-[11px] tracking-[0.09em] uppercase">
                          {g.label}
                        </span>
                        <span
                          data-figure
                          className="text-[11px] text-ink-faint opacity-70"
                        >
                          {g.items.length}
                        </span>
                        <span className="ml-auto text-ink-faint">
                          {isCollapsed ? (
                            <Icon.chevronRight />
                          ) : (
                            <Icon.chevronDown />
                          )}
                        </span>
                      </button>
                    )}
                    {!isCollapsed && (
                      <div className="divide-y divide-hairline">
                        {buildTaskTree(
                          items,
                          (v) => ({
                            id: v.task.id,
                            parentId: v.task.parentTaskId
                              ? String(v.task.parentTaskId)
                              : null,
                          }),
                          collapsedParents,
                        ).map((node) => {
                          const v = node.item;
                          /* Broken down, so this row is the container and not
                             the work. It carries no priority — priority is a
                             position in ONE person's queue, and a container has
                             no assignee doing it — and for the same reason it
                             cannot be dragged into somebody's order. The
                             subtasks beneath it are what hold both. */
                          const isContainerRow =
                            node.hasChildren || v.subtaskCount > 0;
                          const rowInQueue =
                            isAssigneeGroup &&
                            !isContainerRow &&
                            inActiveQueue(v, groupAssigneeId!);
                          const rowDraggable = canDrag && rowInQueue;
                          /* The gap-free position. Prefer the SERVER's derived
                             position for this subject (`queuePosition`, now
                             computed per-person over their WHOLE queue), so this
                             group shows the exact number the report sees on their
                             own list — one source of truth, no fourth numbering
                             path. Falls back to the local index only if the
                             subject's queue could not be read. Null for a closed
                             task ("was P5"), a held-out task, or outside grouping. */
                          const serverPos =
                            v.assignments.find(
                              (a) => a.employeeId === groupAssigneeId,
                            )?.queuePosition ?? null;
                          const derivedPos = rowInQueue
                            ? (serverPos ?? activeIds.indexOf(v.task.id) + 1)
                            : null;
                          /* Why an OPEN task shows no live position — so the
                             reader is told, not left to guess. */
                          const holdReason =
                            isAssigneeGroup && !isContainerRow
                              ? queueHoldReason(v, groupAssigneeId!)
                              : null;
                          return (
                            <Row
                              key={v.task.id}
                              view={v}
                              depth={node.depth}
                              isContainer={isContainerRow}
                              childCount={node.childCount}
                              isLastChild={node.isLastChild}
                              collapsed={collapsedParents.has(v.task.id)}
                              onToggleChildren={
                                node.hasChildren
                                  ? () => toggleParent(v.task.id)
                                  : undefined
                              }
                              rankSubjectId={groupAssigneeId ?? undefined}
                              displayRank={derivedPos}
                              draggable={rowDraggable}
                              isDragging={dragId === v.task.id}
                              isDropTarget={
                                rowDraggable &&
                                overId === v.task.id &&
                                dragId !== null &&
                                dragId !== v.task.id
                              }
                              onDragStart={
                                rowDraggable
                                  ? () => setDragId(v.task.id)
                                  : undefined
                              }
                              onDragOver={
                                rowDraggable
                                  ? () => {
                                      /* Only when it CHANGES. `dragover` fires
                                         continuously while the pointer is over a
                                         row, and an unconditional write here
                                         re-rendered every row in the table
                                         dozens of times a second — which is the
                                         whole of the lag people reported. */
                                      if (dragId && overId !== v.task.id)
                                        setOverId(v.task.id);
                                    }
                                  : undefined
                              }
                              onDrop={
                                rowDraggable
                                  ? () =>
                                      commitReorder(
                                        groupAssigneeId!,
                                        g.label ?? null,
                                        activeIds,
                                        items,
                                      )
                                  : undefined
                              }
                              onDragEnd={() => {
                                setDragId(null);
                                setOverId(null);
                              }}
                              selected={selected.has(v.task.id)}
                              onSelect={() => toggle(v.task.id)}
                              conflicted={
                                v.myRank !== null && conflictRanks.has(v.myRank)
                              }
                              notInQueueReason={holdReason}
                              onPriority={
                                mayReorderOn(v) &&
                                !holdReason &&
                                !isContainerRow
                                  ? () => setPriorityFor(v)
                                  : null
                              }
                              hideProject={Boolean(projectId)}
                              onUnlink={
                                onUnlink
                                  ? async () => {
                                      await onUnlink(v.task.id);
                                      refetch();
                                    }
                                  : undefined
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Below the deck breakpoint: stacked rows, not a sideways-scrolling
              table. A table you must scroll to reach the status column is
              slower than a card. */}
          <div className="divide-y divide-hairline deck:hidden">
            {(data ?? []).map((v) => (
              <NarrowRow key={v.task.id} view={v} />
            ))}
          </div>
        </div>
      )}

      {priorityFor && (
        <PriorityDialog
          view={priorityFor}
          onClose={() => setPriorityFor(null)}
          onDone={() => {
            setPriorityFor(null);
            refetch();
          }}
        />
      )}

      {pendingReorder && (
        <PriorityReorderConfirm
          employeeId={pendingReorder.employeeId}
          employeeName={pendingReorder.employeeName}
          subject={pendingReorder.subject}
          orderedTaskIds={pendingReorder.orderedTaskIds}
          onCancel={() => setPendingReorder(null)}
          onDone={() => {
            setPendingReorder(null);
            refetch();
          }}
        />
      )}
    </>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint">
        <Icon.search />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tasks"
        aria-label="Search tasks"
        className="h-8 w-[176px] rounded-full bg-[var(--surface-sunken)] pr-3 pl-8 text-sm text-ink transition-[width] duration-[180ms] placeholder:text-ink-faint focus:w-[240px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      />
    </div>
  );
}

function Row({
  view,
  selected,
  onSelect,
  conflicted,
  onPriority,
  hideProject,
  onUnlink,
  depth = 0,
  isContainer = false,
  childCount = 0,
  isLastChild = false,
  collapsed = false,
  onToggleChildren,
  rankSubjectId,
  displayRank = null,
  notInQueueReason = null,
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  view: TaskView;
  selected: boolean;
  onSelect: () => void;
  conflicted: boolean;
  /** Null when this viewer may change nobody's priority on this task. */
  onPriority: (() => void) | null;
  hideProject: boolean;
  onUnlink?: () => void;
  /** 0 for a root, 1 for a subtask. Drives the indent and the connector. */
  depth?: number;
  /**
   * This task has been broken down, so the row stands for the container.
   *
   * It shows a folder rather than a status dot, and NO priority — a rank is a
   * position in one person's queue, and nobody is queued to do a container. Its
   * subtasks carry the ranks.
   */
  isContainer?: boolean;
  /** Children beneath it in THIS list, for the count beside the title. */
  childCount?: number;
  /** Last child under its parent — the connector stops rather than continuing. */
  isLastChild?: boolean;
  collapsed?: boolean;
  /** Absent when there is nothing to fold, which is what hides the chevron. */
  onToggleChildren?: () => void;
  /** Whose rank to show — the assignee whose queue this row sits in, when the
      list is grouped by person; the viewer otherwise. */
  rankSubjectId?: string;
  /** The gap-free derived position to show instead of the stored rank. Set in an
      assignee group so a completed task's hole never reads as a missing P3. */
  displayRank?: number | null;
  /** When set, this OPEN task is held out of the person's active queue (budget
      not settled, or unaccepted). The priority cell shows "—" with this text as
      its reason, and the row is neither numbered nor draggable — reordering it
      would move a rank that drives no deadline. */
  notInQueueReason?: string | null;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  /* Real clock, resolved after mount — see `useNow`. */
  const now = useNow();
  const meta = statusMeta(view);
  /* The ACTING viewer. This was the seeded id, so every card answered "is this
     my move" for one person no matter who was signed in — an approver saw
     "Awaiting someone" on a task they were blocking. */
  const viewerId = useViewerId();
  /* The rank shown is the queue's OWNER's, not the reader's, when the list is
     grouped by person — otherwise a manager sorting a report's queue would see
     their own numbers beside the report's tasks. */
  const rankSubject = rankSubjectId ?? viewerId;
  /* Prefer the derived, gap-free position where the caller supplied one — a
     completed task in the queue no longer leaves a hole the reader has to
     explain. Fall back to the stored figure everywhere else. */
  /**
   * **A closed task shows no rank at all.**
   *
   * It used to read "Was P1", and on this product almost every finished task
   * does. The queue compacts when work closes, so whatever you finish next
   * becomes P1 and then leaves holding it — "Was P1" ends up stamped down the
   * whole history and says nothing about the task it is attached to. A column
   * of them is a column of noise sitting where a live position would be.
   *
   * Read off the rule's own `isHistoric` rather than re-deriving "closed" here,
   * so this stays the same answer `priorityDisplay.ts` gives. The rule is
   * unchanged: it still resolves the historic rank, and the tooltip still says
   * what it was when the task left the queue. This only declines to print it in
   * a 92px cell.
   */
  const rank = rankFor(view, rankSubject);
  const rankText = rank.isHistoric
    ? "—"
    : displayRank !== null
      ? `P${displayRank}`
      : formatRankDisplay(rank);
  /* Priority is only real once the time budget is settled. In an assignee group
     the parent already works this out (`notInQueueReason`); everywhere else,
     catch the budget-still-in-negotiation case here so no grouping shows a
     P-tag on a task whose hours nobody has agreed yet. A closed task keeps its
     "was P3" and is not affected — its budget was settled long ago. */
  const isClosed =
    view.task.status === "completed" ||
    view.task.status === "cancelled" ||
    view.task.status === "assignment_rejected";
  const heldReason =
    notInQueueReason ??
    (!isClosed && !isBudgetSettled(view.budgetNegotiation?.state ?? null)
      ? "Not in the queue yet — the time budget isn't settled. Priority takes effect once it's agreed."
      : null);
  /* A decision addressed to this reader by name — the same predicate the
     Actionable inbox decides its membership with, so the mark on the row and
     the row in the inbox can never disagree. */
  const awaitingMyApproval = awaitsApprovalFrom(view, viewerId);
  const action = nextAction(view, viewerId ?? "");
  const ownerEmp = view.owner;
  /* The same test the header runs, off the same prop — see `COLS`. */
  const hasMenu = Boolean(onUnlink);

  return (
    <div
      draggable={draggable}
      onDragStart={
        onDragStart
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              /* Firefox refuses the drag without a payload. */
              e.dataTransfer.setData("text/plain", view.task.id);
              onDragStart();
            }
          : undefined
      }
      onDragOver={
        onDragOver
          ? (e) => {
              e.preventDefault();
              onDragOver();
            }
          : undefined
      }
      onDrop={
        onDrop
          ? (e) => {
              e.preventDefault();
              onDrop();
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      /* No `gap` and no padding on the row itself — both live inside the cells,
         so a cell's own padding is the whole of the space between columns and
         the hover wash still reaches the panel's edges. */
      className={`group grid ${hasMenu ? COLS_MENU : COLS} transition-[colors,opacity] ${
        selected ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
        isDragging ? "opacity-40" : ""
      } ${isDropTarget ? "outline outline-1 -outline-offset-1 outline-ink/40" : ""}`}
    >
      <span className={CELL_LEAD}>
        <span className={`${LINE} justify-center`}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`Select ${view.task.title}`}
            className="h-3.5 w-3.5 accent-[var(--color-ink)]"
          />
        </span>
      </span>

      {/* The rank is INFORMATION first and a control second. Rendering it as a
          disabled button when it cannot be changed dimmed a figure the reader
          still needs and announced it as disabled to a screen reader. Not
          interactive is a span, not a disabled button — the same treatment the
          task detail already gives it. */}
      <span className={CELL}>
      <span className={LINE}>
      {awaitingMyApproval ? (
        /* **A mark, not a number — because there is no number.**

           A task waiting on your approval holds no queue position: nobody has
           accepted it, its budget is not settled, and on the cross-department
           path it is not even assigned yet. Every other branch below prints
           either a rank or an em-dash, and an em-dash here says "no rank" —
           true, and the same thing a project and a task awaiting somebody
           ELSE’s decision both show. This is the one state in the column that
           is an obligation rather than a position.

           The chip itself stays neutral — identical background, padding and
           radius to a rank chip — and the DOT carries the colour. A state wash
           behind it would have put `--state-overdue-ink` on `--state-overdue`,
           which on the dark theme is pale pink on dark maroon: high contrast,
           but it does not read as red. Red on the ordinary control surface
           does, and it keeps the column one material.

           The invisible "P1" is a sizer, and it is why this is not simply a
           dot in a box: it makes the chip exactly the width and height of a
           rank chip, so the column keeps one edge and nothing shifts when a
           decision clears and a real number takes its place. */
        <span
          title="Waiting for your approval. It takes a queue position once you decide."
          className="relative max-w-full rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px]"
        >
          <span data-figure aria-hidden className="invisible">
            P1
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[var(--state-overdue)]"
            />
          </span>
          <span className="sr-only">Waiting for your approval</span>
        </span>
      ) : isContainer ? (
        /* A container holds no rank at all — not "—, because the budget isn't
           settled", but "there is no queue this belongs to". Its subtasks each
           sit in their own assignee's queue with their own number, which is the
           whole reason the work was broken out. */
        <span
          title="A project — its subtasks carry the priority, each in its own assignee's queue."
          className="max-w-full truncate rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-faint"
        >
          <span data-figure>—</span>
        </span>
      ) : heldReason && rankText === "—" ? (
        /* Held out of the queue, and genuinely no number was ever stored —
           the em-dash says "no rank here"; the tooltip says why. */
        <span
          title={heldReason}
          className="max-w-full truncate rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-faint"
        >
          <span data-figure>—</span>
        </span>
      ) : heldReason ? (
        /* **Held out of the LIVE queue, but real work with a real number —
           show it.** `queueRankFor`'s own test states the rule this used to
           violate: "It is real work with a real priority — just not yet in
           the running order." Blanking `rankText` here regardless of its
           value hid the number `rankFor` had already resolved for every task
           awaiting acceptance — which is EVERY newly created task and EVERY
           subtask, since both start in `WAITING_FOR_ASSIGNEE`.

           The number itself is the PROVISIONAL position, not the raw stored
           rank — its own gap-free 1, 2, 3 among everything else of this
           person's awaiting acceptance, computed by `provisionalQueuePositions`
           and excluding anything that has become a container. Before that
           existed this showed the raw, ungapped stored figure, which is why a
           project sitting between two pending subtasks read as a missing
           number rather than as nothing (see `task-priority` in help).

           Not a button: this position is real but not yet a live queue slot,
           so it is not draggable and does not open the reorder dialog —
           dragging it would insert a task into a queue it has not actually
           joined. */
        <span
          title={`${heldReason} Shown is its position among your work still awaiting acceptance — a separate count from the live queue.`}
          className="max-w-full truncate rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-faint"
        >
          <span data-figure>{rankText}</span>
        </span>
      ) : onPriority ? (
        <button
          type="button"
          onClick={onPriority}
          title={
            conflicted
              ? "Rank conflict — more than one task holds this rank"
              : "Change priority"
          }
          className={`max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] transition-colors ${
            conflicted
              ? "bg-[color-mix(in_srgb,var(--state-risk)_30%,transparent)] text-[var(--state-risk-ink)]"
              : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)]"
          }`}
        >
          <span data-figure>{rankText}</span>
        </button>
      ) : (
        <span
          title={
            conflicted
              ? "Rank conflict — more than one task holds this rank"
              : "Your priority is set by your manager"
          }
          className={`max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] ${
            conflicted
              ? "bg-[color-mix(in_srgb,var(--state-risk)_30%,transparent)] text-[var(--state-risk-ink)]"
              : "bg-[var(--control)] text-ink-muted"
          }`}
        >
          <span data-figure>{rankText}</span>
        </span>
      )}
      </span>
      </span>

      {/* The title cell carries the tree: the fold control and the folder on a
          container, the indent and the elbow on a child. Both live INSIDE this
          cell rather than taking columns of their own, so the eleven-column
          grid — and every other row's alignment — is untouched. */}
      <div className={CELL}>
      <div className="flex min-w-0 flex-1 items-stretch">
        {depth > 0 && (
          /* The elbow. `aria-hidden` because the relationship is already
             carried in words by the "Subtask" mark below the title — a screen
             reader gets the fact, not a drawing of it. */
          <span
            aria-hidden="true"
            /* `self-stretch` rather than a fixed height: rows are two lines
               tall and a 32px rule left a gap between consecutive children, so
               the trunk read as a dashed line rather than one branch. */
            className="relative mr-1 w-5 shrink-0 self-stretch"
          >
            <span
              /* Stops halfway down on the last child, so the branch ends at the
                 row it points to instead of trailing into the next task. */
              className={`absolute left-2 top-0 w-px bg-[var(--color-hairline)] ${
                isLastChild ? "h-1/2" : "bottom-0"
              }`}
            />
            <span className="absolute left-2 top-1/2 h-px w-3 bg-[var(--color-hairline)]" />
          </span>
        )}

        {onToggleChildren ? (
          <button
            type="button"
            onClick={onToggleChildren}
            aria-expanded={!collapsed}
            aria-label={
              collapsed
                ? `Show the ${childCount} subtask${childCount === 1 ? "" : "s"} of ${view.task.title}`
                : `Hide the subtasks of ${view.task.title}`
            }
            /* `h-7` and `self-start`, so the control sits ON the title's line
               rather than centred over the whole two-line cell. */
            className="mr-1 grid h-7 w-5 shrink-0 place-items-center self-start rounded text-ink-faint transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
          >
            {collapsed ? (
              <Icon.chevronRight className="h-3.5 w-3.5" />
            ) : (
              <Icon.chevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          /* Holds the chevron's width so titles line up down the column
             whether or not a row can be folded. */
          <span aria-hidden="true" className="mr-1 h-7 w-5 shrink-0" />
        )}

        {/* An anchor drags its URL by default, which would fight the row drag —
            so the title is not itself draggable; the row around it is. */}
        <Link
          href={`/tasks/${view.task.id}`}
          draggable={false}
          className="flex min-w-0 flex-1 flex-col gap-0.5"
        >
        <span className={`${LINE} gap-1.5`}>
          {isContainer && (
            /* A broken-down task IS a project — the same word the task's own
               Completion requirements panel has always used for this state. It
               is not the `/tasks/projects` feature, which links independent
               tasks that each stand on their own; this one is a single piece of
               work whose parts have to come back together. */
            <span
              title="A project — broken down into subtasks"
              className="shrink-0 text-ink-faint"
            >
              <Icon.folder className="h-3.5 w-3.5" />
            </span>
          )}
          {view.task.isBlocked && (
            <span title="Blocked" className="text-[var(--state-blocked-ink)]">
              <Icon.blocked className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate text-sm text-ink">{view.task.title}</span>
        </span>
        <span className="flex h-4 items-center gap-2 overflow-hidden text-[11px] leading-4 text-ink-faint">
          <span data-figure className="shrink-0">
            {view.task.reference}
          </span>
          {/* Which side of a breakdown this row is on. A subtask reads as an
              ordinary task otherwise, and the two rows tell a reader nothing
              about how they relate — which matters most in the list where both
              appear, the one belonging to whoever broke the work out. The
              parent's title is not here: resolving it costs a read per row, and
              the task itself carries the link. */}
          {view.task.parentTaskId ? (
            <span>· Subtask</span>
          ) : (
            view.subtaskCount > 0 && (
              <span>
                · Project ·{" "}
                <span data-figure>{view.subtaskCount}</span>{" "}
                {view.subtaskCount === 1 ? "subtask" : "subtasks"}
              </span>
            )
          )}
          {!hideProject && view.project && (
            <span className="truncate">· {view.project.name}</span>
          )}
          {view.reworkCount > 0 && <span>· {view.reworkCount} rework</span>}
          {view.chatCount > 0 && (
            <span className="flex items-center gap-0.5">
              · <Icon.chat className="h-3 w-3" /> {view.chatCount}
            </span>
          )}
        </span>
        </Link>
      </div>
      </div>

      {/* Owner → assignee, in one 88px cell — the two 28px monograms, the
          chevron between them and the padding that holds them off the rules
          measure 72px, so nothing is pressed against a column line. */}
      <span className={CELL}>
      <span className={`${LINE} gap-1`}>
        {ownerEmp ? (
          <Avatar
            initials={ownerEmp.initials}
            hue={ownerEmp.hue}
            src={ownerEmp.profilePictureUrl}
            name={`Owner ${ownerEmp.displayName}`}
            size="sm"
          />
        ) : (
          <span
            className="h-7 w-7 rounded-full bg-[var(--control)]"
            title="Owner"
          />
        )}
        {/* `opacity-50` on top of `--ink-faint` measured 2.19:1 — below any
            readable floor. The token alone is 6.10:1 and already reads as the
            quietest thing in the row. */}
        <Icon.chevronRight className="h-3 w-3 text-ink-faint" />
        {view.assignees[0] ? (
          <Avatar
            initials={view.assignees[0].initials}
            hue={view.assignees[0].hue}
            src={view.assignees[0].profilePictureUrl}
            name={view.assignees[0].displayName}
            size="sm"
          />
        ) : (
          <span className="h-7 w-7 shrink-0 rounded-full bg-[var(--control)]" />
        )}
      </span>
      </span>

      <span className={CELL}>
      <span className={LINE}>
        <Chip tone={meta.tone} className="max-w-full truncate">
          {meta.label}
        </Chip>
      </span>
        {/* No next action on a container. `action`/`meta` read this document's
            own stored status — usually whatever it was mid-negotiation when it
            got broken down — and nothing here decides for itself that the
            document stopped being actionable the moment it gained a subtask.
            Naming the project instead of a false "Accept" is the fix; leaving
            the chip alone since a stale status label is at least true of the
            document, where a call to action on it was not. */}
        {/* `SUB`'s geometry, but not its colour: this line goes full-strength
            when the next move is the reader's, and stacking `text-ink` on top
            of `SUB`'s `text-ink-faint` would leave which one wins to the order
            Tailwind happens to emit them in rather than to the condition.

            `pl-2.5` is the chip's own horizontal padding, repeated. Without it
            this line began 10px to the left of the chip's first letter and the
            cell had two left edges — see `HEAD_STATUS`, which lines the heading
            up on the same one. */}
        <span
          className={`block truncate pl-2.5 text-[11px] leading-4 ${
            !isContainer && action.actor === "you"
              ? "text-ink"
              : "text-ink-faint"
          }`}
        >
          {isContainer
            ? "Project — see its subtasks"
            : `${action.actor === "you" ? "→ " : ""}${action.label}`}
        </span>
      </span>

      {/* **The progress column is gone.**
          It showed a percentage derived from status and logged time — 5% on
          anything in progress, 95% in review, 100% complete — which is a
          shape, not a measurement. Nobody can compute what fraction of a
          task is done, and the figure invited the reading that somebody
          had. The timer column carries the one honest number. */}

      <span className={CELL}>
      <span
        className={`${LINE} text-xs ${view.isOverdue ? "text-[var(--state-overdue-ink)]" : "text-ink-muted"}`}
      >
        {/* Committed deadline where one exists, else the DERIVED completion date.
            A budget extension leaves the committed deadline frozen (by design) but
            pushes the derived date — so a task with no commitment showed nothing
            here and never reflected the extra time. `operationalDueAt` is the same
            figure the detail page labels "Expected completion".

            **A container shows neither.** Both figures are read off THIS
            document's own deadline block — whatever it held the moment it was
            broken down — and a project negotiates no deadline of its own. Each
            subtask carries its own; this row's date would be a fossil, not a
            fact. */}
        {isContainer
          ? "—"
          : formatDate(
              view.task.deadline.dueAt ?? view.task.deadline.operationalDueAt,
            )}
      </span>
      </span>

      {/* Both figures are eight tabular characters wide, so the column is sized
          for them and for its own heading rather than for the shorter of the
          two — at 62px "of 03:06:31" ran back over the deadline beside it. */}
      <span className={`${CELL} text-right`}>
        {isContainer ? (
          /* No time budget on a container — see the deadline cell's note; the
             same document field, the same reason it is not this row's to show. */
          <span data-figure className={`${LINE} justify-end text-xs text-ink-faint`}>
            —
          </span>
        ) : (
          <>
            <span data-figure className={`${LINE} justify-end text-xs text-ink`}>
              {formatTimer(view.loggedSecs)}
            </span>
            <span data-figure className={SUB}>
              of {formatDurationTimer(view.task.estimatedEffortSecs)}
            </span>
          </>
        )}
      </span>

      {/* Play / pause, wired to the repository. Rows that cannot run a session
          hold the column's width and show elapsed instead of a dead control.
          A container is one more thing that cannot run a session — nobody
          works a project — so it gets the same dash rather than a Start
          button that would begin timing nothing. */}
      <span className={CELL}>
      {/* Centred, because the control is a fixed 74px pill that centres its own
          figure — so the column's values share a centre line, not a left edge,
          and the heading is centred over them to match. */}
      <span className={`${LINE} justify-center`}>
        {isContainer ? (
          <span className="text-xs text-ink-faint">—</span>
        ) : (
          <TimerControl view={view} />
        )}
      </span>
      </span>

      <span className={hasMenu ? CELL : CELL_TAIL}>
        <span className={`${LINE} text-[11px] text-ink-faint`}>
          <span className="truncate">
            {now && formatRelative(view.task.updatedAt, now)}
          </span>
        </span>
        {view.latestSubmission && (
          <span className={SUB}>attempt {view.latestSubmission.attempt}</span>
        )}
      </span>

      {/* Only inside a project, where "Remove from project" has no other home.
          Everywhere else this whole column is gone — see `COLS`. */}
      {hasMenu && (
      <span className={CELL_TAIL}>
      <span className={`${LINE} justify-end`}>
      <Popover
        align="right"
        label={`Actions for ${view.task.title}`}
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={`Actions for ${view.task.title}`}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-[var(--control-hover)] hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Icon.more />
          </button>
        )}
      >
        {() => (
          <>
            <MenuItem icon="tasks">
              <Link href={`/tasks/${view.task.id}`}>Open task</Link>
            </MenuItem>
            {onPriority && !heldReason && (
              <MenuItem icon="flag" onClick={onPriority}>
                Change priority
              </MenuItem>
            )}
            <MenuItem icon="clock">
              <Link href={`/tasks/${view.task.id}/deadline`}>Deadline</Link>
            </MenuItem>
            <MenuDivider />
            <MenuItem icon="history">
              <Link href={`/tasks/${view.task.id}/history`}>History</Link>
            </MenuItem>
            {onUnlink && (
              <MenuItem icon="close" onClick={onUnlink} danger>
                Remove from project
              </MenuItem>
            )}
          </>
        )}
      </Popover>
      </span>
      </span>
      )}
    </div>
  );
}

function NarrowRow({ view }: { view: TaskView }) {
  const meta = statusMeta(view);
  /* The ACTING viewer. This was the seeded id, so every card answered "is this
     my move" for one person no matter who was signed in — an approver saw
     "Awaiting someone" on a task they were blocking. */
  const viewerId = useViewerId();
  const action = nextAction(view, viewerId ?? "");
  const cardRank = rankFor(view, viewerId);
  return (
    <Link href={`/tasks/${view.task.id}`} className="block px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span
          data-figure
          className="mt-0.5 shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-muted"
        >
          {/* Same rule as the table's rank cell: a closed task prints nothing
              rather than "Was P1", which the compacting queue stamps on almost
              everything that finishes. */}
          {cardRank.isHistoric ? "—" : formatRankDisplay(cardRank)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            {view.task.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
            <span>{view.project?.name ?? "No project"}</span>
            {(view.task.deadline.dueAt ??
              view.task.deadline.operationalDueAt) && (
              <span>
                ·{" "}
                {formatDate(
                  view.task.deadline.dueAt ??
                    view.task.deadline.operationalDueAt,
                )}
              </span>
            )}
            {action.actor === "you" && (
              <span className="text-ink">· → {action.label}</span>
            )}
          </span>
        </span>
        <Chip tone={meta.tone}>{meta.label}</Chip>
      </div>
    </Link>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */


interface Group {
  key: string;
  label: string | null;
  items: TaskView[];
  /**
   * Whose queue this group is, when grouping by person. Null otherwise.
   *
   * Carried on the group rather than re-derived from `items[0]` at the render
   * site: the grouping function is the only thing that knows who it grouped by,
   * and two places working it out independently is how the heading and the rank
   * lookup came to disagree.
   */
  ownerId: string | null;
}

/**
 * The four buckets a person actually triages by.
 *
 * Not the raw status label: "Assigned", "Confirmed" and "Deadline pending" are
 * three names for one situation — someone has to do something — and splitting
 * them scatters the only group that matters. Order is fixed rather than
 * insertion-based, so the list does not reshuffle as tasks move.
 */
const STATUS_BUCKETS = [
  "Needs action",
  "In progress",
  "Waiting",
  "Completed",
] as const;

function bucketOf(v: TaskView, viewerId: string): string {
  if (v.task.status === "completed" || v.task.status === "cancelled")
    return "Completed";
  if (nextAction(v, viewerId).actor === "you") return "Needs action";
  if (v.task.status === "in_progress") return "In progress";
  return "Waiting";
}

/**
 * Finished work sinks to the bottom.
 *
 * The list arrives in priority order, and a closed task keeps the rank it held
 * when it left the queue — so a task completed last week sat between P1 and P2,
 * three of them in a row above the work actually in progress. The rank is not
 * wrong; it is just no longer a claim on anybody's attention. Priority answers
 * "what next", and nothing that is already done is next.
 *
 * A stable partition rather than a sort: the incoming order is the priority
 * order the engine resolved, and it survives inside both halves. Applied before
 * grouping, so it holds within each person's group on the team list too.
 */
/**
 * Work waiting on MY decision, lifted to the top.
 *
 * The mirror of `sinkClosed`, and applied after it so the two compose: a
 * decision waiting on you rises, a finished task sinks, everything else keeps
 * the order the query gave it.
 *
 * It earns the top because it is the one kind of row where the LIST is the
 * only place the obligation can be found. A task you are carrying announces
 * itself — it has your name on it, a deadline, a timer. A cross-department
 * task waiting on your hours estimate has none of those: it is not assigned
 * to you, not created by you, and carries no queue position, so it sorts
 * wherever its `updatedAt` happens to fall and reads as somebody else’s work.
 */
function floatMyApprovals(items: TaskView[], viewerId: string): TaskView[] {
  const waiting: TaskView[] = [];
  const rest: TaskView[] = [];
  for (const v of items) {
    (awaitsApprovalFrom(v, viewerId) ? waiting : rest).push(v);
  }
  return [...waiting, ...rest];
}

function sinkClosed(items: TaskView[]): TaskView[] {
  const live: TaskView[] = [];
  const done: TaskView[] = [];
  for (const v of items) {
    (CLOSED_STATUSES.includes(v.task.status) ? done : live).push(v);
  }
  return [...live, ...done];
}

/**
 * Whose queue a row belongs to, on a list grouped by person.
 *
 * **Somebody other than the viewer, where there is one.** A jointly-held task
 * lists both, and `assignees[0]` can be the manager — so a team list grew a
 * group headed with the manager's own name over work that is genuinely their
 * report's. The task belongs there; the heading was answering "who holds this"
 * when the question a team list asks is "whose queue am I reading".
 *
 * One function, used for the heading AND for the id everything else resolves
 * against, because the two must never disagree. They did: the heading moved to
 * the report while `groupAssigneeId` still read `assignees[0]`, so the rank
 * lookup asked about the wrong person, found no assignment, scored every row
 * 999 and left the group unsorted and undraggable.
 */
function groupOwnerOf(v: TaskView, viewerId: string) {
  return v.assignees.find((a) => a.id !== viewerId) ?? v.assignees[0] ?? null;
}

function groupTasks(
  items: TaskView[],
  grouping: Grouping,
  viewerId: string,
): Group[] {
  const ordered = floatMyApprovals(sinkClosed(items), viewerId);
  if (grouping === "none")
    return [{ key: "all", label: null, items: ordered, ownerId: null }];

  const map = new Map<string, TaskView[]>();
  /* The person each group is about, captured where the key is decided. */
  const owners = new Map<string, string | null>();
  for (const v of ordered) {
    let key: string;
    if (grouping === "status") key = bucketOf(v, viewerId);
    else if (grouping === "project") key = v.project?.name ?? "No project";
    else if (grouping === "assignee") {
      const owner = groupOwnerOf(v, viewerId);
      key = owner?.displayName ?? "Unassigned";
      if (!owners.has(key)) owners.set(key, owner?.id ?? null);
    }
    else {
      const due = v.task.deadline.dueAt;
      key = !due ? "No deadline" : v.isOverdue ? "Overdue" : formatDate(due);
    }
    map.set(key, [...(map.get(key) ?? []), v]);
  }
  const entries = [...map.entries()];
  if (grouping === "status")
    entries.sort(
      (a, b) =>
        STATUS_BUCKETS.indexOf(a[0] as (typeof STATUS_BUCKETS)[number]) -
        STATUS_BUCKETS.indexOf(b[0] as (typeof STATUS_BUCKETS)[number]),
    );
  return entries.map(([label, list]) => ({
    key: label,
    label,
    items: list,
    ownerId: owners.get(label) ?? null,
  }));
}
