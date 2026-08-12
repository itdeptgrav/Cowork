import type { Role, RoleId } from "@/lib/domain";

/**
 * The five system roles, as one table.
 *
 * `can()` decides from `(capability, scope, actor, target)` and reads its
 * capabilities off the viewer's roles. Roles are data — but data has to come
 * from somewhere, and the legacy engine has no role entity to read: it stores
 * three strings on `cowork_employees.role` and compares them inline
 * (`coworkAuth.js:78-80`). So the table lives here, in code, as the seed of a
 * store that does not exist yet.
 *
 * **This is the whole of the permission model's data, and it used to be
 * nowhere.** `listRoles()` returned `[]` against the legacy backend, which made
 * `can()` deny every capability to everybody: the chief executive was shown
 * "your roles do not include" in place of the administration area, the workload
 * tab filtered every colleague out of its own list, and priority reordering was
 * inert. None of that was a permission decision — it was the absence of one.
 *
 * The grants follow docs/specs/PERMISSIONS_AND_ROLES_SPEC.md §4.3, deliberately, and
 * that is stricter than legacy in three places §4.4 names as defects: anyone
 * could approve a completion, anyone could change a priority, anyone could
 * counter-propose a deadline. Those controls are now absent for people the
 * engine would still accept the write from. See `SPEC_STRICTER_THAN_LEGACY`.
 *
 * Marked `isSystem`, because nothing here is editable through the role editor
 * while the legacy engine is the backend — there is no store to write to. The
 * editor says so rather than offering a control that silently does nothing.
 */

/* The ids are stable and referenced from fixtures and tests. Renaming one is a
   data migration, not a rename. */
export const ROLE_EMPLOYEE = "role-employee" as RoleId;
export const ROLE_MANAGER = "role-manager" as RoleId;
export const ROLE_SKIP = "role-skip" as RoleId;
export const ROLE_PEOPLE_OPS = "role-people-ops" as RoleId;
export const ROLE_ADMIN = "role-admin" as RoleId;

/**
 * The administrative ladder.
 *
 * Gaps between the rungs on purpose: an organisation inserting a role between
 * manager and senior manager should not have to renumber the ones either side
 * of it. The absolute values mean nothing; only the order does.
 */
const LEVEL = {
  employee: 10,
  manager: 30,
  skip: 50,
  peopleOps: 60,
  admin: 100,
} as const;

/**
 * Every system role, stamped with a tenant.
 *
 * A function of `organisationId` rather than a constant because the same table
 * serves the legacy tenant and the seed tenant, and a role record carries the
 * tenant it belongs to. Returns fresh objects per call so a caller mutating one
 * cannot rewrite another tenant's permissions.
 */
