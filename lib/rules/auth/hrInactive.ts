/**
 * INACTIVE IN HR = NO COWORK  (12 Oct 2026, owner)
 *
 * When HR marks an employee Inactive, the engine switches their Cowork access
 * off: their Firebase login is disabled, their sessions are revoked, and every
 * Cowork request answers 403 with `code: "EMPLOYEE_INACTIVE"`
 * (grav-cms-backend `services/coworkHrAccess.service.js`). Nothing about them
 * is deleted — their record, tasks, messages and history stay, and they stay
 * named on the work they did. Made active in HR again, access comes back.
 *
 * These are the words for it, in one place, so the sign-in screen, the admin
 * panel and the help article say the same thing.
 */

/** The engine's refusal code for somebody HR has made Inactive. */
export const HR_INACTIVE_CODE = "EMPLOYEE_INACTIVE";

/** Shown on the sign-in form when the workspace refused an inactive person. */
export const HR_INACTIVE_SIGN_IN_NOTICE =
  "Your account is inactive in HR, so it can no longer use Cowork. Your work and history are kept. If this is a mistake, contact HR.";

/** Firebase's `auth/user-disabled`: now almost always HR's Inactive. */
export const LOGIN_DISABLED_MESSAGE =
  "This account is switched off — usually because the employee is marked Inactive in HR. Contact HR if that is a mistake.";

/** The admin panel's word for an HR-inactive row. */
export const HR_INACTIVE_ROW_LABEL = "Inactive in HR · no access";

/** Whether an engine refusal is the HR-inactive one. */
export function isHrInactiveRefusal(error: { code?: string } | null | undefined): boolean {
  return error?.code === HR_INACTIVE_CODE;
}

/**
 * Which HR rows the admin panel lists. Active by default: an inactive person
 * cannot be given an account, so the provisioning list is the active ones.
 */
export type HrStatusFilter = "active" | "inactive" | "all";

export function hrStatusQuery(filter: HrStatusFilter): "inactive" | "all" | undefined {
  return filter === "active" ? undefined : filter;
}
