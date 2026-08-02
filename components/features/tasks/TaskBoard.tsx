"use client";

import Link from "next/link";
import { formatRankDisplay, rankFor } from "@/lib/rules/tasks/priorityDisplay";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { statusMeta, nextAction } from "./statusMeta";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Chip,
  EmptyState,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDate } from "@/lib/utils/format";
import type { TaskScope, TaskView } from "@/lib/repositories";
import type { TaskStatus } from "@/lib/domain";

/**
 * Board view, from `task.webp`.
 *
 * Columns come from the canonical state machine, not from the reference — the
 * reference has both "Working in progress" and "In Progress", which is an
 * artefact of its own data rather than a model worth copying.
 *
 * Card grammar is the reference's: title, chips, dated footer, assignee.
 */

const COLUMNS: { id: string; label: string; statuses: TaskStatus[] }[] = [
  {
    id: "waiting",
    label: "Waiting",
    statuses: ["pending_approval", "deadline_negotiation"],
  },
  { id: "ready", label: "Ready", statuses: ["assigned", "confirmed"] },
  { id: "active", label: "In progress", statuses: ["in_progress"] },
  { id: "review", label: "In review", statuses: ["in_review"] },
  { id: "done", label: "Done", statuses: ["completed"] },
];

export function TaskBoard({
  scope,
  projectId,
}: {
  scope: TaskScope;
  projectId?: string;
}) {
  const board = useQuery(
    (r) =>
      r
        .listTasks({
          scope,
          projectId,
          sort: "rank",
          /* Scoped to a project, this board must show every subtask that
             belongs to it — not just the ones the viewer happens to hold or
             have created. Without this the roll-up that hides other people's
             subtasks under their parent (see `TaskQuery.includeSubtasks`)
             ran first, so a manager's project board silently dropped
             teammates' cards. Off for the general board, which has no
             `projectId` and would otherwise inflate its own counts with
             rolled-up subtasks nobody asked to see individually. */
          includeSubtasks: !!projectId,
        })
        .then((p) => p.items),
    [scope, projectId],
  );
  const { data, isLoading } = board;

  if (isLoading) return <SkeletonRows rows={6} />;
  if (board.error)
    return (
      <QueryError queries={[board]} message="This board could not be loaded." />
    );
  if (!data?.length)
    return (
      <div className="frost-panel rounded-panel">
        <EmptyState
          title="No tasks to show"
          body="Tasks appear here as they are assigned."
        />
      </div>
    );

  return (
    <div className="scroll-slim -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {COLUMNS.map((col) => {
        const items = data.filter((v) => col.statuses.includes(v.task.status));
        return (
          <section
            key={col.id}
            aria-label={col.label}
            className="flex w-[264px] shrink-0 flex-col deck:w-[calc((100%-48px)/5)]"
          >
            <header className="mb-2 flex items-center gap-2 px-1">
              <h3 className="text-sm font-medium text-ink">{col.label}</h3>
              <span data-figure className="text-[11px] text-ink-faint">
                {items.length}
              </span>
              <Link
                href="/tasks/new"
                aria-label={`New task in ${col.label}`}
                className="ml-auto grid h-6 w-6 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
              >
                <Icon.plus className="h-3.5 w-3.5" />
              </Link>
            </header>

            <div className="flex flex-1 flex-col gap-2">
              {items.map((v) => (
                <BoardCard key={v.task.id} view={v} />
              ))}
              {!items.length && (
                <p className="rounded-inset border border-dashed border-hairline px-3 py-4 text-center text-[11px] text-ink-faint">
                  Nothing here
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ view }: { view: TaskView }) {
  const meta = statusMeta(view);
  /* The ACTING viewer. This was the seeded id, so every card answered "is this
     my move" for one person no matter who was signed in — an approver saw
     "Awaiting someone" on a task they were blocking. */
  const viewerId = useViewerId();
  const action = nextAction(view, viewerId ?? "");
  return (
    <Link
      href={`/tasks/${view.task.id}`}
      className="frost-panel block rounded-inset px-3 py-2.5 transition-colors hover:bg-[var(--control)]"
    >
      <p className="line-clamp-2 text-sm text-ink">{view.task.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          data-figure
          className="rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-muted"
        >
          {formatRankDisplay(rankFor(view, viewerId))}
        </span>
        <Chip tone={meta.tone}>{meta.label}</Chip>
        {view.task.isBlocked && (
          <span title="Blocked" className="text-[var(--state-blocked-ink)]">
            <Icon.blocked className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-hairline pt-2">
        <span
          className={`flex items-center gap-1 text-[11px] ${
            view.isOverdue
              ? "text-[var(--state-overdue-ink)]"
              : "text-ink-faint"
          }`}
        >
          <Icon.calendar className="h-3 w-3" />
          {/* Committed deadline where set, else the derived completion date, so a
              budget-only task reflects the extra time instead of showing blank. */}
          {formatDate(
            view.task.deadline.dueAt ?? view.task.deadline.operationalDueAt,
          )}
        </span>
        {action.actor === "you" && (
          <span className="truncate text-[11px] text-ink">
            → {action.label}
          </span>
        )}
        {view.assignees[0] && (
          <span className="ml-auto">
            <Avatar
              initials={view.assignees[0].initials}
              hue={view.assignees[0].hue}
              src={view.assignees[0].profilePictureUrl}
              name={view.assignees[0].displayName}
              size="sm"
            />
          </span>
        )}
      </div>
    </Link>
  );
}
