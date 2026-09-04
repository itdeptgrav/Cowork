"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, useLocalParticipant } from "@livekit/components-react";

/**
 * Chat inside the meeting.
 *
 * ## Why LiveKit's own chat and not a Firestore thread
 *
 * `useChat` rides the room's data channel, so a message costs nothing to store
 * and arrives without a round trip to a database. That is the right trade for
 * meeting chat specifically: it is scoped to the call, it is read while the
 * call is happening, and the meeting already has a durable record — the
 * transcript and the summary.
 *
 * **The consequence, stated rather than hidden:** messages are not persisted,
 * so somebody joining late does not see what was said before they arrived, and
 * nothing survives the meeting ending. Cowork's group and DM threads are where
 * a conversation that needs to outlive the call belongs, and the empty state
 * says so rather than leaving somebody to discover it by losing something.
 *
 * ## Links
 *
 * A pasted link is the single most common thing anybody puts in meeting chat —
 * the document being discussed. It is rendered as one, with `noopener` because
 * the target is whatever another participant typed.
 */
export function MeetingChat({ onUnreadChange }: { onUnreadChange?: (n: number) => void }) {
  const { chatMessages, send, isSending } = useChat();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "";

  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  /* Follow the conversation, but do not yank somebody who has scrolled up to
     read something back down on every arriving message. */
  const pinnedToBottomRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !pinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);

  /* The panel is open, so nothing here is unread. */
  useEffect(() => {
    onUnreadChange?.(0);
  }, [chatMessages.length, onUnreadChange]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;
    pinnedToBottomRef.current = true;
    void send(text);
    setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
        aria-label="Meeting chat"
      >
        {chatMessages.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-white/45">
            No messages yet.
            <br />
            Chat here stays with this meeting — it is not saved once the meeting
            ends.
          </p>
        ) : (
          chatMessages.map((m) => {
            const mine = m.from?.identity === me;
            return (
              <div key={m.id ?? `${m.timestamp}-${m.from?.identity}`}>
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold text-white/70">
                    {mine ? "You" : (m.from?.name ?? m.from?.identity ?? "Someone")}
                  </span>
                  <span className="text-[10px] tabular-nums text-white/35">
                    {formatTime(m.timestamp)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-white/90">
                  <Linkified text={m.message} />
                </p>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex shrink-0 items-end gap-2 border-t border-white/10 p-2"
      >
        <label className="sr-only" htmlFor="meeting-chat-input">
          Message the meeting
        </label>
        <textarea
          id="meeting-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            /* Enter sends, Shift+Enter is a newline — what every chat does, and
               what people's hands already expect. */
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          placeholder="Send a message"
          className="max-h-24 min-h-[34px] flex-1 resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || isSending}
          className="h-[34px] shrink-0 rounded-lg bg-white/15 px-3 text-[12px] font-medium text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * Unread count for the chat button, tracked while the panel is CLOSED.
 *
 * Lives outside `MeetingChat` deliberately: the count has to keep rising when
 * the panel is not mounted, which is exactly when the component that renders
 * messages does not exist.
 */
export function useChatUnread(panelOpen: boolean): number {
  const { chatMessages } = useChat();
  const [unread, setUnread] = useState(0);
  const seenRef = useRef(0);

  useEffect(() => {
    if (panelOpen) {
      seenRef.current = chatMessages.length;
      setUnread(0);
      return;
    }
    setUnread(Math.max(0, chatMessages.length - seenRef.current));
  }, [chatMessages.length, panelOpen]);

  return unread;
}

function formatTime(ts: number | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** A message with its URLs made clickable, and nothing else interpreted. */
function Linkified({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(https?:\/\/[^\s]+)/g), [text]);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-white/40 underline-offset-2 hover:decoration-white"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
