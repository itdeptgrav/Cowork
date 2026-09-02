import type { ScoreLedgerEntry } from "@/lib/domain/scoring";

/**
 * The recent point changes a person has not been shown yet.
 *
 * The score ledger is the credit/debit history — each entry is a deduction or a
 * credit. When someone opens the app we want to tell them, once, about the ones
 * that happened while they were away: "−0.2, rework" or "+0.5, on-time credit".
 *
 * Two things keep it from becoming noise:
 *  · a **recency window** — only changes from the last few days, so the very
 *    first time this runs it does not announce a year of history; and
 *  · a **seen list** — ids already announced (held in the browser), so a change
 *    is shown once and never again.
 *
 * Pure on purpose: the component just fetches the ledger, reads the seen list,
 * and renders what this returns.
 */
export interface PtsChange {
  id: string;
  /** Signed: negative is a cut (debit), positive is a credit. */
  points: number;
  isDebit: boolean;
  /** What it was for — the source, or the reason. */
  label: string;
  /** When it took effect. */
  at: string;
}

export interface PtsChangeResult {
  /** Unseen, recent changes, newest first. */
  changes: PtsChange[];
  hasDebit: boolean;
  hasCredit: boolean;
}

/** Three days — long enough to catch what happened over a weekend away. */
export const PTS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function unseenPtsChanges(
  ledger: readonly ScoreLedgerEntry[],
  seenIds: readonly string[],
  nowMs: number,
  windowMs: number = PTS_WINDOW_MS,
): PtsChangeResult {
  const seen = new Set(seenIds);
  const changes: PtsChange[] = [];

  for (const e of ledger) {
    /* Credit lifts the score, a deduction cuts it — signed so the reader sees
       +/− without having to know which column was filled. A zero-zero entry is
       not a change and is skipped. */
    const points = (e.credit || 0) - (e.deduction || 0);
    if (points === 0) continue;
    if (seen.has(e.id)) continue;

    const at = e.effectiveDate || e.createdAt || "";
    const t = at ? new Date(at).getTime() : NaN;
    if (!Number.isFinite(t) || nowMs - t > windowMs) continue;

    changes.push({
      id: e.id,
      points,
      isDebit: points < 0,
      label: e.sourceLabel || e.reason || "Score change",
      at,
    });
  }

  changes.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    changes,
    hasDebit: changes.some((c) => c.isDebit),
    hasCredit: changes.some((c) => !c.isDebit),
  };
}
