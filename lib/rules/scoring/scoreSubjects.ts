/**
 * Whose score history a person may open.
 *
 * The old application put an employee picker beside the SOP history so a
 * manager could read a report's record. This is that list — but it is **not a
 * second answer to who may see whose score.** That answer already exists:
 * `score.view`, scoped `self` for an employee, `direct_reports` for a manager,
 * `hierarchy` for skip-level leadership and `organisation` for people-ops and
 * administrators. This module takes the decision as a predicate and only orders
 * and labels the result.
 *
 * Keeping it that way matters more than the small amount of code it saves. A
 * picker that built its own idea of "my team" would be a second place for the
 * reporting line to be interpreted, and the two would eventually disagree —
 * at which point somebody is reading a colleague's conduct record because a
 * list widget was more generous than the permission that governs it.
 */

/** The fields this module needs from an employee record. */
export interface SubjectLike {
  id: string;
  displayName: string;
}

export interface ScoreSubject {
  id: string;
  name: string;
  /** True for the viewer's own row, which is always offered first. */
  isSelf: boolean;
}

/**
 * The people whose history this viewer may open, self first then by name.
 *
 * Self leads the list rather than sorting alphabetically into it: the page
 * opens on the viewer's own history, so the selected entry should be the one
 * at the top rather than somewhere in the middle of their reports.
 *
 * The viewer is included **only if the predicate allows it**. Everybody holds
 * `score.view` over themselves, so in practice they are always there — but
 * granting it here regardless would be this module deciding a permission
 * question, which is the thing it exists not to do.
 */
export function scoreSubjects(input: {
  viewerId: string | null;
  employees: readonly SubjectLike[];
  /** `can("score.view", id)`, passed in rather than reimplemented. */
  canView: (employeeId: string) => boolean;
}): ScoreSubject[] {
  const { viewerId, employees, canView } = input;

  const allowed = employees
    .filter((e) => canView(e.id))
    .map((e) => ({
      id: e.id,
      name: e.displayName?.trim() || e.id,
      isSelf: e.id === viewerId,
    }));

  return allowed.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Whether a picker is worth showing at all.
 *
 * One subject is an employee looking at their own record, and a dropdown with a
 * single entry is a control that cannot do anything — it says "you could be
 * looking at somebody else" to a person who cannot.
 */
export function offersChoice(subjects: readonly ScoreSubject[]): boolean {
  return subjects.length > 1;
}

/**
 * The subject to read, given what is selected.
 *
 * A selection that is no longer permitted falls back to the viewer rather than
 * being honoured. Roles change while a page is open, and a stale id in
 * component state must not be what decides whose conduct record is fetched.
 */
export function resolveSubject(input: {
  selectedId: string | null;
  viewerId: string | null;
  subjects: readonly ScoreSubject[];
}): string | null {
  const { selectedId, viewerId, subjects } = input;
  if (selectedId && subjects.some((s) => s.id === selectedId)) return selectedId;
  return viewerId;
}
