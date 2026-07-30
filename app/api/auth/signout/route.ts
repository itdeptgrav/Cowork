import { NextResponse } from "next/server";
import { clearSession } from "@/lib/server/session";

/**
 * Sign out.
 *
 * POST only. A GET would be followable by a prefetch, an image tag or a link in
 * an email, and a sign-out anybody can trigger on your behalf is a nuisance
 * attackers do use.
 *
 * `clearSession` revokes the server-side record as well as dropping the cookie,
 * so a copied token dies here rather than at its expiry.
 */

export const runtime = "nodejs";

export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
