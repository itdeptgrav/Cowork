/**
 * The legacy wire format, and the traps in it.
 *
 * **This module is the boundary, and it is deliberately the only place that
 * knows legacy's vocabulary.** Everything above it speaks the new product's
 * language; everything below it is byte-for-byte what legacy stores.
 *
 * Nothing here decides anything. Deadline maths, scoring and SOP accumulation
 * stay in the legacy services where they already work — this only translates.
 * A rule implemented here would be a second implementation of a rule that
 * already exists, which is the failure mode the adapter exists to avoid.
 *
 * See `docs/legacy-system-map.md` for where each of these shapes lives.
 */

/* ── Task state ───────────────────────────────────────────────────────────── */

/**
 * Legacy runs **two parallel state axes** on every task, maintained
 * independently: `status` and `completionStatus`.
 *
 * They are not redundant — a task can be `open` on one and `pending_tl_review`
 * on the other — so the adapter carries both and never synthesises one from the
 * other.
 */
export type LegacyStatus =
  | "open" | "pending" | "in_progress" | "submitted"
  | "approved" | "rejected" | "completed" | "cancelled"
  /* Appears only in `TERMINAL_STATUSES`; never observed being written. Kept
     because the terminality check tests for it and a task carrying it must not
     be treated as live. */
  | "done"
  /* Written to `status` despite reading like a completion state — see
     `TERMINAL_STATUSES` below. */
  | "tl_final_approved" | "ceo_approved";

export type LegacyCompletionStatus =
  | "submitted"
  | "pending_tl_review" | "pending_ceo_review"
  | "tl_approved" | "tl_final_approved" | "ceo_approved"
  | "tl_rejected" | "rejected_by_tl"
  | "ceo_rejected" | "rejected_by_ceo"
  | "approved" | "completed";

/**
 * Terminal states, transcribed verbatim from
 * `services/taskForward.service.js:2200`.
 *
 * Two things about it are wrong and are preserved anyway, because the adapter's
 * job is to agree with the running system rather than to improve it:
 *
 *  · it is checked against `status`, but three of its four values otherwise
 *    appear on `completionStatus`;
 *  · `"done"` is not in the observed `status` domain at all.
 *
 * Reproducing the list exactly is what keeps the new UI's idea of "finished"
 * identical to the engine's. Correcting it here would make the two disagree,
 * and the engine wins every argument.
 */
export const TERMINAL_STATUSES: readonly string[] = [
  "done",
  "cancelled",
  "tl_final_approved",
  "ceo_approved",
];

export function isTerminal(status: string | null | undefined): boolean {
  return status != null && TERMINAL_STATUSES.includes(status);
}

/**
 * Legacy writes two spellings for each rejection, and both are live.
 *
 * `tl_rejected` / `rejected_by_tl` and `ceo_rejected` / `rejected_by_ceo` mean
 * the same thing. A predicate that checks one spelling silently misses half the
 * data — so every read normalises, and every write preserves whatever it was
 * given rather than picking a favourite.
 */
export type CompletionOutcome =
  | "submitted"
  | "awaiting_tl" | "awaiting_ceo"
  | "tl_approved" | "ceo_approved"
  | "tl_rejected" | "ceo_rejected"
  | "approved" | "completed"
  | "unknown";

export function readCompletionStatus(
  raw: string | null | undefined,
): CompletionOutcome {
  switch (raw) {
    case "submitted": return "submitted";
    case "pending_tl_review": return "awaiting_tl";
    case "pending_ceo_review": return "awaiting_ceo";
    case "tl_approved": return "tl_approved";
    case "tl_final_approved": return "tl_approved";
    case "ceo_approved": return "ceo_approved";
    /* Both spellings, both live. */
    case "tl_rejected":
    case "rejected_by_tl": return "tl_rejected";
    case "ceo_rejected":
    case "rejected_by_ceo": return "ceo_rejected";
    case "approved": return "approved";
    case "completed": return "completed";
    default: return "unknown";
  }
}

/* ── SOP points ───────────────────────────────────────────────────────────── */

/**
 * Legacy's `bleachType`, whose vocabulary is inverted.
 *
 * From `models/Employee.js`'s own comments:
 *
 *  · `"credit"` = a **violation**. It ADDS to `totalDeducted`. Red in the UI.
 *  · `"debit"`  = a **reward**. It SUBTRACTS. Green.
 *
 * A third field, `isCredit: boolean`, is kept for old rows — and `true` there is
 * treated as `bleachType: "debit"`, so the boolean's name is inverted relative
 * to the enum value it maps to.
 *
 * Anyone reading this with ordinary accounting intuition gets the sign
 * backwards, which is why it is converted here, once, and the words never
 * appear above this line.
 */
