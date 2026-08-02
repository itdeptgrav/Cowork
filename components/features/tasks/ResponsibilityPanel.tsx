"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icons";
import { Panel } from "@/components/ui/Primitives";
import type { TaskView } from "@/lib/repositories";

/**
 * What a subtask is answerable for, shown on the subtask.
 *
 * Somebody who receives "Create meeting system" needs to know it is part of
 * Cowork and that finishing it is what closes *Build meetings module* — without
 * that, a delegated task is an instruction with no visible purpose and its
 * assignee cannot tell whether anyone is waiting on it.
 *
 * Every value here is read from the PARENT through `view.parent`, resolved by
 * the repository. Nothing is copied onto the subtask and no status is stored
 * twice: the tick shown against a requirement is the parent's own satisfaction
 * state, so the two screens cannot drift.
 *
 * It renders above the fold on the overview, before the brief, because it is
 * context for everything below it rather than a footnote to it.
 */
export function ResponsibilityPanel({ view }: { view: TaskView }) {
  const parent = view.parent;
  if (!parent) return null;

  const claims = parent.claimedRequirements;
  const done = view.task.status === "completed";

  return (
    <Panel label="Completion responsibility">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Part of
        </span>
        <Link
          href={`/tasks/${parent.id}`}
          className="text-sm font-medium text-ink underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current"
        >
          {parent.title}
        </Link>
        {parent.ownerName && (
          <span className="text-[11px] text-ink-faint">
            · owned by {parent.ownerName}
          </span>
        )}
      </div>

      {claims.length === 0 ? (
        /* Unreachable for anything created through the subtask form, which
           requires at least one claim. Kept for records that predate that rule
           — a persisted store or a legacy import — because an empty heading
           reads as data that failed to load rather than as a task with no
           stated contract. */
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          This was broken out of {parent.title} without being tied to one of its
          completion requirements.
        </p>
      ) : (
        <>
          <p className="mt-3.5 text-sm text-ink">
            {done ? "This satisfied" : "Completing this satisfies"}
            {claims.length === 1 ? " a requirement on" : " requirements on"} the
            project:
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {claims.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-2.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                    r.isSatisfied
                      ? "bg-[color-mix(in_srgb,var(--state-positive)_28%,transparent)] text-[var(--state-positive-ink)]"
                      : "bg-[var(--control)] text-ink-faint"
                  }`}
                >
                  {r.isSatisfied ? (
                    <Icon.check className="h-3 w-3" />
                  ) : (
                    <Icon.clock className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{r.text}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    {r.isSatisfied
                      ? "Satisfied on the project"
                      : r.isSoleClaimant
                        ? "Outstanding — this task is the only thing it is waiting on."
                        : "Outstanding — shared with other subtasks, so it closes when all of them do."}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            {done
              ? "Nothing further is needed from you here."
              : "You do not tick these off. They are satisfied when this task is completed and approved."}
          </p>
        </>
      )}
    </Panel>
  );
}
