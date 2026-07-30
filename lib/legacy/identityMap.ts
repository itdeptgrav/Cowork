/**
 * The join between who signs in and where they sit in the org.
 *
 * ## Four identities, three stores
 *
 * ```
 * Firebase auth user   (uid, email)          — Firebase
 *        ↓  /cowork/me
 * Cowork employee      (employeeId, role)    — Firestore cowork_employees
 *        ↓  employeeId === biometricId
 * HR employee          (biometricId)         — MongoDB Employee
 *        ↓  primaryManager.managerId
 * Hierarchy node                             — derived
 * ```
 *
 * The second join is a **string equality on two independently-maintained
 * records**. It now holds for all 17 Cowork employees.
 *
 * ## The break, and how it was closed
 *
 * It did not always hold. Until 2026-07-29 the CEO was two records sharing no
 * key: `GR0000` in HR with eight people reporting to it and no Cowork record,
 * and `E000` in Cowork carrying the login and reported to by nobody. Signing in
 * resolved to `E000`, so the CEO's team was empty while eight people reported
 * to a record the Cowork directory had never heard of.
 *
 * `E000` was never a person. `Middlewear/coworkAuth.js:51` creates it as a
 * catch-all for any authenticated Firebase user it cannot match by `authUid` or
 * `email` — and the CEO fell into it, because `GR0000` had no Cowork record and
 * its HR record carries no email to match on.
 *
 * **Fixed in the data, not in code.** `cowork_employees/GR0000` was created
 * with the CEO's Firebase uid and `E000`'s `authUid` removed, so the login now
 * resolves to the identity the org already reports to. `E000` remains — it is
 * the hardcoded default cross-department approver and the historical record for
 * ~130 references across 14 collections — but it is no longer a login.
 *
 * ## The residual risk, stated
 *
 * **`E000` and `GR0000` both carry `email: "ray@grav.in"`.** The middleware
 * falls back to `where("email","==",…).limit(1)` when the `authUid` lookup
 * misses (`coworkAuth.js:43`), and that query is unordered. It cannot fire
 * today because `GR0000` matches on `authUid` first — but if that uid were ever
 * lost or rotated, the email fallback becomes a coin flip between the two
 * documents, and line 67 would re-stamp whichever it found. Clearing or
 * changing `E000.email` would close it; that was out of scope for a migration
 * asked to touch login binding only.
 */

/**
 * Cowork `employeeId` → HR `biometricId`, where they differ.
 *
 * Empty is the healthy state. Every entry is a record of two stores disagreeing
 * about one person.
 */
export const IDENTITY_ALIASES: Readonly<Record<string, string>> = {
  /* **Empty, and that is the healthy state.**
   *
   * It held `E000 -> GR0000` until 2026-07-29, when the underlying data was
   * fixed instead: `cowork_employees/GR0000` was created carrying the CEO's
   * Firebase uid, and `E000`'s `authUid` was removed. The human now signs in
   * as the identity eight people already report to, so nothing needs
   * translating.
   *
   * `E000` still exists and is referenced ~130 times across 14 collections —
   * it is the hardcoded default cross-department approver and the historical
   * record. It is simply no longer a login.
   *
   * Keep this table empty. An entry here means two stores disagree about one
   * person, and the fix belongs in the stores. */
};
/**
 * The id to resolve hierarchy against.
 *
 * Everyone who is consistent maps to themselves, so this is the identity
 * function for 15 of 16 people and a lookup for one.
 */
export function toHierarchyId(employeeId: string): string {
  return IDENTITY_ALIASES[employeeId] ?? employeeId;
}

/** The Cowork ids that alias onto a given hierarchy id. Usually none. */
export function fromHierarchyId(hierarchyId: string): string[] {
  return Object.entries(IDENTITY_ALIASES)
    .filter(([, hr]) => hr === hierarchyId)
    .map(([cowork]) => cowork);
}

export type IdentityProblem =
  | { kind: "no_hierarchy_node"; employeeId: string; hierarchyId: string }
  | { kind: "no_manager"; employeeId: string; hierarchyId: string };

/**
 * Whether this person's identities line up.
 *
 * Returns a **problem, not a boolean**, because the two failures need different
 * words on screen and lead to different fixes:
 *
 * · `no_hierarchy_node` — signed in, but nothing in the reporting tree
 *   corresponds. This is the E000 case, and it is why a team can be empty while
 *   the person plainly has reports. It must never render as "you have no
 *   reports", which is a statement about the org rather than about a broken
 *   join.
 * · `no_manager` — a real node with nobody above it. Correct for the person at
 *   the top, a data gap for anyone else.
 *
 * Both are reported rather than repaired. Guessing a manager is exactly the
 * thing that must not happen — receiving somebody is a decision, not a default.
 */
export function checkIdentity(input: {
  employeeId: string;
  knownHierarchyIds: ReadonlySet<string>;
  managerOf: (hierarchyId: string) => string | null;
}): IdentityProblem | null {
  const hierarchyId = toHierarchyId(input.employeeId);

  if (!input.knownHierarchyIds.has(hierarchyId)) {
    return { kind: "no_hierarchy_node", employeeId: input.employeeId, hierarchyId };
  }
  if (input.managerOf(hierarchyId) === null) {
    return { kind: "no_manager", employeeId: input.employeeId, hierarchyId };
  }
  return null;
}

/**
 * What to show somebody whose identity does not resolve.
 *
 * Names the ids, because whoever can act on this needs them and the person
 * reading it can quote them. Vague is worse than technical here: "something
 * went wrong" sends somebody to support, "E000 has no record in the reporting
 * hierarchy" sends them to whoever maintains it.
 */
export function describeIdentityProblem(problem: IdentityProblem): string {
  switch (problem.kind) {
    case "no_hierarchy_node":
      return `Your account (${problem.employeeId}) has no record in the reporting hierarchy${
        problem.hierarchyId !== problem.employeeId
          ? `, and neither does ${problem.hierarchyId}, which it is mapped to`
          : ""
      }. Team and approvals cannot be resolved until somebody places you in it. This is not the same as having no reports.`;
    case "no_manager":
      return `Your account (${problem.employeeId}) is in the reporting hierarchy but has nobody above it. That is expected at the top of the organisation and a gap anywhere else.`;
  }
}
