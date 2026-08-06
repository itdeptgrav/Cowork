import { legacyFetch } from "./http.ts";
import type { LegacyResult } from "./envelope.ts";

/**
 * The no-account side of external sharing — redeeming an invite link and
 * reading/writing a document, sheet or mindmap as a guest.
 *
 * Same shape as `meetingMedia.ts`'s public/guest functions: plain JSON calls
 * against routes the backend deliberately serves with NO Firebase auth,
 * because the caller here may never have had a Cowork account. Nothing in
 * this file touches `getRepository()` — a guest is not a `CoworkRepository`
 * consumer, and routing it through that layer would mean every one of the
 * repository's ~190 methods needing to answer "what if there is no
 * employee" for the sake of three that are actually reachable this way.
 *
 * `acceptShareInvite` is called from the server (`app/api/share/accept/route.ts`,
 * which mints the httpOnly cookie) as well as directly — `legacyFetch` has no
 * browser-only dependency, so it works in a Next.js Route Handler exactly as
 * it does in a client component.
 */

export type GuestTargetKind = "document" | "mindmap";
export type GuestRole = "editor" | "viewer";

/** `POST /cowork/share/accept` — redeem an invite token. No auth. */
export async function acceptShareInvite(token: string): Promise<
  LegacyResult<{
    guestSessionToken?: string;
    targetKind?: GuestTargetKind;
    targetId?: string;
    role?: GuestRole;
    title?: string | null;
  }>
> {
  return legacyFetch({
    path: "/cowork/share/accept",
    method: "POST",
    body: { token },
  });
}

/**
 * `GET /cowork/share/guest/:kind/:id` — read a target's content as a guest.
 *
 * The guest bearer session token rides as `Authorization: Bearer <token>`,
 * same header `legacyFetch` already uses for a Firebase ID token — the
 * backend route reads it identically either way, it just isn't one.
 */
export async function getGuestContent(
  sessionToken: string,
  kind: GuestTargetKind,
  id: string,
): Promise<
  LegacyResult<{
    title?: string;
    role?: GuestRole;
    html?: string;
    cells?: string | null;
    nodes?: unknown[];
  }>
> {
  return legacyFetch({
    path: `/cowork/share/guest/${kind}/${encodeURIComponent(id)}`,
    token: sessionToken,
  });
}

/**
 * `PUT /cowork/share/guest/:kind/:id` — write a target's content as a guest.
 *
 * Refused server-side (403) unless the grant behind this session is
 * `"editor"` — the caller does not need to check the role first, only handle
 * the refusal if it comes back.
 */
export async function saveGuestContent(
  sessionToken: string,
  kind: GuestTargetKind,
  id: string,
  content: { html?: string; cells?: string | null; nodes?: unknown[] },
): Promise<LegacyResult<{ ok?: boolean; nodes?: unknown[] }>> {
  return legacyFetch({
    path: `/cowork/share/guest/${kind}/${encodeURIComponent(id)}`,
    method: "PUT",
    token: sessionToken,
    body: content,
  });
}