export function systemRoles(organisationId: string): Role[] {
  return [
    {
      organisationId,
      id: ROLE_EMPLOYEE,
      key: "employee",
      displayName: "Employee",
      archetype: "employee",
      administrativeLevel: LEVEL.employee,
      isSystem: true,
      permissions: [
        { id: "p1", capability: "task.view", scope: "self" },
        /* Organisation, matching legacy: `/task/create` restricted assignment to
           nobody, and work handed upward or across a boundary was gated by an
           approval rather than refused. Narrowing this to `self` — as §4.3
           proposes — made the product stricter than the system it replaces, and
           produced "You can only create task for yourself" against a picker
           that had just offered the person.

           **The one place the spec is deliberately not followed**, because a
           later owner decision overrides it: assignment is consent, not
           permission, and `lib/auth/assignment.ts` holds the work with an
           approval gate instead of refusing it. Still data: narrow it in the
           role editor and both the picker and the write follow. */
        { id: "p2", capability: "task.create", scope: "organisation" },
        { id: "p3", capability: "task.priority.change", scope: "self" },
        { id: "p4", capability: "deadline.propose", scope: "self" },
        { id: "p5", capability: "deadline.extend", scope: "self" },
        { id: "p6", capability: "submission.create", scope: "self" },
        { id: "p7", capability: "score.view", scope: "self" },
        { id: "p8", capability: "people.view", scope: "organisation" },
        { id: "p10", capability: "meeting.manage", scope: "self" },
      ],
    },
    {
      organisationId,
      id: ROLE_MANAGER,
      key: "manager",
      displayName: "Manager",
      archetype: "manager",
      administrativeLevel: LEVEL.manager,
      isSystem: true,
      permissions: [
        { id: "m1", capability: "task.view", scope: "direct_reports" },
        /* Same reason as the employee grant above — legacy placed no ceiling on
           who a team lead could assign to either. */
        { id: "m2", capability: "task.create", scope: "organisation" },
        { id: "m3", capability: "task.edit", scope: "direct_reports" },
        { id: "m4", capability: "task.cancel", scope: "direct_reports" },
        { id: "m5", capability: "task.priority.change", scope: "direct_reports" },
        { id: "m7", capability: "deadline.decide", scope: "direct_reports" },
        {
          id: "m8",
          capability: "deadline.extension.decide",
          scope: "direct_reports",
        },
        { id: "m9", capability: "review.decide", scope: "direct_reports" },
        { id: "m10", capability: "review.rework", scope: "direct_reports" },
        { id: "m11", capability: "score.view", scope: "direct_reports" },
        { id: "m12", capability: "score.compare", scope: "direct_reports" },
        { id: "m13", capability: "project.create", scope: "direct_reports" },
        { id: "m14", capability: "project.edit", scope: "direct_reports" },
        {
          id: "m15",
          capability: "project.manage_members",
          scope: "direct_reports",
        },
        { id: "m16", capability: "project.link_tasks", scope: "direct_reports" },
        { id: "m17", capability: "group.manage", scope: "direct_reports" },
        /* A manager records attendance for their own reports only — never their
           own day, which the scope naturally forbids since nobody reports to
           themselves. */
        { id: "m18", capability: "attendance.record", scope: "direct_reports" },
        /* C3 · conduct.
         *
         * **A breach is applied by the employee's own manager**, and the same
         * person settles a dispute about it. Neither grant existed: `conduct.apply`
         * was held only by People Operations and administrators, so the person
         * who actually witnesses the conduct could not record it, and every
         * deduction had to be routed through somebody with no view of the work.
         *
         * `direct_reports` rather than `hierarchy` deliberately. A skip-level
         * manager reviewing a dispute is a second opinion from further away;
         * charging somebody two levels down is not, and the engine refuses it
         * anyway — `_mayDecideFor` asks for the primary manager exactly. */
        { id: "m19", capability: "conduct.apply", scope: "direct_reports" },
        {
          id: "m20",
          capability: "conduct.review_dispute",
          scope: "direct_reports",
        },
      ],
    },
    {
      organisationId,
      id: ROLE_SKIP,
      key: "skip_level",
      displayName: "Senior Manager",
      archetype: "skip_level",
      administrativeLevel: LEVEL.skip,
      isSystem: true,
      permissions: [
        { id: "s1", capability: "task.view", scope: "hierarchy" },
        { id: "s2", capability: "review.second_stage", scope: "hierarchy" },
        { id: "s3", capability: "score.view", scope: "hierarchy" },
        { id: "s4", capability: "score.compare", scope: "hierarchy" },
        { id: "s5", capability: "task.delete", scope: "hierarchy" },
        { id: "s6", capability: "project.archive", scope: "hierarchy" },
        { id: "s7", capability: "conduct.review_dispute", scope: "hierarchy" },
      ],
    },
    {
      organisationId,
      id: ROLE_PEOPLE_OPS,
      key: "people_ops",
      displayName: "People Operations",
      archetype: "people_ops",
      administrativeLevel: LEVEL.peopleOps,
      isSystem: true,
      permissions: [
        { id: "o1", capability: "people.view", scope: "organisation" },
        { id: "o2", capability: "people.create", scope: "organisation" },
        { id: "o3", capability: "people.deactivate", scope: "organisation" },
        {
          id: "o4",
          capability: "people.change_reporting",
          scope: "organisation",
        },
        { id: "o5", capability: "score.view", scope: "organisation" },
        { id: "o6", capability: "score.compare", scope: "organisation" },
        { id: "o7", capability: "conduct.apply", scope: "organisation" },
        { id: "o8", capability: "conduct.review_dispute", scope: "organisation" },
        { id: "o9", capability: "people.reset_password", scope: "organisation" },
        { id: "o10", capability: "attendance.record", scope: "organisation" },
      ],
    },
    {
      organisationId,
      id: ROLE_ADMIN,
      key: "system_admin",
      displayName: "System Administrator",
      archetype: "system_admin",
      administrativeLevel: LEVEL.admin,
      isSystem: true,
      permissions: [
        { id: "a1", capability: "score.configure", scope: "organisation" },
        { id: "a2", capability: "people.change_role", scope: "organisation" },
        /* docs/specs/PERMISSIONS_AND_ROLES_SPEC.md §4.3 grants the system administrator
           organisation scope on the reporting line and the directory. Both were
           missing, which left the only role that can edit roles unable to edit
           the org chart those roles resolve against. */
        {
          id: "a6",
          capability: "people.change_reporting",
          scope: "organisation",
        },
        { id: "a7", capability: "people.view", scope: "organisation" },
        /* The owner's full set: manage every setting, see every dashboard, and
           act on anyone — the administrative floor still prevents acting on an
           equal or higher level, which for the top level means only themselves. */
        { id: "a8", capability: "people.create", scope: "organisation" },
        { id: "a9", capability: "people.deactivate", scope: "organisation" },
        { id: "a10", capability: "people.reset_password", scope: "organisation" },
        { id: "a11", capability: "score.view", scope: "organisation" },
        { id: "a12", capability: "score.compare", scope: "organisation" },
        { id: "a13", capability: "score.adjust", scope: "organisation" },
        { id: "a14", capability: "conduct.apply", scope: "organisation" },
        {
          id: "a15",
          capability: "conduct.review_dispute",
          scope: "organisation",
        },
        { id: "a16", capability: "task.view", scope: "organisation" },
        { id: "a17", capability: "task.create", scope: "organisation" },
        { id: "a18", capability: "task.edit", scope: "organisation" },
        { id: "a19", capability: "task.cancel", scope: "organisation" },
        { id: "a20", capability: "task.delete", scope: "organisation" },
        { id: "a21", capability: "task.priority.change", scope: "organisation" },
        { id: "a22", capability: "project.create", scope: "organisation" },
        { id: "a23", capability: "project.archive", scope: "organisation" },
        { id: "a24", capability: "meeting.manage", scope: "organisation" },
        { id: "a25", capability: "group.manage", scope: "organisation" },
        { id: "a3", capability: "people.delete", scope: "organisation" },
        { id: "a4", capability: "integration.configure", scope: "organisation" },
        { id: "a5", capability: "notification.broadcast", scope: "organisation" },
        { id: "a26", capability: "attendance.record", scope: "organisation" },
      ],
    },
  ];
}

