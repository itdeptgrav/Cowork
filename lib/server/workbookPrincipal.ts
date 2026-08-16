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
