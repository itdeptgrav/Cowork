/**
 * The point history, as a person reads it.
 *
 * The channel pages each show their own slice of the ledger. This is the view
 * the old application had and this one did not: **every entry, in one list,
 * newest first, with what it cost or earned and why.** It is the page somebody
 * opens to answer "where did my points go", and until now the History tab
 * answered "No history yet" — true of closed scoring periods, and not at all
 * true of the ledger, which had years of entries in it.
 *
 * Ported from `OwnHistory` in the old project's `app/coworking/sop/page.js`.
 * The behaviour is deliberately the same, including the parts that look like
 * details:
 *
 *  - **Filters narrow, they do not re-fetch.** One request holds the whole
 *    ledger; component and date filters are applied here. So switching between
 *    All and C3 is instant and cannot show a different history than the one
 *    already on screen.
 *  - **A confirmed dispute removes the points but keeps the row.** Legacy
 *    resolves a dispute by marking the entry `recheck.status: "confirmed"` and
 *    excluding it from the total. Deleting the row instead would leave somebody
 *    who remembers the deduction unable to find out what happened to it.
 *  - **Positive is good.** The engine stores a penalty as a positive number
 *    (`totalDeducted` counts upward as things get worse). Every figure here is
 *    flipped to the direction a reader expects — earned is positive, deducted
 *    is negative — which is the same flip the old summary bar made with
 *    `displayTotal = -totalAll`.
 *
 * Pure, so the arithmetic that decides what somebody is told about their own
 * score is testable without a network, a clock or a browser.
 */

/** The component codes, in the order they are offered. */
export const LEDGER_COMPONENTS = ["c1", "c2", "c3", "c4"] as const;
export type LedgerComponent = (typeof LEDGER_COMPONENTS)[number];

/** `All`, or one component. */
export type LedgerFilter = "all" | LedgerComponent;

/**
 * One ledger entry, as `listLedger` returns it.
 *
 * Structural rather than an import of the repository type: this module needs
 * six fields and naming them is what makes the rules below readable. A change
 * to the repository shape that drops one of these fails the typecheck at the
 * call site, which is where it should fail.
 */
export interface LedgerEntryLike {
  id: string;
  component: string;
  /** `YYYY-MM-DD`, or empty when the engine sent none. */
  effectiveDate: string;
  /** The year the engine filed it under. */
  periodKey: string;
  sourceLabel: string;
  reason: string;
  actorId: string;
  actorLabel: string;
  /** Positive, or zero. Never both this and `deduction`. */
  credit: number;
  deduction: number;
  disputeStatus?: string | null;
}

/**
 * Whether a dispute took this entry's points back.
 *
 * `confirmed` is legacy's word for "the objection was upheld". The entry stays
 * on the record — see the note at the top — but it no longer counts.
 */
export function isReversed(entry: LedgerEntryLike): boolean {
  return (entry.disputeStatus ?? "").toLowerCase() === "confirmed";
}

/**
 * Points as the reader should see them: **positive earned, negative deducted.**
 *
 * A reversed entry is worth nothing, which is what makes the totals below
 * agree with the rows a reader can see struck through.
 */
export function signedPointsOf(entry: LedgerEntryLike): number {
  if (isReversed(entry)) return 0;
  /* `|| 0` normalises negative zero — `-0` formats as "−0", which reads as a
     deduction of nothing rather than as nothing at all. The same guard as
     `presentLedgerEntry`. */
  return entry.credit > 0 ? entry.credit : -entry.deduction || 0;
}

export interface LedgerQuery {
  component: LedgerFilter;
  /** `YYYY-MM-DD`, inclusive. Empty means unbounded. */
  from: string;
  /** `YYYY-MM-DD`, inclusive. Empty means unbounded. */
  to: string;
}

export const NO_FILTER: LedgerQuery = { component: "all", from: "", to: "" };

export function isFiltered(query: LedgerQuery): boolean {
  return query.component !== "all" || query.from !== "" || query.to !== "";
}

/**
 * The entries a query selects.
 *
 * Dates are compared as strings, which is exact for `YYYY-MM-DD` and avoids
 * parsing a date only to compare it back. An entry with no date survives a
 * component filter but is excluded by any date bound — it cannot be shown to
 * fall inside a range nobody can place it in.
 */
export function filterLedger(
  entries: readonly LedgerEntryLike[],
  query: LedgerQuery,
): LedgerEntryLike[] {
  return entries.filter((e) => {
    if (query.component !== "all") {
      if ((e.component ?? "").toLowerCase() !== query.component) return false;
    }
    if (query.from || query.to) {
      if (!e.effectiveDate) return false;
      if (query.from && e.effectiveDate < query.from) return false;
      if (query.to && e.effectiveDate > query.to) return false;
    }
    return true;
  });
}

