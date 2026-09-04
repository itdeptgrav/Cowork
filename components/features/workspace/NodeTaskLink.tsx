"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icons";
import { Chip, Input } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import type { TaskStatus } from "@/lib/domain";

/**
 * The card's link to a Cowork task.
 *
 * This is the one thing a mindmap here can do that a standalone tool cannot:
 * a branch of ideas becomes the work, and the card reads the task's state
 * back. Linking is a search over tasks the person can see; the card then
 * shows the task's reference and status and opens it in one click.
 *
 * The list is fetched once (the same `listTasks` the task table uses) and
 * filtered as you type. A map is rarely linked to more than a handful of
 * tasks, and a second endpoint for "tasks matching a word" would be one more
 * thing to keep in step with the table's own rules about who sees what.
 */

const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  assigned: "Assigned",
  deadline_negotiation: "Deadline negotiation",
  confirmed: "Confirmed",
  in_progress: "In progress",
  in_review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
  assignment_rejected: "Assignment rejected",
};

export function NodeTaskLink({
  taskId,
  readOnly,
  onChange,
}: {
  taskId: string | null | undefined;
  readOnly: boolean;
  onChange: (taskId: string | null) => void;
}) {
  const tasks = useQuery((r) => r.listTasks({ scope: "all", includeSubtasks: true }), []);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);

  const linked = useMemo(
    () => (taskId ? (tasks.data?.items.find((t) => t.task.id === taskId) ?? null) : null),
    [tasks.data, taskId],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = tasks.data?.items ?? [];
    const pool = q
      ? items.filter(
          (t) => t.task.title.toLowerCase().includes(q) || t.task.reference.toLowerCase().includes(q),
        )
      : items;
    return pool.slice(0, 8);
  }, [tasks.data, query]);

  return (
    <div className="mt-5">
      <p className="text-sm font-medium text-ink">Task</p>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        {"Link this card to the work it stands for. The card shows the task's state."}
      </p>

      {taskId && (
        <div className="mt-2 flex items-center gap-2 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-2">
          <Icon.tasks className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          {linked ? (
            <>
              <Link
                href={`/tasks/${encodeURIComponent(linked.task.id)}`}
                className="min-w-0 flex-1 truncate text-[12.5px] text-ink hover:underline"
                title={linked.task.title}
              >
                <span className="mr-1.5 font-mono text-[11px] text-ink-faint">{linked.task.reference}</span>
                {linked.task.title}
              </Link>
              <Chip tone="neutral">{STATUS_LABEL[linked.task.status] ?? linked.task.status}</Chip>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
              {tasks.isLoading ? "Looking up the task…" : "A task you cannot see, or one that was deleted."}
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              aria-label="Unlink task"
              onClick={() => onChange(null)}
              className="shrink-0 text-ink-faint hover:text-ink"
            >
              <Icon.close className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {!readOnly && !taskId && !picking && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-[var(--control-hover)]"
        >
          <Icon.link className="h-3 w-3" />
          Link a task
        </button>
      )}

      {!readOnly && !taskId && picking && (
        <div className="mt-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPicking(false);
            }}
            placeholder="Search by title or reference"
          />
          <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-inset border border-hairline bg-[var(--surface-raised)] scroll-slim">
            {tasks.isLoading && <li className="px-3 py-2 text-[12px] text-ink-faint">Loading tasks…</li>}
            {!tasks.isLoading && matches.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-ink-faint">No task matches that.</li>
            )}
            {matches.map((t) => (
              <li key={t.task.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(t.task.id);
                    setPicking(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--control)]"
                >
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">{t.task.reference}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t.task.title}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-faint">{STATUS_LABEL[t.task.status] ?? t.task.status}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="mt-1.5 text-[11.5px] text-ink-muted underline decoration-hairline underline-offset-4 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
