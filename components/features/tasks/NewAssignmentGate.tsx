"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getRepository } from "@/lib/repositories";
import { Button, Chip } from "@/components/ui/Primitives";
import { formatDateTime, formatDuration } from "@/lib/utils/format";
import { actionableFor } from "@/lib/rules/tasks/actionable";
import {
  committedEffort,
  MAX_SHOWN,
  rememberSeen,
  unseenNotices,
  type AssignmentNotice,
} from "@/lib/rules/tasks/newAssignments";

/**
 * "You have new work" — shown once, when somebody opens Cowork after being
 * assigned something.
 *
 * ## Why this is not another `PriorityAckGate`
 *
 * That gate is deliberately non-dismissable: it exists because commitments
 * somebody already made were silently changed underneath them, and they must
 * see that. This is a different event. New work arriving is not a change to
 * anything they already agreed to, the task is on their list regardless, and
 * `confirmTask` is the real acceptance step. So this is a notice with a way
 * out, not a wall — Escape closes it, and so does the button.
 *
 * Making it blocking would also have made it hostile in the one case it most
 * needs to be gentle: somebody back from leave with a dozen new assignments
 * would be met by a modal they cannot pass without reading all of it.
 *
 * ## What tells it something is new
 *
 * The task's own status. `assigned` is the state between somebody assigning
 * work and the assignee confirming it, which is already the product's
 * server-side record of "not acted on yet" — so no `seenAt` field, no
 * migration, and no second source of truth that could drift from the task
 * list. What is stored per-browser is only whether the NOTICE has been put in
 * front of them; see `lib/rules/tasks/newAssignments.ts` for why that
 * distinction matters and what it costs.
 */

const SEEN_KEY = "cowork.assignments.announced.v1";

function readSeen(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    /* A corrupt or unavailable store means the notice shows again, which is
       the harmless direction to fail in. */
    return [];
  }
}

function writeSeen(keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
  } catch {
    /* Private browsing, or a full quota. The notice reappearing is a far
       smaller problem than a thrown error taking the shell down with it. */
  }
}

