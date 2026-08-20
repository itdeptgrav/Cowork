/**
 * A subtask may never be due after the project it belongs to.
 * OWNER DECISION, 16 Aug 2026.
 *
 * The parent carries the commitment — 20 August, 11:00 — and the subtasks are
 * how that commitment gets met. A part due after the whole is a promise that
 * cannot be kept, and the parent's owner has no way to see it coming: the
 * project would sit there looking healthy until the day it was due, when the
 * work underneath it was still running.
 *
 * ## Why this is checked twice
 *
 * A subtask's deadline is usually not typed. Inside a reporting line the
 * assigner enters a **budget** and the deadline is DERIVED later — walked
 * through the office calendar from when the assignee first comes online. So at
 * the moment the subtask is created there is no date to compare, only a
 * projection, and the real date is stamped at acceptance, possibly days later
 * and possibly past the parent's.
 *
 * Hence both:
 *
 *  · **At creation** — compare the projection and warn, so the assigner can fix
 *    the budget while they are still holding it.
 *  · **At acceptance** — compare the real date and refuse. This is the one that
 *    actually guarantees the rule; the first is only courtesy.
 *
 * A cross-department subtask types a date outright, so for those the first
 * check is exact and the second is a formality.
 *
 * ## What this module does not decide
 *
 * Whether the parent's own deadline may move. It may — and an extension on a
 * subtask that would breach this cap is answered by moving the parent first,
 * see `capRaiseOffer`. This module only ever compares two instants.
 */

export type CapBreach = "after_parent";

export interface CapVerdict {
  /** False only when the proposed date is genuinely past the parent's. */
  allowed: boolean;
  breach: CapBreach | null;
  /** Seconds the proposal overshoots by. Zero when allowed. */
  overshootSecs: number;
}

const ALLOWED: CapVerdict = { allowed: true, breach: null, overshootSecs: 0 };

/**
 * Whether a proposed subtask deadline fits under its parent's.
 *
 * **Unknown is allowed**, deliberately. A missing parent deadline or an
 * unreadable proposal is not evidence of a breach, and refusing on absent data
 * would block ordinary work — a task whose parent has no deadline has no cap to
 * exceed. The acceptance-time check is where a real date always exists.
 *
 * Equal instants pass: due exactly when the parent is due is not after it.
 */
export function subtaskDeadlineCap(input: {
  parentDueAtMs: number | null | undefined;
  proposedDueAtMs: number | null | undefined;
}): CapVerdict {
  const parent = input.parentDueAtMs;
  const proposed = input.proposedDueAtMs;
  if (!Number.isFinite(parent as number) || parent == null) return ALLOWED;
  if (!Number.isFinite(proposed as number) || proposed == null) return ALLOWED;
  if ((proposed as number) <= (parent as number)) return ALLOWED;
  return {
    allowed: false,
    breach: "after_parent",
    overshootSecs: Math.round(
      ((proposed as number) - (parent as number)) / 1000,
    ),
  };
}

/** `2d 3h 15m`, or `15m` — the smallest reading that stays exact. */
export function formatOvershoot(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

/**
 * What somebody is told when the cap bites.
 *
 * Names the parent's date and the size of the overshoot, because "too late" on
 * its own leaves them guessing by how much — and the fix is arithmetic: cut the
 * budget by at least this, or move the parent.
 *
 * `parentLabel` is the formatted parent deadline, passed in rather than
 * formatted here: date formatting is a display concern and belongs with the
 * viewer's locale, not in a rule.
 */
export function capRefusal(input: {
  verdict: CapVerdict;
  parentLabel: string;
  /** True while only a projection is known — softens "is" to "would be". */
  projected?: boolean;
}): string | null {
  if (input.verdict.allowed) return null;
  const by = formatOvershoot(input.verdict.overshootSecs);
  /* "A task", not "a subtask". The same cap now guards two shapes — a subtask
     under its parent task, and a task under a PROJECT that carries its own
     deadline — and a refusal naming only the first reads as the wrong rule to
     somebody who is looking at the second. Both are tasks. */
  return input.projected
    ? `This would finish about ${by} after the project is due (${input.parentLabel}). A task cannot be due after the project it belongs to — reduce the time, or move the project's deadline first.`
    : `That is ${by} after the project is due (${input.parentLabel}). A task cannot be due after the project it belongs to — choose an earlier date, or move the project's deadline first.`;
}

/**
 * The one-step way out when an EXTENSION would breach the cap.
 * OWNER DECISION, 16 Aug 2026: refused, unless the parent moves too.
 *
 * A flat refusal would be a dead end — the approver believes the extra time is
 * warranted and the only remedy is a second, separate action on another task
 * that they may not think to take. So the refusal carries the remedy: extend
 * the project by the same amount, in the same press.
 *
 * Returns null when there is nothing to offer, so a caller can render the
 * ordinary approval path unchanged.
 */
export function capRaiseOffer(input: {
  verdict: CapVerdict;
  parentLabel: string;
  parentTitle: string;
}): { message: string; raiseBySecs: number } | null {
  if (input.verdict.allowed) return null;
  const by = formatOvershoot(input.verdict.overshootSecs);
  return {
    raiseBySecs: input.verdict.overshootSecs,
    message: `This runs ${by} past “${input.parentTitle}”, which is due ${input.parentLabel}. Granting it moves the project's deadline out by the same ${by} so the two still agree — approve only if the whole project can slip.`,
  };
}
