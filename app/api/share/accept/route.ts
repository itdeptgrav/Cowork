import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { acceptShareInvite } from "@/lib/legacy/shareGuest";
import {
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_COOKIE_MAX_AGE,
} from "@/lib/auth/guestSessionCookie";

/**
 * Redeem an external-share invite token and mint the guest an httpOnly
 * session cookie.
 *
 * **Why this is a server route rather than the guest page calling the
 * backend directly.** The backend's `POST /cowork/share/accept` returns the
 * guest session token in its JSON body — it has no other way to hand it to a
 * first-time caller. Something has to turn that into a cookie the browser
 * carries automatically on the guest's next visit, and doing it here, in
 * Node rather than the Edge, is what lets the cookie be `httpOnly`: no
 * script on `/share/view/*` ever holds this credential in a readable form,
 * mirroring why `writeFirebaseCookie` exists as a *client*-side mirror only
 * because there is no Admin SDK credential available to do this the safer
 * way for that one — here there is nothing stopping the safer way, so this
 * route takes it.
 *
 * The token itself is deliberately NOT echoed back in this response. The
 * view page reads the cookie server-side (`app/share/view/[kind]/[id]/page.tsx`)
 * and hands it to the guest viewer as a prop; nothing downstream needs the
 * plaintext to have passed through this response body.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  const result = await acceptShareInvite(token);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.message },
      { status: result.error.status || 400 },
    );
  }

  const { guestSessionToken, targetKind, targetId, role, title } = result.data;
  if (!guestSessionToken || !targetKind || !targetId) {
    return NextResponse.json(
      { error: "This invite link is invalid or has expired." },
      { status: 400 },
    );
  }

  const jar = await cookies();
  jar.set(GUEST_SESSION_COOKIE, guestSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_SESSION_COOKIE_MAX_AGE,
  });

  return NextResponse.json({
    targetKind,
    targetId,
    role: role ?? null,
    title: title ?? null,
  });
}
