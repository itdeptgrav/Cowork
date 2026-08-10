"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/Avatar";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { getRepository } from "@/lib/repositories";
import type { Conversation, Employee, Message } from "@/lib/domain";
/**
 * Where a forwarded message goes.
 *
 * Forwarding is a SEND, not a move: the original stays where it is and a copy
 * — the same text and the same attachments — is written to the conversation
 * chosen here. That is why this asks for a destination rather than confirming an
 * action: the question "which thread" is the whole of it.
 *
 * **The message is not annotated as forwarded**, and that is a limitation rather
 * than a decision: `Message` has no field for provenance, so anything this could
 * add would be text put into somebody's words. A thread that says "Forwarded
 * from Ada" needs a field on the document, and it is the honest way to do it
 * when it is wanted.
 *
 * Same dialog idiom as the rest of the product: a portal, a backdrop that closes
 * on click, Escape to dismiss.
 */
export function ForwardDialog({
  message,
  fromConversationId,
  onClose,
  onForwarded,
}: {
  message: Message;
  /** Hidden from the list — forwarding to the thread it is already in is a
   *  duplicate nobody means to send. */
  fromConversationId: string;
  onClose: () => void;
  onForwarded: (conversationTitle: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const conversations = useQuery((r) => r.listConversations(), []);
  /* The same hook every other surface asks with — one answer to "who am I",
     rather than a second read that could disagree with the thread behind it. */
  const viewerId = useViewerId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const all = (conversations.data ?? []).filter(
      (c) => c.id !== fromConversationId,
    );
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c) =>
      titleOf(c, viewerId).toLowerCase().includes(needle),
    );
  }, [conversations.data, fromConversationId, query, viewerId]);

  async function forwardTo(
    target: Conversation & { participants: Employee[] },
  ) {
    if (sendingTo) return;
    setSendingTo(target.id);
    setFailure(null);
    /* Text AND attachments. A forwarded photo with its caption dropped is a
       different message from the one somebody chose to pass on. */
    const result = await getRepository().sendMessage(
      target.id,
      message.text,
      message.attachments ?? [],
      null,
    );
    setSendingTo(null);
    if (!result.ok) {
      setFailure(result.message ?? "That message could not be forwarded.");
      return;
    }
    onForwarded(titleOf(target, viewerId));
    onClose();
  }

  /* The same guard every other portal dialog in the product uses: an
     expression, not state, so the prerender simply renders nothing. */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Forward message"
        className="frost-bar flex max-h-[min(560px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-panel border border-hairline shadow-[var(--deck-seat)]"
      >
        <div className="border-b border-hairline px-4 py-3">
          <p className="text-sm font-medium text-ink">Forward to</p>
          {/* What is being sent, so nobody forwards the wrong line from a menu
              opened on the wrong bubble. */}
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
            {message.text ||
              `${message.attachments?.length ?? 0} attachment${
                (message.attachments?.length ?? 0) === 1 ? "" : "s"
              }`}
          </p>
        </div>

        <div className="border-b border-hairline px-4 py-2.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {conversations.isLoading ? (
            <p className="px-2.5 py-3 text-xs text-ink-faint">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-ink-faint">
              {query
                ? "No conversation matches that."
                : "There is nowhere else to forward this yet."}
            </p>
          ) : (
            rows.map((c) => {
              const other = c.participants.find((p) => p.id !== viewerId);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={sendingTo !== null}
                  onClick={() => void forwardTo(c)}
                  className="flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors hover:bg-[var(--control)] disabled:opacity-50"
                >
                  <Avatar
                    initials={other?.initials ?? "#"}
                    hue={other?.hue ?? 0}
                    src={other?.profilePictureUrl}
                    name={titleOf(c, viewerId)}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">
                    {titleOf(c, viewerId)}
                  </span>
                  {sendingTo === c.id && (
                    <span className="text-[11px] text-ink-faint">Sending…</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {failure && (
          <p
            role="alert"
            className="border-t border-hairline px-4 py-2 text-[11px] text-[var(--state-overdue-ink)]"
          >
            {failure}
          </p>
        )}

        <div className="flex justify-end border-t border-hairline px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * What to call a conversation in a list.
 *
 * A group carries its own title; a direct message is named after the other
 * person, which is what makes "forward to Ada" findable by typing "Ada".
 */
function titleOf(
  c: Conversation & { participants: Employee[] },
  viewerId: string | null,
): string {
  if (c.title) return c.title;
  const other = c.participants.find((p) => p.id !== viewerId);
  return other?.displayName ?? "Conversation";
}
