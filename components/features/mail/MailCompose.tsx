"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Input,
} from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { AiTextAssistButton } from "@/components/ui/AiTextAssist";
import {
  UploadProgressRow,
  formatBytes,
} from "@/components/features/messages/MessageAttachments";
import { RecipientField } from "./RecipientField";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "./RichTextEditor";
import { recipientRefusal } from "@/lib/rules/mail/blindCopy";
import { replySeed } from "@/lib/rules/mail/reply";
import { textToHtml, isRichHtml } from "@/lib/rules/mail/richText";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { sendRefusal, transportNotice } from "@/lib/integrations/mail/transport";
import { improveText, textSignature } from "@/lib/workspace/ai/textAssist";
import type { MailMessage, MailParty, MessageAttachment } from "@/lib/domain";

/** Attachments are bounded in COUNT, not size — the Drive pipeline is resumable
 *  and uncapped, which is the "no size limit" the mailbox wants. */
const MAX_MAIL_ATTACHMENTS = 20;

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
  viewerId,
  editingDraft,
  onClose,
  onSent,
  onSaved,
}: {
  mode?: "reply" | "replyAll" | "forward";
  replyTo?: MailMessage;
  /** The composer's own employee id, so a Reply All never addresses you. */
  viewerId?: string | null;
  /** A saved draft being finished — prefills every field, is overwritten by Save
   *  Draft, and is discarded once the message actually sends. */
  editingDraft?: MailMessage;
  onClose: () => void;
  onSent: () => void;
  /** Fired after a draft is saved (distinct from `onSent`), so the list can
   *  refresh without implying the message left. */
  onSaved?: () => void;
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

  const repo = useRepo();
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

  /* Who a reply pre-fills — the one place the To/Cc seeding lives, shared by
     Reply and Reply All, so "never reply to yourself", "keep the Cc" and "never
     carry bcc" are decided once. See `lib/rules/mail/reply.ts`. A draft being
     edited overrides all of it: its fields are restored exactly. */
  const seed = replySeed(mode ?? "forward", replyTo, viewerId);
  const [recipients, setRecipients] = useState<MailParty[]>(
    editingDraft ? editingDraft.to : seed.to,
  );
  const [cc, setCc] = useState<MailParty[]>(
    editingDraft ? editingDraft.cc : seed.cc,
  );
  const [bcc, setBcc] = useState<MailParty[]>(
    editingDraft ? editingDraft.bcc : [],
  );
  const [showCc, setShowCc] = useState(
    (editingDraft ? editingDraft.cc.length : seed.cc.length) > 0,
  );
  const [showBcc, setShowBcc] = useState(
    editingDraft ? editingDraft.bcc.length > 0 : false,
  );
  const [subject, setSubject] = useState(
    editingDraft
      ? editingDraft.subject
      : replyTo
        ? `${mode === "forward" ? "Fwd" : "Re"}: ${replyTo.subject.replace(/^(Re|Fwd):\s*/i, "")}`
        : "",
  );
  const [body, setBody] = useState(
    editingDraft
      ? editingDraft.body
      : mode === "forward" && replyTo
        ? `\n\n---------- Forwarded ----------\nFrom: ${replyTo.from.displayName}\n\n${replyTo.body}`
        : "",
  );
  /* Rich body. The editor mounts ONCE from this initial HTML — a draft's saved
     rich body, or the plain reply/forward prefill converted — and reports both
     its HTML and its plain text back on every change. `body` stays the plain
     text (the source of truth for the grammar gate, search and preview);
     `bodyHtml` carries the formatting. */
  const editorRef = useRef<RichTextEditorHandle>(null);
  const initialHtmlRef = useRef(editingDraft?.bodyHtml ?? textToHtml(body));
  const [bodyHtml, setBodyHtml] = useState(initialHtmlRef.current);

  /* Staged attachments — uploaded to Drive first (resumable, uncapped), then
     carried inline on the send, exactly as the chat composer does. Prefilled
     from a draft being finished. */
  const [pending, setPending] = useState<MessageAttachment[]>(
    editingDraft?.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<
    { id: string; name: string; fraction: number }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canAttach = typeof repo.uploadMessageAttachment === "function";

  /* Upload is its own step: each file lands on Drive first, then the send writes
     ONE message carrying the returned attachments — so a failed upload never
     leaves a half-sent message, and the composer keeps the file staged. */
  async function handleFiles(picked: File[]) {
    if (!repo.uploadMessageAttachment) return;
    const list = picked.slice(0, MAX_MAIL_ATTACHMENTS - pending.length);
    if (list.length === 0) return;
    setUploadError(null);
    setUploading(true);
    const batch = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
    }));
    setUploadProgress(
      batch.map((b) => ({ id: b.id, name: b.file.name, fraction: 0 })),
    );
    const results = await Promise.all(
      batch.map(({ id, file }) =>
        repo.uploadMessageAttachment!(file, (fraction) =>
          setUploadProgress((prev) =>
            prev.map((p) => (p.id === id ? { ...p, fraction } : p)),
          ),
        ),
      ),
    );
    setUploading(false);
    setUploadProgress([]);
    const ready: MessageAttachment[] = [];
    let firstError: string | null = null;
    results.forEach((r) => {
      if (r.ok) ready.push(r.data);
      else if (!firstError) firstError = r.message;
    });
    if (ready.length)
      setPending((prev) =>
        [...prev, ...ready].slice(0, MAX_MAIL_ATTACHMENTS),
      );
    setUploadError(firstError);
  }

  /**
   * The mandatory spelling/grammar gate.
   *
   * `grammarCheckedFor` holds the signature of the subject+body pair the
   * check last ran against. "Checked" means the pass ran and its findings
   * were looked at — not that its suggestions were accepted, because a
   * person is always allowed to send their own wording once they've seen
   * what the assistant would change. Editing either field afterward changes
   * the signature and re-engages the gate.
   */
  const [grammarCheckedFor, setGrammarCheckedFor] = useState<string | null>(null);
  const [checkingGrammar, setCheckingGrammar] = useState(false);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const [grammarSuggestions, setGrammarSuggestions] = useState<{
    subject?: string;
    body?: string;
    signature: string;
  } | null>(null);
  const grammarChecked = grammarCheckedFor === textSignature(subject, body);

  async function runGrammarCheck() {
    const sig = textSignature(subject, body);
    setCheckingGrammar(true);
    setGrammarError(null);
    const [subjectRes, bodyRes] = await Promise.all([
      subject.trim()
        ? improveText({ text: subject, mode: "grammar", surface: "mail-subject" })
        : Promise.resolve(null),
      body.trim()
        ? improveText({ text: body, mode: "grammar", surface: "mail-body" })
        : Promise.resolve(null),
    ]);
    setCheckingGrammar(false);

    if (subjectRes && !subjectRes.ok) return setGrammarError(subjectRes.message);
    if (bodyRes && !bodyRes.ok) return setGrammarError(bodyRes.message);

    const subjectFix =
      subjectRes && subjectRes.ok && subjectRes.text.trim() !== subject.trim()
        ? subjectRes.text
        : undefined;
    const bodyFix =
      bodyRes && bodyRes.ok && bodyRes.text.trim() !== body.trim() ? bodyRes.text : undefined;

    if (!subjectFix && !bodyFix) {
      // Nothing to flag — the check ran and passed clean.
      setGrammarCheckedFor(sig);
      setGrammarSuggestions(null);
      return;
    }
    setGrammarSuggestions({ subject: subjectFix, body: bodyFix, signature: sig });
  }

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
    (uploading ? "Wait for the attachment upload to finish." : null) ??
    recipientRefusal({ to: recipients, cc, bcc }) ??
    sendRefusal({
      recipients: everyone,
      subject,
      gmailAvailable: gmail.data?.connected ?? false,
    }) ??
    (!grammarChecked ? "Run the spelling & grammar check before sending." : null);

  /**
   * Send.
   *
   * Internal goes straight to the repository. External goes through
   * `/api/mail/send` FIRST — that route is the only place `GmailConnection` is
   * readable, because it holds credentials and lives server-side — and whatever
   * it answers is then recorded locally: Gmail's ids on success, the reason on
   * failure. A refused message is kept as a draft rather than lost.
   */
  /* Reply, Reply All and a sent DRAFT all continue their existing thread; only
     a Forward or a brand-new message starts a fresh one. */
  const threadId = editingDraft
    ? editingDraft.threadId
    : replyTo && (mode === "reply" || mode === "replyAll")
      ? replyTo.threadId
      : null;

  const [send, state] = useAction(async (r) => {
    /* Store the rich body only when it actually carries formatting; a plain
       message stays plain and renders the fast path. */
    const richHtml = isRichHtml(bodyHtml) ? bodyHtml : undefined;
    let sent;
    if (notice.transport === "internal") {
      sent = await r.sendMail({
        to: recipients,
        cc,
        bcc,
        subject,
        body,
        bodyHtml: richHtml,
        attachments: pending,
        threadId,
      });
    } else {
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipients, cc, bcc, subject, body }),
      });
      const payload = (await res.json().catch(() => null)) as {
        gmail?: { gmailMessageId: string; gmailThreadId: string };
        error?: string;
      } | null;

      sent = await r.sendMail({
        to: recipients,
        cc,
        bcc,
        subject,
        body,
        bodyHtml: richHtml,
        attachments: pending,
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
    }

    /* A draft that has now been sent (or kept as a failed record) must not
       linger in Drafts — remove the original once its replacement exists. */
    if (sent.ok && editingDraft) await r.discardMailDraft(editingDraft.id);
    return sent;
  });

  /* Save Draft is deliberately NOT gated on the grammar check or a recipient —
     an unfinished message is exactly what a draft is for. */
  const [saveDraft, saveState] = useAction((r) =>
    r.saveMailDraft({
      draftId: editingDraft?.id ?? null,
      to: recipients,
      cc,
      bcc,
      subject,
      body,
      bodyHtml: isRichHtml(bodyHtml) ? bodyHtml : undefined,
      attachments: pending,
      threadId,
    }),
  );
  const canSaveDraft =
    !!subject.trim() || !!body.trim() || recipients.length > 0;

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
            {mode === "reply"
              ? "Reply"
              : mode === "replyAll"
                ? "Reply all"
                : mode === "forward"
                  ? "Forward"
                  : editingDraft
                    ? "Edit draft"
                    : "New message"}
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
            <div className="relative">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="pr-9"
              />
              <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
                <AiTextAssistButton
                  value={subject}
                  onApply={setSubject}
                  fieldLabel="Subject"
                  surface="mail-subject"
                />
              </div>
            </div>
          </Field>

          <Field label="Message" className="mt-4">
            {/* The formatting toolbar and editable area. `body` (plain text) and
                `bodyHtml` (formatting) are both kept from its onChange.

                No AI-assist button sits over this field: its popover opened
                DOWNWARD across the whole editor and blocked typing. AI grammar
                help stays available through the "Check now" gate below, and the
                Subject field keeps its own small assist. */}
            <RichTextEditor
              ref={editorRef}
              html={initialHtmlRef.current}
              aria-label="Message"
              onChange={(html, text) => {
                setBodyHtml(html);
                setBody(text);
              }}
            />
          </Field>

          {/* Attachments — any file, no size cap (the Drive pipeline is
              resumable). Each uploads on pick and stages here; the send carries
              them inline. */}
          {canAttach && (
            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void handleFiles(files);
                }}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-ink-faint">
                  Any file — no size limit.
                </p>
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={uploading || pending.length >= MAX_MAIL_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon.attach className="h-3.5 w-3.5" />
                    Attach files
                  </span>
                </Button>
              </div>

              {uploadProgress.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
                  {uploadProgress.map((p) => (
                    <UploadProgressRow
                      key={p.id}
                      name={p.name}
                      fraction={p.fraction}
                    />
                  ))}
                </div>
              )}

              {uploadError && (
                <p
                  role="alert"
                  className="mt-1.5 text-[11px] text-[var(--state-overdue-ink)]"
                >
                  {uploadError}
                </p>
              )}

              {pending.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {pending.map((a, i) => (
                    <li
                      key={`${a.fileId ?? a.url}-${i}`}
                      className="flex items-center gap-2 rounded-inset bg-[var(--control)] px-2.5 py-1.5 text-[11px]"
                    >
                      <Icon.attach className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span className="max-w-[160px] truncate text-ink">
                        {a.name ?? "file"}
                      </span>
                      {a.sizeBytes != null && (
                        <span className="text-ink-faint">
                          {formatBytes(a.sizeBytes)}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${a.name ?? "file"}`}
                        onClick={() =>
                          setPending((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="shrink-0 rounded-full px-1 text-base leading-none text-ink-faint hover:text-ink"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* A grammar/spelling pass is mandatory before send — see `refusal`
              below, which folds `grammarRefusal` into the same one-reason
              gate as the recipient and transport checks. This panel is where
              that check actually runs and where its findings are reviewed;
              "checked" means the pass ran and was looked at, not that its
              suggestions were accepted — a person is always allowed to send
              their own wording. */}
          {(subject.trim() || body.trim()) && (
            <div className="mt-4 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-ink">
                  {grammarChecked
                    ? "✓ Spelling & grammar checked"
                    : "Spelling & grammar check required before sending"}
                </p>
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={checkingGrammar}
                  onClick={runGrammarCheck}
                >
                  {checkingGrammar
                    ? "Checking…"
                    : grammarChecked
                      ? "Re-check"
                      : "Check now"}
                </Button>
              </div>
              {grammarError && (
                <p className="mt-1.5 text-[11px] text-[var(--state-overdue-ink)]">
                  {grammarError}
                </p>
              )}
              {grammarSuggestions && (
                <div className="mt-2.5 space-y-2 border-t border-hairline pt-2.5">
                  {grammarSuggestions.subject && (
                    <div>
                      <p className="mb-1 text-[11px] text-ink-faint">
                        Suggested subject
                      </p>
                      <p className="rounded-inset bg-[var(--surface-raised)] p-2 text-sm text-ink">
                        {grammarSuggestions.subject}
                      </p>
                    </div>
                  )}
                  {grammarSuggestions.body && (
                    <div>
                      <p className="mb-1 text-[11px] text-ink-faint">
                        Suggested message
                      </p>
                      <p className="max-h-32 overflow-y-auto rounded-inset bg-[var(--surface-raised)] p-2 text-sm whitespace-pre-wrap text-ink">
                        {grammarSuggestions.body}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button
                      size="sm"
                      tone="ghost"
                      onClick={() => setGrammarSuggestions(null)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      size="sm"
                      tone="secondary"
                      onClick={() => {
                        setGrammarCheckedFor(grammarSuggestions.signature);
                        setGrammarSuggestions(null);
                      }}
                    >
                      Send as written
                    </Button>
                    <Button
                      size="sm"
                      tone="primary"
                      onClick={() => {
                        const nextSubject = grammarSuggestions.subject ?? subject;
                        const nextBody = grammarSuggestions.body ?? body;
                        setSubject(nextSubject);
                        setBody(nextBody);
                        /* Push the corrected text back into the rich editor. */
                        if (grammarSuggestions.body) {
                          const h = textToHtml(nextBody);
                          setBodyHtml(h);
                          editorRef.current?.setHtml(h);
                        }
                        setGrammarCheckedFor(textSignature(nextSubject, nextBody));
                        setGrammarSuggestions(null);
                      }}
                    >
                      Apply corrections
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-hairline px-6 py-4">
          {(state.error || saveState.error) && (
            <div className="mb-3">
              <InlineError
                compact
                message={(state.error ?? saveState.error) as string}
                code={state.errorCode}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] text-ink-faint">{refusal ?? ""}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Button tone="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              {/* Save Draft keeps an unfinished message without sending — no
                  recipient or grammar check required. */}
              <Button
                tone="secondary"
                size="sm"
                loading={saveState.isPending}
                disabled={!canSaveDraft || saveState.isPending || state.isPending}
                onClick={async () => {
                  const r = await saveDraft();
                  if (r.ok) (onSaved ?? onClose)();
                }}
              >
                {saveState.isPending ? "Saving…" : "Save draft"}
              </Button>
              <Button loading={state.isPending}
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
