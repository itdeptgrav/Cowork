import "server-only";
import { currentSession } from "./session";
import { readFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { verifyIdToken } from "@/lib/auth/firebaseToken";

/**
 * Who a workbook request is for — resolved by EITHER auth system the product
 * runs on, and by NEITHER a claim the client could forge.
 *
 * This does not invent authentication. It reuses the two the app already has,
 * the same pair `apiAuth.ts` and `mailPrincipal.ts` reconcile:
 *
 *  · `cowork_session` — the server-side session record. `currentSession()`
 *    verifies its signature and looks up the account; its `accountId` is the
 *    owner id.
 *  · else the Firebase ID token cookie — the path every existing employee signs
 *    in on. The token's SIGNATURE is verified against Google's keys (the identical
 *    check `middleware.ts` makes), and only then is its `uid` trusted. That uid,
 *    namespaced, is the owner id.
 *
 * The server derives the identity itself in both branches — it never reads an
 * owner id the browser sent. That is the whole of requirement 14: authorization
 * is decided from a verified identity, server-side, not from anything the client
 * claims. A route turns a null here into 401.
 */
export interface WorkbookPrincipal {
  /** The stable id that OWNS a workbook. Ownership is checked against it. */
  ownerId: string;
}

export async function workbookPrincipal(request: Request): Promise<WorkbookPrincipal | null> {
  const session = await currentSession();
  if (session) return { ownerId: session.accountId };

  const token = readFirebaseCookie(request.headers.get("cookie"));
  if (!token) return null;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  try {
    const result = await verifyIdToken({ token, projectId });
    if (!result.ok) return null;
    /* Namespaced so a Firebase uid can never collide with a server accountId. */
    return { ownerId: `fb:${result.claims.uid}` };
  } catch {
    return null;
  }
}

function legacyApiBase(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_LEGACY_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed || null;
}

/**
 * The caller's Cowork EMPLOYEE id — the id the people directory uses, and so the
 * id a workbook is shared BY when somebody is picked by name.
 *
 * Distinct from `ownerId`. Ownership is held by whichever principal created the
 * workbook — a server account id, or `fb:<uid>` on the Firebase path — but a
 * SHARE names a person from the directory, and the directory speaks employee
 * ids. Without this bridge a sheet shared with a colleague's employee id would
 * never match the `fb:<uid>` their session presents, so the share would grant
 * nothing; this is what lets sharing-by-name actually admit them.
 *
 * Resolved the way `mailPrincipal` resolves the same id: the server session
 * carries it directly; on the Firebase path the LEGACY `/cowork/me` is the
 * authority and VERIFIES the token (the identical signature check middleware
 * makes), so trusting its answer trusts a verified identity, never a client
 * claim. Null when it cannot be established — the caller then reaches only what
 * their `ownerId` already reaches, exactly as before.
 */
export async function workbookEmployeeId(request: Request): Promise<string | null> {
  const session = await currentSession();
  if (session) return session.employeeId || null;

  const token = readFirebaseCookie(request.headers.get("cookie"));
  if (!token) return null;

  const base = legacyApiBase();
  if (!base) return null;

  try {
    const r = await fetch(`${base}/cowork/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const me = (await r.json()) as {
      employeeId?: unknown;
      data?: { employeeId?: unknown };
    };
    const employeeId = String(me.employeeId ?? me.data?.employeeId ?? "").trim();
    return employeeId || null;
  } catch {
    return null;
  }
}
