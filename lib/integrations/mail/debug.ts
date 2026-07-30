import "server-only";

/**
 * Temporary tracing for the Gmail connection flow.
 *
 * Added while chasing a state inconsistency: Settings reported "Connected"
 * while sending reported "not connected". It logs the two ids that had to
 * match and the status that decided the outcome.
 *
 * **Never logs a token.** The whole point of sealing them is defeated by a log
 * line, and logs travel further than databases. Only ids, an address and a
 * status — enough to tell an id mismatch from a status problem, which are the
 * two things that actually go wrong here.
 *
 * Off unless `MAIL_DEBUG=true`, so turning it on is deliberate and it does not
 * follow anybody into production by accident.
 */
export function mailDebug(scope: string, fields: Record<string, unknown>): void {
  if (process.env.MAIL_DEBUG !== "true") return;
  const safe = Object.fromEntries(
    Object.entries(fields).filter(
      ([k]) => !/token|secret|refresh|access/i.test(k),
    ),
  );
  console.log(`[mail:${scope}]`, JSON.stringify(safe));
}
