"use client";

/**
 * Saying what a slow action is doing, once it has been slow enough to need
 * saying.
 *
 * ## Why a spinner was not enough
 *
 * Every action button in Cowork already turns into "Approving…" with a ring
 * beside it, and that answers one question: is this working? It does not answer
 * the one people actually ask after two seconds, which is **why is this taking
 * so long** — and with nothing on screen answering it, the honest reading is
 * that the app is slow or the press did not land. Both readings send somebody
 * to press it again.
 *
 * The true answer is worth telling, because it is not idleness. A task action
 * is not a save: the engine writes the change, posts it into the task's chat,
 * pushes it to everyone on the task, and renumbers each of their priority lists
 * — and it does all of that BEFORE it replies. The wait is work being done on
 * somebody's behalf, and a person who knows that waits differently from a
 * person who thinks nothing is happening.
 *
 * ## Why it waits before appearing
 *
 * On a fast press the whole thing is over in a few hundred milliseconds, and an
 * explanation that flashes up and vanishes is noise — worse, it makes a quick
 * action feel like a slow one. So nothing is said until the wait has already
 * become a wait. Under that threshold the spinner is the complete answer.
 *
 * The threshold is deliberately below a second: past roughly that point a delay
 * stops reading as "responding" and starts reading as "stuck", and the line has
 * to be there before that happens rather than after.
 */

import { useEffect, useState, type ReactNode } from "react";

/** How long an action may run before it owes the reader an explanation. */
export const EXPLAIN_AFTER_MS = 900;

/**
 * The standard explanation for a task write.
 *
 * One sentence, because it is read while waiting rather than studied, and it
 * describes what the engine actually does — see the note at the top of this
 * file. Every task lifecycle action funnels through the same route, so the same
 * sentence is true of approve, submit, start, reject, rework and accept alike;
 * holding it here rather than in ten components keeps it that way.
 */
export const TASK_WRITE_WAIT =
  "Still working — this is normal. Saving the change is only part of it: everyone on the task is notified and their priority lists are put back in order before the server replies.";

/**
 * True once `pending` has been true for longer than `afterMs`.
 *
 * Exported for the one caller that narrates several steps and needs to know
 * whether the line is on screen; most callers want `ActionWait` instead.
 */
export function useSlowWait(
  pending: boolean,
  afterMs: number = EXPLAIN_AFTER_MS,
): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      /* Written through the updater so React bails out when it is already
         false, which is the overwhelmingly common case — a component whose
         action has never run must not re-render because of this hook. */
      setSlow((was) => (was ? false : was));
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [pending, afterMs]);

  return slow;
}

/**
 * The line itself. Renders nothing until the wait has earned it.
 *
 * `role="status"` rather than plain text: it appears part-way through an
 * interaction somebody has already committed to, so a screen reader has to be
 * told about it. `status` announces politely, without interrupting — the same
 * courtesy the visual version extends by waiting.
 */
export function ActionWait({
  pending,
  note = TASK_WRITE_WAIT,
  afterMs = EXPLAIN_AFTER_MS,
  className = "",
}: {
  pending: boolean;
  /** What is happening, in the words of this particular action. */
  note?: ReactNode;
  afterMs?: number;
  className?: string;
}) {
  const slow = useSlowWait(pending, afterMs);
  if (!slow) return null;
  return (
    <p
      role="status"
      className={`text-[11px] leading-relaxed text-ink-faint ${className}`}
    >
      {note}
    </p>
  );
}
