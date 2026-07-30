import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";
import { type LegacyRole, readRole } from "./permissions.ts";
import { type BiometricId, biometricId } from "./wire.ts";

/**
 * Who the signed-in person is, according to the legacy engine.
 *
 * **Legacy authentication is not replaced, and this module does not attempt to.**
 * It consumes the identity the engine already issues. The new project's own
 * scrypt session in `lib/server/` stays exactly where it is and keeps serving
 * the surfaces that do not touch legacy.
 *
 * ## Three identities, one person
 *
 * ```
 *   Firebase Auth uid
 *        │  (cowork_employees.authUid, with a fallback match on email)
 *        ▼
 *   cowork_employees.employeeId          ← Firestore. Role lives here.
 *        │  (string equality — no constraint enforces it)
 *        ▼
 *   Employee.biometricId                 ← MongoDB. HR, hierarchy, SOP ledger.
 * ```
 *
 * The third link **can be missing**. `/cowork/employee/my-managers/:employeeId`
 * answers `{ success: true, primaryManager: null, message: "Employee not found
 * in HR system" }` for somebody who exists in Cowork but not in HR — and it
 * reports that as a success, because from Cowork's point of view it is one.
 * Any screen showing HR data has to treat "no HR record" as a real state rather
 * than an error or an empty result.
 *
 * `Employee.employeeId` is a Mongoose virtual and is **not queryable**; every
 * HR lookup goes by `biometricId`. The `BiometricId` brand exists to make that
 * unmissable at each call site.
 */

/** `GET /cowork/me`, verbatim. */
export interface LegacyMe {
  authUid: string;
  employeeId: string;
  role: string;
  name: string;
  /** Present only while the temporary password is still in force. */
  tempPassword: string | null;
  passwordChanged: boolean;
}

/** The identity the new UI works with. */
export interface LegacyIdentity {
  authUid: string;
  /** The Cowork employee id, which is also the HR `biometricId`. */
  employeeId: BiometricId;
  name: string;
  role: LegacyRole;
  /**
   * Whether legacy is forcing a password change.
   *
   * `passwordChanged === false` means the person is still on the temporary
   * password the engine generated. Legacy blocks the app until it is changed,
   * and the new UI must do the same or it will let somebody work in a state the
   * engine considers incomplete.
   */
  mustChangePassword: boolean;
}

export function readIdentity(me: LegacyMe): LegacyIdentity {
  return {
    authUid: me.authUid,
    employeeId: biometricId(me.employeeId),
    name: me.name,
    role: readRole(me.role),
    mustChangePassword: me.passwordChanged === false,
  };
}

/**
 * The signed-in person, from the engine.
 *
 * `GET /cowork/me` is the session bootstrap: it is what turns a Firebase token
 * into an employee id and a role. Nothing else in the adapter may derive a role
 * from anywhere but here — a role read from a cached document or a custom claim
 * is a role that can disagree with the one the engine enforces.
 */
export async function fetchIdentity(
  token: string,
): Promise<LegacyResult<LegacyIdentity>> {
  const result = await legacyFetch<LegacyMe>({ path: "/cowork/me", token });
  return result.ok
    ? { ok: true, data: readIdentity(result.data) }
    : result;
}

/**
 * Change the signed-in person's password.
 *
 * The only way out of `mustChangePassword`.
 */
export async function changePassword(input: {
  token: string;
  currentPassword: string;
  newPassword: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: "/cowork/change-password",
    method: "POST",
    token: input.token,
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    },
  });
}

/**
 * How long a role change takes to take effect, in milliseconds.
 *
 * `verifyCoworkToken` caches the employee record **per server process for five
 * minutes** and the employee-update paths never call `invalidateEmployeeCache`.
 * So a promotion, a demotion or a deactivation is not reliably in force until
 * the cache expires — and, with more than one server process, different requests
 * can disagree for that whole window.
 *
 * Exported because a UI that changes somebody's role has to say so. Silently
 * showing the new role while the engine still enforces the old one produces a
 * support conversation nobody can resolve.
 */
export const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;

export const ROLE_CHANGE_NOTICE =
  "Role changes take up to five minutes to take effect everywhere.";
