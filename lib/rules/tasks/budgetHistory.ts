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

/**
 * The same cause, as one word — for the deadline timeline's connecting
 * segment, where `CREDIT_CAUSE_LABEL`'s full sentence would not fit beside an
 * icon and a duration.
 */
export const CREDIT_CAUSE_SHORT_LABEL: Record<CreditCause, string> = {
  break: "Break",
  offline: "Offline",
  emergency: "Emergency",
  meeting: "Meeting",
  extension: "Extension",
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
 * **A granted extension is a credit, and it can be named without a receipt.**
 *
 * The budget grows when a manager approves an extension, and until recently
 * nothing wrote a credit receipt when that happened. The panel then reported
 * the difference as "Credited earlier — applied before this history was kept,
 * so the cause was not recorded", which was true of the RECEIPT and false of
 * the event: the extension record was sitting in
 * `cowork_task_budget_extensions` the whole time, with its own before, after,
 * approver and decision date. Reported as exactly that — "it should show what
 * +30 reason is, extension".
 *
 * So the extension records are read as credits in their own right. Nothing is
 * invented: every field comes off the stored request, and the delta is the
 * record's own before/after pair, the same rule `budgetHistoryView` applies to
 * a receipt.
 *
 * **Only where the time was actually granted.** `pending` is somebody asking,
 * `rejected` is an answer of no, and `counter_proposed` is a different figure
 * still being argued — none of them moved a budget. `approved` and `accepted`
 * did.
 *
 * **Deduped against real receipts by the resulting budget.** Once the engine
 * writes a receipt for an approval, both records describe one event; listing
 * both would double the credit and show the same grant twice. Two different
 * credits landing on the identical resulting budget is not a thing that
 * happens, so `newSecs` identifies the event.
 */
export interface ExtensionCreditSource {
  id: string;
  status: string;
  previousBudgetSecs: number;
  newBudgetSecs: number;
  /** What the manager actually granted, where it differs from what was asked. */
  approvedSecs: number | null;
  approverId: string | null;
  /**
   * The approver's name, resolved by the caller from the directory.
   *
   * The stored record keeps only an id, and `Extension approved by GR0000.`
   * is not a sentence anybody should have to read on their own task. The
   * id stays as the fallback rather than the source: somebody since
   * removed from the directory is still better named by their code than
   * by nothing at all.
   */
  approverName: string | null;
  /** When the manager decided. */
  approvedAt: string | null;
  confirmedAt: string | null;
  createdAt: string | null;
}

const GRANTED_EXTENSION_STATUSES = ["approved", "accepted"];

export function extensionCredits(
  extensions: readonly ExtensionCreditSource[],
  recorded: readonly BudgetCredit[] = [],
): BudgetCredit[] {
  const covered = new Set(recorded.map((c) => Math.round(secs(c.newSecs))));

  return extensions
    .filter((x) => GRANTED_EXTENSION_STATUSES.includes(String(x.status)))
    .map((x) => {
      const previousSecs = secs(x.previousBudgetSecs);
      /**
       * **What the manager GRANTED, never what was asked for.**
       *
       * `newBudgetSecs` is the total the REQUEST proposed, and it is left
       * standing when the manager grants a different figure — the answer
       * goes to `approvedSecs`, which is the approved total window and not
       * a delta. On a live record: previous 9600, asked 1200,
       * `approvedSecs` 9900, `newBudgetSecs` 10800. The manager gave five
       * minutes; the request had asked for twenty.
       *
       * Reading `newBudgetSecs` first credited the twenty. Four rows of a
       * 2h budget then read +30m, +10m, +20m, +20m under a total of 2h 50m
       * — an account that did not add up to the figure printed beneath it,
       * which is the one thing this panel exists to guarantee. Reported as
       * "it is showing 20 minutes even though the manager only added 5".
       *
       * So the answer wins where there is one, and the request stands only
       * where the manager granted exactly what was asked — which is what
       * a null `approvedSecs` means.
       */
      const newSecs =
        secs(x.approvedSecs) > 0 ? secs(x.approvedSecs) : secs(x.newBudgetSecs);
      /* The decision, not the request: the budget grew when it was answered. */
      const at = x.approvedAt ?? x.confirmedAt ?? x.createdAt ?? "";
      /* The name where the directory knew them, their code where it did not. */
      const who = x.approverName?.trim() || x.approverId?.trim() || null;
      return {
        id: `extension:${x.id}`,
        at,
        previousSecs,
        newSecs,
        /* Worded as the engine's own receipt words it, so a derived row and a
           recorded one read identically — and so `creditCause` classifies it
           as an extension rather than falling through to "other". */
        reason: who
          ? `Extension approved by ${who}.`
          : "Extension approved.",
        byEmployeeId: null,
      };
    })
    /* A row with no date cannot be placed in the account, and one that did not
       raise the budget is not a credit. `budgetHistoryView` drops the second
       kind as well; dropping it here keeps the dedupe honest. */
    .filter((c) => c.at !== "" && c.newSecs > c.previousSecs)
    .filter((c) => !covered.has(Math.round(c.newSecs)));
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

/* ── Deadline timeline ────────────────────────────────────────────────────── */

/**
 * A staircase of deadline moves, rendered as a connected timeline.
 *
 * ## What is real, and the one thing that is deliberately NOT here
 *
 * Every instant on a `DeadlineTimelineChain` is one of `fromIso`/`toIso` off a
 * `DeadlineMove` record — nothing here computes, guesses or interpolates a
 * time. What it does NOT carry, because the record never carries it: the clock
 * window somebody was actually offline or on a break for. `#compensateOneDeadline`
 * writes `previousDeadline`/`proposedDeadline` — the DEADLINE's own before and
 * after — and a text `reason` such as "Time credited back — offline 69m". The
 * offline span's own start and end are used once, in memory, to compute the
 * credited minutes, and are never written to Firestore. A row showing "11:42 →
 * 12:50" would be a real-looking number invented for the screen, which is worse
 * than the row not existing — see the module header on why an unreconciled
 * figure here is treated as a fault rather than a rounding choice.
 *
 * ## Why moves are grouped into chains rather than assumed to connect
 *
 * `#compensateOneDeadline` reads the task's CURRENT stored deadline as
 * `previousDeadline` before writing the new one, so in the ordinary case one
 * move's `toIso` is byte-for-byte the next move's `fromIso` — a genuine
 * staircase. Nothing GUARANTEES that: a deadline edited by a path this
 * function does not read from would break the chain without either record
 * saying so. Asserting continuity that is not actually there is exactly the
 * failure this avoids, so two moves are only drawn as one connected line when
 * their instants actually match; otherwise they are two separate staircases,
 * each still fully truthful about itself.
 */
export interface DeadlineTimelineChain {
  /** Oldest first, already connected: chain[i].toIso === chain[i+1].fromIso. */
  moves: DeadlineMoveEntry[];
}

export function deadlineTimelineChains(
  moves: readonly DeadlineMoveEntry[],
): DeadlineTimelineChain[] {
  const chains: DeadlineTimelineChain[] = [];
  for (const m of moves) {
    const last = chains[chains.length - 1];
    const prev = last?.moves[last.moves.length - 1];
    if (prev && Date.parse(prev.toIso) === Date.parse(m.fromIso)) {
      last.moves.push(m);
    } else {
      chains.push({ moves: [m] });
    }
  }
  return chains;
}
