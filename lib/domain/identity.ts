/**
 * Identity, roles, permissions and the reporting hierarchy.
 *
 * Roles are DATA, never string literals in code (docs/architecture/MIGRATION_DECISIONS.md D27).
 * Legacy hard-coded `ceo` / `tl` / `employee` and a magic `E000` employee id;
 * docs/architecture/PRODUCT.md:115 forbids hard-coding this organisation's structure.
 *
 * Permission is always (capability × scope), never capability alone — the
 * legacy defect where any TL could see every employee's score came from having
 * capabilities with no scope (docs/specs/PERMISSIONS_AND_ROLES_SPEC.md §4.2).
 */

export type EmployeeId = string;
export type UserId = string;
export type RoleId = string;

export type UserStatus = "active" | "invited" | "suspended" | "deactivated";

export interface User {
  id: UserId;
  email: string;
  displayName: string;
  status: UserStatus;
  /** Opaque handle from whichever identity provider is configured. */
  identityProviderId: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface Employee {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: EmployeeId;
  userId: UserId;
  /** Human-facing code. Not a magic value and never used for authorisation. */
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  initials: string;
  /** Index into the field palette so monograms vary without new colour. */
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  /**
   * Their picture, or null for the monogram.
   *
   * A `data:image/jpeg` URL — a 160px square at quality 0.75, six to twelve
   * kilobytes — carried ON the record rather than behind a second fetch, so an
   * avatar never costs a request. That is the old application's own decision and
   * its own field (`cowork_employees.profilePicUrl`), which it still reads; this
   * is the same picture, not a parallel one.
   *
   * Null is ordinary and permanent for anyone who has not set one. Nothing here
   * generates a face — see `components/ui/Avatar.tsx`.
   */
  profilePictureUrl: string | null;
  /**
   * Work email. The directory address, and the address an invitation goes to.
   *
   * On the EMPLOYEE rather than on `User`, deliberately. `User` is the
   * identity-provider seam and the credential record already exists server-side
   * as `Account` — putting the address on `User` as well would make a third
   * representation of one person, joined by nothing. Here it is an attribute of
   * the worker, alongside their designation and timezone.
   *
   * It is NOT a credential and grants nothing. An account is a separate record
   * with a password behind it; the two meet when somebody is invited, and the
   * address is what they meet on.
   *
   * Nullable because the fixture pre-dates it and a person can exist in the
   * directory before anybody decides they need to sign in.
   */
  email: string | null;
  departmentId: string | null;
  departmentName: string | null;
  designation: string | null;
  roleIds: RoleId[];
  timezone: string;
  workCalendarId: string;
  joinedAt: string;
  exitedAt: string | null;
  /**
   * Whether this person created the organisation.
   *
   * Provenance, NOT hierarchy — it says nothing about who reports to whom, and
   * the reporting tree remains the only answer to that. It exists to separate
   * two states the tree cannot tell apart on its own: an employee with no
   * manager because they are the top of the organisation, and an employee with
   * no manager because nobody has placed them yet.
   *
   * Without the distinction both look identical, which is how somebody gets
   * created unattached and stays invisible to every manager — no team surface
   * reaches them, and no administrator is told they are missing.
   */
  isFounder: boolean;
}

/**
 * A department, as a record rather than a string on a person.
 *
 * Legacy stored `department` as free text on the employee document and resolved
 * "who approves for this department" with an unordered
 * `where(role == "tl").limit(1)` — so a department with two team leads picked
 * an arbitrary one, and could pick a different one on the next call
 * (`taskForward.js:93`). A department needs an identity and a named head before
 * any workflow can route to it deterministically.
 */
export interface Department {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  name: string;
  /**
   * The head of department. This is the "HOD" an approval stage can resolve
   * against — one person, named, or explicitly nobody.
   */
  hodEmployeeId: EmployeeId | null;
  /** Parent department, for organisations with divisions. Null at the top. */
  parentDepartmentId: string | null;
  isActive: boolean;
}

/**
 * The five archetypes from docs/specs/PERMISSIONS_AND_ROLES_SPEC.md §4.1. The archetype
 * drives default capabilities; the role record itself is renameable per
 * organisation.
 */
export type RoleArchetype =
  "employee" | "manager" | "skip_level" | "people_ops" | "system_admin";

export type Capability =
  | "task.view"
  | "task.create"
  | "task.edit"
  | "task.cancel"
  | "task.delete"
  | "task.priority.change"
  | "deadline.propose"
  | "deadline.decide"
  | "deadline.extend"
  | "deadline.extension.decide"
  | "submission.create"
  | "review.decide"
  | "review.rework"
  | "review.second_stage"
  | "score.view"
  | "score.compare"
  | "score.configure"
  | "score.adjust"
  | "conduct.apply"
  | "conduct.review_dispute"
  | "attendance.record"
  | "people.view"
  | "people.create"
  | "people.deactivate"
  | "people.delete"
  | "people.reset_password"
  | "people.change_role"
  | "people.change_reporting"
  | "project.create"
  | "project.edit"
  | "project.manage_members"
  | "project.link_tasks"
  | "project.archive"
  | "group.manage"
  | "meeting.manage"
  | "integration.configure"
  | "notification.broadcast";

/** Who a capability may be exercised against. */
export type Scope = "self" | "direct_reports" | "hierarchy" | "organisation";

export interface Permission {
  id: string;
  capability: Capability;
  scope: Scope;
}

export interface Role {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: RoleId;
  key: string;
  displayName: string;
  archetype: RoleArchetype;
  /**
   * Higher levels can never be targeted by lower ones. This is what makes the
   * legacy defect — a TL resetting the CEO's password — structurally
   * impossible rather than merely discouraged.
   */
  administrativeLevel: number;
  permissions: Permission[];
  isSystem: boolean;
}

/**
 * Time-bounded, so a score computed for a past period stays visible to whoever
 * managed that person *then*. Legacy stored one current manager on the employee
 * document, so a re-org silently rewrote historical visibility.
 */
export interface ReportingRelationship {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  employeeId: EmployeeId;
  managerId: EmployeeId;
  type: "primary" | "secondary" | "dotted";
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: EmployeeId;
  createdAt: string;
}

/** The resolved actor for a request. Carries scope, never bare role strings. */
export interface Viewer {
  employeeId: EmployeeId;
  roles: Role[];
  /** Transitive closure beneath this actor, resolved server-side. */
  hierarchyIds: EmployeeId[];
  directReportIds: EmployeeId[];
  /**
   * Whether anybody manages this actor.
   *
   * Carried on the viewer so a screen can answer "may I reorder my own
   * priority" without fetching the whole reporting table to ask one question
   * about itself. The repository re-derives it on the write regardless — this
   * is what lets the control be absent rather than present and refused.
   */
  hasManager: boolean;
  administrativeLevel: number;
}
