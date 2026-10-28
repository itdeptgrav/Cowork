/**
 * WHY THE WORKSPACE SAID NO TO A CORRECT PASSWORD  (21 Oct 2026)
 *
 * Signing in is two steps. Firebase checks the password; then `/cowork/me`
 * asks the engine which employee that Firebase user is. When the second step
 * refuses, the person has already typed a correct password — so the sentence
 * they land back on the form with has to say which of these it was, because
 * each sends them somewhere different:
 *
 *   · 403, `EMPLOYEE_INACTIVE` — HR has switched them off (`hrInactive.ts`).
 *   · 403, anything else — the engine knows the token and has no employee for
 *     it: genuinely not registered here.
 *   · 401 — the engine could not VERIFY the token at all, so it never got as
 *     far as asking who the person is. This used to be reported as "not
 *     registered", which is how a correctly-provisioned employee was told to go
 *     and get themselves added: cowork.grav.in signs people in to Firebase
 *     project grav-cms-38f45 and asked an engine configured for another
 *     project, which refuses every token with `incorrect "aud"`. That is the
 *     server's configuration, never the person's account, and the sentence now
 *     says so.
 */

import { isHrInactiveRefusal } from "./hrInactive";

/** The engine's code for a token minted by a different Firebase project. */
export const TOKEN_PROJECT_MISMATCH_CODE = "TOKEN_PROJECT_MISMATCH";

export type SignInRefusal = "refused" | "inactive" | "unverified" | "misconfigured";

/** The engine answered: this person is not an employee of this workspace. */
export const NOT_REGISTERED_SIGN_IN_NOTICE =
  "That account signed in, but it is not registered as an employee of this workspace. Ask an administrator to add it, or sign in with your work account.";

/** The engine could not verify the sign-in token. */
export const UNVERIFIED_SIGN_IN_NOTICE =
  "Your password was accepted, but the workspace server could not confirm the sign-in. Try again in a moment; if it keeps happening, tell an administrator.";

/** The engine is set up for a different Firebase project than this site. */
export const MISCONFIGURED_SIGN_IN_NOTICE =
  "Your password was accepted, but the workspace server is connected to a different sign-in project from this site, so it cannot confirm anyone's sign-in. Nothing is wrong with your account — tell an administrator.";

/**
 * Firebase's `auth/invalid-credential`: a wrong email or password.
 *
 * It used to say "your password may still be your mobile number". No Cowork
 * account starts with that: the engine generates the temporary password, or an
 * administrator types one, and it arrives in the welcome email. The hint sent
 * people to type a password that could never work.
 */
export const INVALID_CREDENTIAL_MESSAGE =
  "Those details do not match an account. If you have not signed in before, use the temporary password from your welcome email — or reset it with Forgot your password?";

/**
 * Which refusal an `auth` (401) or `permission` (403) answer from `/cowork/me`
 * is. The message is read as well as the code so an engine deployed before the
 * code existed is still diagnosed correctly.
 */
export function signInRefusal(error: {
  kind: string;
  code?: string;
  message?: string;
}): SignInRefusal {
  if (error.kind === "permission") return isHrInactiveRefusal(error) ? "inactive" : "refused";
  if (
    error.code === TOKEN_PROJECT_MISMATCH_CODE ||
    /incorrect "(aud|iss)"/.test(error.message ?? "")
  ) {
    return "misconfigured";
  }
  return "unverified";
}
