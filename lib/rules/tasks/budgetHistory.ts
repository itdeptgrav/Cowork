/**
 * Where a task's hours came from.
 *
 * A task is created with a budget and that budget can GROW afterwards, without
 * anybody asking for it: a break credited back, an offline span, an approved
 * emergency, a meeting attended. Each of those is a rule applying itself, which
 * is exactly why they need an account — "my budget says 10:26:53 and I was
 * given nine hours" is a fair question and until now the product had no answer
 * to it.
 *
 * ## What this module is, and is not
 *
 * It is the arithmetic and the vocabulary: classify a stored reason into a
 * cause, add the credits up, and say plainly what is left over. It reads
 * records; it does not write them and does not decide what earns a credit —
 * that is `meetingCredit.ts` and the presence rules, and duplicating any of it
 * here would give the same question two answers.
 *
 * ## The unaccounted line is the point
 *
 * Credits were applied for a long time before anything recorded them, so on
 * most existing tasks the recorded credits will NOT add up to the current
 * budget. The honest response is to say so — `unaccountedSecs` — rather than
 * quietly showing a total that disagrees with the figure on the same screen.
 * A history whose numbers do not reconcile with the Details panel is worse
 * than no history, because the reader cannot tell which one is lying.
 */

/** One recorded increase to a task's budget. */
export interface BudgetCredit {
  id: string;
  /** ISO. When the credit was applied. */
  at: string;
  /** The budget before, in seconds. */
  previousSecs: number;
  /** The budget after, in seconds. */
  newSecs: number;
  /** The engine's own sentence — shown as written. */
  reason: string;
  /** Who the credit was for. Null where the record does not say. */
  byEmployeeId: string | null;
}

/**
 * What caused a credit, from the reason the engine wrote.
 *
 * Classified from the text because that is what was stored — no cause field
 * exists on the older records, and inventing one now would leave every
 * historical row as "other". The strings are the engine's own and are matched
 * loosely enough to survive a reworded suffix.
 */
export type CreditCause =
  | "break"
  | "offline"
  | "emergency"
  | "meeting"
  | "extension"
  | "other";

export function creditCause(reason: string): CreditCause {
  const r = reason.toLowerCase();
  if (r.includes("meeting")) return "meeting";
  if (r.includes("emergency")) return "emergency";
  /* Break before offline: one span can credit both — "break 20m + offline 5m" —
     and a single row cannot be two causes. Break is the more specific of the
     two and the one a reader recognises, so it wins the label; the reason line
     underneath still names both. */
  if (r.includes("break")) return "break";
  if (r.includes("offline")) return "offline";
  if (r.includes("extension") || r.includes("granted")) return "extension";
  return "other";
}

/** How a cause reads on screen. */
export const CREDIT_CAUSE_LABEL: Record<CreditCause, string> = {
  break: "Break credited back",
  offline: "Offline time credited back",
  emergency: "Emergency approved",
  meeting: "Meeting attended",
  extension: "Extension granted",
  other: "Credited",
};

/** One row of the history, ready to render. */
export interface BudgetHistoryEntry {
  id: string;
  at: string;
  cause: CreditCause;
  label: string;
  /** The engine's own sentence. */
  reason: string;
  /** Always positive — see `budgetHistoryView`. */
  deltaSecs: number;
  newSecs: number;
}

export interface BudgetHistoryView {
  /** What the task was created with. */
  givenSecs: number;
  /** What it holds now — the figure the Details panel prints. */
  currentSecs: number;
  /** Oldest first: the order things happened in. */
  entries: BudgetHistoryEntry[];
  /** The recorded credits, added up. */
  creditedSecs: number;
  /**
   * Budget that exists but has no record explaining it.
   *
   * Positive on any task credited before receipts were kept. Zero is the
   * healthy case and the only one where the history is complete.
   */
  unaccountedSecs: number;
  /** True when every second of the current budget is explained. */
  complete: boolean;
}

