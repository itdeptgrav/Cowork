import "server-only";
import { currentSession } from "./session";
import { readFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { verifyIdToken } from "@/lib/auth/firebaseToken";

/**
 * Is this request signed in — by either of the two systems the product runs on?
 *
 * **The product has two, and a route that knows about only one is a route that
 * is closed to half the company.** They are the identity/workspace seam:
 *
 *  · `cowork_session` — the server-side session record, issued by
 *    `/api/auth/signup`. Revocable, holds no claims.
 *  · The Firebase ID token cookie — written by `SignInForm`, which is the path
 *    **every existing employee** uses to sign in. `middleware.ts` gates every
 *    page on it.
 *
 * Nothing issues `cowork_session` on the Firebase path. So a real employee gets
 * pages, because the middleware accepts their token, and got **401 from every
 * API route that asked `currentSession()` alone** — which is how
 * `GET /api/livekit/token?identity=employee-GR0000 401` appears in the dev log
 * for a signed-in chief executive.
 *
 * That was tolerable while presence only coloured a pill. It stopped being
 * tolerable when task actions became gated on being online: no token means no
 * room, no room means never online, and never online means unable to start a
 * timer or advance your own work.
 *
 * **The Firebase branch verifies the SIGNATURE**, against Google's JWKS, which
 * is the identical check the middleware makes and the one whose absence was a
 * previously-closed auth bypass. Reading claims alone would accept a token
 * anybody could write.
 *
 * This answers "is somebody real behind this request" and nothing more. It is
 * not an authorisation check, and no caller should read it as one.
 */
export async function isSignedInRequest(request: Request): Promise<boolean> {
  if (await currentSession()) return true;

  const token = readFirebaseCookie(request.headers.get("cookie"));
  if (!token) return false;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  /* No project id means no way to verify, and an unverifiable token is not a
     signed-in caller. Fails closed, exactly as the middleware does. */
  if (!projectId) return false;

  try {
    const result = await verifyIdToken({ token, projectId });
    return result.ok;
  } catch {
    return false;
  }
}
