"use client";

/**
 * The landing screen for `/share/invite/[token]` — redeems the invite token
 * against `/api/share/accept` (which mints the httpOnly guest session cookie
 * and never hands the plaintext back to this component) and forwards into
 * the viewer.
 *
 * Modelled on `GuestMeetingArea`'s own shape: a client component that does
 * its one round trip in an effect and renders a loading/error state around
 * it, entirely outside `SessionProvider`/`getRepository()` — this person may
 * have no Cowork account at all.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/layout/shell/Mark";

type Phase = { kind: "loading" } | { kind: "error"; message: string };

export function ShareInviteAccept({ inviteToken }: { inviteToken: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/share/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.targetKind || !data?.targetId) {
          setPhase({
            kind: "error",
            message:
              data?.error ?? "This invite link is invalid or has expired.",
          });
          return;
        }
        router.replace(
          `/share/view/${data.targetKind}/${encodeURIComponent(data.targetId)}`,
        );
      } catch {
        if (!cancelled)
          setPhase({
            kind: "error",
            message:
              "Could not reach the server. Check your connection and try again.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, router]);

  return (
    <>
      <div className="fixed top-6 left-6 z-10 flex items-center gap-2.5 sm:top-8 sm:left-8">
        <Mark className="h-7 w-7" />
        <span className="text-base leading-none font-medium tracking-[-0.03em] text-ink">
          cowork
        </span>
      </div>
      <div className="grid min-h-dvh place-items-center px-[clamp(16px,4vw,48px)] py-[clamp(24px,5vh,64px)]">
        {phase.kind === "error" ? (
          <div className="max-w-md space-y-2 text-center">
            <p className="text-lg font-medium text-ink">
              Cannot open this invite
            </p>
            <p className="text-base text-ink-muted">{phase.message}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3.5">
            <span
              aria-hidden="true"
              className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-[var(--color-hairline)] border-t-ink"
            />
            <p className="text-base text-ink-muted">Opening…</p>
          </div>
        )}
      </div>
    </>
  );
}
