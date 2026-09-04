"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, InlineError, Skeleton } from "@/components/ui/Primitives";
import { idToken } from "@/lib/legacy/firebase";
import { buildQrPayload, issueQrCode, revokeQrCode } from "@/lib/auth/recoveryApi";

/**
 * Share Dashboard — the QR code that signs you in on a second device.
 *
 * ## What is on the screen is a credential, and it behaves like one
 *
 * Anyone who can see this code can open your workspace. That is not a caveat to
 * the feature, it IS the feature, and everything here follows from it:
 *
 *  · **It expires in ninety seconds** and is replaced in place. The countdown is
 *    shown rather than hidden — somebody who understands that the code on screen
 *    dies in a minute treats it differently from somebody who thinks they are
 *    looking at a permanent ID card. The CMS's employee QR *is* a permanent ID
 *    card (`https://grav.in/employee/<id>` on a printed badge); this is the
 *    opposite kind of object and the panel has to say so.
 *  · **Closing the panel revokes it.** Walking away from a screen must not leave
 *    a working key on it for the rest of its minute.
 *  · **It is never rendered as a downloadable image and never printed.** There
 *    is no "save" control here, deliberately — a saved QR is a screenshot of a
 *    password.
 *
 * ## Why the code renders in the browser
 *
 * The server returns a token, not a picture. The URL wrapped around it has to
 * carry the origin of whoever is *looking* — this app is reached on localhost,
 * on a tunnel and on a production hostname, and a server-rendered image would
 * bake in one of them and produce codes that scan to a host the scanner cannot
 * reach. `buildQrPayload` takes `window.location.origin` for that reason.
 *
 * `qrcode` is pulled in with a dynamic import, so the library lands only for
 * somebody who opens this panel rather than in the profile page's bundle.
 */

/** Re-issue this long before expiry, so the visible code is never a dead one. */
const REFRESH_MARGIN_MS = 15_000;

export function ShareDashboardDialog({ onClose }: { onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  /* The token currently on screen, so the cleanup below can revoke exactly
     what was issued rather than trusting the server to guess. */
  const liveRef = useRef(false);

  const issue = useCallback(async () => {
    setError(null);
    const token = await idToken();
    if (!token) {
      setError("Your session has expired. Sign in again to share a code.");
      return null;
    }

    const result = await issueQrCode(token);
    if (!result.success || !result.token || !result.ttlMs) {
      setError(result.message ?? "Could not create a sign-in code.");
      return null;
    }

    try {
      /* Loaded here, not imported at the top — see the note above. */
      const QRCode = (await import("qrcode")).default;
      const payload = buildQrPayload(window.location.origin, result.token);
      const image = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: "M",
        /* Fixed black on white rather than the theme's ink tokens. A scanner
           needs contrast, and in dark mode `ink` on `surface` is a pale code on
           a dark ground that many decoders refuse. The white quiet zone below
           is part of the same decision. */
        color: { dark: "#000000", light: "#ffffff" },
      });
      setDataUrl(image);
      liveRef.current = true;
      return result.ttlMs;
    } catch {
      setError("Could not draw the code. Sign in with your password instead.");
      return null;
    }
  }, []);

  /* Issue on open, then re-issue shortly before each code expires. One chain of
     timeouts rather than an interval: the next refresh is scheduled from the
     TTL the server actually returned, so a change there needs no edit here. */
  useEffect(() => {
    let cancelled = false;
    let refresh: ReturnType<typeof setTimeout> | null = null;

    const cycle = async () => {
      const ttl = await issue();
      if (cancelled || ttl == null) return;
      setSecondsLeft(Math.round(ttl / 1000));
      refresh = setTimeout(() => void cycle(), Math.max(5_000, ttl - REFRESH_MARGIN_MS));
    };

    void cycle();

    return () => {
      cancelled = true;
      if (refresh) clearTimeout(refresh);

      /* Revoke on the way out. Best effort — the ninety-second expiry is the
         real guarantee and this is the courtesy on top of it, so a failure here
         is deliberately silent rather than an error on a panel that has already
         closed. */
      if (liveRef.current) {
        void idToken()
          .then((t) => (t ? revokeQrCode(t) : null))
          .catch(() => null);
      }
    };
  }, [issue]);

  /* The countdown. Cosmetic — the server decides what is expired — but it is
     what makes the short life of the code legible instead of surprising. */
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dashboard-title"
      className="fixed inset-0 z-[97] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative w-[min(420px,96vw)] rounded-panel px-6 py-5">
        <h2
          id="share-dashboard-title"
          className="text-[17px] leading-tight font-medium tracking-[-0.01em] text-ink"
        >
          Share Dashboard
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
          On the other device, open Cowork’s sign-in page and choose{" "}
          <span className="text-ink">Sign in by scanning a code</span>. Then hold
          its camera up to this.
        </p>

        {error ? (
          <div className="mt-4">
            <InlineError message={error} />
          </div>
        ) : (
          <>
            <div className="mt-4 grid place-items-center rounded-inset bg-white p-4">
              {dataUrl ? (
                /* A plain <img>: this is a data URL generated a moment ago in
                   this browser, so `next/image`'s optimiser has nothing to
                   optimise and would only add a round trip. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={dataUrl}
                  alt="A QR code that signs you in on another device"
                  width={260}
                  height={260}
                  className="h-[260px] w-[260px]"
                />
              ) : (
                <Skeleton className="h-[260px] w-[260px]" />
              )}
            </div>

            <p
              role="status"
              className="mt-3 text-center text-[12px] leading-relaxed text-ink-muted"
            >
              {secondsLeft !== null && secondsLeft > 0
                ? `This code expires in ${secondsLeft}s and refreshes itself.`
                : "Refreshing…"}
            </p>
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Anyone who scans this signs in as you. Do not photograph it, screen
          share it, or leave this open on an unattended screen — closing this
          panel cancels the code.
        </p>

        <div className="mt-5 flex justify-end">
          <Button tone="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
