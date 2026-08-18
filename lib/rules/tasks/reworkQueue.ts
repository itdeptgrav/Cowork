import type { ReworkQueueRow } from "@/lib/repositories";

/**
 * Sending work back: where it lands, and what that moves.
 *
 * The engine decides the dates — this file only decides how to say them. It is
 * separate from the panel so the sentence a reviewer reads before committing
 * can be tested without a browser.
 */

/**
 * The priorities a rework can be given.
 *
 * P1 to P5, matching the ranks the engine already stores. Deliberately not
 * open-ended: the queue is ordered by rank and then by which task was raised
 * first, so a sixth level would add an ordering nobody could see on screen.
 */
export const REWORK_RANKS = [1, 2, 3, 4, 5] as const;

/**
 * Definitely a different calendar day, in the reader's own timezone.
 *
 * **False when either date cannot be read.** The claim being made on screen is
 * "this lands on another day", and a date that will not parse is not evidence
 * of that — reporting it as a day crossing would put a scarier sentence in
 * front of the reviewer than the facts support.
 */
function crossesDay(from: string, to: string): boolean {
  const x = new Date(from);
  const y = new Date(to);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return false;
  return (
    x.getFullYear() !== y.getFullYear() ||
    x.getMonth() !== y.getMonth() ||
    x.getDate() !== y.getDate()
  );
}

/** A row whose deadline actually changes — the rework's own row never counts. */
function moved(row: ReworkQueueRow): boolean {
  return !row.isRework && row.from !== null && row.from !== row.to;
}

/**
 * One sentence naming what this choice costs, or null when it costs nothing.
 *
 * **Null is the useful half.** A warning that appears on every choice is
 * ignored by the third rework; one that appears only when deadlines actually
 * move is read. So a choice that pushes nothing says nothing, and the absence
 * of the line is itself the message.
 *
 * Crossing to another day is called out separately because it is the shift
 * people care about — an hour later the same afternoon is a nuisance, landing
 * on tomorrow is a different promise to whoever is waiting for it.
 */
export function describeQueueShift(rows: readonly ReworkQueueRow[]): string | null {
  const pushed = rows.filter(moved);
  if (pushed.length === 0) return null;

  const crossed = pushed.filter((r) => r.from !== null && crossesDay(r.from, r.to));

  const count =
    pushed.length === 1 ? "1 deadline" : `${pushed.length} deadlines`;

  if (crossed.length === 0) return `This pushes ${count} out.`;
  if (crossed.length === pushed.length) {
    return pushed.length === 1
      ? `This pushes 1 deadline into another day.`
      : `This pushes ${count} out, all into another day.`;
  }
  return `This pushes ${count} out, ${crossed.length} into another day.`;
}
