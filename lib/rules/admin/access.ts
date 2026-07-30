import type { RoleArchetype } from "@/lib/domain/identity";

/**
 * Who may open the administration console. One answer, one place.
 *
 * **`system_admin`, and nothing else.**
 *
 * It was `system_admin || people_ops`, and separately the settings repository
 * inferred an administrator from `legacyRole === "ceo"`. Two different
 * definitions of "administrator" in one codebase is one definition too many:
 * whichever is checked first decides, and which one that is depends on whether
 * a request arrived through a page or through a repository call.
 *
 * ## What this costs, deliberately
 *
 * People-ops accounts lose the console. That is the point of the change rather
 * than a side effect — administering the people directory and administering the
 * system are different jobs, and the console now contains an audit log that
 * records role changes. Somebody who can alter roles and also read the log of
 * role alterations can cover one change with another.
 *
 * If people-ops needs the directory back, the answer is a directory surface
 * outside `/admin`, not a second archetype in this predicate.
 *
 * ## No inference
 *
 * Nothing here reads a legacy role string, a capability list or a department.
 * The archetype is resolved once, server-side, when the session is established;
 * everything downstream asks these functions. A predicate that could be
 * satisfied by inference is a predicate with an undocumented second door.
 */

/** May open `/admin` at all. */
export function canAccessAdminConsole(
  user: { archetype?: RoleArchetype | null } | null | undefined,
): boolean {
  return user?.archetype === "system_admin";
}

/**
 * May read the settings audit log.
 *
 * Identical to console access today. Kept separate because the two answer
 * different questions and will not always agree — a read-only auditor is the
 * obvious future case, and splitting a shared predicate at that moment is
 * exactly when a mistake gets made.
 */
export function canViewAuditLogs(
  user: { archetype?: RoleArchetype | null } | null | undefined,
): boolean {
  return user?.archetype === "system_admin";
}

/** May change system configuration — office hours, roles, workflows, scoring. */
export function canModifySettings(
  user: { archetype?: RoleArchetype | null } | null | undefined,
): boolean {
  return user?.archetype === "system_admin";
}

/** The words a refusal uses. Quoted by the API, the UI and the help corpus. */
export const ADMIN_REFUSAL =
  "Only a system administrator can open the admin console.";
export const SETTINGS_REFUSAL =
  "Only a system administrator can change system settings.";
export const AUDIT_REFUSAL =
  "Only a system administrator can read the settings audit log.";
