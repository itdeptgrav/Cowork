"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Input,
  Textarea,
} from "@/components/ui/Primitives";
import { RecipientField } from "./RecipientField";
import { recipientRefusal } from "@/lib/rules/mail/blindCopy";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { sendRefusal, transportNotice } from "@/lib/integrations/mail/transport";
import type { MailMessage, MailParty } from "@/lib/domain";

/**
 * Compose, with one recipient field.
 *
 * **The recipient decides the transport, so there is no transport control.**
 * Legacy made the person choose by opening either `/mail` or `/mail/gmail`
 * before they had typed anything, which meant picking wrong was a mistake you
 * could only fix by starting over. Here you type or pick people, and the banner
 * tells you what will happen — from `transportNotice`, the same function that
 * routes the send, so the label cannot disagree with the outcome.
 *
 * Typing a colleague's own work address resolves to that EMPLOYEE, not to an
 * external address, so it stays inside Cowork rather than leaving through Gmail
 * and coming back without their profile.
 */
export function MailCompose({
  mode,
  replyTo,
  onClose,
  onSent,
}: {
  mode?: "reply" | "forward";
  replyTo?: MailMessage;
  onClose: () => void;
  onSent: () => void;
}) {
  const people = useQuery((r) => r.listEmployees(), []);
  const gmail = useQuery(
    async () => {
      const res = await fetch("/api/mail/gmail/status", { cache: "no-store" });
      return res.ok
        ? ((await res.json()) as { connected: boolean; email: string | null })
        : { connected: false, email: null };
    },
    [],
  );

  const directory = useMemo(
    () =>
      (people.data ?? [])
        .filter((p) => p.email)
        .map((p) => ({
          employeeId: p.id,
          address: p.email!,
          displayName: p.displayName,
        })),
    [people.data],
  );

  const [recipients, setRecipients] = useState<MailParty[]>(
    mode === "reply" && replyTo ? [replyTo.from] : [],
  );
  /* A reply keeps the visible copies, because dropping them silently removes
     people from a conversation they were part of. Bcc is NEVER carried over:
     the blind copies on the message you are replying to are not yours to
     re-disclose, and on anything but your own sent message you cannot see them
     anyway. */
  const [cc, setCc] = useState<MailParty[]>(
    mode === "reply" && replyTo ? replyTo.cc : [],
  );
  const [bcc, setBcc] = useState<MailParty[]>([]);
  const [showCc, setShowCc] = useState(
    mode === "reply" && replyTo ? replyTo.cc.length > 0 : false,
  );
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(
    replyTo
      ? `${mode === "forward" ? "Fwd" : "Re"}: ${replyTo.subject.replace(/^(Re|Fwd):\s*/i, "")}`
      : "",
  );
  const [body, setBody] = useState(
    mode === "forward" && replyTo
      ? `\n\n---------- Forwarded ----------\nFrom: ${replyTo.from.displayName}\n\n${replyTo.body}`
      : "",
  );

  const everyone = [...recipients, ...cc, ...bcc];
  const taken = new Set(everyone.map((p) => p.address));
  /* All three fields decide the transport. One external address in Bcc takes
     the whole message outside the company, and a banner reading "Internal
     message" while that happened would be the worst version of this bug. */
  const notice = transportNotice(everyone);
  /* One question, asked once: `/api/mail/gmail/status` → `connectionView` →
     `getGmailConnection`. The banner, the disabled state and the server's own
     check now all resolve from that same record, which is what stopped Settings
     and the composer contradicting each other. */
  const refusal =
    recipientRefusal({ to: recipients, cc, bcc }) ??
    sendRefusal({
      recipients: everyone,
      subject,
      gmailAvailable: gmail.data?.connected ?? false,
    });

  /**
   * Send.
   *
   * Internal goes straight to the repository. External goes through
   * `/api/mail/send` FIRST — that route is the only place `GmailConnection` is
   * readable, because it holds credentials and lives server-side — and whatever
   * it answers is then recorded locally: Gmail's ids on success, the reason on
   * failure. A refused message is kept as a draft rather than lost.
   */
  const [send, state] = useAction(async (r) => {
    const threadId = replyTo && mode === "reply" ? replyTo.threadId : null;
    if (notice.transport === "internal")
      return r.sendMail({ to: recipients, cc, bcc, subject, body, threadId });

    const res = await fetch("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipients, cc, bcc, subject, body }),
    });
    const payload = (await res.json().catch(() => null)) as {
      gmail?: { gmailMessageId: string; gmailThreadId: string };
      error?: string;
    } | null;

    return r.sendMail({
      to: recipients,
      cc,
      bcc,
      subject,
      body,
      threadId,
      gmail: payload?.gmail
        ? {
            messageId: payload.gmail.gmailMessageId,
            threadId: payload.gmail.gmailThreadId,
          }
        : null,
      deliveryError: res.ok
        ? null
        : (payload?.error ?? "Gmail refused the message."),
    });
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative flex max-h-[90vh] w-[min(660px,96vw)] flex-col overflow-hidden rounded-panel">
        <div className="px-6 pt-5 pb-3">
          <h2
            id="compose-title"
            className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
          >
            {mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New message"}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-hairline px-6 py-4 scroll-slim">
          {/* One `taken` set across all three fields: the suggestion list never
              offers somebody who is already addressed, which is what stops the
              commonest route into "in both To and Bcc". */}
          <RecipientField
            label="To"
            value={recipients}
            onChange={setRecipients}
            directory={directory}
            taken={taken}
            autoFocus
          />

          {/* Gmail's pattern, and it earns its keep: most messages have neither,
              and two permanently-visible empty fields above the subject push the
              message itself off the first screen. */}
          {!(showCc && showBcc) && (
            <div className="mt-1.5 flex gap-3">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
                >
                  Add Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => setShowBcc(true)}
                  className="text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
                >
                  Add Bcc
                </button>
              )}
            </div>
          )}

          {showCc && (
            <div className="mt-3">
              <RecipientField
                label="Cc"
                hint="Everyone on the message sees who is in Cc."
                value={cc}
                onChange={setCc}
                directory={directory}
                taken={taken}
                autoFocus
              />
            </div>
          )}

          {showBcc && (
            <div className="mt-3">
              <RecipientField
                label="Bcc"
                /* Said at the point of use, because this is the field people
                   are most likely to be wrong about. */
                hint="Nobody else on the message sees these people — not even each other."
                value={bcc}
                onChange={setBcc}
                directory={directory}
                taken={taken}
                autoFocus
              />
            </div>
          )}

          {/* What will actually happen. From the same function that routes the
              send, so it cannot lie. */}
          {recipients.length > 0 && (
            <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs font-medium text-ink">
                <Chip tone={notice.transport === "internal" ? "positive" : "neutral"}>
                  {notice.label}
                </Chip>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                {notice.detail}
              </p>
            </div>
          )}

          <Field label="Subject" required className="mt-4">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>

          <Field label="Message" className="mt-4">
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>

        <div className="border-t border-hairline px-6 py-4">
          {state.error && (
            <div className="mb-3">
              <InlineError compact message={state.error} code={state.errorCode} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] text-ink-faint">{refusal ?? ""}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Button tone="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                tone="primary"
                size="sm"
                disabled={!!refusal || state.isPending}
                onClick={async () => {
                  const r = await send();
                  if (r.ok) onSent();
                }}
              >
                {state.isPending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