/**
 * Where the table above refuses something the legacy engine allows.
 *
 * Recorded rather than merely commented, because each one is a control that
 * disappears from a screen for somebody whose write the engine would still
 * accept. §4.4 classifies all three as legacy defects — the point of following
 * the spec is that they stop being reachable from this product — but a person
 * who used the old app will experience it as a button that has gone, and
 * whoever fields that question should be able to find the reason in one search.
 */
export const SPEC_STRICTER_THAN_LEGACY: {
  what: string;
  legacy: string;
  now: string;
}[] = [
  {
    what: "review.decide",
    legacy: "`review-completion` has no check at all — anyone signed in could approve any completion (P1).",
    now: "The assignee's manager, and above.",
  },
  {
    what: "task.priority.change",
    legacy: "Priority was a client-side Firestore write with no check and no audit (P6).",
    now: "Your own tasks, or a direct report's.",
  },
  {
    what: "deadline.decide",
    legacy: "Counter-proposing a deadline had no role check — any authenticated user could counter anyone's.",
    now: "The manager deciding on a direct report's proposal.",
  },
];

/**
 * Which system roles somebody holds, given what legacy knows about them.
 *
 * Two facts, two sources, and keeping them apart is the point:
 *
 * · **Reach comes from the reporting tree.** Anyone with a direct report holds
 *   the manager role, whatever their title says, because every manager grant is
 *   `direct_reports`-scoped and therefore self-limiting — the role reaches
 *   exactly the people who actually report to you, and nobody if that is
 *   nobody. `tl` is included as well so a team lead between assignments keeps
 *   their surfaces rather than losing them the day their last report moves.
 *
 * · **Standing comes from the role string.** `administrativeLevel` decides who
 *   may act on whom and which assignments need consent from above, and legacy
 *   records it in exactly one place: `cowork_employees.role`. Acquiring a report
 *   must not raise your standing over your colleagues — that is a promotion,
 *   and it is not this product's to grant.
 *
 * The fallthrough matches `archetypeForLegacyRole`: an unrecognised role is an
 * employee. A mapping that guessed upward would grant access the engine then
 * refuses, which reads as a broken product and reviews as a privilege bug.
 */
export function systemRoleIdsFor(input: {
  legacyRole: unknown;
  hasDirectReports: boolean;
}): RoleId[] {
  const ids: RoleId[] = [ROLE_EMPLOYEE];
  if (input.hasDirectReports || input.legacyRole === "tl") ids.push(ROLE_MANAGER);
  if (input.legacyRole === "ceo") ids.push(ROLE_ADMIN);
  return ids;
}

/**
 * Standing, from the role string alone.
 *
 * Deliberately NOT `max(level of every role held)` — that would let the tree
 * raise it, and a viewer whose level disagreed with the level `usePermissions`
 * computes for the same person from the directory would make the administrative
 * floor and the upward-assignment gate answer differently about one employee.
 */
export function administrativeLevelForLegacyRole(role: unknown): number {
  if (role === "ceo") return LEVEL.admin;
  if (role === "tl") return LEVEL.manager;
  return LEVEL.employee;
}

/**
 * The roles held, resolved.
 *
 * A convenience over `systemRoleIdsFor` for callers that need the records
 * rather than the ids — `Viewer.roles` is `Role[]`, and `can()` intersects it
 * with `listRoles()` by id, so the two have to be the same table.
 */
export function systemRolesFor(input: {
  organisationId: string;
  legacyRole: unknown;
  hasDirectReports: boolean;
}): Role[] {
  const held = new Set<string>(systemRoleIdsFor(input));
  return systemRoles(input.organisationId).filter((r) => held.has(r.id));
}

/** The ids only, for an `Employee.roleIds` field. */
export function directoryRoleIdsFor(legacyRole: unknown): RoleId[] {
  /* No tree here on purpose: the directory is read without paying for the N
     `my-managers` calls a tree costs, and `Employee.roleIds` feeds `levelOf`,
     which is standing rather than reach. */
  return systemRoleIdsFor({ legacyRole, hasDirectReports: false });
}
