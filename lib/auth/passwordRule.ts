/**
 * The password rule, in a module BOTH sides may import.
 *
 * `lib/server/password.ts` is `server-only` — importing it from a form would
 * fail the build, and rightly: the hashing parameters and the verify path have
 * no business in a browser bundle. But the minimum length is not a secret, and
 * the signup form has to state it before somebody types a short one.
 *
 * So the number lives here and the server imports it too. One constant, so the
 * hint under the field and the rejection from the endpoint can never disagree —
 * which is the failure this split exists to prevent, not a style preference.
 */
export const PASSWORD_MIN_LENGTH = 10;
