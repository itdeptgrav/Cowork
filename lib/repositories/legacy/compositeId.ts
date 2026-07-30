/**
 * Ids for records legacy stores without one.
 *
 * **The bug this exists to stop happening again.** Legacy keeps submissions,
 * reviews, rework requests and deadline history as fields and array members on
 * the task document — none of them has an identity of its own. The domain needs
 * ids, so the adapter mints them from the task id plus a discriminator.
 *
 * That is fine until something sends one back. `reviewSubmission` took a
 * `submissionId` and used it verbatim as a task id — true while submissions
 * were unwired, and false the moment `listSubmissions` began minting
 * `T626#submission`. The engine was asked for a task called `T626#submission`,
 * could not find one, and the reviewer was told **"Task not found."**
 *
 * So minting and decoding live together, in one place, and every composite id in
 * the adapter goes through them. A decoder that lives next to the minter cannot
 * drift from it; four hand-rolled `split("#")` calls can.
 */

const SEPARATOR = "#";

/**
 * `T626` + `submission` → `T626#submission`.
 *
 * The task id comes FIRST and the discriminators after, which is what makes
 * decoding unambiguous: everything up to the first separator is the task.
 */
export function compositeId(taskId: string, ...parts: (string | number)[]): string {
  return [taskId, ...parts].join(SEPARATOR);
}

/**
 * The task a composite id belongs to.
 *
 * Splits at the **first** separator, not the last. `T626#review-1#rework` has
 * two, and taking the last would yield `T626#review-1` — an id the engine has
 * never heard of, which is the same "Task not found" by a different route.
 *
 * An id with no separator is returned unchanged: legacy task ids carry none, so
 * a bare one is already a task id. That keeps this safe to apply to a value
 * that may or may not be composite, which is exactly the situation at a
 * repository boundary.
 */
export function taskIdOf(id: string): string {
  const cut = id.indexOf(SEPARATOR);
  return cut > 0 ? id.slice(0, cut) : id;
}

/** Whether this id was minted here rather than by the engine. */
export function isComposite(id: string): boolean {
  return id.indexOf(SEPARATOR) > 0;
}