export interface LedgerTotals {
  /** Positive. */
  earned: number;
  /** Positive — the magnitude taken off. */
  deducted: number;
  /** `earned - deducted`. Positive is good. */
  net: number;
}

/**
 * Totals over a set of entries.
 *
 * Rounded to two decimals at the end rather than per entry: the engine stores
 * fractional points and summing rounded figures drifts away from the figure the
 * engine itself holds.
 */
export function totalsOf(entries: readonly LedgerEntryLike[]): LedgerTotals {
  let earned = 0;
  let deducted = 0;
  for (const e of entries) {
    const p = signedPointsOf(e);
    if (p > 0) earned += p;
    else if (p < 0) deducted += -p;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { earned: round(earned), deducted: round(deducted), net: round(earned - deducted) };
}

/**
 * The newest entries, newest first.
 *
 * For the Score tab, which leads with what has just been earned or lost rather
 * than with an explanation of the model. A plain `slice` cannot do this: the
 * ledger arrives grouped by filing year, so the first entries in the array are
 * whichever year the provider happened to send first — on a record with two
 * years in it, "recent" would show 2025.
 *
 * Undated entries sort LAST rather than first, for the reason `groupLedger`
 * lifts the empty case out: `""` compares before every real date, so an entry
 * the engine forgot to stamp would otherwise head the panel. They are still
 * eligible for the slice — an entry that moved somebody's score is not withheld
 * from them over a missing stamp — but only once the dated ones are placed.
 */
export function recentEntries(
  entries: readonly LedgerEntryLike[],
  limit: number,
): LedgerEntryLike[] {
  if (limit <= 0) return [];
  return [...entries]
    .sort((a, b) => {
      const [x, y] = [a.effectiveDate || "", b.effectiveDate || ""];
      if (x === y) return 0;
      if (x === "") return 1;
      if (y === "") return -1;
      return y.localeCompare(x);
    })
    .slice(0, limit);
}

export interface LedgerDay {
  /** `YYYY-MM-DD`, or `""` for entries the engine dated nothing. */
  date: string;
  entries: LedgerEntryLike[];
  totals: LedgerTotals;
}

export interface LedgerYear {
  /** The engine's own filing year, as a string. */
  year: string;
  days: LedgerDay[];
  totals: LedgerTotals;
}

/**
 * The history, grouped the way it is read: year, then day, newest first.
 *
 * Undated entries are collected under one empty-string day and sorted LAST
 * rather than dropped. An entry that moved somebody's score is not withheld
 * from them because the engine forgot to stamp it.
 */
export function groupLedger(
  entries: readonly LedgerEntryLike[],
): LedgerYear[] {
  const years = new Map<string, Map<string, LedgerEntryLike[]>>();
  for (const e of entries) {
    /* The engine's filing year is authoritative. Falling back to the date's own
       year keeps an entry visible when `periodKey` is missing rather than
       filing it under "". */
    const year = e.periodKey || e.effectiveDate.slice(0, 4) || "";
    const day = e.effectiveDate || "";
    const days = years.get(year) ?? new Map<string, LedgerEntryLike[]>();
    years.set(year, days);
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  /* Undated last within a year, undated year last overall — `""` sorts before
     every real value, so the empty case is lifted out rather than reversed. */
  const byNewest = (a: string, b: string) =>
    a === "" ? 1 : b === "" ? -1 : b.localeCompare(a);

  return [...years.entries()]
    .sort(([a], [b]) => byNewest(a, b))
    .map(([year, days]) => {
      const grouped = [...days.entries()]
        .sort(([a], [b]) => byNewest(a, b))
        .map(([date, dayEntries]) => ({
          date,
          entries: dayEntries,
          totals: totalsOf(dayEntries),
        }));
      return {
        year,
        days: grouped,
        totals: totalsOf(grouped.flatMap((d) => d.entries)),
      };
    });
}

/**
 * The one-line summary a year header carries.
 *
 * Says "earned" or "deducted" in words rather than relying on a sign and a
 * colour — the old page's header did the same, and a figure that means the
 * opposite of what it appears to mean is the specific failure this avoids.
 */
export function describeTotals(totals: LedgerTotals): string {
  if (totals.net > 0) return `+${totals.net.toFixed(1)} pts earned`;
  if (totals.net < 0) return `−${Math.abs(totals.net).toFixed(1)} pts deducted`;
  return "0 pts net";
}
