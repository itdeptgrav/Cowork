"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useChat, useLocalParticipant } from "@livekit/components-react";

import { Icon } from "@/components/ui/Icons";
import { useRepo } from "@/lib/hooks/useRepository";
import { sendFailureReason } from "@/lib/rules/meetings/chatSendFailure";
import {
  isPersistableMeetId,
  mergeChat,
  oldestStoredMs,
  type ChannelMessage,
  type MergedChatMessage,
} from "@/lib/rules/meetings/mergeChat";
import { dayBreakLabel, needsDayBreak } from "@/lib/rules/messages/dayBreak";
import {
  employeeLedger,
  ephemeralLedger,
  guestLedger,
  type ChatLedger,
} from "@/lib/legacy-ui/meetingChatLedger";
import {
  FileDropZone,
  MessageAttachments,
  UploadProgressRow,
  filesFromClipboard,
} from "@/components/features/messages/MessageAttachments";
import type { MessageAttachment, StoredMeetingMessage } from "@/lib/domain";

/**
 * Chat inside the meeting — delivered live, and saved underneath.
 *
 * ## Two transports, one conversation
 *
 * Delivery still rides LiveKit's data channel (`useChat`): instant, free, works
 * for guests, reconnects on its own. Written UNDERNEATH it is a durable ledger —
 * every message is saved keyed by its LiveKit stream id, so a refresh does not
 * lose it and somebody joining late reads back what was said. `mergeChat` folds
 * the live copy and the stored copy into the one list a reader sees, and the
 * SERVER clock decides the order so everybody agrees on it. If the ledger is
 * absent or failing, chat still works exactly as it did before — see
 * `ChatLedger.canPersist`.
 *
 * A **task** meeting's room id (`meet-task-…`) is not a stored-meeting id and is
 * refused by the ledger, so those rooms stay live-only with no history — the
 * empty state says which kind of room this is.
 *
 * ## Files
 *
 * A file is uploaded straight to Drive (browser → Google, any size — the backend
 * never holds the bytes), then rides the ledger, not the data channel. The
 * sender sees it immediately from their own outbox; everyone else sees it as the
 * stored copy arrives.
 */
