/**
 * A project's dates and people, from the work connected to it.
 *
 * A project is not a thing with a schedule of its own — it is a name for a set
 * of tasks, and every fact it reports is theirs. Progress already works this
 * way (`ProjectProgress` is counted from the links), and the dates had been the
 * one exception: two `<input type="date">` fields, prefilled with a pair of
 * hardcoded literals from the demo seed, that somebody was expected to keep in
 * agreement with the tasks by hand. They never could — connecting one more task
 * moves the real end date and nothing on the form knew.
 *
 * So the form derives them, and this is the derivation. Pure, so the same
 * answer can be asserted without rendering anything.
 *
 * **Both dates are proposals, not locks.** The form writes them into fields the
 * creator can still overwrite: a project may legitimately start before its
 * first task was raised, or be promised for a date past its current work. What
 * is removed is the requirement to *invent* them.
 */

/** The only fields the derivation reads. Deliberately narrow. */
export interface DatedTask {
  createdAt: string;
  /** When the work is really expected to land, then the stored commitment. */
  operationalDueAt: string | null;
  dueAt: string | null;
}

export interface DerivedProjectDates {
  /** `YYYY-MM-DD`, or null when nothing connected can date it. */
  startDate: string | null;
  targetDate: string | null;
}

/** An ISO instant as the `YYYY-MM-DD` an `<input type="date">` accepts. */
function asDateInput(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The window the connected work occupies.
 *
 * Start is the earliest task's creation — when the first piece of this work was
 * raised is when the project began, whatever anybody later writes on a charter.
 *
 * Target is the latest end date, and `operationalDueAt` is preferred over
 * `dueAt` for the reason the field exists: the stored figure is assignment time
 * plus a budget, as if the assignee were free that instant, while the
 * operational one walks their actual queue. A project promised against the
 * former is promised against a date nobody's calendar agrees with. Where the
 * queue could not be chained the stored figure is all there is, and it is used.
 *
 * A task with no end date contributes nothing to the target rather than
 * collapsing it — an undated task is unknown, not immediate.
 */
export function deriveProjectDates(
  tasks: readonly DatedTask[],
): DerivedProjectDates {
  if (tasks.length === 0) return { startDate: null, targetDate: null };

  let startMs: number | null = null;
  let targetMs: number | null = null;

  for (const t of tasks) {
    const created = Date.parse(t.createdAt);
    if (!Number.isNaN(created) && (startMs === null || created < startMs)) {
      startMs = created;
    }

    const end = t.operationalDueAt ?? t.dueAt;
    if (!end) continue;
    const endMs = Date.parse(end);
    if (!Number.isNaN(endMs) && (targetMs === null || endMs > targetMs)) {
      targetMs = endMs;
    }
  }

  return {
    startDate: startMs === null ? null : asDateInput(new Date(startMs).toISOString()),
    targetDate:
      targetMs === null ? null : asDateInput(new Date(targetMs).toISOString()),
  };
}
