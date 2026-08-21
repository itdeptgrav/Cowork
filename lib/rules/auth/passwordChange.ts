/**
 * What makes a password change acceptable, before anything is sent.
 *
 * Pure, so the same rules can be asserted in a test without a browser, a
 * Firebase session or a running engine. The engine checks these again — this
 * module is here so somebody gets told what is wrong while they are still
 * looking at the field, not after a round trip that also revoked their session.
 *
 * ## The minimum is six, and that is not an oversight
 *
 * Six is what `POST /cowork/change-password` enforces and what the admin-side
 * Reset password dialog offers. A stricter rule here would refuse passwords the
 * engine accepts, and — worse — would disagree with the number the help
 * corpus quotes to people. One rule, three places, one number.
 *
 * Raising it is a product decision, not a local one: it belongs in the engine
 * first, with the help text and the admin dialog moving in the same change.
 *
 * ## It is NOT the same rule as `PASSWORD_MIN_LENGTH`, which is ten
 *
 * `lib/auth/passwordRule.ts` exports `PASSWORD_MIN_LENGTH = 10`. That is a
 * different password on a different system: the scrypt account this repository
 * hashes itself, used by signup and the emailed reset link. This module governs
 * the **Firebase** password an employee signs into Cowork with, which the legacy
 * engine owns and enforces at six.
 *
 * The two coexist deliberately — see the note on `signIn` in
 * `lib/legacy/firebase.ts`. Do not import one for the other, and do not
 * "reconcile" them to a single number: they gate different credentials, and
 * making this ten would silently refuse passwords the engine accepts, including
 * the ones already in use.
 */

/** The shortest password the Cowork engine will accept. */
export const MIN_PASSWORD_LENGTH = 6;

/** Which field a problem belongs to, so the message lands under the right box. */
export type PasswordField = "current" | "next" | "confirm";

export interface PasswordProblem {
  field: PasswordField;
  message: string;
}

export interface PasswordChangeInput {
  current: string;
  next: string;
  confirm: string;
}

/**
 * Every problem with a proposed change, in field order.
 *
 * Returns ALL of them rather than the first. Revealing one problem at a time
 * turns a three-field form into three round trips of the same frustration —
 * fix the length, learn the confirmation does not match, fix that, learn it
 * matches the old one.
 *
 * Empty array means it is worth sending. It does not mean the current password
 * is correct: nothing here can know that, and only Firebase can say.
 */
export function passwordChangeProblems(
  input: PasswordChangeInput,
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];

  if (input.current.length === 0)
    problems.push({
      field: "current",
      message: "Enter your current password.",
    });

  if (input.next.length === 0) {
    problems.push({ field: "next", message: "Enter a new password." });
  } else if (input.next.length < MIN_PASSWORD_LENGTH) {
    problems.push({
      field: "next",
      message: `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  } else if (input.next === input.current) {
    /* Only once it is otherwise valid: telling somebody who has typed two
       characters that they match their current password is noise, and it
       also confirms the first two characters of their existing password to
       anybody reading over their shoulder. */
    problems.push({
      field: "next",
      message: "Your new password must be different from your current one.",
    });
  }

  /* Silent while they are still typing the confirmation — a mismatch warning
     that appears on the first keystroke and stays until the last is not a
     warning, it is decoration. It speaks once there is something to compare. */
  if (input.confirm.length > 0 && input.confirm !== input.next)
    problems.push({
      field: "confirm",
      message: "This does not match your new password.",
    });

  return problems;
}

/**
 * Whether the form may be submitted.
 *
 * Stricter than "no problems": the confirmation must be non-empty, which
 * `passwordChangeProblems` deliberately does not complain about while it is
 * still being typed. An empty confirmation is not an error to show, but it is
 * not consent to submit either.
 */
export function canSubmitPasswordChange(input: PasswordChangeInput): boolean {
  return (
    input.confirm.length > 0 && passwordChangeProblems(input).length === 0
  );
}

/**
 * The message for a field, or null.
 *
 * A convenience for the component, kept here so the "first problem wins per
 * field" rule is testable rather than being an accident of JSX ordering.
 */
export function problemFor(
  problems: PasswordProblem[],
  field: PasswordField,
): string | null {
  return problems.find((p) => p.field === field)?.message ?? null;
}
