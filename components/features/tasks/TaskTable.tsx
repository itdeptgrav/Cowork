"use client";

import Link from "next/link";
import { formatRankDisplay, rankFor } from "@/lib/rules/tasks/priorityDisplay";
import { isBudgetSettled } from "@/lib/rules/tasks/activeQueue";
import { usePermissions, useViewerId } from "@/lib/hooks/usePermissions";
import { reorderableAssignees } from "@/lib/rules/tasks/priorityAffordance";
import { buildTaskTree } from "@/lib/rules/tasks/tree";
import { useMemo, useState } from "react";
import {
  statusMeta,
  statusLabel,
  nextAction,
  ALL_STATUSES,
} from "./statusMeta";
import { PriorityDialog } from "./PriorityDialog";
import { PriorityReorderConfirm } from "./PriorityReorderConfirm";
import { TimerControl } from "./TimerControl";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  MenuDivider,
  MenuItem,
  MenuLabel,
  Popover,
  ToolButton,
} from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Meter,
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
 * Eleven columns. The brief names task, status, priority, assignee, owner,
 * project, deadline, timer, progress, play/pause state and pending action as
 * things a person must be able to compare — owner and assignee share one cell
 * as "owner → assignee", status and pending action share one as "status ·
 * next", and the timer cell is both the elapsed figure and the control.
 */
/* The priority column is 92px, not the 38px a bare "P1" needs. Two of the four
   things it renders are longer than the chip: "Was P3" on a closed task, and
   "P2 to accept" on work whose hours are not agreed. Both are deliberate — a
   number from a different sequence must not wear the live queue's chip — and
   at 38px both overflowed into the title beside them.

   The number in "P2 to accept" is the rank whoever assigned it CHOSE, not a
   derived position: the suffix alone marks the sequence. See `priority.ts`. */
const COLS =
  "grid-cols-[28px_92px_minmax(0,1fr)_78px_146px_86px_74px_62px_78px_76px_30px]";

