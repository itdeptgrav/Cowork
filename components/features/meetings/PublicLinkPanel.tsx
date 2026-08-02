"use client";

/**
 * Public share link for a meeting.
 *
 * The organiser can mint a link that lets anyone (no account) join via
 * `/meetings/guest/[token]`. The backend enforces that the link only works
 * while the meeting is live and `publicShareEnabled` is true; the frontend
 * just shows the URL and lets the host copy or revoke it.
 */

import { useCallback, useState } from "react";
import { firebaseAuth } from "@/lib/legacy-ui/coworkFirebase";
import {
  createMeetingPublicLink,
  revokeMeetingPublicLink,
} from "@/lib/legacy/meetingMedia";
import { InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";

async function getToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
}

export function PublicLinkPanel({ meetId }: { meetId: string }) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mint = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await createMeetingPublicLink({ token, meetId });
      if (!res.ok) throw new Error(res.error.message);
      setShareToken(res.data?.publicShareToken ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create link");
    } finally {
      setLoading(false);
    }
  }, [meetId]);

  const revoke = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await revokeMeetingPublicLink({ token, meetId });
      if (!res.ok) throw new Error(res.error.message);
      setShareToken(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke link");
    } finally {
      setLoading(false);
    }
  }, [meetId]);

  async function copy() {
    if (!shareToken) return;
    const url = guestUrl(shareToken);
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2">
      {shareToken ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 rounded-inset border border-hairline bg-[var(--surface-sunken)] px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
              {guestUrl(shareToken)}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy link"
              className="shrink-0 text-[11px] text-ink-faint hover:text-ink-muted"
            >
              {copied ? (
                <Icon.check className="h-3.5 w-3.5 text-[var(--state-positive-ink)]" />
              ) : (
                <Icon.link className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-ink-faint">
            Anyone with this link can join while the meeting is live. Revoke it
            to prevent new guests.
          </p>
          <button
            type="button"
            onClick={() => void revoke()}
            disabled={loading}
            className="text-[11px] text-[var(--state-overdue-ink)] disabled:opacity-40 hover:underline"
          >
            {loading ? "Revoking…" : "Revoke link"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">
            No guest link yet. Generate one to invite people outside CoWork.
          </p>
          <button
            type="button"
            onClick={() => void mint()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-inset bg-[var(--control)] px-3 py-1.5 text-[12px] text-ink transition-colors disabled:opacity-40 hover:bg-[var(--control-active)]"
          >
            <Icon.external className="h-3.5 w-3.5" />
            {loading ? "Generating…" : "Generate guest link"}
          </button>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <InlineError compact message={error} />
        </div>
      )}
    </div>
  );
}

function guestUrl(token: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "https://cowork.app";
  return `${origin}/meetings/guest/${token}`;
}
