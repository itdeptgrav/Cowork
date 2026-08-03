/**
 * Editing a list of acceptance criteria.
 *
 * Pure, and separate from the form, because the awkward part is not the typing
 * — it is that the editor identifies a criterion by its POSITION while the list
 * underneath it can change. Removing a row above the one being edited shifts
 * every index below it, and an editor holding a stale number silently rewrites
 * its neighbour. That is a data-loss bug with no error and no visible symptom
 * until somebody reads the task back.
 *
 * So both operations return the next list AND where the editor should now be
 * pointing, together, from one function. Keeping those two facts in step is the
 * whole job.
 *
 * `-1` means "not editing".
 */

export interface CriteriaState {
  list: string[];
  editingIndex: number;
}

/**
 * Write an edit back, or drop the criterion if it has been emptied.
 *
 * A blank criterion is not saved. An acceptance criterion the reviewer cannot
 * judge and the assignee cannot satisfy is worse than no row at all, and
 * somebody who deleted every character of one meant to be rid of it.
 */
export function commitCriterion(
  list: readonly string[],
  index: number,
  draft: string,
): CriteriaState {
  if (index < 0 || index >= list.length) {
    return { list: [...list], editingIndex: -1 };
  }
  const next = draft.trim();
  return {
    list: next
      ? list.map((value, j) => (j === index ? next : value))
      : list.filter((_, j) => j !== index),
    editingIndex: -1,
  };
}

/**
 * Remove a criterion, keeping any open editor pointed at the same line.
 *
 * Three cases, and the third is the one that bites:
 *   · the edited row is the one removed  → close the editor, it has no subject
 *   · a row BELOW it is removed          → indices above are untouched
 *   · a row ABOVE it is removed          → everything shifts down by one, and
 *                                          so must the editor
 */
export function removeCriterion(
  list: readonly string[],
  index: number,
  editingIndex: number,
): CriteriaState {
  if (index < 0 || index >= list.length) {
    return { list: [...list], editingIndex };
  }
  return {
    list: list.filter((_, j) => j !== index),
    editingIndex:
      editingIndex === index
        ? -1
        : editingIndex > index
          ? editingIndex - 1
          : editingIndex,
  };
}

/** Append a criterion, ignoring blank input. Returns the list unchanged if so. */
export function addCriterion(
  list: readonly string[],
  draft: string,
): string[] {
  const next = draft.trim();
  return next ? [...list, next] : [...list];
}