function secs(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * The whole account: given, plus what was credited, versus what is held now.
 *
 * Credits are sorted oldest first and their deltas are computed from the
 * record's own before/after pair rather than from a stored delta, so a row
 * cannot claim a size that disagrees with the two numbers beside it.
 * Non-positive deltas are dropped: this is a record of budget GROWING, and a
 * zero-second row is noise while a negative one would be a different feature
 * that does not exist.
 */
export function budgetHistoryView(input: {
  /** The task's original budget. 0 where it was never recorded. */
  givenSecs: number;
  /** The budget now. */
  currentSecs: number;
  credits: readonly BudgetCredit[];
}): BudgetHistoryView {
  const givenSecs = secs(input.givenSecs);
  const currentSecs = secs(input.currentSecs);

  const entries: BudgetHistoryEntry[] = [...input.credits]
    .map((c) => {
      const delta = secs(c.newSecs) - secs(c.previousSecs);
      const cause = creditCause(c.reason);
      return {
        id: c.id,
        at: c.at,
        cause,
        label: CREDIT_CAUSE_LABEL[cause],
        reason: c.reason,
        deltaSecs: delta,
        newSecs: secs(c.newSecs),
      };
    })
    .filter((e) => e.deltaSecs > 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const creditedSecs = entries.reduce((sum, e) => sum + e.deltaSecs, 0);

  /* Floored at zero. A task whose budget was REDUCED, or whose `given` figure
     was written after some credits had already landed, would otherwise report
     a negative gap — which reads as "we owe you time" and means nothing. */
  const unaccountedSecs = Math.max(0, currentSecs - givenSecs - creditedSecs);

  return {
    givenSecs,
    currentSecs,
    entries,
    creditedSecs,
    unaccountedSecs,
    /* A task with no `given` figure at all cannot be complete: there is no
       baseline to reconcile against, so claiming the account balances would be
       claiming knowledge the record does not have. */
    complete: givenSecs > 0 && unaccountedSecs === 0,
  };
}

/* ── Deadline moves ───────────────────────────────────────────────────────── */

/**
 * One recorded shift of a task's due date.
 *
 * Read from `cowork_task_deadline_extensions`, which is where every move is
 * already filed — a break, an offline span, an approved emergency, an approved
 * extension and credited meeting time all write one. The record has been
 * written all along; nothing displayed it.
 */
export interface DeadlineMove {
  id: string;
  /** When the move was applied. */
  at: string;
  /** ISO instants, before and after. */
  fromIso: string;
  toIso: string;
  /** The engine's own sentence — it names the cause better than a label can. */
  reason: string;
  /** True where a rule applied itself, false where a person approved it. */
  automatic: boolean;
}

export interface DeadlineMoveEntry extends DeadlineMove {
  /** Seconds the date moved by. Negative where a deadline was pulled in. */
  deltaSecs: number;
  /** What to call it, when the reason is empty. */
  label: string;
}

/**
 * The deadline's own history, oldest first.
 *
 * ## Why this exists beside the budget's
 *
 * Going offline moves a due date and does **not** touch the budget — the work
 * still takes as long, the day simply has less of it left. So the budget
 * history correctly said "Nothing has been credited", and a reader who had just
 * watched their deadline move read that as the system having no idea it had
 * happened. Two different facts, and only one of them had somewhere to appear.
 *
 * **Nothing here computes a shift.** The dates are read back off the record the
 * engine already wrote; `deltaSecs` is the difference between the two instants
 * on that record, so a row can never claim a size that disagrees with the pair
 * beside it.
 *
 * A move of zero seconds is dropped: a record whose before and after are the
 * same instant explains nothing and is noise in a list read for explanations.
 */
export function deadlineMoveEntries(
  moves: readonly DeadlineMove[],
): DeadlineMoveEntry[] {
  return [...moves]
    .map((m) => {
      const from = Date.parse(m.fromIso);
      const to = Date.parse(m.toIso);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
      const deltaSecs = Math.round((to - from) / 1000);
      if (deltaSecs === 0) return null;
      return {
        ...m,
        deltaSecs,
        /* Named for the direction, because "moved" alone leaves a reader
           working out which way from two timestamps. */
        label: deltaSecs > 0 ? "Deadline moved later" : "Deadline moved earlier",
      };
    })
    .filter((m): m is DeadlineMoveEntry => m !== null)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
