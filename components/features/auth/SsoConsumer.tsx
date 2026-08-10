"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LEGACY_LANDING } from "@/lib/auth/roleMap";
import { signInWithToken } from "@/lib/legacy/firebase";
import { writeFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { AuthFrame, AuthSwitch } from "./AuthFrame";
import { InlineError } from "@/components/ui/Primitives";

/**
 * The other end of the CMS onboarding handoff.
 *
 * `DepartmentPortal.js` (in the CMS) asks its backend to mint a Firebase
 * custom token for the caller's already-linked CoWork account, then sends the
 * browser here with it in `?token=`. This exchanges it for a real session the
 * same way `SignInForm` does for a typed password — same cookie mirror, same
 * hard navigation — so everything downstream of sign-in cannot tell the two
 * apart.
 *
 * A custom token is single-use and short-lived by design, so this runs once
 * on mount rather than offering a retry: a stale link needs a fresh one from
 * the CMS, not a second attempt at the same token.
 */
export function SsoConsumer() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("This sign-in link is missing its token.");
      return;
    }
    (async () => {
      try {
        const user = await signInWithToken(token);
        writeFirebaseCookie(await user.getIdToken());
        window.location.href = LEGACY_LANDING;
      } catch {
        setError(
          "This sign-in link is no longer valid. Go back to the CMS and open CoWork again.",
        );
      }
    })();
    // Runs once, against the token this route was loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthFrame
      title={error ? "Could not sign you in" : "Signing you in…"}
      lede={
        error
          ? "The link the CMS sent did not work."
          : "Connecting your CoWork account. One moment."
      }
      footer={
        <AuthSwitch
          question="Prefer a password?"
          href="/signin"
          action="Sign in directly"
        />
      }
    >
      {error ? (
        <InlineError message={error} />
      ) : (
        <p className="text-sm text-ink-muted">Connecting…</p>
      )}
    </AuthFrame>
  );
}
