import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentSession, landingFor } from "@/lib/server/session";
import { SESSION_COOKIE } from "@/lib/auth/sessionCookie";

/**
 * Who the caller is, according to the server.
 *
 * The client asks this once on mount and treats the answer as authoritative —
 * it is the only thing that tells the workspace which employee to act as. The
 * browser cannot answer it for itself: the cookie is httpOnly and carries no
 * claims, so this round trip is the only way to know.
 *
 * Never cached. A cached identity is somebody else's identity on a shared
 * proxy, which is the worst bug in this whole area.
 *
 * **It also clears a cookie it cannot honour**, and that is not tidiness — it is
 * what stops a redirect loop. The Edge proxy can only check the SIGNATURE, so a
 * cookie whose session has been revoked, expired or wiped still looks valid to
 * it: the proxy sends `/signin` to `/home`, the client asks here, hears "not
 * authenticated" and sends `/home` back to `/signin`, forever. The server is the
 * only party that knows the cookie is dead, so it is the one that has to say so.
 * Found by wiping the session store while a cookie was still live.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();

  if (!session) {
    const jar = await cookies();
    if (jar.get(SESSION_COOKIE)) jar.delete(SESSION_COOKIE);
    return NextResponse.json(
      { authenticated: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      employeeId: session.employeeId,
      email: session.email,
      displayName: session.displayName,
      archetype: session.archetype,
      organisationId: session.organisationId,
      organisationName: session.organisationName,
      landing: landingFor(session.archetype),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