export type LegacyBleachType = "credit" | "debit";

export interface LegacyBleach {
  sopId?: string | null;
  policyId?: string | null;
  type?: string;
  sopName?: string;
  folderName?: string;
  points?: number;
  description?: string;
  date?: string;
  cutBy?: string;
  cutByName?: string;
  cutByRole?: string;
  bleachType?: LegacyBleachType;
  isCredit?: boolean;
  recheck?: Record<string, unknown>;
}

/**
 * The signed points a bleach contributes to `totalDeducted`.
 *
 * **Positive is a penalty, negative is a reward** — the same direction as
 * `totalDeducted` itself, so summing these reproduces legacy's figure exactly.
 * That is the property that matters: the adapter must never disagree with the
 * number `pmpService` computed.
 *
 * Precedence is `bleachType` first, then `isCredit`, then penalty. `isCredit`
 * is only consulted when `bleachType` is absent, which is what legacy's "kept
 * for backward compat with old entries" means in practice.
 */
export function signedPoints(bleach: LegacyBleach): number {
  const magnitude = Math.abs(Number(bleach.points) || 0);
  if (magnitude === 0) return 0;

  if (bleach.bleachType === "debit") return -magnitude;
  if (bleach.bleachType === "credit") return magnitude;
  /* No bleachType — an old row. `isCredit: true` is treated as "debit". */
  if (bleach.isCredit === true) return -magnitude;
  return magnitude;
}

/** True when this entry rewarded the employee rather than penalising them. */
export function isReward(bleach: LegacyBleach): boolean {
  return signedPoints(bleach) < 0;
}

/**
 * The score component a bleach belongs to.
 *
 * SOP points are **not** a conduct-only mechanism: entries are written with
 * `type` set to C1, C2, C3 and C4 by four different producers. An adapter that
 * assumed C3 would drop three quarters of the ledger.
 *
 * Folder-based entries may legitimately carry no `type` — legacy says so — so
 * an absent value is normal, not an error.
 */
export type ScoreComponent = "C1" | "C2" | "C3" | "C4";

export function readComponent(
  bleach: LegacyBleach,
): ScoreComponent | null {
  const t = (bleach.type ?? "").toUpperCase();
  return t === "C1" || t === "C2" || t === "C3" || t === "C4" ? t : null;
}

/**
 * Net signed points for a year, reproducing `totalDeducted`.
 *
 * Recomputed from the entries rather than read from the stored total so a
 * mismatch is visible instead of silently trusted. Callers that need the
 * authoritative figure should still show legacy's `totalDeducted` — this is for
 * checking it, and for filtering by component, which the stored total cannot do.
 */
export function netPoints(
  bleaches: readonly LegacyBleach[],
  component?: ScoreComponent,
): number {
  return bleaches
    .filter((b) => !component || readComponent(b) === component)
    .reduce((sum, b) => sum + signedPoints(b), 0);
}

/* ── Identity ─────────────────────────────────────────────────────────────── */

/**
 * The join key between the two databases.
 *
 * Mongo's `Employee.biometricId` IS Firestore's `cowork_employees.employeeId`.
 * `Employee.employeeId` is a Mongoose **virtual** and is not queryable — and
 * `timerSop.service.js` records in its own header that every lookup by
 * `{ employeeId }` silently returned null until it was fixed to
 * `{ biometricId }`.
 *
 * The type exists to make that unmissable at every call site: whichever name the
 * endpoint uses, the value is the biometric id.
 */
export type BiometricId = string & { readonly __biometric: unique symbol };

export function biometricId(value: string): BiometricId {
  return value as BiometricId;
}

/* ── Timers ───────────────────────────────────────────────────────────────── */

/**
 * A timer session document.
 *
 * Path: `cowork_task_timers/{employeeId}/sessions/{taskId}` — a **subcollection**.
 * A flat collection query will find nothing, which is worth stating because the
 * name looks like a top-level collection and nothing else in the schema nests.
 *
 * Several fields are stored under two names (`totalSecs`/`totalSeconds`,
 * `windowSecs`/`winSecs`, `displaySecs`/`displaySeconds`). Readers must accept
 * either; `firstNumber` below is how.
 */
