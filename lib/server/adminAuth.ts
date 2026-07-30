import "server-only";
import { cookies } from "next/headers";
import { currentSession } from "./session";
import { FIREBASE_COOKIE } from "@/lib/auth/firebaseCookie";
import { verifyIdToken } from "@/lib/auth/firebaseToken";
import { archetypeForLegacyRole } from "@/lib/auth/roleMap";
import { fetchIdentity } from "@/lib/legacy/auth";
import {
  canAccessAdminConsole,
  canModifySettings,
  canViewAuditLogs,
} from "@/lib/rules/admin/access";
import type { RoleArchetype } from "@/lib/domain/identity";

/**
 * Who is administering, resolved on the SERVER, across both sign-in systems.
 *
 * ## The bug this closes
 *
 * `app/admin/layout.tsx` asked `currentSession()`, which reads the
 * `cowork_session` cookie and nothing else. `SignInForm` signs in through
 * Firebase and writes only the Firebase cookie — **nothing on that path ever
 * issues `cowork_session`.** So the layout's `if (!session) redirect("/signin")`
 * fired for every actual employee, including the chief executive, and
 * **`/admin` was unreachable in production.**
 *
 * The 307 observed for an unauthenticated request was read as proof the guard
 * worked. It was: it also fired for the one person who is supposed to get in.
 * This is the same identity/workspace seam as the LiveKit and directory 401s —
 * a route that knows one of the two systems is a route closed to half the
 * company, and here that half was the half that matters.
 *
 * ## How the archetype is resolved
 *
 * Same order, same sources, same mapping the client already uses — moved to
 * where the gate is rather than duplicated:
 *
 *  1. `cowork_session`, if present. It carries the archetype on the account
 *     record, so nothing further is needed.
 *  2. Otherwise the Firebase cookie: **verify the signature** against Google's
 *     JWKS, then ask the engine who this is with `GET /cowork/me`, then map its
 *     role through `archetypeForLegacyRole`.
 *
 * The signature check is not optional and not a formality. Reading claims alone
 * was a previously-closed auth bypass — a forged unsigned token returned 200 on
 * `/team`. An admin console is the last place to reintroduce it.
 *
 * ## What this deliberately does not do
 *
 * It does not mint a session, set a cookie, or create an account. It answers a
 * question about the request in front of it. Nothing here widens who is an
 * administrator: the predicate is still `canAccessAdminConsole`, and the
 * archetype still comes from `cowork_employees.role` by way of one mapping
 * whose fallthrough is `employee`. An unrecognised role is refused, not guessed
 * upward.
 */

export interface AdminIdentity {
  employeeId: string;
  displayName: string | null;
  archetype: RoleArchetype | null;
  /** Which system answered. Recorded for the log, never for a decision. */
  via: "cowork_session" | "firebase";
}

/**
 * The signed-in person, or null.
 *
 * Null means "nobody verifiable is behind this request" — not "not an
 * administrator". The two are different refusals and the callers word them
 * differently: one is a redirect to sign in, the other is a 403.
 */
export async function currentAdminIdentity(): Promise<AdminIdentity | null> {
  const session = await currentSession();
  if (session) {
    return {
      employeeId: session.employeeId,
      displayName: session.displayName,
      archetype: session.archetype,
      via: "cowork_session",
    };
  }

  const jar = await cookies();
  const token = jar.get(FIREBASE_COOKIE)?.value ?? null;
  if (!token) return null;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  /* No project id means no way to verify, and an unverifiable token is not a
     signed-in caller. Fails closed, exactly as the middleware does. */
  if (!projectId) return null;

  try {
    const verified = await verifyIdToken({ token, projectId });
    if (!verified.ok) return null;
  } catch {
    return null;
  }

  /* The engine is the authority on the role. Asking it costs a request per
     admin page load, which is the correct trade: the alternative is caching an
     authorisation decision, and a stale cache here means somebody keeps the
     console after their role was taken away. */
  const identity = await fetchIdentity(token).catch(() => null);
  if (!identity?.ok) return null;

  return {
    employeeId: String(identity.data.employeeId),
    displayName: identity.data.name ?? null,
    archetype: archetypeForLegacyRole(identity.data.role),
    via: "firebase",
  };
}

/**
 * The three admin questions, asked of the request.
 *
 * Separate functions rather than one `isAdmin`, mirroring
 * `lib/rules/admin/access.ts` — they answer different questions and will not
 * always agree. Each delegates to that module, so there is still exactly one
 * definition of "administrator" in the codebase.
 */
export async function adminConsoleAccess(): Promise<{
  identity: AdminIdentity | null;
  mayOpenConsole: boolean;
  mayModifySettings: boolean;
  mayViewAuditLogs: boolean;
}> {
  const identity = await currentAdminIdentity();
  return {
    identity,
    mayOpenConsole: canAccessAdminConsole(identity),
    mayModifySettings: canModifySettings(identity),
    mayViewAuditLogs: canViewAuditLogs(identity),
  };
}
