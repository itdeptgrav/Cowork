import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminCapabilityGuard } from "@/components/features/admin/AdminCapabilityGuard";
import { adminConsoleAccess } from "@/lib/server/adminAuth";

/**
 * The administration route gate — the half that actually holds.
 *
 * A **server** component, so the decision is made before a byte of `/admin`
 * reaches the browser. This is the answer to "unauthorized dashboard access":
 * the previous guard was a client component, which means the page shipped, ran
 * its queries and then rendered a refusal over data it had already fetched.
 *
 * Middleware cannot do this job. It runs on the Edge with no access to the
 * identity store, so it can verify a signature and nothing more — it does not
 * know the archetype. Here, the archetype has been resolved from whichever
 * sign-in system the request actually used, so it is trustworthy.
 *
 * **This asked `currentSession()` alone, and that made `/admin` unreachable.**
 * That function reads the `cowork_session` cookie, which the Firebase sign-in
 * path — the path every real employee uses — never issues. So the redirect below
 * fired for the chief executive exactly as it fires for a stranger. See
 * `lib/server/adminAuth.ts`; the fix is to ask both systems, not to soften the
 * gate.
 *
 * `notFound()` rather than a refusal page would be defensible too — not
 * confirming that `/admin` exists tells a prober less. `redirect` to the
 * workspace is chosen instead because this is an internal tool where the
 * existence of an admin area is not a secret, and silently 404ing a colleague
 * who mistyped is worse than sending them home.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { identity, mayOpenConsole } = await adminConsoleAccess();

  /* Middleware should have caught this already. Checked again because a gate
     that relies on another gate having run is one refactor away from being no
     gate at all.

     Two refusals, not one: nobody verifiable behind the request is a redirect to
     sign in, while a verified person without the archetype is sent home with a
     reason. Collapsing them would send an ordinary employee to a sign-in form
     they are already past, which reads as a broken product. */
  if (!identity) redirect("/signin?next=/admin");
  if (!mayOpenConsole) redirect("/home?denied=admin");

  return <AdminCapabilityGuard>{children}</AdminCapabilityGuard>;
}