export interface LegacyTimerSession {
  taskId?: string;
  employeeId?: string;
  startedAt?: unknown;
  updatedAt?: unknown;
  baseSecs?: number;
  anchorBaseSecs?: number;
  totalSecs?: number;
  totalSeconds?: number;
  windowSecs?: number;
  winSecs?: number;
  newTotalWindowSecs?: number;
  addedSecs?: number;
  lastExtensionSecs?: number;
  displaySecs?: number;
  displaySeconds?: number;
  activeId?: string | null;
  activeTaskId?: string | null;
}

export function timerSessionPath(
  employeeId: string,
  taskId: string,
): string[] {
  return ["cowork_task_timers", employeeId, "sessions", taskId];
}

/**
 * The first field of a set that holds a usable number.
 *
 * Legacy stores the same quantity under several names and does not guarantee
 * which is present. Reading one name and defaulting to zero silently reports a
 * timer at zero for anybody whose document used the other spelling.
 */
export function firstNumber(
  source: Record<string, unknown>,
  ...names: string[]
): number | null {
  for (const name of names) {
    const v = source[name];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function totalSeconds(session: LegacyTimerSession): number {
  return firstNumber(
    session as Record<string, unknown>,
    "totalSecs",
    "totalSeconds",
  ) ?? 0;
}

export function windowSeconds(session: LegacyTimerSession): number | null {
  return firstNumber(
    session as Record<string, unknown>,
    "windowSecs",
    "winSecs",
    "newTotalWindowSecs",
  );
}

/* ── Duty status ──────────────────────────────────────────────────────────── */

/**
 * `cowork_duty_status/{employeeId}`.
 *
 * **Legacy already implements the availability-delta model**, under different
 * names: `latenessMs` is late login, `breakGapAppliedMs` and
 * `emergencyGapAppliedMs` are deltas already applied to deadlines, the
 * `pending*` fields are measured-but-unapplied, and `lastDeadlineShiftMs` is the
 * idempotency watermark that stops one absence being paid for twice.
 *
 * That is the same model as `lib/rules/availability/ledger.ts`, arrived at
 * independently. Anything new belongs alongside these fields rather than in a
 * second set — two accumulators for one quantity is how an hour gets credited
 * twice.
 */
export interface LegacyDutyStatus {
  status?: string;
  prevMode?: string;
  targetMode?: string;
  startedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;

  sessionSecs?: number;
  totalSeconds?: number;
  workedTodaySeconds?: number;

  /** Milliseconds late against the scheduled open. Legacy's late-login figure. */
  latenessMs?: number;
  officeOpenMs?: number;
  istMidnightUtcMs?: number;
  istTimeMs?: number;

  breakStartedAtMs?: number;
  breakSessionSecs?: number;
  breakElapsedSeconds?: number;
  breakRemainingSeconds?: number;
  dailyBreakSeconds?: number;
  maxBreakSecs?: number;
  breakIncrementSecs?: number;
  /** Measured. */
  breakGapStoredMs?: number;
  /** Already given back to deadlines. */
  breakGapAppliedMs?: number;
  /** Measured but not yet applied. */
  pendingBreakGapMs?: number;
  directBreakAppliedMs?: number;

  emergencyStartedAtMs?: number;
  emergencyGapStoredMs?: number;
  emergencyGapAppliedMs?: number;
  pendingEmergencyGapMs?: number;
  directEmergencyGapMs?: number;

  /** Idempotency watermark — the last shift already paid out. */
  lastDeadlineShiftMs?: number;
  shiftMs?: number;
  appliedSecs?: number;
  dueMs?: number;
  pendingMs?: number;
  sinceMs?: number;
}

/**
 * Milliseconds measured but not yet given back to deadlines.
 *
 * The quantity a new UI needs in order to show "your deadlines will move by X"
 * before the engine applies it. Derived from legacy's own fields rather than
 * recomputed from timestamps, so it cannot disagree with what the engine will
 * actually do.
 */
export function unappliedGapMs(duty: LegacyDutyStatus): number {
  const pendingBreak =
    duty.pendingBreakGapMs ??
    Math.max(0, (duty.breakGapStoredMs ?? 0) - (duty.breakGapAppliedMs ?? 0));
  const pendingEmergency =
    duty.pendingEmergencyGapMs ??
    Math.max(
      0,
      (duty.emergencyGapStoredMs ?? 0) - (duty.emergencyGapAppliedMs ?? 0),
    );
  return Math.max(0, pendingBreak) + Math.max(0, pendingEmergency);
}
