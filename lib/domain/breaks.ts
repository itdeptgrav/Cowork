import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

/**
 * Break Mode, and the daily budget that bounds what it gives back.
 *
 * Ported from legacy's `DutyStatusToggle.jsx`, which ran the whole thing in the
 * browser: `breakStartedAtMs` on the status doc, a `dailyBreakSeconds.{day}`
 * accumulator, a cap read from `cowork_settings/office`, and a direct Firestore
 * write to every one of the person's due dates.
 *
 * **Two decisions carried over verbatim, because both are load-bearing.**
 *
 * The cap CLAMPS what a break gives back; it never stops somebody taking one.
 * Legacy computed `appliedSecs = min(sessionSecs, remainingBudget)` and let the
 * break happen regardless. Refusing to let a person step away in order to
 * protect a deadline is the wrong trade, and it is not what this product does.
 *
 * The real duration and the credited duration are recorded SEPARATELY. Legacy
 * kept an uncapped accumulator "for honest reporting, independent of how much
 * of it actually got applied", and that separation is why a manager can see
 * somebody took ninety minutes on a sixty-minute allowance.
 */

/** Legacy's default when `maxBreakMinutesPerDay` was unset. */
export const DEFAULT_MAX_BREAK_MINUTES_PER_DAY = 60;

export interface OrganisationSettings {
  /**
   * How much break time a day may be credited back to deadlines, per person.
   *
   * Configuration, not a scoring rule, so it lives here rather than in
   * `PROVISIONAL_RULES` — nothing in C1–C4 reads it. Legacy stored it on a
   * single `cowork_settings/office` document; this is that document.
   */
  maxBreakMinutesPerDay: number;
}

/**
 * One completed break.
 *
 * The audit record AND the daily accumulator: today's usage is the sum of
 * today's sessions, so there is no counter that can drift from the history it
 * is supposed to summarise.
 */
export interface BreakSession {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  employeeId: EmployeeId;
  startedAt: string;
  endedAt: string;
  /** What the break really was. Uncapped, always. */
  durationSecs: number;
  /** What the budget allowed. `min(durationSecs, remaining)` — may be 0. */
  appliedSecs: number;
  /** True when the budget, not the break, decided `appliedSecs`. */
  wasCapped: boolean;
  /** Deadlines this break actually moved. Empty when nothing was eligible. */
  shiftedTaskIds: TaskId[];
  createdAt: string;
}

/** What the pill and the settings screen both need to say. */
export interface BreakBudget {
  maxSecs: number;
  usedSecs: number;
  remainingSecs: number;
}
