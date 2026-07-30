import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

/**
 * Why somebody's working day differed from their schedule, and what that owes
 * their deadlines.
 *
 * **One ledger, five causes, a signed number.** Break, Emergency, going offline
 * mid-day, arriving late and arriving early all answer the same question — how
 * much working time did this person actually have against how much they were
 * scheduled — and answering it five times in five places is how the same hour
 * comes to be credited twice, or not at all.
 *
 * The delta is SIGNED, and that is the whole design:
 *
 *     newDueAt = existingDueAt + availabilityDelta
 *
 * Positive moves a deadline later (time was lost); negative moves it earlier
 * (time was gained by starting before the schedule did). One formula, one
 * direction of data flow, and no branch anywhere that asks "is this the kind
 * that adds or the kind that subtracts".
 *
 * **Intervals, not daily totals.** The obvious implementation keeps a running
 * per-day figure and rewrites every deadline from it whenever it changes. That
 * is wrong twice over: it makes each recalculation depend on every earlier one,
 * so a single bad total corrupts the whole day, and it rewrites deadlines that
 * nothing happened to. Each interval instead carries its own delta and is
 * applied exactly once, to the tasks live at that moment.
 */

/**
 * What made the day differ from the schedule.
 *
 * The sign is a property of the kind, not of the caller — see `DELTA_SIGN`.
 */
export type AvailabilityKind =
  /** Online before the scheduled start. The only kind that earns a credit. */
  | "early_login"
  /** Online after the scheduled start. */
  | "late_login"
  /** Went offline during the working day and came back. */
  | "offline"
  /** Break Mode, bounded by the daily allowance. */
  | "break"
  /** Emergency Mode. The only kind that needs somebody to agree to it. */
  | "emergency";

/**
 * Which direction each kind moves a deadline.
 *
 * Data rather than control flow, so adding a kind is a line here instead of a
 * branch in the arithmetic — and so it is impossible for two call sites to
 * disagree about whether a break is a credit or a charge.
 */
export const DELTA_SIGN: Record<AvailabilityKind, 1 | -1> = {
  early_login: -1,
  late_login: 1,
  offline: 1,
  break: 1,
  emergency: 1,
};

/**
 * Whether a kind reaches deadlines on its own, or waits for a decision.
 *
 * Emergency alone waits. Everything else is an observation — the person was or
 * was not online — and observations do not need approving. An emergency is a
 * claim about why, and the existing `EmergencyRequest` already routes that
 * claim to the direct manager with its evidence.
 */
export const NEEDS_APPROVAL: Record<AvailabilityKind, boolean> = {
  early_login: false,
  late_login: false,
  offline: false,
  break: false,
  emergency: true,
};

export type AvailabilityApproval =
  | "not_required"
  | "pending"
  | "approved"
  | "declined";

/**
 * One span of the day that differed from the schedule.
 *
 * **Non-overlapping per person, always.** An hour offline that is also an hour
 * of approved emergency is one hour, not two, and the ledger refuses the second
 * claim on it rather than silently paying twice — see `overlapRefusal`.
 */
export interface AvailabilityInterval {
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
  kind: AvailabilityKind;
  /** The office-local date it belongs to. Grouping key for daily allowances. */
  localDate: string;
  startedAt: string;
  endedAt: string;

  /**
   * Signed WORKING seconds this interval owes the person's deadlines.
   *
   * Measured through the office calendar at the moment the interval closes and
   * then frozen. Not recomputed on read: office hours are versioned and a later
   * edit to them must not retroactively change what a past absence cost.
   */
  deltaSecs: number;
  /**
   * What the interval really was, before any allowance clamped it.
   *
   * Kept beside `deltaSecs` for the same reason `BreakSession` keeps
   * `durationSecs` beside `appliedSecs` — a manager needs to see that somebody
   * took ninety minutes on a sixty-minute allowance.
   */
  measuredSecs: number;

  approval: AvailabilityApproval;
  /** Who decided, for the one kind that needs deciding. */
  decidedById: EmployeeId | null;
  decidedAt: string | null;

  /**
   * The natural key of the real-world event behind this interval.
   *
   * A retried write, a double-clicked button and a replayed queue message all
   * produce the same key, and the ledger keeps the first. Derived from the
   * event rather than generated, because a generated key is unique per ATTEMPT
   * and it is attempts we are deduplicating.
   */
  idempotencyKey: string;
  /** The record this came from — a `BreakSession` or `EmergencyRequest`. */
  sourceId: string | null;

  /**
   * When this interval's delta reached deadlines, and which ones it moved.
   *
   * Null means not yet applied. Set once and never cleared: an applied interval
   * is applied, and re-running the application is the double-credit this whole
   * design exists to prevent.
   */
  appliedAt: string | null;
  appliedTaskIds: TaskId[];
  createdAt: string;
}