export function NewAssignmentGate() {
  const [notices, setNotices] = useState<AssignmentNotice[] | null>(null);

  /**
   * Read ONCE per mount, not on a poll.
   *
   * "When they open Cowork" is the requirement, and a page load is that
   * moment. Polling would turn a welcome notice into an interruption that
   * can appear over whatever somebody is in the middle of — and anything
   * arriving mid-session is already covered by the notification bell.
   */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const repo = getRepository();
        const viewer = await repo.getViewer();
        const page = await repo.listTasks({
          scope: "mine",
          status: ["assigned"],
          assigneeId: viewer.employeeId,
          limit: 50,
        });

        const all: AssignmentNotice[] = page.items.map((view) => {
          const mine = view.assignments.find((a) => a.employeeId === viewer.employeeId);
          /* The same resolver the action inbox uses, so the notice and the
             inbox can never name different next steps for one task. */
          const action = actionableFor(view, viewer.employeeId);
          return {
            taskId: view.task.id,
            title: view.task.title,
            reference: view.task.reference,
            /* The assignment's own stamp, not the task's — being re-assigned
               later has to read as a new event. Falls back to the task's
               creation only where no assignment row came back. */
            assignedAt: mine?.assignedAt ?? view.task.createdAt,
            assignedByName: view.owner?.displayName ?? null,
            dueAt: view.task.deadline.dueAt,
            rank: view.myStoredRank ?? mine?.rank ?? null,
            description: view.task.description,
            requirementCount: view.task.requirements.length,
            /* The proposed window on a budget task, the estimate otherwise —
               whichever one is the real answer to "how long is this". */
            effortSecs:
              view.task.deadline.mode === "timer"
                ? (view.task.deadline.currentWindowSecs ?? view.task.estimatedEffortSecs)
                : view.task.estimatedEffortSecs,
            deadlineMode: view.task.deadline.mode,
            projectName: view.project?.name ?? null,
            isSubtask: view.task.parentTaskId !== null,
            action: action ? { label: action.label, href: action.href } : null,
          };
        });

        const unseen = unseenNotices(all, readSeen());
        if (!cancelled && unseen.length > 0) setNotices(unseen);
      } catch {
        /* A notice that cannot be built is simply not shown. Nothing here is
           load-bearing enough to surface an error over the whole shell. */
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (typeof document === "undefined" || !notices || notices.length === 0) return null;

  const shown = notices.slice(0, MAX_SHOWN);
  const overflow = notices.length - shown.length;
  /* Across everything new, not just the five on screen — the sentence says
     "these were assigned to you", and that is all of them. */
  const effort = committedEffort(notices);

  function dismiss() {
    /* Everything unseen is marked seen, including the overflow — they were
       counted on screen, and re-announcing them next time would be a notice
       about work the person has already been told about. */
    writeSeen(rememberSeen(readSeen(), notices ?? []));
    setNotices(null);
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-assignment-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") dismiss();
      }}
      className="fixed inset-0 z-[100] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/70 backdrop-blur-[6px]"
      />

      <div className="frost-panel relative max-h-[88vh] w-[min(560px,96vw)] overflow-y-auto overscroll-contain rounded-panel px-6 py-5">
        <p className="text-[11px] font-medium tracking-[0.09em] text-ink-muted uppercase">
          While you were away
        </p>
        <h2
          id="new-assignment-title"
          className="mt-2 text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
        >
          {notices.length === 1
            ? "You have a new task"
            : `You have ${notices.length} new tasks`}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {notices.length === 1
            ? "This was assigned to you and is waiting on you."
            : "These were assigned to you and are waiting on you."}{" "}
          {effort.totalSecs > 0 && (
            <>
              They commit{" "}
              <span data-figure className="text-ink">
                {formatDuration(effort.totalSecs)}
              </span>{" "}
              of your time
              {/* Said explicitly when only some carry a figure: a bare total
                  over a partly-estimated set reads as the whole commitment
                  and is not. */}
              {effort.withEstimate < effort.total && (
                <>
                  {" "}
                  across{" "}
                  <span data-figure>
                    {effort.withEstimate} of {effort.total}
                  </span>{" "}
                  — the rest have no time set yet
                </>
              )}
              .
            </>
          )}
        </p>

        <ul className="mt-4 divide-y divide-hairline">
          {shown.map((n) => (
            <li key={`${n.taskId}:${n.assignedAt}`} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {n.rank !== null && (
                  <span data-figure className="w-7 shrink-0 text-[11px] text-ink">
                    P{n.rank}
                  </span>
                )}
                {/* The real detail route. `/tasks?task=…` would have looked
                    right and quietly landed on the overview — `TasksArea`
                    reads `?view=` and nothing else. */}
                <Link
                  href={`/tasks/${encodeURIComponent(n.taskId)}`}
                  onClick={dismiss}
                  className="min-w-0 flex-1 truncate text-[13px] text-ink hover:underline"
                >
                  {n.title}
                </Link>
                <span data-figure className="shrink-0 text-[10px] text-ink-faint">
                  {n.reference}
                </span>
              </div>

              {n.description && (
                <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-muted">
                  {n.description}
                </p>
              )}

              {/* One line of facts, in the order somebody triages by: how long
                  is it, when is it wanted, what is it part of. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                {n.effortSecs !== null && n.effortSecs > 0 && (
                  <span>
                    {/* A budget is time the assignee will schedule; an
                        estimate is the assignor's guess at a fixed-date task.
                        Naming which one this is decides what happens next. */}
                    {n.deadlineMode === "timer" ? "Budget" : "Estimate"}{" "}
                    <span data-figure className="text-ink">
                      {formatDuration(n.effortSecs)}
                    </span>
                  </span>
                )}
                {n.dueAt ? (
                  <span>
                    Due <span className="text-ink">{formatDateTime(n.dueAt)}</span>
                  </span>
                ) : (
                  /* A budget task genuinely has no date until the window is
                     accepted — saying so states a fact rather than leaving a
                     gap that reads as missing data. */
                  <span>
                    {n.deadlineMode === "timer"
                      ? "Date set once you accept the time"
                      : "No date yet"}
                  </span>
                )}
                {n.requirementCount > 0 && (
                  <span>
                    <span data-figure className="text-ink">
                      {n.requirementCount}
                    </span>{" "}
                    {n.requirementCount === 1 ? "requirement" : "requirements"}
                  </span>
                )}
                {n.projectName && <span className="truncate">In {n.projectName}</span>}
                {n.isSubtask && <Chip tone="neutral">Part of a larger task</Chip>}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {n.assignedByName && (
                  <span className="text-[11px] text-ink-faint">
                    Assigned by {n.assignedByName}
                  </span>
                )}
                {/* The real next step for THIS task, from the same resolver
                    the action inbox uses — "Confirm receipt", "Accept or
                    discuss the time", "Propose a deadline" — linking to the
                    screen that actually does it. */}
                {n.action && (
                  <Link
                    href={n.action.href}
                    onClick={dismiss}
                    className="ms-auto shrink-0 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
                  >
                    {n.action.label}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>

        {overflow > 0 && (
          <p className="mt-2 text-[11px] text-ink-faint">
            and <span data-figure>{overflow}</span> more on your task list.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button tone="ghost" onClick={dismiss}>
            Later
          </Button>
          <Link href="/tasks" onClick={dismiss}>
            <Button tone="primary">Go to my tasks</Button>
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