export function TaskTable({
  scope,
  projectId,
  onUnlink,
}: {
  scope: TaskScope;
  /** When set, the table is scoped to one project and hides the project column. */
  projectId?: string;
  /** Supplied by a project, which can remove a task's link without deleting it. */
  onUnlink?: (taskId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [sort, setSort] = useState<Sort>("rank");
  /* Grouped by status on arrival. A flat list of forty rows makes a person do
     the triage the product already knows how to do: the first question is
     always "what needs me", and that is the first group. Changing it is one
     click and the choice sticks for the session. */
  const [grouping, setGrouping] = useState<Grouping>("status");
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

  const filterCount =
    statuses.length +
    (onlyOverdue ? 1 : 0) +
    (onlyBlocked ? 1 : 0) +
    (onlyMine ? 1 : 0);

  const groups = useMemo(
    () => groupTasks(data ?? [], grouping, tableViewerId ?? ""),
    [data, grouping, tableViewerId],
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

  return (
    <>
      {/* Toolbar — one row, right-aligned, no empty gutter. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <SearchBox value={search} onChange={setSearch} />

        <Popover
          label="Filters"
          trigger={({ toggle: t, open }) => (
            <ToolButton
              icon="filter"
              label="Filter"
              onClick={t}
              active={open || filterCount > 0}
              count={filterCount}
            >
              Filter
            </ToolButton>
          )}
        >
          {() => (
            <>
              <MenuLabel>Quick</MenuLabel>
              <MenuItem
                selected={onlyOverdue}
                onClick={() => setOnlyOverdue((v) => !v)}
              >
                Overdue only
              </MenuItem>
              <MenuItem
                selected={onlyBlocked}
                onClick={() => setOnlyBlocked((v) => !v)}
              >
                Blocked only
              </MenuItem>
              <MenuItem
                selected={onlyMine}
                onClick={() => setOnlyMine((v) => !v)}
              >
                Assigned to me
              </MenuItem>
              <MenuDivider />
              <MenuLabel>Status</MenuLabel>
              <div className="max-h-[220px] overflow-y-auto scroll-slim">
                {ALL_STATUSES.map((s) => (
                  <MenuItem
                    key={s}
                    selected={statuses.includes(s)}
                    onClick={() =>
                      setStatuses((cur) =>
                        cur.includes(s)
                          ? cur.filter((x) => x !== s)
                          : [...cur, s],
                      )
                    }
                  >
                    {statusLabel(s)}
                  </MenuItem>
                ))}
              </div>
              {filterCount > 0 && (
                <>
                  <MenuDivider />
                  <MenuItem
                    onClick={() => {
                      setStatuses([]);
                      setOnlyOverdue(false);
                      setOnlyBlocked(false);
                      setOnlyMine(false);
                    }}
                  >
                    Clear all filters
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Popover>

        <Popover
          label="Group by"
          trigger={({ toggle: t, open }) => (
            <ToolButton
              icon="group"
              label="Group"
              onClick={t}
              active={open || grouping !== "none"}
            >
              {grouping === "none" ? "Group" : `By ${grouping}`}
            </ToolButton>
          )}
        >
          {(close) => (
            <>
              {(
                [
                  "none",
                  "status",
                  "project",
                  "assignee",
                  "deadline",
                ] as Grouping[]
              ).map((g) => (
                <MenuItem
                  key={g}
                  selected={grouping === g}
                  onClick={() => {
                    setGrouping(g);
                    close();
                  }}
                >
                  {g === "none" ? "No grouping" : `By ${g}`}
                </MenuItem>
              ))}
            </>
          )}
        </Popover>

        <Popover
          label="Sort"
          trigger={({ toggle: t, open }) => (
            <ToolButton icon="sort" label="Sort" onClick={t} active={open} />
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Sort by</MenuLabel>
              {(
                [
                  ["rank", "Priority"],
                  /* The assignor's commitment, not when the work will finish.
                     A list cannot show expected completion without one
                     feasibility query PER ROW, so it shows the fact it has and
                     names it honestly — the detail page carries both. */
                  ["due", "Requested"],
                  ["updated", "Recently updated"],
                  ["title", "Title"],
                ] as [Sort, string][]
              ).map(([id, label]) => (
                <MenuItem
                  key={id}
                  selected={sort === id}
                  onClick={() => {
                    setSort(id);
                    close();
                  }}
                >
                  {label}
                </MenuItem>
              ))}
            </>
          )}
        </Popover>

        <span className="ml-auto text-xs text-ink-faint">
          {data ? `${data.length} ${data.length === 1 ? "task" : "tasks"}` : ""}
        </span>
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
            <div
              className={`grid ${COLS} items-center gap-2 border-b border-hairline px-3 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase`}
            >
              <span className="grid place-items-center">
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
              <span>P</span>
              <span>Task</span>
              <span>People</span>
              <span>Status · next</span>
              <span>Progress</span>
              <span>Deadline</span>
              <span className="text-right">Time budget</span>
              <span>Timer</span>
              <span>Activity</span>
              <span />
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
                const groupAssigneeId =
                  grouping === "assignee"
                    ? (g.items[0]?.assignees[0]?.id ?? null)
                    : null;
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
                        className="mb-4 flex w-full items-center gap-2 border-b border-hairline px-3 pb-2 text-left transition-colors hover:border-[var(--color-ink-faint)]"
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint"
                        />
                        <span className="text-[11px] tracking-[0.09em] text-ink-muted uppercase">
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
  const rankText =
    displayRank !== null
      ? `P${displayRank}`
      : formatRankDisplay(rankFor(view, rankSubject));
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
  const action = nextAction(view, viewerId ?? "");
  const ownerEmp = view.owner;
  const progress = progressOf(view);

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
      className={`group grid ${COLS} items-center gap-2 px-3 py-2 transition-[colors,opacity] ${
        selected ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
        isDragging ? "opacity-40" : ""
      } ${isDropTarget ? "outline outline-1 -outline-offset-1 outline-ink/40" : ""}`}
    >
      <span className="grid place-items-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${view.task.title}`}
          className="h-3.5 w-3.5 accent-[var(--color-ink)]"
        />
      </span>

      {/* The rank is INFORMATION first and a control second. Rendering it as a
          disabled button when it cannot be changed dimmed a figure the reader
          still needs and announced it as disabled to a screen reader. Not
          interactive is a span, not a disabled button — the same treatment the
          task detail already gives it. */}
      {isContainer ? (
        /* A container holds no rank at all — not "—, because the budget isn't
           settled", but "there is no queue this belongs to". Its subtasks each
           sit in their own assignee's queue with their own number, which is the
           whole reason the work was broken out. */
        <span
          title="A project — its subtasks carry the priority, each in its own assignee's queue."
          className="justify-self-start rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-faint"
        >
          <span data-figure>—</span>
        </span>
      ) : heldReason && rankText === "—" ? (
        /* Held out of the queue, and genuinely no number was ever stored —
           the em-dash says "no rank here"; the tooltip says why. */
        <span
          title={heldReason}
          className="justify-self-start rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-faint"
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
          className="justify-self-start rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-faint"
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
          className={`justify-self-start rounded-full px-1.5 py-0.5 text-[11px] transition-colors ${
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
          className={`justify-self-start rounded-full px-1.5 py-0.5 text-[11px] ${
            conflicted
              ? "bg-[color-mix(in_srgb,var(--state-risk)_30%,transparent)] text-[var(--state-risk-ink)]"
              : "bg-[var(--control)] text-ink-muted"
          }`}
        >
          <span data-figure>{rankText}</span>
        </span>
      )}

      {/* The title cell carries the tree: the fold control and the folder on a
          container, the indent and the elbow on a child. Both live INSIDE this
          cell rather than taking columns of their own, so the eleven-column
          grid — and every other row's alignment — is untouched. */}
      <div className="flex min-w-0 items-center">
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
            className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
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
          <span aria-hidden="true" className="mr-1 h-5 w-5 shrink-0" />
        )}

        {/* An anchor drags its URL by default, which would fight the row drag —
            so the title is not itself draggable; the row around it is. */}
        <Link
          href={`/tasks/${view.task.id}`}
          draggable={false}
          className="min-w-0 flex-1"
        >
        <span className="flex items-center gap-1.5">
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
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
          <span data-figure>{view.task.reference}</span>
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

      {/* Owner → assignee, so both are visible in one 78px cell. */}
      <span className="flex items-center gap-1">
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
          <span className="h-7 w-7 rounded-full bg-[var(--control)]" />
        )}
      </span>

      <span className="min-w-0">
        <Chip tone={meta.tone}>{meta.label}</Chip>
        {/* No next action on a container. `action`/`meta` read this document's
            own stored status — usually whatever it was mid-negotiation when it
            got broken down — and nothing here decides for itself that the
            document stopped being actionable the moment it gained a subtask.
            Naming the project instead of a false "Accept" is the fix; leaving
            the chip alone since a stale status label is at least true of the
            document, where a call to action on it was not. */}
        <span
          className={`mt-0.5 block truncate text-[11px] ${
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

      <span className="min-w-0">
        <Meter value={progress} label={`${view.task.title} progress`} />
        <span data-figure className="mt-1 block text-[11px] text-ink-faint">
          {progress}%
        </span>
      </span>

      <span
        className={`text-xs ${view.isOverdue ? "text-[var(--state-overdue-ink)]" : "text-ink-muted"}`}
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

      <span className="text-right">
        {isContainer ? (
          /* No time budget on a container — see the deadline cell's note; the
             same document field, the same reason it is not this row's to show. */
          <span data-figure className="block text-xs text-ink-faint">
            —
          </span>
        ) : (
          <>
            <span data-figure className="block text-xs text-ink">
              {formatTimer(view.loggedSecs)}
            </span>
            <span data-figure className="block text-[11px] text-ink-faint">
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
      <span className="justify-self-start">
        {isContainer ? (
          <span className="text-xs text-ink-faint">—</span>
        ) : (
          <TimerControl view={view} />
        )}
      </span>

      <span className="min-w-0 text-[11px] text-ink-faint">
        <span className="block truncate">
          {now && formatRelative(view.task.updatedAt, now)}
        </span>
        {view.latestSubmission && (
          <span className="block truncate">
            attempt {view.latestSubmission.attempt}
          </span>
        )}
      </span>

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
  return (
    <Link href={`/tasks/${view.task.id}`} className="block px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span
          data-figure
          className="mt-0.5 shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-muted"
        >
          {formatRankDisplay(rankFor(view, viewerId))}
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

/**
 * Progress from logged effort against the estimate — real data, not a status
 * lookup table. Terminal and pre-start states short-circuit because effort
 * logged against them is not meaningful progress.
 */
function progressOf(v: TaskView): number {
  const t = v.task;
  if (t.status === "completed") return 100;
  if (t.status === "cancelled" || t.status === "draft") return 0;
  if (t.status === "in_review") return 95;
  const estimate = t.estimatedEffortSecs ?? 0;
  if (estimate <= 0 || v.loggedSecs <= 0)
    return t.status === "in_progress" ? 5 : 0;
  return Math.min(90, Math.round((v.loggedSecs / estimate) * 100));
}

interface Group {
  key: string;
  label: string | null;
  items: TaskView[];
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

function groupTasks(
  items: TaskView[],
  grouping: Grouping,
  viewerId: string,
): Group[] {
  if (grouping === "none") return [{ key: "all", label: null, items }];

  const map = new Map<string, TaskView[]>();
  for (const v of items) {
    let key: string;
    if (grouping === "status") key = bucketOf(v, viewerId);
    else if (grouping === "project") key = v.project?.name ?? "No project";
    else if (grouping === "assignee")
      key = v.assignees[0]?.displayName ?? "Unassigned";
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
  }));
}
