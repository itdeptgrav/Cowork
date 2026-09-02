"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { useAction } from "@/lib/hooks/useRepository";
import type { TaskId } from "@/lib/domain";

export interface RequirementMark {
  requirementId: string;
  done: boolean;
  byEmployeeId: string | null;
  byName: string;
  at: string;
}

/**
 * The circle beside a requirement: press it to say you have done that one.
 *
 * ## What it is, and the thing it is carefully not
 *
 * A requirement is **satisfied** when the reviewer says so, or by a subtask
 * completing. That is what gates submission and acceptance, and this component
 * never writes it. `satisfied` arrives as a prop and is read-only here.
 *
 * What it writes is **progress**: the person carrying the work reporting that
 * one line is done, so whoever raised the task can see movement without asking
 * and without waiting for review. Two facts, two records, and the reviewer's is
 * still the one that counts.
 *
 * Keeping them apart is the whole reason this could be built at all. Merging
 * them would have handed the assignee the authority to satisfy their own
 * acceptance criteria and unlock their own submission — a real change to who
 * declares work done, which is not what a checkbox should quietly decide.
 *
 * ## The three states
 *
 *  · **Met** — the reviewer's tick. Not pressable: a progress mark about a
 *    settled question would be noise, and offering one implies it still matters.
 *  · **Marked done** — somebody reported it. A tick in a quieter colour than
 *    the reviewer's, so the two are never mistaken for each other.
 *  · **Neither** — an empty circle, pressable by the two people the task is
 *    between and inert for everybody else.
 *
 * ## Why the failure is shown on the row
 *
 * The engine refuses anyone who is neither carrying the task nor raised it. A
 * button that silently did nothing would be indistinguishable from one that had
 * worked, on a control whose entire output is a small shape changing.
 */
export function RequirementProgressToggle({
  taskId,
  requirementId,
  requirementText,
  satisfied,
  marked,
  canMark,
  onChanged,
}: {
  taskId: TaskId;
  requirementId: string;
  requirementText: string;
  /** The REVIEWER's answer. Read-only here. */
  satisfied: boolean;
  /** This requirement's progress mark, or null where there is none. */
  marked: RequirementMark | null;
  /** Whether this reader is one of the two people who may mark it. */
  canMark: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [save, saveState] = useAction((r, next: boolean) =>
    r.setRequirementProgress({
      taskId,
      requirementId,
      done: next,
      requirementText,
    }),
  );

  const isMarked = marked?.done === true;

  /* The reviewer's tick, and nothing to press. */
  if (satisfied) {
    return (
      <span
        aria-hidden="true"
        title="Met — the reviewer has accepted this one."
        className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--state-positive)_28%,transparent)] text-[var(--state-positive-ink)]"
      >
        <Icon.check className="h-3 w-3" />
      </span>
    );
  }

  if (!canMark) {
    return (
      <span
        aria-hidden="true"
        title={
          isMarked
            ? `Marked done by ${marked?.byName || "the assignee"}. The reviewer decides if it is met.`
            : "Acceptance criterion — the reviewer decides if it is met."
        }
        className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${
          isMarked
            ? "bg-[var(--control)] text-ink-muted"
            : "bg-[var(--surface-sunken)] text-ink-faint"
        }`}
      >
        {isMarked && <Icon.check className="h-3 w-3" />}
      </span>
    );
  }

  return (
    <span className="relative mt-px shrink-0">
      <button
        type="button"
        onClick={async () => {
          setError(null);
          const r = await save(!isMarked);
          if (r && r.ok === false) {
            setError(r.message);
            return;
          }
          onChanged();
        }}
        disabled={saveState.isPending}
        aria-pressed={isMarked}
        aria-label={
          isMarked
            ? `Clear the done mark on: ${requirementText}`
            : `Mark done: ${requirementText}`
        }
        title={
          isMarked
            ? "You marked this done. Press to clear it. The reviewer still decides if it is met."
            : "Mark this done — the person who raised the task is told. The reviewer still decides if it is met."
        }
        className={`grid h-5 w-5 place-items-center rounded-full transition-colors disabled:opacity-60 ${
          isMarked
            ? "bg-[var(--control)] text-ink hover:opacity-80"
            : "bg-[var(--surface-sunken)] text-ink-faint hover:bg-[var(--control)] hover:text-ink-muted"
        }`}
      >
        {isMarked ? (
          <Icon.check className="h-3 w-3" />
        ) : (
          /* Nothing at rest. A faint tick behind an empty circle would read as
             already marked at a glance, which is the one thing this control
             must not be ambiguous about. */
          <span className="sr-only">Not marked</span>
        )}
      </button>

      {error && (
        <span
          role="alert"
          className="absolute top-6 left-0 z-10 w-52 rounded-control bg-[var(--surface-raised)] px-2 py-1 text-[11px] leading-tight text-[var(--state-rework-ink)] shadow-lg"
        >
          {error}
        </span>
      )}
    </span>
  );
}