export function MeetingChat({
  meetId,
  guestSessionId,
  onUnreadChange,
}: {
  /** The meeting this chat belongs to. A `cowork_scheduled_meets` id persists;
      a task room's `meet-task-…` name stays live-only. */
  meetId?: string;
  /** Present in the guest room: reaches the same ledger through guest-session
      routes instead of a signed-in token. */
  guestSessionId?: string;
  onUnreadChange?: (n: number) => void;
}) {
  const { chatMessages, send, isSending } = useChat();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "";

  const repo = useRepo();

  /* One adapter, chosen by which room this is. The guest path is gated by the
     session id issued at join; the employee path by the repository's token.
     Either resolves to a non-persisting ledger when it cannot save (a task
     room, or a backend without the methods), and the panel stays ephemeral. */
  const ledger: ChatLedger = useMemo(() => {
    if (!meetId || !isPersistableMeetId(meetId)) return ephemeralLedger();
    if (guestSessionId) return guestLedger(meetId, guestSessionId);
    return employeeLedger(repo, meetId);
  }, [repo, meetId, guestSessionId]);

  /* The stored history, accumulated (never replaced) so a refresh of the recent
     page does not drop older messages already paged in. Keyed by id on merge. */
  const [stored, setStored] = useState<StoredMeetingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  /* Latched once the top of history has been paged in. The recent-page refresh
     raises `hasMore` whenever the meeting simply holds more than one page, which
     is not the same as "there is older history still to load" — without this
     latch that refresh would make the "Load earlier" button reappear a few
     seconds after the reader reached the top, offering a no-op. */
  const [reachedOldest, setReachedOldest] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  /* What I have sent this session: the attachments to show on my own bubble the
     instant it appears (the channel copy carries none), and the payload a failed
     send is retried from. */
  const [outbox, setOutbox] = useState<
    Record<string, { text: string; attachments: MessageAttachment[] }>
  >({});

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState<
    { id: string; name: string; fraction: number }[]
  >([]);
  /**
   * Why a send can fail, in words, or null.
   *
   * `send()` is awaited and caught: a rejected send leaves the text in the box
   * and says why, rather than emptying the box into silence (which read as the
   * message having sent). `livekit-client` mints the stream id with
   * `crypto.randomUUID()`, which is secure-context only — every send over plain
   * http throws — so the reason names https when that is the cause.
   */
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* The channel copies, normalised for the merge. */
  const channel: ChannelMessage[] = useMemo(
    () =>
      chatMessages.map((m) => ({
        id: m.id,
        senderId: m.from?.identity ?? "",
        senderName: m.from?.name || m.from?.identity || "",
        text: m.message,
        createdAtMs: m.timestamp,
      })),
    [chatMessages],
  );

  const merged: MergedChatMessage[] = useMemo(() => {
    const rows = mergeChat({ channel, stored, meId: me, failedIds });
    /* Inject my own just-sent attachments until the stored copy (which carries
       them) arrives — the channel copy never did. Only for my rows, only where
       the merge has not already supplied attachments. */
    return rows.map((r): MergedChatMessage =>
      r.mine && r.attachments.length === 0 && outbox[r.id]?.attachments.length
        ? { ...r, attachments: outbox[r.id].attachments }
        : r,
    );
  }, [channel, stored, me, failedIds, outbox]);

  /* Merge a freshly-read page into what is held, newest fields winning, without
     dropping older messages already paged in. */
  const absorb = useCallback((incoming: StoredMeetingMessage[]) => {
    if (incoming.length === 0) return;
    setStored((prev) => {
      const byId = new Map(prev.map((m) => [m.messageId, m]));
      for (const m of incoming) byId.set(m.messageId, m);
      return [...byId.values()];
    });
  }, []);

  /* The most recent page — the initial load, and the refresh that pulls in
     other people's saved messages and everyone's attachments. Cheap at a
     meeting's scale, and it never empties the panel on a failure. */
  const refresh = useCallback(async () => {
    if (!ledger.canPersist) return;
    const page = await ledger.list({ limit: 50 });
    absorb(page.messages);
    setHasMore((prev) => prev || page.hasMore);
  }, [ledger, absorb]);

  /* Load history when the panel opens (it mounts on open), and whenever the
     meeting changes. The reset on a change of ledger happens DURING render —
     React's pattern for state that belonged to a previous prop — rather than
     in the effect, which painted one frame of the old meeting's messages and
     then re-rendered to clear them. */
  const [loadedFor, setLoadedFor] = useState(ledger);
  if (loadedFor !== ledger) {
    setLoadedFor(ledger);
    setStored([]);
    setHasMore(false);
    setReachedOldest(false);
  }
  /* The load itself runs from a zero-delay timer: the compiler lint reads
     `refresh` as a state update and refuses it synchronously inside an effect,
     and a cancellable timer also means a ledger swapped twice in one tick
     loads once, not twice. */
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  /* Refresh shortly after any channel activity — a new live message is the cue
     that a stored copy (and any attachment) is landing — and on a slow interval
     as a backstop for an attachment whose channel copy was empty. */
  useEffect(() => {
    if (!ledger.canPersist) return;
    const t = setTimeout(() => void refresh(), 800);
    return () => clearTimeout(t);
  }, [chatMessages.length, ledger, refresh]);

  useEffect(() => {
    if (!ledger.canPersist) return;
    const iv = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(iv);
  }, [ledger, refresh]);

  /* Follow the conversation, but do not yank somebody who has scrolled up to
     read something back down on every arriving message. */
  const pinnedToBottomRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !pinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [merged.length]);

  /* The panel is open, so nothing here is unread. */
  useEffect(() => {
    onUnreadChange?.(0);
  }, [merged.length, onUnreadChange]);

  /* Persist a message the channel has already delivered. Fire-and-forget from
     the composer's point of view — it is on everybody's screen — so a failure
     is marked for a retry rather than surfaced as the send having failed. */
  const persist = async (
    messageId: string,
    text: string,
    attachments: MessageAttachment[],
  ) => {
    setOutbox((o) => ({ ...o, [messageId]: { text, attachments } }));
    const ok = await ledger.record({ messageId, text, attachments });
    if (ok) {
      setFailedIds((f) => f.filter((id) => id !== messageId));
      void refresh();
    } else {
      setFailedIds((f) => (f.includes(messageId) ? f : [...f, messageId]));
    }
  };

  const retry = async (messageId: string) => {
    const payload = outbox[messageId];
    if (!payload) return;
    setFailedIds((f) => f.filter((id) => id !== messageId));
    await persist(messageId, payload.text, payload.attachments);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    const attachments = pending;
    /* Not while a file is still uploading: `isSending` is LiveKit's send state,
       not the upload's, so without this a caption sent mid-upload would go with
       no file attached and the file would be orphaned. */
    if (
      (!text && attachments.length === 0) ||
      isSending ||
      uploading.length > 0
    )
      return;
    pinnedToBottomRef.current = true;

    /* The draft is cleared only once the send has actually resolved. Clearing
       first is what made a failure indistinguishable from a success: the box
       emptied either way. The stored write happens after — a failure THERE is a
       retry, not a lost message, because the channel already delivered it. */
    try {
      setSendError(null);
      const sent = await send(text);
      setDraft("");
      /* Clear only the attachments actually sent — one that finished uploading
         during the await must be kept for the next message, not discarded. */
      setPending((p) => p.filter((a) => !attachments.includes(a)));
      void persist(sent.id, text, attachments);
    } catch (err) {
      setSendError(sendFailureReason(err));
    }
  };

  const handleFiles = async (files: File[]) => {
    if (!ledger.canUpload || files.length === 0) return;
    pinnedToBottomRef.current = true;
    for (const file of files) {
      const rowId = `${file.name}-${file.size}-${uploadSeq()}`;
      setUploading((u) => [...u, { id: rowId, name: file.name, fraction: 0 }]);
      const att = await ledger.upload(file, (fraction) =>
        setUploading((u) =>
          u.map((r) => (r.id === rowId ? { ...r, fraction } : r)),
        ),
      );
      setUploading((u) => u.filter((r) => r.id !== rowId));
      if (att) setPending((p) => [...p, att]);
      else setSendError(`“${file.name}” could not be uploaded. Try again.`);
    }
  };

  const nowMs = useNowMinute();
  const dated = merged.map((m) => ({ createdAt: m.createdAtMs }));

  return (
    <FileDropZone
      canUpload={ledger.canUpload}
      onFiles={handleFiles}
      hint="Drop to share in the meeting"
      /* `flex-1`, not `h-full`: the panel's height is a stretched flex size,
         which a percentage below it does not reliably resolve against — see
         RoomSidePanel. Flexing into the column fills it regardless. */
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        /* `min-w-0` alongside `min-h-0` for the same reason the composer needs
           it: without it this list cannot be narrower than its widest child, so
           ONE over-wide message widens the whole column — and every
           right-aligned bubble then aligns to an edge that is off screen, where
           `overflow-x-hidden` clips it. A message vanishing off the side is not
           a message list being scrolled; it is one that was never told it may
           shrink. */
        className="min-h-0 min-w-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden px-2.5 py-3 sm:px-3"
        aria-live="polite"
        aria-label="Meeting chat"
      >
        {hasMore && !reachedOldest && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/20"
            >
              Load earlier messages
            </button>
          </div>
        )}

        {merged.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-white/45">
            No messages yet.
            <br />
            {ledger.canPersist
              ? "Chat here is saved with the meeting — the history stays, and anyone joining later can read it."
              : "Chat here stays with this meeting — it is not saved once the meeting ends."}
          </p>
        ) : (
          merged.map((m, i) => (
            <Fragment key={m.id}>
              {needsDayBreak(dated, i) && (
                <div className="flex justify-center py-2">
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50">
                    {dayBreakLabel(m.createdAtMs, nowMs)}
                  </span>
                </div>
              )}
              <MessageRow message={m} showStatus={ledger.canPersist} onRetry={retry} />
            </Fragment>
          ))
        )}
      </div>

      {sendError && (
        /* Above the composer rather than in the message list: the message never
           became a message, and putting a failure where messages go would imply
           it had. `role="alert"` so it is announced. */
        <p
          role="alert"
          className="shrink-0 border-t border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100"
        >
          {sendError}
        </p>
      )}

      {(pending.length > 0 || uploading.length > 0) && (
        <div className="shrink-0 space-y-1.5 border-t border-white/10 bg-white/[0.03] px-2.5 py-2">
          {uploading.map((u) => (
            <UploadProgressRow key={u.id} name={u.name} fraction={u.fraction} />
          ))}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pending.map((a, i) => (
                <span
                  key={a.fileId ?? a.url ?? i}
                  className="flex max-w-full items-center gap-1.5 rounded-full bg-white/10 py-1 pl-2.5 pr-1 text-[11px] text-white/80"
                >
                  <Icon.attach className="h-3 w-3 shrink-0" />
                  <span className="max-w-[160px] truncate">{a.name ?? "file"}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name ?? "attachment"}`}
                    onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/20 hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={submit}
        className="flex shrink-0 items-end gap-1.5 border-t border-white/10 p-2"
      >
        {ledger.canUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                void handleFiles(files);
              }}
            />
            <button
              type="button"
              aria-label="Attach a file"
              title="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon.attach className="h-4 w-4" />
            </button>
          </>
        )}
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
              void submit(e);
            }
          }}
          onPaste={(e) => {
            /* A pasted screenshot or a copied file uploads exactly as one
               dropped or picked — the same `handleFiles`, the same ledger —
               but only when the paste actually carries files. A plain-text
               paste falls through untouched, so pasting a link or a snippet
               still types into the box. Mirrors the Messages thread and the
               task chat, which is where this pattern was settled. */
            if (!ledger.canUpload) return;
            const pasted = filesFromClipboard(e.clipboardData);
            if (pasted.length) {
              e.preventDefault();
              void handleFiles(pasted);
            }
          }}
          rows={1}
          placeholder="Send a message"
          /**
           * **`min-w-0` is what keeps Send on screen.**
           *
           * A flex item defaults to `min-width: auto`, which means it refuses to
           * shrink below its own min-content — and a `<textarea>`'s min-content
           * comes from `cols`, which defaults to TWENTY characters. So this box
           * demanded ~180px no matter how narrow the column got; add the attach
           * button, the gaps and Send, and the row's minimum was wider than the
           * 340px panel. The row overflowed and Send was pushed off the right
           * edge, which is precisely what the report shows.
           *
           * `flex-1` alone never fixes this. It sets how spare space is shared,
           * not whether an item may shrink below its content.
           */
          className="max-h-24 min-h-[34px] w-full min-w-0 flex-1 resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={
            (!draft.trim() && pending.length === 0) ||
            isSending ||
            uploading.length > 0
          }
          title={uploading.length > 0 ? "Waiting for the file to finish uploading" : undefined}
          className="h-[34px] shrink-0 rounded-lg bg-white/15 px-3 text-[12px] font-medium text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </FileDropZone>
  );

  /* Older pages: page backwards from the oldest message currently held. The
     server's cursor is inclusive, so the boundary message comes back too and is
     de-duplicated by id on merge. */
  async function loadEarlier() {
    const before = oldestStoredMs(merged);
    const page = await ledger.list({ beforeMs: before || undefined, limit: 50 });
    absorb(page.messages);
    setHasMore(page.hasMore);
    /* The top of history is reached; latch it so the recent-page refresh cannot
       resurrect the button. Messages only ever get newer, so there is nothing
       older to page to after this. */
    if (!page.hasMore) setReachedOldest(true);
  }
}

/** A monotonic id for an in-flight upload row, without reading the clock. */
let _uploadSeq = 0;
function uploadSeq(): number {
  _uploadSeq += 1;
  return _uploadSeq;
}

/**
 * One message: a bubble aligned by who sent it, its attachments, and — for my
 * own — how far it has got.
 */
function MessageRow({
  message: m,
  showStatus,
  onRetry,
}: {
  message: MergedChatMessage;
  showStatus: boolean;
  onRetry: (id: string) => void;
}) {
  const mine = m.mine;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`min-w-0 max-w-[85%] ${mine ? "items-end" : "items-start"}`}>
        {/* The name is the only elastic thing on this row, so it is the only
            thing allowed to shrink. "Soumya Ranjan Mohapatra" on a phone would
            otherwise widen the row past the bubble's 85% cap and carry the time
            — and, for a guest, the badge saying they are one — off the edge.
            Whose message it is and when they sent it are what the row is FOR;
            the full name is still in `title`. */}
        <div className="mb-0.5 flex items-baseline gap-2">
          {!mine && (
            <span
              title={m.senderName || m.senderId || undefined}
              className="min-w-0 truncate text-[11px] font-semibold text-white/70"
            >
              {m.senderName || m.senderId || "Someone"}
            </span>
          )}
          {!mine && m.senderKind === "guest" && (
            <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] uppercase tracking-wide text-white/45">
              Guest
            </span>
          )}
          <span className="shrink-0 text-[10px] tabular-nums text-white/35">
            {formatTime(m.createdAtMs)}
          </span>
        </div>
        <div
          /* `min-w-0` so nothing inside can force the bubble past the 85% cap
             on its parent. Without it a child with a definite width — an
             attachment card, a long unbroken URL — sets the bubble's width and
             simply overflows, and the list's `overflow-x-hidden` then CLIPS it
             rather than scrolling, which is how a whole message can vanish off
             the right edge of a 300px panel. */
          className={`min-w-0 rounded-2xl px-3 py-2 ${
            mine
              ? "rounded-br-sm bg-[var(--accent,#3b82f6)]/85 text-white"
              : "rounded-bl-sm bg-white/10 text-white/90"
          }`}
        >
          {m.text && (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">
              <Linkified text={m.text} />
            </p>
          )}
          {m.attachments.length > 0 && (
            <div className={m.text ? "mt-1.5" : ""}>
              <MessageAttachments items={m.attachments} mine={mine} />
            </div>
          )}
          {!m.text && m.attachments.length === 0 && (
            /* An attachment message whose stored copy (with the file) has not
               arrived yet — a placeholder rather than an empty bubble. */
            <p className="flex items-center gap-1.5 text-[12px] italic text-white/55">
              <Icon.attach className="h-3 w-3" /> Sharing a file…
            </p>
          )}
        </div>
        {mine && showStatus && (
          <div className="mt-0.5 text-right text-[10px] text-white/40">
            {m.delivery === "failed" ? (
              <button
                type="button"
                onClick={() => onRetry(m.id)}
                className="text-amber-300 hover:underline"
              >
                Not saved · Retry
              </button>
            ) : m.delivery === "sent" ? (
              <span title="Saved with the meeting">Saved ✓</span>
            ) : (
              <span title="Sending">Sending…</span>
            )}
          </div>
        )}
      </div>
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
  /* `seen` is how many messages the panel held when it was last open. It is
     brought up to date DURING render while the panel is open — the pattern
     React documents for state derived from a prop change — not in an
     effect, which set state after every commit and so re-rendered the
     control bar once more for every arriving message. */
  const [seen, setSeen] = useState(0);
  if (panelOpen && seen !== chatMessages.length) setSeen(chatMessages.length);
  return panelOpen ? 0 : Math.max(0, chatMessages.length - seen);
}

/**
 * The time, at minute resolution, as something the panel SUBSCRIBES to.
 *
 * Day-break labels only need to know which day it is, and `Date.now()` in
 * render is impure — the React Compiler refuses it. Subscribing also closes a
 * real gap the old read had: a panel left open across midnight said “Today”
 * until something else happened to re-render it.
 */
const MINUTE_MS = 60_000;
const minuteNow = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
function subscribeMinute(onChange: () => void): () => void {
  const iv = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(iv);
}
function useNowMinute(): number {
  return useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
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
