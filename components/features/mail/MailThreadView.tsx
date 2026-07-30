"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  Button,
  Chip,
  Panel,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";
import { MailCompose } from "./MailCompose";
import type { MailMessage } from "@/lib/domain";

/**
 * One conversation, both transports in the same list.
 *
 * A thread that began internally and continued by email renders as one
 * conversation — that is the whole point of the unified mailbox. The only place
 * transport appears is a small chip on the individual message, because "this
 * one left the company" is occasionally worth knowing and never worth a
 * separate screen.
 */
export function MailThreadView({
  threadId,
  onBack,
}: {
  threadId: string;
  onBack: () => void;
}) {
  const messages = useQuery((r) => r.listMailMessages(threadId), [threadId]);
  const [reply, setReply] = useState<null | { mode: "reply" | "forward" }>(null);

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

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button tone="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {list[0]?.subject || "(no subject)"}
        </span>
        {last && (
          <>
            <Button
              tone="secondary"
              size="sm"
              onClick={() => setReply({ mode: "reply" })}
            >
              Reply
            </Button>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setReply({ mode: "forward" })}
            >
              Forward
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {list.map((m) => (
          <MessageCard key={m.id} message={m} />
        ))}
      </div>

      {reply && last && (
        <MailCompose
          mode={reply.mode}
          replyTo={last}
          onClose={() => setReply(null)}
          onSent={() => {
            setReply(null);
            messages.refetch();
          }}
        />
      )}
    </>
  );
}

function MessageCard({ message }: { message: MailMessage }) {
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

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar
          initials={initials || "??"}
          hue={2}
          name={message.from.displayName}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            {message.from.displayName}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            to {message.to.map((p) => p.displayName).join(", ")}
          </span>
        </span>
        {message.transport === "gmail" && <Chip tone="neutral">Gmail</Chip>}
        <span className="text-[11px] text-ink-faint">
          {formatDateTime(message.sentAt ?? message.createdAt)}
        </span>
      </div>

      {/* A message that could not be delivered is KEPT and says so. Somebody
          wrote it; discarding it would be worse than not sending it. */}
      {message.deliveryError && (
        <p className="mt-3 rounded-inset bg-[color-mix(in_srgb,var(--state-overdue)_18%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--state-overdue-ink)]">
          Not sent — {message.deliveryError}
        </p>
      )}

      <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">
        {message.body}
      </p>

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
    </Panel>
  );
}
