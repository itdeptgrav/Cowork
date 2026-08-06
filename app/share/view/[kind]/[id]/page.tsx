import { cookies } from "next/headers";
import { Mark } from "@/components/layout/shell/Mark";
import { GuestDocumentViewer } from "@/components/features/workspace/guest/GuestDocumentViewer";
import { GuestMindmapViewer } from "@/components/features/workspace/guest/GuestMindmapViewer";
import { GUEST_SESSION_COOKIE } from "@/lib/auth/guestSessionCookie";

export const dynamic = "force-dynamic";

/**
 * Where an external-share invite lands after `/share/invite/[token]`
 * redeems it.
 *
 * A server component, not a client one — the guest session token lives in an
 * httpOnly cookie precisely so no script on this page can read it, which
 * means it has to be read here, server-side, and handed down to the guest
 * viewer as a plain prop. That mirrors how `app/meetings/guest/[token]/page.tsx`
 * hands its URL token to `GuestMeetingArea`; the only difference is where the
 * token comes from.
 *
 * A missing or expired cookie is not an error to throw — it is a normal
 * outcome (the link was opened on a different device, the 90-day session
 * lapsed, or the guest never accepted an invite for this id) and is shown
 * as a plain message rather than a crash.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const jar = await cookies();
  const sessionToken = jar.get(GUEST_SESSION_COOKIE)?.value ?? null;

  if (kind !== "document" && kind !== "mindmap") {
    return <GuestShell message="This link is not valid." />;
  }
  if (!sessionToken) {
    return (
      <GuestShell message="Your guest session has expired or was never started here. Ask whoever shared this with you to send a new invite." />
    );
  }

  return kind === "mindmap" ? (
    <GuestMindmapViewer sessionToken={sessionToken} id={id} />
  ) : (
    <GuestDocumentViewer sessionToken={sessionToken} id={id} />
  );
}

function GuestShell({ message }: { message: string }) {
  return (
    <>
      <div className="fixed top-6 left-6 z-10 flex items-center gap-2.5 sm:top-8 sm:left-8">
        <Mark className="h-7 w-7" />
        <span className="text-base leading-none font-medium tracking-[-0.03em] text-ink">
          cowork
        </span>
      </div>
      <div className="grid min-h-dvh place-items-center px-[clamp(16px,4vw,48px)] py-[clamp(24px,5vh,64px)]">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-lg font-medium text-ink">Cannot open this</p>
          <p className="text-base text-ink-muted">{message}</p>
        </div>
      </div>
    </>
  );
}
