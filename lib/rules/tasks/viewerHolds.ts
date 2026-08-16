/**
 * Does the viewer hold this task — yes, no, or **not known yet**?
 *
 * The third answer is the point. `useViewerId()` returns null while the viewer
 * is still being read and again if that read failed, and every gate in the task
 * surfaces was written as
 *
 *     assignments.some((a) => a.employeeId === me)
 *
 * which answers FALSE for null. A boolean cannot tell "you are not the
 * assignee" apart from "I do not know who you are yet", so the screen picked
 * the first and said so.
 *
 * Reported 16 Aug 2026: T051's assignee opened Submission and was told "Only an
 * assignee can submit this task." The task was correct — `assigneeIds` held
 * exactly that person and the mapper produced the matching assignment — and the
 * viewer simply had not resolved. On this machine that is not a brief flicker:
 * the identity store is empty and the viewer is read through the engine, which
 * had been failing, so the refusal was permanent.
 *
 * **Hiding a control while this is `unknown` is fine — it appears once the
 * viewer lands. Printing a refusal is not.** A refusal is a statement about
 * somebody's permissions, and stating one from missing data is the failure this
 * exists to prevent.
 */
export type ViewerHolds = "yes" | "no" | "unknown";

export function viewerHolds(input: {
  /** `useViewerId()` — null while loading, and after a failed read. */
  viewerId: string | null;
  assignments: readonly { employeeId: string }[];
}): ViewerHolds {
  if (!input.viewerId) return "unknown";
  return input.assignments.some((a) => a.employeeId === input.viewerId)
    ? "yes"
    : "no";
}

/**
 * What to say when somebody cannot act, or null when the answer is not known.
 *
 * Null is deliberately NOT "you may not" — a caller that renders nothing while
 * the viewer resolves is correct, and one that prints this string only ever
 * does so about a viewer it has actually identified.
 */
export function holdsRefusal(
  holds: ViewerHolds,
  refusal: string,
): string | null {
  return holds === "no" ? refusal : null;
}
