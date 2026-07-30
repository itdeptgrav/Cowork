"use client";

import { useEffect, useState } from "react";
import { Button, Chip, InlineError, Panel, PanelHead } from "@/components/ui/Primitives";

/**
 * Connect a Gmail account.
 *
 * Per-employee OAuth, as legacy did it — each person authorises their own
 * mailbox. The alternative, a service account impersonating everybody, needs a
 * Workspace super-admin to enable domain-wide delegation and was verified not to
 * work with the credentials here (docs/architecture/MAIL_MIGRATION_SPEC.md §5).
 *
 * **No token ever reaches this component.** `/api/mail/gmail/status` returns
 * whether a mailbox is connected and which address — nothing else exists to
 * leak. The consent redirect is a full navigation rather than a fetch, because
 * Google's consent screen cannot be framed or XHR'd.
 */
interface Status {
  configured: boolean;
  connected: boolean;
  email: string | null;
  status: "active" | "expired" | "revoked" | null;
  connectedAt: string | null;
}

export function GmailConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mail/gmail/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Status | null) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setError("Could not read the Gmail connection.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/mail/gmail/disconnect", { method: "POST" });
      setStatus((s) => (s ? { ...s, connected: false, email: null, status: null } : s));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead
        title="Gmail"
        sub="Send mail to people outside Cowork from your own address"
      />

      <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
        Messages to colleagues stay inside Cowork and need none of this.
        Connecting Gmail is only for mail that leaves the company — it is sent
        from your address, and Cowork never sees your Google password.
      </p>

      {error && (
        <div className="mt-3">
          <InlineError compact message={error} />
        </div>
      )}

      {status && !status.configured && (
        <p className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5 text-[11px] leading-relaxed text-ink-faint">
          Gmail is not configured on this server, so external mail cannot be
          sent yet. An administrator needs to add the Google OAuth client
          credentials.
        </p>
      )}

      {status?.configured && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status.connected ? (
            <>
              <Chip tone="positive">Connected</Chip>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {status.email}
              </span>
              <Button tone="ghost" size="sm" disabled={busy} onClick={disconnect}>
                {busy ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <>
              {status.status === "revoked" && (
                <Chip tone="overdue">Access revoked</Chip>
              )}
              <span className="min-w-0 flex-1 text-sm text-ink-muted">
                {status.status === "revoked"
                  ? "Google access was withdrawn. Connect again to send external mail."
                  : "No account connected."}
              </span>
              {/* A full navigation, not a fetch — Google's consent screen
                  cannot be framed or requested by XHR. */}
              <Button tone="primary" size="sm">
                <a href="/api/mail/gmail/connect">Connect Gmail</a>
              </Button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
