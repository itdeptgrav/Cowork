"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Chip,
  Panel,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDateTime } from "@/lib/utils/format";
import { mailSendStatus, MAIL_STATUS_LABEL } from "@/lib/rules/mail/status";
import { MessageAttachments } from "@/components/features/messages/MessageAttachments";
import { MailRichText } from "./MailRichText";
import { MailCompose } from "./MailCompose";
import type { MailFolder, MailMessage } from "@/lib/domain";

/**
 * One conversation, both transports in the same list.
 *
 * A thread that began internally and continued by email renders as one
 * conversation — that is the whole point of the unified mailbox. The only place
 * transport appears is a small chip on the individual message, because "this
 * one left the company" is occasionally worth knowing and never worth a
 * separate screen.
 *
 * Opening the thread is what marks it read — the same rule the message thread
 * uses: a conversation you have looked at stops being unread, and the list's
 * badge and dot clear the moment you do. Reply / Reply All / Forward, a
 * per-message star, and move-to-Trash (Restore, in Trash) are the actions on it;
 * all reuse the repository methods the mailbox already exposes.
 */
export function MailThreadView({
  threadId,
  folder,
  onBack,
  onChanged,
}: {
  threadId: string;
  /** Where this thread was opened from — decides Trash vs Restore. */
  folder?: MailFolder;
  onBack: () => void;
  /** Fired after read/star/trash changes so the list and unread count refresh. */
  onChanged?: () => void;
}) {
  const messages = useQuery((r) => r.listMailMessages(threadId), [threadId]);
  const repo = useRepo();
  const me = useViewerId();
  const [reply, setReply] = useState<null | {
    mode: "reply" | "replyAll" | "forward";
  }>(null);
  const [busy, setBusy] = useState(false);

  /* Opening the thread marks the messages addressed to me read — once each, so
     a failed write (offline) does not retry in a loop, and a refetch does not
     re-mark what is already read. */
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    markedRef.current = new Set();
  }, [threadId]);
  useEffect(() => {
    const data = messages.data;
    if (!data || !me) return;
    const toMark = data.filter(
      (m) =>
        m.from.employeeId !== me &&
        !m.readBy.includes(me) &&
        !markedRef.current.has(m.id),
    );
    if (toMark.length === 0) return;
    toMark.forEach((m) => markedRef.current.add(m.id));
    let cancelled = false;
    void (async () => {
      for (const m of toMark) await repo.setMailRead(m.id, true);
      if (cancelled) return;
      messages.refetch();
      onChanged?.();
    })();
    return () => {
      cancelled = true;
    };
    // messages.refetch / onChanged are stable enough; re-run on new data only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data, me, repo, threadId]);

  if (messages.error)
    return (
      <QueryError
        queries={[messages]}
        message="This conversation could not be loaded."
      />
    );
  if (messages.isLoading) return <SkeletonRows rows={5} />;
  const list = messages.data ?? [];
  const last = list[list.length - 1];
  const inTrash = folder === "trash";
  const inSpam = folder === "spam";

  async function toggleStar(m: MailMessage) {
    if (!me) return;
    const on = !m.starredBy.includes(me);
    await repo.setMailFlag(m.id, "starred", on);
    messages.refetch();
    onChanged?.();
  }

  async function toggleImportant(m: MailMessage) {
    if (!me) return;
    const on = !m.importantBy.includes(me);
    await repo.setMailFlag(m.id, "important", on);
    messages.refetch();
    onChanged?.();
  }

  /* Spam is per-message like Trash; the control moves (or clears) the whole
     conversation, then steps back to the list. */
  async function spamThread(on: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      for (const m of list) await repo.setMailFlag(m.id, "spam", on);
    } finally {
      setBusy(false);
    }
    onChanged?.();
    onBack();
  }

  /* Trash is per-message in the model; a person thinks in conversations, so the
     control trashes (or restores) every message of the thread that is mine to
     move, then steps back to the list. */
  async function trashThread(on: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      for (const m of list) await repo.setMailFlag(m.id, "trashed", on);
    } finally {
      setBusy(false);
    }
    onChanged?.();
    onBack();
  }

  async function markThreadUnread() {
    if (busy || !me) return;
    setBusy(true);
    try {
      const inbound = list.filter((m) => m.from.employeeId !== me);
      for (const m of inbound) await repo.setMailRead(m.id, false);
    } finally {
      setBusy(false);
    }
    onChanged?.();
    onBack();
  }

  return (
    <div className="flex flex-col">
      {/* Action bar: step back, and the thread-level moves. Reply lives at the
          foot of the conversation, where it ends — the Gmail read. */}
      <div className="mb-4 flex items-center gap-1">
        <IconAction label="Back to list" onClick={onBack}>
          <Icon.chevronRight className="h-4 w-4 rotate-180" />
        </IconAction>
        <div className="flex-1" />
        {me && list.some((m) => m.from.employeeId !== me) && !inTrash && (
          <Button
            tone="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void markThreadUnread()}
          >
            Mark unread
          </Button>
        )}
        {/* Spam is its own move, distinct from Trash — reporting junk is not the
            same gesture as deleting a conversation you are done with. */}
        {!inTrash && (
          <IconAction
            label={inSpam ? "Not spam" : "Report spam"}
            disabled={busy}
            onClick={() => void spamThread(!inSpam)}
          >
            <Icon.blocked className="h-4 w-4" />
          </IconAction>
        )}
        <IconAction
          label={inTrash ? "Restore from trash" : "Move to trash"}
          disabled={busy}
          onClick={() => void trashThread(!inTrash)}
        >
          {inTrash ? (
            <Icon.inbox className="h-4 w-4" />
          ) : (
            <Icon.trash className="h-4 w-4" />
          )}
        </IconAction>
      </div>

      {/* The subject is the page's heading, not a truncated line in a toolbar. */}
      <h2 className="mb-4 px-1 text-[19px] leading-snug font-normal text-ink">
        {list[0]?.subject || "(no subject)"}
      </h2>

      {/* The whole conversation on ONE surface, messages separated by a hairline
          — not a stack of boxes, which is what made the old thread read as a
          form rather than a conversation. */}
      <Panel padded={false}>
        <div className="divide-y divide-hairline">
          {list.map((m) => (
            <MessageBlock
              key={m.id}
              message={m}
              viewerId={me}
              onToggleStar={() => void toggleStar(m)}
              onToggleImportant={() => void toggleImportant(m)}
            />
          ))}
        </div>
      </Panel>

      {/* Reply / Reply all / Forward — at the foot, after the last message. */}
      {last && (
        <div className="mt-4 flex flex-wrap gap-2 px-1">
          <Button
            tone="secondary"
            size="sm"
            onClick={() => setReply({ mode: "reply" })}
          >
            <span className="flex items-center gap-1.5">
              <Icon.reply className="h-3.5 w-3.5" />
              Reply
            </span>
          </Button>
          {/* Reply All only earns its place when there is more than one other
              person on the thread; otherwise it does exactly what Reply does. */}
          {countOthers(last, me) > 1 && (
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setReply({ mode: "replyAll" })}
            >
              Reply all
            </Button>
          )}
          <Button
            tone="ghost"
            size="sm"
            onClick={() => setReply({ mode: "forward" })}
          >
            <span className="flex items-center gap-1.5">
              <Icon.forward className="h-3.5 w-3.5" />
              Forward
            </span>
          </Button>
        </div>
      )}

      {reply && last && (
        <MailCompose
          mode={reply.mode}
          replyTo={last}
          viewerId={me}
          onClose={() => setReply(null)}
          onSent={() => {
            setReply(null);
            messages.refetch();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

/** A round ghost icon button — the thread-bar action shape. */
function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** How many OTHER people are on the message — decides whether Reply All differs
 *  from Reply. Counts the sender and every to/cc party that is not the viewer,
 *  deduped by address; bcc is never here (it was redacted on read). */
function countOthers(m: MailMessage, viewerId: string | null): number {
  const seen = new Set<string>();
  for (const p of [m.from, ...m.to, ...m.cc]) {
    if (p.employeeId && p.employeeId === viewerId) continue;
    seen.add(p.address.toLowerCase());
  }
  return seen.size;
}

function MessageBlock({
  message,
  viewerId,
  onToggleStar,
  onToggleImportant,
}: {
  message: MailMessage;
  viewerId: string | null;
  onToggleStar: () => void;
  onToggleImportant: () => void;
}) {
  const attachments = useQuery(
    (r) => r.listMailAttachments(message.attachmentIds),
    [message.attachmentIds.join(",")],
  );
  const initials = message.from.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const starred = viewerId ? message.starredBy.includes(viewerId) : false;
  const important = viewerId ? message.importantBy.includes(viewerId) : false;
  const status = mailSendStatus(message, viewerId);

  return (
    <article className="px-4 py-4 sm:px-5">
      {/* Header row: who, to whom, when, and the personal flags. */}
      <div className="flex items-start gap-3">
        <Avatar
          initials={initials || "??"}
          hue={2}
          name={message.from.displayName}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-ink">
              {message.from.displayName}
            </span>
            {message.from.address && (
              <span className="truncate text-[11px] text-ink-faint">
                &lt;{message.from.address}&gt;
              </span>
            )}
            {/* Sender-only status. "Seen" is internal-only and honest — Gmail
                cannot report an outside recipient's read. */}
            {status && (
              <Chip
                tone={
                  status === "failed"
                    ? "overdue"
                    : status === "seen"
                      ? "positive"
                      : "neutral"
                }
              >
                {MAIL_STATUS_LABEL[status]}
              </Chip>
            )}
            {message.transport === "gmail" && <Chip tone="neutral">Gmail</Chip>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-ink-faint">
            to {message.to.map((p) => p.displayName).join(", ") || "—"}
            {message.cc.length > 0 && (
              <> · cc {message.cc.map((p) => p.displayName).join(", ")}</>
            )}
            {/* Non-empty ONLY for the sender: every other read has already had
                this list emptied by `redactBcc`. */}
            {message.bcc.length > 0 && (
              <>
                {" · "}
                <span className="text-ink-muted">
                  bcc {message.bcc.map((p) => p.displayName).join(", ")}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="mr-1 hidden text-[11px] text-ink-faint sm:inline">
            {formatDateTime(message.sentAt ?? message.createdAt)}
          </span>
          <button
            type="button"
            onClick={onToggleImportant}
            aria-label={important ? "Unflag Important" : "Flag Important"}
            aria-pressed={important}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.flag
              className={`h-4 w-4 ${important ? "fill-[var(--state-overdue,#d1495b)] text-[var(--state-overdue,#d1495b)]" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onToggleStar}
            aria-label={starred ? "Unstar" : "Star"}
            aria-pressed={starred}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.star
              className={`h-4 w-4 ${starred ? "fill-[var(--state-warning,#e0a11b)] text-[var(--state-warning,#e0a11b)]" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* The date, on its own line at narrow widths where it did not fit above. */}
      <div className="mt-1 text-[11px] text-ink-faint sm:hidden">
        {formatDateTime(message.sentAt ?? message.createdAt)}
      </div>

      {/* A message that could not be delivered is KEPT and says so. */}
      {message.deliveryError && (
        <p className="mt-3 rounded-inset bg-[color-mix(in_srgb,var(--state-overdue)_18%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--state-overdue-ink)]">
          Not sent — {message.deliveryError}
        </p>
      )}

      {/* Body, full width — a formatted message renders its sanitised rich body,
          a plain one keeps its pre-wrap text. */}
      {message.bodyHtml ? (
        <div className="mt-3">
          <MailRichText html={message.bodyHtml} />
        </div>
      ) : (
        <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">
          {message.body}
        </p>
      )}

      {/* Inline attachments — the SAME component chat uses, so a mail image
          previews and a document downloads exactly as in a message thread. */}
      {(message.attachments ?? []).length > 0 && (
        <div className="mt-3">
          <MessageAttachments
            items={message.attachments ?? []}
            mine={viewerId ? message.from.employeeId === viewerId : false}
          />
        </div>
      )}

      {/* Legacy/Gmail attachments in the separate collection — a fallback for
          records that predate inline storage. */}
      {(attachments.data ?? []).length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {(attachments.data ?? []).map((a) => (
            <li
              key={a.id}
              className="rounded-inset bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[11px] text-ink-muted"
            >
              <span className="text-ink">{a.filename}</span> ·{" "}
              {Math.max(1, Math.round(a.sizeBytes / 1024))} KB
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
