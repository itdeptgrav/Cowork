import { LegacyHealth } from "@/components/features/legacy/LegacyHealth";

export const metadata = { title: "Connection — Cowork" };

/**
 * Migration tooling. Not a product surface.
 *
 * **No provider and no sign-in form of its own.** It carried both until now: a
 * second `LegacySessionProvider` resolving Firebase independently of the app's
 * session, and a duplicate email/password form beside the real `/signin`. That
 * was two auth systems and two sign-in surfaces for one person, and it is why
 * this page still read "not signed in" after the app had signed in — the two
 * resolved on different schedules and neither knew about the other.
 *
 * `ShellFrame` already mounts the application's `SessionProvider` for this
 * route. `LegacyHealth` reads it, and sends anybody who is not signed in to
 * `/signin` rather than offering its own way in.
 *
 * The original reason for the separate provider — that a diagnostics page must
 * render when Firebase itself cannot initialise — still holds, and is still
 * satisfied: `LegacyHealth` renders its checks without consuming any session.
 * Only the *signed-in* line needs one, and that line is allowed to be absent.
 */
export default function Page() {
  return <LegacyHealth />;
}
