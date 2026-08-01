import { DEFAULT_MAX_BREAK_MINUTES } from "../../legacy/officePolicy.ts";

/**
 * How much break time may be given back to deadlines in one day.
 *
 * The allowance is `maxBreakMinutesPerDay` from **Admin → Office policy →
 * break time**, and it bounds the CREDIT, not the break. Somebody may take as
 * long a break as they need; what the policy limits is how much of it the
 * company will move deadlines for. Refusing the break itself would be a
 * different product decision, and a worse one — it would push people to stay
 * marked online while away.
 *
 * ## Why the running total is per day and stamped with its date
 *
 * A cap with no ledger is not a cap: three twenty-minute breaks would each be
 * under a sixty-minute allowance and together exceed it. So the credited total
 * is carried on the duty document with the day it belongs to, and a stamp from
 * another day resets it rather than accumulating — which is what makes
 * "per day" true rather than "per lifetime".
 *
 * The day is the LOCAL calendar day. An allowance that reset at midnight UTC
 * would reset in the middle of an afternoon in India, where this runs.
 */

/** The day key a moment belongs to, in local time. `2026-08-01`. */
export function dayKeyOf(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface BreakLedger {
  /** The day the running total belongs to. */
  dayKey: string | null;
  /** Break milliseconds already credited to deadlines that day. */
  creditedMs: number;
}

export interface AllowanceResult {
  /** What may actually be added to deadlines now. */
  grantedMs: number;
  /** What was asked for but refused, because the day's allowance is spent. */
  deniedMs: number;
  /** The ledger to store. */
  ledger: BreakLedger;
  /** Whether the day's allowance is now fully used. */
  exhausted: boolean;
}

/**
 * Apply the day's allowance to a break span.
 *
 * A span that crosses the limit is granted in PART rather than refused whole:
 * somebody forty minutes into a day with thirty minutes left is owed those
 * thirty. Refusing the lot because it does not fit would be arithmetic nobody
 * would accept on a payslip.
 */
export function grantBreakCredit(input: {
  /** The break span just measured, in ms. */
  spanMs: number;
  /** `maxBreakMinutesPerDay`. Zero or less means no credit is ever given. */
  maxMinutesPerDay?: number;
  ledger: BreakLedger;
  nowMs: number;
}): AllowanceResult {
  const today = dayKeyOf(input.nowMs);
  /* A ledger from another day starts over — that is what per-day means. */
  const usedMs =
    input.ledger.dayKey === today ? Math.max(0, input.ledger.creditedMs) : 0;

  const minutes =
    input.maxMinutesPerDay === undefined || input.maxMinutesPerDay === null
      ? DEFAULT_MAX_BREAK_MINUTES
      : input.maxMinutesPerDay;
  const allowanceMs = Math.max(0, minutes) * 60_000;

  const span = Math.max(0, input.spanMs);
  const remaining = Math.max(0, allowanceMs - usedMs);
  const grantedMs = Math.min(span, remaining);

  return {
    grantedMs,
    deniedMs: span - grantedMs,
    ledger: { dayKey: today, creditedMs: usedMs + grantedMs },
    exhausted: usedMs + grantedMs >= allowanceMs,
  };
}

/** Read a stored ledger, tolerating a document written before this existed. */
export function readBreakLedger(raw: Record<string, unknown>): BreakLedger {
  return {
    dayKey:
      typeof raw.breakCreditDayKey === "string" ? raw.breakCreditDayKey : null,
    creditedMs:
      typeof raw.breakCreditedMs === "number" && Number.isFinite(raw.breakCreditedMs)
        ? Math.max(0, raw.breakCreditedMs)
        : 0,
  };
}

/** The fields to merge onto the duty document. */
export function writeBreakLedger(ledger: BreakLedger): Record<string, unknown> {
  return {
    breakCreditDayKey: ledger.dayKey,
    breakCreditedMs: ledger.creditedMs,
  };
}
