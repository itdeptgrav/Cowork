/**
 * A millisecond instant as an ISO string, or null — never a throw.
 *
 * **Why this exists.** `new Date(undefined).toISOString()` raises
 * `RangeError: Invalid time value`, and inside `toTask` that does not spoil one
 * field: it aborts the whole mapping, so a single task document missing one
 * timestamp empties the list it belongs to. Reported as tasks vanishing after
 * `clockStartsAt` was added — the guard there tested `=== null`, and an ABSENT
 * field is `undefined`.
 *
 * A field that is missing, null, unparseable or infinite means "not recorded",
 * and every caller already renders that as nothing shown. Degrading to null is
 * the behaviour; crashing was never anybody's intent.
 */
export function instantOrNull(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
