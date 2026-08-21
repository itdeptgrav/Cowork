import { legacyFetch } from "./http.ts";
import type { LegacyResult } from "./envelope";

export interface HrEmployee {
  hrId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  biometricId: string;
  phone: string;
  hasCoworkAccount: boolean;
  /**
   * Their `cowork_employees` document id, or null where there is no account.
   *
   * **Not the same thing as `biometricId`, and assuming so would be a bug with
   * somebody else's password in it.** The two usually agree — a biometric id
   * becomes the CoWork id when one exists — but an account provisioned without
   * one is matched by EMAIL and given a generated id. The engine now answers
   * with whichever document it actually matched, so an action taken against an
   * existing account is taken against the right account.
   */
  coworkEmployeeId: string | null;
  /**
   * HR fields this person genuinely has no value for — `[]` when the row is
   * ready to provision.
   *
   * **Not the same as "the panel did not receive one".** HR records one address
   * under either of two fields and fills whichever it was given, so reading
   * only the work `email` reported half the directory as having none; the
   * engine now resolves the personal address too and this names only what is
   * actually absent. An account cannot be created without an email — Firebase
   * Auth is keyed on one — so a non-empty list means the fix is in HR, not
   * here, and the row says so instead of offering a button that gets refused.
   *
   * Optional because the engine deploys separately: an older one answers
   * without the field, and every row then reads as provisionable, which is the
   * behaviour that came before this and not a new failure.
   */
  missingInHr?: string[];
}

export interface HrEmployeeList {
  employees: HrEmployee[];
  departments: string[];
  total: number;
  withAccount: number;
  /** How many listed people HR does not hold enough detail to provision. */
  missingDetails?: number;
}

export interface ProvisionResult {
  employeeId: string;
  tempPassword: string;
  role: string;
  /**
   * Whether the new starter was actually sent their sign-in details.
   *
   * Optional because an older engine does not return it, and `undefined` there
   * means "unknown", not "no" — the panel says nothing rather than claiming a
   * failure that may not have happened. When it is `false` the admin is holding
   * the only remaining copy of the temporary password, so they have to be told.
   */
  emailSent?: boolean;
  emailError?: string | null;
}

/** HR employees from MongoDB, tagged with whether they already have a CoWork account. */
export async function listHrEmployees(input: {
  token: string;
  search?: string;
  department?: string;
}): Promise<LegacyResult<HrEmployeeList>> {
  const query: Record<string, string> = {};
  if (input.search) query.search = input.search;
  if (input.department && input.department !== "all") query.department = input.department;
  return legacyFetch({
    path: "/cowork/admin/hr-employees",
    token: input.token,
    query,
  });
}

/**
 * Set a new password on an existing CoWork account.
 *
 * **What this does at the other end, because it is more than it looks.** The
 * engine writes the password to Firebase Auth, records it as a temporary one
 * (`passwordChanged: false`), **revokes every refresh token the person holds**
 * — so they are signed out of every device within moments — and notifies them
 * in the app, by push and by email. There is no quiet version of this.
 *
 * The id is the `cowork_employees` document id: `HrEmployee.coworkEmployeeId`,
 * never the HR id.
 */
export async function resetCoworkPassword(input: {
  token: string;
  employeeId: string;
  newPassword: string;
}): Promise<LegacyResult<{ message: string }>> {
  return legacyFetch({
    path: `/cowork/employee/${encodeURIComponent(input.employeeId)}/reset-password`,
    method: "POST",
    token: input.token,
    body: { newPassword: input.newPassword },
  });
}

/**
 * Send somebody their sign-in details again.
 *
 * For when the automatic welcome email did not arrive — it bounced, it was
 * filtered, the mail server was switched off that day. Nothing is generated
 * here: it re-sends the temporary password the account already has.
 *
 * The engine refuses once that person has chosen their own password, because
 * from that moment nobody holds it — not this panel, not an administrator, not
 * the engine. It answers with a message naming Reset password as the way
 * forward, which is the one operation that can help.
 */
export async function sendCoworkCredentials(input: {
  token: string;
  employeeId: string;
}): Promise<LegacyResult<{ message: string; emailSent: boolean }>> {
  return legacyFetch({
    path: `/cowork/employee/${encodeURIComponent(input.employeeId)}/send-credentials`,
    method: "POST",
    token: input.token,
  });
}

/**
 * A temporary password somebody can read down a phone line.
 *
 * **No lookalike characters** — no `l1I`, no `0O`. This is typed by hand from a
 * message or read aloud, and a password that cannot be transcribed reliably
 * generates a support request per use. Twelve characters from a 30-symbol
 * alphabet is ~59 bits, which is far beyond what a password living for one
 * sign-in needs.
 *
 * `crypto.getRandomValues`, never `Math.random`: a predictable temporary
 * password is a way into somebody's account, and the modulo bias of a naive
 * mapping is avoided by rejecting the tail of the byte range.
 */
export function generateTempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length);
  const out: string[] = [];
  while (out.length < 12) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue; /* Biased tail — draw again. */
      out.push(alphabet[b % alphabet.length]);
      if (out.length === 12) break;
    }
  }
  /* Split for reading: `grav-7fk2-qp8m` rather than one run of twelve. */
  return `${out.slice(0, 4).join("")}-${out.slice(4, 8).join("")}-${out.slice(8).join("")}`;
}

/** Create a CoWork account for an HR employee. */
export async function provisionCoworkAccount(input: {
  token: string;
  name: string;
  email: string;
  phone?: string;
  department: string;
  role?: "employee" | "tl";
  biometricId?: string;
}): Promise<LegacyResult<ProvisionResult>> {
  return legacyFetch({
    path: "/cowork/employee/create",
    method: "POST",
    token: input.token,
    body: {
      name: input.name,
      email: input.email,
      mobile: input.phone ?? "",
      city: "",
      department: input.department,
      role: input.role ?? "employee",
      employeeId: input.biometricId || undefined,
    },
  });
}
