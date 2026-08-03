"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getRepository } from "@/lib/repositories";
import { useSession } from "@/components/features/auth/SessionProvider";
import { Button, Chip } from "@/components/ui/Primitives";
import { formatDateTime, formatDuration } from "@/lib/utils/format";
import { actionableFor } from "@/lib/rules/tasks/actionable";
import { readTask, type LegacyTaskDoc } from "@/lib/legacy/tasks";
import { toTaskStatus } from "@/lib/repositories/legacy/taskMap";
import {
  committedEffort,
  MAX_SHOWN,
  noticeKey,
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
  const session = useSession();
  const [notices, setNotices] = useState<AssignmentNotice[] | null>(null);

  /**
   * Watch `cowork_tasks` with a live Firestore listener, **for the whole
   * session**.
   *
   * ## Why a listener rather than a read on mount
   *
   * A one-shot `repo.listTasks()` on mount fails silently on first login:
   * Firestore has no local cache yet, and the `getViewer()` call deep inside
   * `listTasks` triggers `#reportingTree()`, a batch of HTTP calls to the
   * backend — if any are slow or fail, the chain errors, the catch swallows
   * it, and the popup never shows. `onSnapshot` fires immediately from cache on
   * refresh and from the network on first login, and goes nowhere near
   * `#reportingTree()`.
   *
   * ## Why it is no longer detached after the first snapshot
   *
   * **This was the bug that made the popup need a refresh.** The listener used
   * to tear itself down the moment it saw any assigned task — before checking
   * whether that task was one the person had already been told about. So the
   * ordinary case killed it instantly: somebody with one outstanding assigned
   * task from yesterday loads Cowork, the first snapshot fires, the listener
   * detaches, and every assignment made for the rest of that session arrives to
   * a page with nothing watching. Reloading re-attached it, which is exactly
   * the symptom — work only appearing after a refresh.
   *
   * Nothing about the cold-start reasoning required detaching; that was about
   * the FIRST snapshot arriving, not about the last. So the listener now lives
   * as long as the session does, which is what makes this notice live at all.
   *
   * A snapshot that brings a new assigned id triggers one `listTasks()` to
   * build the rich notices — owner name, deadline mode, action label. That call
   * is reliable here because the Firestore data is already in the local cache
   * by the time it runs.
   */
  useEffect(() => {
    const employeeId = session.status === "authenticated" ? session.employeeId : null;
    if (!employeeId) return;

    let cancelled = false;
    let detach: (() => void) | null = null;

    /**
     * The assigned ids this listener has already built for, and whether a build
     * is running.
     *
     * **Effect-local, and that is load-bearing rather than tidy.** These were
     * `useRef`s, which survive a remount — and React StrictMode deliberately
     * mounts every effect twice in development. The first mount's snapshot
     * recorded the task id and started a build; the unmount cancelled that
     * build; the second mount's snapshot then saw the id already recorded, took
     * the "nothing new" path, and never built. The notice never appeared at
     * all. Scoped to the effect, each listener starts with its own empty set,
     * so a cancelled build leaves nothing behind that can suppress its
     * replacement.
     *
     * The set is a COST guard — it stops every unrelated task edit, which bumps
     * `updatedAt` and re-fires the snapshot, from costing a full `listTasks()`
     * to discover there is nothing new to say. Whether the person has SEEN a
     * notice is a different question, answered by the stored seen-list through
     * `unseenNotices`, which is the authority. Conflating those two is what
     * made this notice one-shot in the first place.
     */
    const builtFor = new Set<string>();
    /* One build at a time. Two snapshots landing together would otherwise issue
       two `listTasks()` calls and race to set the same popup. */
    let building = false;

    async function buildNotices() {
      if (cancelled || building) return;
      building = true;
      try {
        const repo = getRepository();
        /* employeeId is already known from the session — skip getViewer() so
           we don't block on #reportingTree() fetching every employee's managers
           from the backend. */
        /* employeeId is narrowed to string by the guard at the top of the
           outer effect, but TypeScript loses that across async closures. */
        const eid = employeeId as string;
        const page = await repo.listTasks({
          scope: "mine",
          status: ["assigned"],
          assigneeId: eid,
          limit: 50,
        });

        if (cancelled) return;

        const all: AssignmentNotice[] = page.items.map((view) => {
          const mine = view.assignments.find((a) => a.employeeId === eid);
          const action = actionableFor(view, eid);
          return {
            taskId: view.task.id,
            title: view.task.title,
            reference: view.task.reference,
            assignedAt: mine?.assignedAt ?? view.task.createdAt,
            assignedByName: view.owner?.displayName ?? null,
            dueAt: view.task.deadline.dueAt,
            rank: view.myStoredRank ?? mine?.rank ?? null,
            description: view.task.description,
            requirementCount: view.task.requirements.length,
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
        if (unseen.length === 0) return;
        /* Merged into whatever is already on screen rather than replacing it.
           A second assignment arriving while the notice is open should join the
           list — swapping the contents underneath somebody mid-read would lose
           the one they were about to click, and dismissing marks everything
           shown as seen, so a replaced notice would be marked read unread. */
        setNotices((prev) => {
          if (!prev || prev.length === 0) return unseen;
          const have = new Set(prev.map(noticeKey));
          const added = unseen.filter((n) => !have.has(noticeKey(n)));
          return added.length === 0 ? prev : [...added, ...prev];
        });
      } catch (e) {
        /* Forget what this attempt covered so the next snapshot retries rather
           than treating a failed build as done. */
        builtFor.clear();
        console.error("[NewAssignmentGate] buildNotices failed:", e);
      } finally {
        building = false;
      }
    }

    async function startWatch() {
      const { collection, limit, onSnapshot, orderBy, query, where } =
        await import("firebase/firestore");
      const { legacyDb } = await import("@/lib/legacy/firebase");

      if (cancelled) return;

      /**
       * TWO listeners, because "assigned to me" is two fields in legacy.
       *
       * **This is what left the notice needing a refresh.** A task that is
       * still at a gate — cross-department approval, TL hours — has an EMPTY
       * `assigneeIds` and its person in `pendingAssigneeId`; `taskForward.js`
       * only writes `assigneeIds` at the moment the task goes to `open`, and
       * `pendingAssigneeId` is never cleared afterwards. So a single
       * `array-contains` listener cannot see that whole class of work arriving.
       *
       * It looked like it worked on reload only because of an accident: on
       * mount the trigger set is empty, so ANY of this person's existing tasks
       * counts as fresh and starts a build — and the build reads `listTasks`,
       * which resolves holders through `holdersOf` and therefore DOES include
       * pending assignees. The new task was found by the rebuild, never by the
       * listener. With nothing else assigned, even that accident stopped
       * working.
       *
       * So the trigger watches the same two fields `holdersOf` reads. Matching
       * the domain's own definition rather than picking one field is the same
       * rule that fixed the status comparison above: a trigger that disagrees
       * with the build is a notice that fires for work it cannot find, or —
       * here — never fires for work that is there.
       */
      const tasks = collection(legacyDb(), "cowork_tasks");
      const sources = [
        query(
          tasks,
          where("assigneeIds", "array-contains", employeeId),
          orderBy("updatedAt", "desc"),
          limit(50),
        ),
        /* Needs the (pendingAssigneeId, updatedAt) index, declared in
           firestore.indexes.json. Bounded and ordered rather than a bare
           equality because `pendingAssigneeId` is never cleared — every
           cross-department task ever routed to this person keeps it set, so an
           unordered query would grow without limit and an unordered `limit`
           would return the 50 oldest document ids rather than the newest work. */
        query(
          tasks,
          where("pendingAssigneeId", "==", employeeId),
          orderBy("updatedAt", "desc"),
          limit(50),
        ),
      ];

      /** The latest ids each listener reported, unioned on every snapshot. */
      const latest: string[][] = sources.map(() => []);

      const detachers = sources.map((q, index) =>
        onSnapshot(
          q,
          (snap) => {
            if (cancelled) return;
            /**
             * Status is checked in memory rather than in the query — a
             * `status ==` filter would need yet another composite index — and
             * it is checked THROUGH `toTaskStatus`.
             *
             * **This is what stopped the notice appearing at all.** The filter
             * was `d.data().status === "assigned"`, comparing the raw legacy
             * field against a DOMAIN status name. `assigned` is something the
             * domain computes; legacy's own word for the same state is `open`
             * — plus `pending_deadline_approval`, `deadline_approved`, and
             * anything unrecognised, which `toTaskStatus` maps to `assigned`
             * as its neutral default. Almost every real assignment is written
             * `status: "open"` by `taskForward.js`, so the filter matched
             * nothing and no build ever ran.
             */
            latest[index] = snap.docs
              .map((d) => readTask({ ...(d.data() as LegacyTaskDoc), id: d.id }))
              .filter((t): t is NonNullable<typeof t> => t !== null)
              .filter((t) => toTaskStatus(t) === "assigned")
              .map((t) => t.id);

            const assignedIds = [...new Set(latest.flat())];
            if (assignedIds.length === 0) return;

            /* An id that is no longer assigned is forgotten, so a task
               confirmed and then assigned again later reads as new work rather
               than as one already built for. Harmless when a task merely falls
               out of the 50-row window: the stored seen-list still suppresses
               the notice. */
            const assigned = new Set(assignedIds);
            for (const id of [...builtFor])
              if (!assigned.has(id)) builtFor.delete(id);

            /* Rebuild only when an assigned id is one we have not built for.
               Without this, every edit to any of this person's tasks bumps
               `updatedAt`, re-fires a snapshot, and costs a full `listTasks()`
               to discover there is nothing new to say. */
            const fresh = assignedIds.filter((id) => !builtFor.has(id));
            if (fresh.length === 0) return;
            for (const id of assignedIds) builtFor.add(id);
            void buildNotices();
          },
          (err) => {
            /* Named loudly, because the commonest cause is a composite index
               that has not been deployed — and the symptom of that is silence,
               which reads exactly like "no new work". */
            console.error(
              `[NewAssignmentGate] Firestore watch ${index === 0 ? "(assigneeIds)" : "(pendingAssigneeId)"} failed:`,
              err.message,
            );
          },
        ),
      );

      detach = () => detachers.forEach((d) => d());
    }

    void startWatch();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [session.status, session.employeeId]);

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
