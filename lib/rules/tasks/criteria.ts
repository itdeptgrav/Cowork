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

/**
 * The acceptance criteria a SUBTASK is created with: what it inherits from the
 * parent, then what was typed for it.
 *
 * ## Why the claimed requirement belongs in the list
 *
 * A subtask claims one of its parent's completion requirements — that claim is
 * the reason it exists, and closing it is the one thing the subtask is
 * definitely for. It was carried only as a link on the parent, so the child was
 * created with just the criteria typed into its own form and its reviewer read
 * a list that never mentioned the work's actual purpose. The person doing it
 * saw two criteria; the thing they were answerable for was a third that
 * appeared nowhere on their task.
 *
 * ## Inherited first
 *
 * It is the requirement the subtask was raised to satisfy, so it is the first
 * thing a reviewer should read. What was typed in the form is additional to it,
 * and follows.
 *
 * Blank entries are dropped and repeats are collapsed case-insensitively:
 * somebody who types the parent's requirement out again meant one criterion,
 * not two identical rows for the reviewer to tick separately. The FIRST
 * spelling of a repeat is the one kept, so the parent's own wording survives.
 */
export function subtaskCriteria(
  inherited: readonly string[],
  typed: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...inherited, ...typed]) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
