"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarStack, ZoomableAvatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  InlineError,
  Panel,
  QueryError,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import {
  invalidateQuery,
  useAction,
  useQuery,
  useRepo,
} from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { NewChatDialog } from "./NewChatDialog";
import { GroupSettings } from "./GroupSettings";
import { ForwardDialog } from "./ForwardDialog";
import { ChatPanel } from "@/components/features/tasks/ChatPanel";
import {
  pairedTaskChats,
  taskChatLabel,
  type PairedTaskChat,
} from "@/lib/rules/messages/taskChats";
import { TaskChatPicker } from "./TaskChatPicker";
import { TaskChatBrief } from "./TaskChatBrief";
import { VoiceRecorder } from "./VoiceRecorder";
import { CardComposer } from "./CardComposer";
import { MessageCardView } from "./MessageCardView";
import { useMentions } from "./MentionInput";
import { mentionTokensFor } from "./MessageText";
import { mentionSegments } from "@/lib/rules/messages/mentions";
import {
  MessageContextMenu,
  type MessageMenuItem,
} from "./MessageContextMenu";
import {
  MEDIA_BASE,
  MessageAttachments,
  FileDropZone,
  filesFromClipboard,
  formatBytes,
  UploadProgressRow,
  mediaUrl,
  mediaProxyUrl,
} from "./MessageAttachments";
import { GalleryLightbox } from "@/components/ui/GalleryLightbox";
import {
  collectConversationImages,
  galleryIndexOf,
} from "@/lib/rules/media/conversationGallery";
import { copyPlan } from "@/lib/rules/media/copyMessage";
import { COPIED_NOTICE, runCopyPlan } from "@/lib/utils/copyToClipboard";
import {
  formatClock,
  formatDate,
  formatDateTime,
  formatRelative,
  istDayKey,
} from "@/lib/utils/format";
import { linkifyMessage } from "@/lib/utils/linkify";
import { useNow } from "@/lib/hooks/useNow";
import { useAutoGrowTextarea } from "@/lib/hooks/useAutoGrowTextarea";
import { MESSAGE_PAGE_SIZE, MESSAGE_QUICK_REACTIONS } from "@/lib/domain";
import {
  conversationsNeedingDelivery,
  messageStatus,
  type MessageStatus,
} from "@/lib/rules/messages/messageStatus";
import { myReaction, reactionSummary } from "@/lib/rules/messages/reactions";
import { isPinned } from "@/lib/rules/messages/pins";
import { escapeAction } from "@/lib/rules/messages/escapeLadder";
import { searchThread } from "@/lib/rules/messages/threadSearch";
import { snippetAround, searchSegments } from "@/lib/rules/messages/globalSearch";
import { clearDraft, readDraft, saveDraft } from "./draftStorage";
import {
  mergeMessagePages,
  newMessagesIn,
  oldestLoadedAt,
  shouldLoadOlder,
} from "@/lib/rules/messages/pagination";
import type {
  Conversation,
  Employee,
  Message,
  MessageAttachment,
  MessageCard,
  MessageReply,
  MessageSearchHit,
} from "@/lib/domain";

/**
 * Messages.
 *
 * The surface had one real defect and it was not cosmetic: there was no way to
 * start a conversation. `createConversation` did not exist on the repository at
 * all, so anybody whose seeded threads were empty — most profiles — met a card
 * saying "No conversations" with nothing to do about it. An empty state that
 * cannot be left is a dead end, not an empty state.
 *
 * The layout is a two-pane thread view, and it renders **at every state**,
 * including with nothing in it. A single empty card in the middle of the page
 * tells you the feature is broken; a real list beside a real thread pane, both
 * empty, tells you it is new. The panes are Cowork's own frosted panels on the
 * iridescent field — the field is seen around and between them, never through
 * one carrying text.
 *
 * Messages are bubbles rather than a table of rows. That is a legibility
 * decision before a stylistic one: a conversation is read as an exchange, and
 * repeating the sender's name against every line makes a two-person thread
 * three times longer than the words in it. Own messages take deck ink — the
 * same fill as a primary control, so no new colour enters the system — and
 * everything else takes the raised surface. Per The Four Channels Rule nothing
 * here borrows a C1–C4 hue: saturated colour in Cowork means "score component".
 */

type ConversationView = Conversation & { participants: Employee[] };

export function MessagesPage({
  conversationId,
  closed = false,
  jumpToMessageId,
}: {
  conversationId?: string;
  /**
   * The reader deliberately LEFT a thread, rather than never opening one.
   *
   * **Why this is in the URL and not in state.** The right pane defaults to the
   * first conversation because an empty pane beside a full list reads as a
   * loading failure — right on arrival, wrong afterwards. Escape navigated to
   * `/messages` correctly and the default then put the reader straight back
   * into the thread they had just closed: on a wide screen the newest
   * conversation is both `all[0]` and, usually, the one they were reading. So
   * Escape appeared to do nothing at all.
   *
   * A `useState` flag cannot fix that. `/messages` and `/messages/[id]` are
   * separate route segments, so leaving a thread swaps which page component
   * renders and any state here is discarded on the way. The intent has to
   * survive the navigation, and the URL is the one thing that does — which is
   * also what this file already claims as its source of truth. Opening any
   * conversation navigates to `/messages/[id]` and drops the flag naturally.
   */
  closed?: boolean;
  /**
   * A message id from `?m=` — set when a global-search result is opened — that
   * the thread should scroll to once it loads. Read on the SERVER and passed in
   * as a prop, exactly like `closed`, so this stays free of `useSearchParams`
   * and the Suspense boundary a client search-params hook would force here.
   */
  jumpToMessageId?: string;
}) {
  const router = useRouter();
  const viewerId = useViewerId();
  const conversations = useQuery((r) => r.listConversations(), []);
  const repo = useRepo();
  /* Live: a message from anyone in any of the viewer's threads refreshes the
     list on its own. `watchConversations` is optional — a backend without a live
     channel simply omits it and the list still updates on the viewer's writes. */
  useEffect(() => repo.watchConversations?.(), [repo]);
  const [newChat, setNewChat] = useState<null | "direct" | "group">(null);
  const [search, setSearch] = useState("");

  const all = useMemo(
    () => sortByRecency(conversations.data ?? []),
    [conversations.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) =>
      [
        conversationTitle(c, viewerId),
        c.lastMessagePreview ?? "",
        ...c.participants.map((p) => p.displayName),
      ].some((v) => v.toLowerCase().includes(q)),
    );
  }, [all, search, viewerId]);

  /* Global message search. Besides filtering the chat list by name above,
     typing here searches message TEXT across every conversation the viewer is
     in — the "Messages" section under the list. Debounced so the fan-out fires
     on a pause, not on every keystroke. */
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);
  const messageHits = useQuery(
    (r) =>
      r.searchMessages && debouncedQuery
        ? r.searchMessages(debouncedQuery, 30)
        : Promise.resolve<MessageSearchHit[]>([]),
    [debouncedQuery],
  );
  const enrichedHits = useMemo(
    () =>
      (messageHits.data ?? []).map((h) => {
        const conv = all.find((c) => c.id === h.conversationId);
        return {
          ...h,
          chatTitle: conv ? conversationTitle(conv, viewerId) : "Conversation",
        };
      }),
    [messageHits.data, all, viewerId],
  );

  /* The route is the source of truth for what is open; the first conversation
     is only a default, and only until the reader has said otherwise — see
     `closed`. */
  const active =
    conversationId ?? (closed || !all.length ? undefined : all[0].id);
  const activeConversation = all.find((c) => c.id === active) ?? null;

  /**
   * **Tell the senders their messages arrived — the grey double tick.**
   *
   * Delivery is a fact about this CLIENT being connected, not about any thread
   * being open, so it is stamped for every conversation at once and from the
   * list rather than from `Thread`. Somebody sitting on the messages page with
   * chat A open has still received the message that just landed in chat B, and
   * a stamp that only fired for the open thread would leave the other sender
   * looking at a single tick indefinitely.
   *
   * **It cannot loop, and that is a property of the input rather than a guard
   * bolted on here.** The stamp lives on the conversation document, which
   * `watchConversations` is listening to, so writing unconditionally would mean
   * write → snapshot → refetch → write. `conversationsNeedingDelivery` returns
   * only the conversations where a message has arrived since our own last
   * stamp, so the pass that follows a write finds nothing to do and it stops.
   *
   * Nothing is awaited into the render and no failure surfaces: a stamp that
   * does not land costs somebody else's tick a few seconds, and is not worth an
   * error in front of the person who did nothing wrong.
   */
  useEffect(() => {
    if (!viewerId || !repo.markConversationsDelivered) return;
    const need = conversationsNeedingDelivery(all, viewerId);
    if (need.length === 0) return;
    void repo.markConversationsDelivered(need).catch(() => {});
  }, [repo, all, viewerId]);
  /**
   * Whether the reader ASKED for this thread, or the layout picked it.
   *
   * `active` falls back to `all[0]` so the wide layout does not show an empty
   * right pane. That default is a presentation choice and must not count as
   * reading — see `Thread`'s `opened` prop, which is the whole of the fix for a
   * badge that cleared itself.
   */
  const openedDeliberately = Boolean(conversationId);
  const unreadTotal = all.reduce((s, c) => s + c.unreadCount, 0);

  function openCreated(id: string) {
    setNewChat(null);
    /**
     * **Invalidate before navigating, not merely refetch.**
     *
     * Merged in from the incoming branch, which found this: `listConversations`
     * carries a 30s `staleTime`, and that TTL cache is keyed without the
     * repository version — so the write that just created this conversation
     * does not clear it. The `refetch()` below only forces THIS hook past the
     * TTL, and this hook is about to unmount: `/messages/[conversationId]` is a
     * different route segment, so the page remounts and its new hook starts at
     * nonce 0 with nothing forced. It was then served the list as it stood
     * BEFORE the conversation existed, found no match for the id in the URL,
     * and fell through to the empty state — offering to start a conversation
     * the reader had just finished starting. Taking that offer created a second
     * one, because `createConversation` deduplicates direct pairs only.
     *
     * The refetch stays: it warms the inflight entry at the new version, so the
     * remounted page joins that read instead of opening its own.
     */
    invalidateQuery("listConversations");
    conversations.refetch();
    router.push(`/messages/${id}`);
  }

  /**
   * A message was forwarded somewhere: open that conversation.
   *
   * **Half of this fix went missing.** `ForwardDialog` hands back the
   * destination's ID — its own comment says so, and it calls
   * `notifyRepositoryChanged()` before doing it — but the only caller was
   * feeding that id straight into a toast reading "Forwarded to
   * dm_GR0045_GR0108.", and going nowhere. So the reported defect stood: you
   * forward a message and are left in the thread you forwarded FROM, with no
   * way to see whether it landed.
   *
   * The same invalidate-then-navigate as `openCreated`, and for the same
   * reason: `listConversations` carries a 30s `staleTime` whose cache is keyed
   * without the repository version, so the send that just happened does not
   * clear it. Without the invalidate the destination opens showing the preview
   * it had BEFORE the forwarded message arrived.
   */
  function openForwarded(id: string) {
    invalidateQuery("listConversations");
    conversations.refetch();
    router.push(`/messages/${id}`);
  }

  return (
    /*
     * No page header.
     *
     * Messages is the one workspace whose two panes ARE the page: the left pane
     * already names itself with a search box over a list of conversations, and
     * the right one carries the other person's name and avatar. A title bar
     * saying "Messages" over that repeated the navigation tab that got you here
     * and spent ~44px of a view whose whole job is fitting a thread and its
     * composer on one screen without a second scrollbar.
     *
     * The "New message" button went with it. It and the + beside the search were
     * the same action twice, and the + is the one that sits where the list it
     * adds to lives — so the + inherits the filled treatment the button had.
     * The conversation count moved into the list, beside the thing it counts.
     */
    <>
      {conversations.error ? (
        <QueryError
          queries={[conversations]}
          message="Your conversations could not be loaded."
        />
      ) : (
        /* One fixed-height region rather than two independently growing panels:
           a thread scrolls inside itself, so the composer stays on screen and
           the page itself never grows a second scrollbar.

           **The height is the window minus the chrome, not a magic number.** It
           was `100vh - 188px`, totalled by hand, and it left ~80px of dead space
           under the panes: the page frame pads the bottom by up to 64px while
           the gap above the panes is at most 22px, so the surface sat high in a
           window it was supposed to fill. Now it takes the header and ONE gap
           off each end, so the space below the panes matches the space between
           them and the bar.

           The negative margin is what makes that possible. The frame's own
           `pb` is larger than the gap we want, and a page cannot shrink its
           parent's padding — so the difference is pulled back here. Without it
           the region would fit the window and then push a scrollbar's worth of
           padding past the bottom of it.

           **At every width, not only on the wide layout.** The height was
           `deck:` only, so below 1180px — an ordinary laptop window, not just a
           phone — the region had no definite height at all. `h-full` on the
           panel then resolved against an auto-sized grid row, `flex-1
           min-h-0` had nothing to be a fraction OF, and `overflow-y-auto` never
           engaged: the thread rendered at its full length and the PAGE scrolled
           instead. The composer went with it, so the box you type in sat below
           the fold of a conversation you had to scroll to the bottom of to
           reach — and opening a thread landed you at the top of the page rather
           than at its newest message, because the element holding the scroll
           position was not the one scrolling.

           `dvh` rather than `vh` now that this reaches small screens: mobile
           browsers count `vh` against the viewport with the address bar hidden,
           so a `vh` box is taller than what you can see and the composer hides
           under the chrome. They are the same number on a desktop.

           The floor drops to 420px below `deck:` — a landscape phone is
           genuinely shorter than 520px, and forcing that would reintroduce the
           page scroll this removes. */
        <div className="mb-[calc(var(--shell-gap)-var(--shell-bottom))] grid h-[calc(100dvh-var(--shell-top)-2*var(--shell-gap))] min-h-[420px] grid-cols-1 gap-4 deck:min-h-[520px] deck:grid-cols-12">
          <div
            className={`min-h-0 deck:col-span-4 ${conversationId ? "hidden deck:block" : ""}`}
          >
            <ConversationList
              conversations={filtered}
              total={all.length}
              unread={unreadTotal}
              ready={conversations.data !== null && conversations.data !== undefined}
              loading={conversations.isLoading}
              activeId={active}
              viewerId={viewerId}
              search={search}
              onSearch={setSearch}
              onNew={() => setNewChat("direct")}
              messageHits={enrichedHits}
              searching={debouncedQuery.length > 0}
              messageSearchSupported={typeof repo.searchMessages === "function"}
              searchLoading={messageHits.isLoading}
            />
          </div>

          <div
            className={`chat-select min-h-0 deck:col-span-8 ${!conversationId ? "hidden deck:block" : ""}`}
          >
            {activeConversation ? (
              <Thread
                key={activeConversation.id}
                conversation={activeConversation}
                viewerId={viewerId}
                opened={openedDeliberately}
                jumpTo={jumpToMessageId}
                onRead={() => conversations.refetch()}
                onSent={() => conversations.refetch()}
                onForwarded={openForwarded}
                /* `?closed=1` carries the intent across the segment change.
                   Without it the wide layout re-defaults straight back into
                   this very thread; on a narrow screen the navigation alone is
                   the whole of the change, since the list is what shows when
                   there is no `conversationId`. */
                onClose={() => router.push("/messages?closed=1")}
              />
            ) : (
              <NoThread
                loading={conversations.isLoading}
                empty={all.length === 0}
                /* The URL names a thread this list does not contain. That is
                   never an invitation to start another one — see `NoThread`. */
                missing={Boolean(conversationId)}
                /* Capped at five each. This pane is a way back in, not a second
                   copy of the list — which is already on screen beside it. */
                waiting={all.filter((c) => c.unreadCount > 0).slice(0, 5)}
                recent={all.slice(0, 5)}
                viewerId={viewerId}
                onDirect={() => setNewChat("direct")}
                onGroup={() => setNewChat("group")}
              />
            )}
          </div>
        </div>
      )}

      {newChat && (
        <NewChatDialog
          initialKind={newChat}
          onClose={() => setNewChat(null)}
          onCreated={openCreated}
        />
      )}
    </>
  );
}

/* ── Left pane ────────────────────────────────────────────────────────────── */

function ConversationList({
  conversations,
  total,
  unread,
  ready,
  loading,
  activeId,
  viewerId,
  search,
  onSearch,
  onNew,
  messageHits,
  searching,
  messageSearchSupported,
  searchLoading,
}: {
  conversations: ConversationView[];
  total: number;
  /** Unread across every conversation, not just the ones matching the search. */
  unread: number;
  /** Whether the count is real yet — a bare "0 conversations" while the first
      read is still in flight reads as "you have none", which is a lie. */
  ready: boolean;
  loading: boolean;
  activeId?: string;
  viewerId: string | null;
  search: string;
  onSearch: (v: string) => void;
  onNew: () => void;
  /** Messages matching the search, across every conversation, each carrying the
   *  title of the chat it belongs to. */
  messageHits: (MessageSearchHit & { chatTitle: string })[];
  /** Whether a (debounced) search term is currently in effect. */
  searching: boolean;
  /** Whether the backend offers cross-thread message search at all. */
  messageSearchSupported: boolean;
  searchLoading: boolean;
}) {
  return (
    <Panel padded={false} label="Conversations" className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint">
            <Icon.search className="h-4 w-4" />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search chats and messages"
            aria-label="Search chats and messages"
            className="h-9 w-full rounded-full bg-[var(--surface-sunken)] pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
        </div>
        {/* The filled treatment, inherited from the "New message" button this
            replaced: it is the only way to start a conversation now, so it is
            the primary action on the page and reads as one. `bg-ink` is deck ink
            against the body background, which resolves to a white pill on the
            dark theme and a black one on the light — the same pair the primary
            Button and the selected lens segment already use. */}
        <button
          type="button"
          onClick={onNew}
          aria-label="New message"
          title="New message"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-[var(--body-bg)] transition-opacity duration-[180ms] ease-[var(--ease-deck)] hover:opacity-90"
        >
          <Icon.plus className="h-4 w-4" />
        </button>
      </div>

      {/* The census the page header used to carry, moved beside the list it
          counts. One line at caption size instead of a title block. */}
      {ready && (
        <p className="shrink-0 px-3 pb-2 text-[11px] text-ink-faint">
          <span data-figure>{total}</span>
          {total === 1 ? " conversation" : " conversations"}
          {unread > 0 && (
            <>
              {" · "}
              <span data-figure>{unread}</span> unread
            </>
          )}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 scroll-slim">
        {loading ? (
          <div className="px-3 py-2">
            <SkeletonRows rows={5} />
          </div>
        ) : (
          <>
            {/* Chats — matched by name. While searching this is one of two
                sections, so it takes a heading; the default list needs none. */}
            {searching && conversations.length > 0 && (
              <p className="px-3 pt-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Chats
              </p>
            )}
            {conversations.length > 0 && (
              <ul>
                {conversations.map((c) => (
                  <li key={c.id}>
                    <ConversationRow
                      conversation={c}
                      viewerId={viewerId}
                      active={c.id === activeId}
                    />
                  </li>
                ))}
              </ul>
            )}
            {conversations.length === 0 && !searching && (
              <p className="px-3 py-8 text-center text-xs leading-relaxed text-ink-faint">
                {total === 0
                  ? "Nothing here yet. Start a conversation and it will appear in this list."
                  : `No conversation matches “${search}”.`}
              </p>
            )}
            {conversations.length === 0 && searching && (
              <p className="px-3 pt-2 pb-1 text-xs text-ink-faint">
                No chats match “{search}”.
              </p>
            )}

            {/* Messages — matched by their TEXT, across every conversation. The
                whole point of a global search: find the line, not just the
                chat. A hit opens its conversation at that message (`?m=`). */}
            {searching && messageSearchSupported && (
              <div className="mt-1 border-t border-hairline pt-2">
                <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  Messages
                </p>
                {searchLoading && messageHits.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-faint">Searching…</p>
                ) : messageHits.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-faint">
                    No messages match “{search}”.
                  </p>
                ) : (
                  <ul>
                    {messageHits.map((h) => (
                      <li key={`${h.conversationId}:${h.messageId}`}>
                        <Link
                          href={`/messages/${h.conversationId}?m=${h.messageId}`}
                          className="block rounded-inset px-3 py-2 transition-colors hover:bg-[var(--control)]"
                        >
                          <span className="block truncate text-[13px] font-medium text-ink">
                            {h.chatTitle}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-muted">
                            <span className="text-ink-faint">{h.senderName}: </span>
                            {searchSegments(snippetAround(h.text, search), search).map(
                              (seg, i) =>
                                seg.match ? (
                                  <mark
                                    key={i}
                                    className="rounded-[2px] bg-[color-mix(in_srgb,var(--accent,#1a73e8)_24%,transparent)] text-ink"
                                  >
                                    {seg.text}
                                  </mark>
                                ) : (
                                  <span key={i}>{seg.text}</span>
                                ),
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function ConversationRow({
  conversation: c,
  viewerId,
  active,
}: {
  conversation: ConversationView;
  viewerId: string | null;
  active: boolean;
}) {
  /* Real clock, resolved after mount — see `useNow`. */
  const now = useNow();
  const others = c.participants.filter((p) => p.id !== viewerId);
  const unread = c.unreadCount > 0;

  return (
    <Link
      href={`/messages/${c.id}`}
      aria-current={active ? "page" : undefined}
      /* A touch target, not a mouse one: 44px is the smallest thing a finger
         hits reliably, and these rows were 52px tall with 2.5 of padding —
         comfortable to click and tight to tap next to its neighbour. The
         extra vertical padding on a phone is what separates them. */
      className={`flex items-center gap-3 rounded-inset px-2.5 py-3 transition-colors duration-[180ms] ease-[var(--ease-deck)] sm:py-2.5 ${
        active ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"
      }`}
    >
      {c.kind === "group" ? (
        <AvatarStack
          people={others.slice(0, 2).map((p) => ({
            initials: p.initials,
            hue: p.hue,
            name: p.displayName,
            src: p.profilePictureUrl,
          }))}
          overflow={Math.max(0, others.length - 2)}
        />
      ) : others[0] ? (
        <Avatar
          initials={others[0].initials}
          hue={others[0].hue}
          src={others[0].profilePictureUrl}
          name={others[0].displayName}
          size="md"
        />
      ) : (
        <Avatar initials="—" hue={4} name="Empty conversation" size="md" />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-medium text-ink" : "text-ink"}`}
          >
            {conversationTitle(c, viewerId)}
          </span>
          {c.lastMessageAt && (
            <span
              data-figure
              className="shrink-0 text-[11px] text-ink-faint"
              title={new Date(c.lastMessageAt).toISOString()}
            >
              {relativeTime(c.lastMessageAt, now)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[11px] ${unread ? "text-ink-muted" : "text-ink-faint"}`}
          >
            {c.lastMessagePreview ?? "No messages yet"}
          </span>
          {/* A count, not a dot: "3 waiting" and "1 waiting" are different
              amounts of obligation and the list is where that is decided. */}
          {unread && (
            <span
              data-figure
              className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-ink px-1 text-[11px] leading-none text-[var(--body-bg)]"
            >
              {c.unreadCount}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/* ── Right pane ───────────────────────────────────────────────────────────── */

/**
 * The empty and unselected states, which are the same panel with different
 * words.
 *
 * Both carry the two actions, because the answer to "there is nothing here" and
 * to "nothing is open" is the same in a messaging product: start something. A
 * dead end with no control on it is what this surface had.
 *
 * **"Nothing open" is not the same as "nothing to do".** Closing a thread used
 * to leave an icon and the sentence "Choose a conversation from the list" — a
 * caption for the list already on screen, which told the reader nothing they
 * could not see. Where there ARE conversations, this pane now answers the
 * question somebody actually has at that moment: who is waiting on me. Only the
 * genuinely empty workspace keeps the plain placeholder, because there it is
 * true.
 */
function NoThread({
  loading,
  empty,
  missing,
  waiting,
  recent,
  viewerId,
  onDirect,
  onGroup,
}: {
  loading: boolean;
  empty: boolean;
  /**
   * The route names a conversation, and it is not in the list.
   *
   * Merged in from the incoming branch. The reader has not failed to choose a
   * thread — they are looking at one that did not arrive, and offering "Create
   * a group" there answers a question nobody asked and does real damage if
   * taken: `createConversation` deduplicates direct pairs only, so every press
   * writes another group with the same name and members.
   */
  missing: boolean;
  /** Conversations carrying unread messages, most recent first. */
  waiting: ConversationView[];
  /** The latest threads, for when nothing is unread. */
  recent: ConversationView[];
  viewerId: string | null;
  onDirect: () => void;
  onGroup: () => void;
}) {
  /* Withheld entirely on the not-found state — see `missing`. Both controls sit
     inside the ONE guard: letting only the first out would still leave "Create
     a group", which is the press that writes the duplicate.

     Belt and braces with the early return below, deliberately. The return is
     what protects the reader today; this is what protects them if somebody
     later gives the not-found state a body of its own and reaches for the
     shared `actions` to fill it. */
  const actions = (
    <>
      {!missing && (
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="primary" size="sm" onClick={onDirect}>
            <Icon.chat className="h-3.5 w-3.5" />
            Start a conversation
          </Button>
          <Button size="sm" onClick={onGroup}>
            <Icon.team className="h-3.5 w-3.5" />
            Create a group
          </Button>
        </div>
      )}
    </>
  );

  /* A thread that should be here and is not. Answered before the unread
     summary, because "where did that conversation go" is the question in front
     of the reader — not how much else is unread. */
  if (missing)
    return (
      <Panel label="No conversation open" className="grid h-full place-items-center">
        <div className="max-w-[44ch] px-6 py-10 text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-sunken)] text-ink-faint"
          >
            <Icon.chat className="h-6 w-6" />
          </span>
          <p className="text-[17px] leading-tight font-medium tracking-[-0.02em] text-ink">
            This conversation could not be opened
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            It is not in your list — it may have been removed, or you may no
            longer be in it. Pick another from the list on the left.
          </p>
        </div>
      </Panel>
    );

  if (loading)
    return (
      <Panel label="No conversation open" className="grid h-full place-items-center">
        <div className="w-full max-w-[360px]">
          <SkeletonRows rows={3} />
        </div>
      </Panel>
    );

  /* Nothing to be useful ABOUT. A first-run workspace gets the plain invitation
     it always had — inventing a summary of nothing would be worse than the
     placeholder it replaces. */
  if (empty)
    return (
      <Panel label="No conversation open" className="grid h-full place-items-center">
        <div className="max-w-[44ch] px-6 py-10 text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-sunken)] text-ink-faint"
          >
            <Icon.chat className="h-6 w-6" />
          </span>
          <p className="text-[17px] leading-tight font-medium tracking-[-0.02em] text-ink">
            No conversations yet
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Direct messages and group chats live here. You can reach anyone in
            the organisation — there is no request to send first.
          </p>
          <div className="mt-5 flex justify-center">{actions}</div>
        </div>
      </Panel>
    );

  const unreadTotal = waiting.reduce((s, c) => s + c.unreadCount, 0);
  /* Unread leads where there is any, because it is the only part of this that
     is actionable. Recent threads are a way back in, not a task. */
  const rows = waiting.length ? waiting : recent;

  return (
    <Panel label="No conversation open" className="h-full overflow-y-auto">
      <div className="mx-auto flex h-full max-w-[46ch] flex-col justify-center px-6 py-10">
        <p className="text-[17px] leading-tight font-medium tracking-[-0.02em] text-ink">
          {waiting.length
            ? `${unreadTotal} message${unreadTotal === 1 ? "" : "s"} waiting on you`
            : "You are up to date"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {waiting.length
            ? `Across ${waiting.length} conversation${waiting.length === 1 ? "" : "s"}. Nothing else is unanswered.`
            : "Nothing unread. Pick up where you left off, or start something new."}
        </p>

        <ul className="mt-4 space-y-0.5 border-t border-hairline pt-3">
          {rows.map((c) => (
            /* The list row itself, not a second design of one — the same
               avatars, the same unread badge, the same timestamp, so this pane
               and the list beside it cannot describe one thread differently. */
            <li key={c.id}>
              <ConversationRow
                conversation={c}
                viewerId={viewerId}
                active={false}
              />
            </li>
          ))}
        </ul>

        <div className="mt-5 border-t border-hairline pt-4">{actions}</div>
      </div>
    </Panel>
  );
}

function Thread({
  conversation: c,
  viewerId,
  opened,
  jumpTo,
  onRead,
  onSent,
  onForwarded,
  onClose,
}: {
  conversation: ConversationView;
  viewerId: string | null;
  /**
   * The reader navigated to this thread, rather than the layout defaulting to it.
   *
   * Only a deliberate open marks the conversation read. See the effect below.
   */
  opened: boolean;
  /** A message id from `?m=` — a global-search result the thread should scroll
   *  to once it has loaded. Paged in from history if it is older than the first
   *  window. Null when the thread was opened normally. */
  jumpTo?: string | null;
  onRead: () => void;
  onSent: () => void;
  /** A message was forwarded to this conversation id — open it, so the sender
   *  sees the copy arrive rather than being left where they forwarded FROM. */
  onForwarded: (conversationId: string) => void;
  /**
   * Leave the conversation — the last rung of the Escape ladder.
   *
   * Optional so a caller that has nowhere to go back TO simply does not pass
   * it, and Escape then stops at the rung above rather than appearing to do
   * nothing.
   */
  onClose?: () => void;
}) {
  const repo = useRepo();
  /**
   * **The draft is restored in a lazy initialiser, not an effect.**
   *
   * `Thread` is mounted with `key={conversation.id}`, so switching threads
   * remounts it and every `useState` here starts fresh — which is exactly why
   * an unsent message used to vanish. Reading storage as the initial value puts
   * it back on the FIRST render, so the composer is never briefly empty and
   * nothing flashes.
   *
   * Safe against hydration despite touching `localStorage` during render:
   * `Thread` only exists once `conversations.data` has resolved, which cannot
   * happen on the server, so this component never appears in server HTML for a
   * client render to disagree with. `readDraft` is defensive anyway and returns
   * null rather than throwing if that ever stops being true.
   *
   * Read once into `restored` rather than three times: `useState` initialisers
   * run in order, so the two below can close over it.
   */
  const [restored] = useState(() => readDraft(c.id));
  const [text, setText] = useState(restored?.text ?? "");
  const [pending, setPending] = useState<MessageAttachment[]>(
    restored?.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /**
   * Files that failed to upload, kept WITH their bytes so a retry costs a click.
   *
   * Separate from `pending`, which is what will actually be sent: a file with no
   * URL yet cannot be attached to a message, so putting these in the same list
   * would either send something broken or hold back the ones that worked.
   *
   * A `File` cannot be serialised, so unlike `pending` these do not survive a
   * refresh — the honest limit behind "where technically possible" in the draft
   * rules. They do survive switching conversations for as long as the thread
   * stays mounted, and the message text beside them is kept either way.
   */
  const [failedUploads, setFailedUploads] = useState<
    { id: string; file: File; message: string }[]
  >([]);
  /** One entry per file in the batch currently uploading — see `handleFiles`. */
  const [uploadProgress, setUploadProgress] = useState<
    { id: string; name: string; sizeBytes: number; fraction: number }[]
  >([]);
  /* Part of the draft: a reply restored without the message it answers is a
     different message from the one somebody started writing. */
  const [replyingTo, setReplyingTo] = useState<MessageReply | null>(
    restored?.replyTo ?? null,
  );
  /** The message a right-click opened a menu on, and where the pointer was. */
  const [menu, setMenu] = useState<{
    message: Message;
    x: number;
    y: number;
  } | null>(null);
  /** The message being forwarded, while the destination is being chosen. */
  const [forwarding, setForwarding] = useState<Message | null>(null);
  /**
   * One line of feedback for an action that has no other visible result.
   *
   * Copying, and a refusal to delete, both leave the thread looking exactly as
   * it did. Without this the menu item is indistinguishable from a broken one.
   */
  const [messageNotice, setMessageNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!messageNotice) return;
    const id = setTimeout(() => setMessageNotice(null), 3200);
    return () => clearTimeout(id);
  }, [messageNotice]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId !== null;
  /* In-conversation search: the bar under the header, the star filter inside
     it, and which match is current. The position is stored WITH the query it
     was reached in (`searchNav`), so typing on simply reads as "not yet
     navigated" rather than needing an effect to reset anything. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [starFilter, setStarFilter] = useState(false);
  const [searchNav, setSearchNav] = useState<{
    key: string;
    at: number;
  } | null>(null);
  /* Which pinned message the banner shows — clicking the banner jumps to it
     and cycles to the next, the way every chat with multiple pins works. */
  const [pinAt, setPinAt] = useState(0);

  /**
   * ## The task discussions this conversation carries
   *
   * A task is a thing one person handed another, so its thread belongs in the
   * DM between those two — see `pairedTaskChats`. The pairing is decided from
   * a task list the viewer can already read; no new repository method, and no
   * second source of truth about who is on what.
   *
   * `scope: "all"` rather than two reads of `mine` and `assigned_out`. It is
   * the UNFILTERED set of what the role-scoped queries already returned, which
   * is exactly the superset both directions of the pairing are drawn from —
   * so one read answers a question that would otherwise cost two.
   *
   * Only for a direct message. A group has no assigner/assignee pair, so there
   * is nothing to pair a task thread TO.
   */
  /* Read off the participants rather than the `others` list below, which is
     declared further down the component — reaching forward to it would be a
     temporal dead zone, and moving that declaration up to suit this would put
     it away from everything else that uses it. */
  const other =
    c.kind === "direct"
      ? (c.participants.find((p) => p.id !== viewerId) ?? null)
      : null;
  /**
   * **A TTL, because this thread bumps the repository constantly.**
   *
   * `listTasks` is deliberately absent from `METHOD_STALE_DEFAULTS`, so it
   * carries `staleTime: 0` and re-runs on every version bump — which is the
   * right default on a task page, and wrong here. Every message sent, received
   * or marked read in ANY conversation bumps the version, so without this the
   * cost of sitting in a thread is a full task-list read per message.
   *
   * 30s is safe for what this answers. The picker's membership changes only
   * when work is assigned, reassigned or closed — none of which is something
   * the person reading a message thread is doing — and the worst case is a
   * task appearing in the list up to half a minute late.
   */
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "all" }).then((p) => p.items),
    [],
    { staleTime: 30_000 },
  );
  const taskChats = useMemo(
    () =>
      other
        ? pairedTaskChats({
            tasks: tasks.data ?? [],
            viewerId,
            otherId: other.id,
          })
        : [],
    [tasks.data, viewerId, other],
  );

  /**
   * Which of the two conversations is on screen, and which task.
   *
   * The task id is held rather than an index: the list re-sorts when a rank
   * changes, and an index would silently point at a different task after a
   * reorder — the reader would be typing into a thread they did not choose.
   */
  const [pane, setPane] = useState<"normal" | "task">("normal");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  /* P1 first, so the picker opens on the work that matters most — and falls
     back to the head of the list whenever the held id is no longer offered
     (the task closed, the rank moved it, the pairing changed). */
  const openTask: PairedTaskChat | null =
    taskChats.find((t) => t.taskId === openTaskId) ?? taskChats[0] ?? null;
  /* Nothing shared means no tabs at all: a DM with somebody you have never
     assigned work to looks exactly as it did before this existed, rather than
     carrying a dead control. Falling back to the normal thread here is what
     stops the pane going blank if the last shared task closes while open. */
  const hasTaskChats = taskChats.length > 0;
  const showingTask = pane === "task" && hasTaskChats && openTask !== null;

  /**
   * **Persist the draft on every change, with no debounce.**
   *
   * The obvious refinement is to wait a moment before writing, and it is wrong
   * here for two reasons. The cleanup of a debounced effect cancels the pending
   * write, so the one case that matters most — type something, immediately click
   * another conversation — would cancel the save on the way out and lose exactly
   * what this exists to keep. And a page refresh gives no cleanup at all, so
   * anything still in the timer is gone. Writing a couple of kilobytes
   * synchronously per keystroke is far cheaper than either.
   *
   * **Never while editing.** `startEdit` replaces the composer's contents with
   * an existing message's text; storing that would restore somebody's edit of an
   * old message as a new draft the next time they opened the thread. The draft
   * already on disk is left untouched throughout, so cancelling an edit and
   * switching away still brings back what they had been writing before.
   */
  useEffect(() => {
    if (editing) return;
    saveDraft(c.id, { text, attachments: pending, replyTo: replyingTo });
  }, [c.id, text, pending, replyingTo, editing]);
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const typingSentRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  /* The composer grows with what is typed, up to `max-h-32` (128px), then
     scrolls — see `useAutoGrowTextarea`. Keyed on `text`, so a restored draft
     and the clear after send resize it too, not only keystrokes. */
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(composerRef, text, 128);
  /* The whole directory. Two uses: the contact-share picker (a contact is most
     often someone NOT already in this thread), and finding the viewer's OWN
     record below so a duplicate of them is kept out of the @-mention list.
     Cheap and cached; the mention list itself stays scoped to this thread. */
  const directory = useQuery((r) => r.listEmployees(), []);
  /* @-mention autocomplete over the people on THIS conversation, minus me.
     "Minus me" is by employee id AND by the login/email my own record carries:
     a DUPLICATE employee record of the viewer (the same person under a second
     id — or a shared account whose person appears again under their own id)
     would otherwise pass the id check and show up as a mentionable "other",
     which reads as "@ is offering me my own name". A real colleague never
     shares the viewer's `userId` (auth uid) or work email, so this only ever
     removes the viewer themselves. */
  const mentionPeople = useMemo(() => {
    const me = (directory.data ?? []).find((e) => e.id === viewerId) ?? null;
    const isSelf = (p: Employee) =>
      p.id === viewerId ||
      (!!me &&
        ((!!me.userId && p.userId === me.userId) ||
          (!!me.email && p.email === me.email)));
    return c.participants
      .filter((p) => !isSelf(p))
      .map((p) => ({ id: p.id, displayName: p.displayName }));
  }, [c.participants, directory.data, viewerId]);
  const mentions = useMentions({
    people: mentionPeople,
    text,
    setText,
    textareaRef: composerRef,
  });
  /* The attach control only appears where the backend actually accepts uploads;
     the in-memory prototype omits `uploadMessageAttachment`, so it stays off
     rather than failing silently. */
  const canUpload = typeof repo.uploadMessageAttachment === "function";
  /**
   * **One live page of 50, plus a stack of older pages fetched once each.**
   *
   * This used to grow a single window — 50, then 100, then 150 — re-reading
   * everything already on screen to add fifty more. It was correct, and the
   * reason was real: the thread is re-read on every live update, and one window
   * stays right under that refetch for free. It was also quadratic. Scrolling
   * back through a long conversation re-read it from the beginning at every
   * step, and each live update then re-read however far somebody had scrolled.
   *
   * Now the query below stays at exactly `MESSAGE_PAGE_SIZE` and is the only
   * thing that refetches, so a live update costs 50 reads however deep the
   * reader has gone. Older pages are fetched once, held here, and never asked
   * for again — history does not change.
   *
   * The reconciliation the old comment was avoiding is written down in
   * `mergeMessagePages`, which keys on message id: the live page's copy of a
   * message wins, so an edit or a deletion is picked up, and the same message
   * arriving in two pages cannot be drawn twice.
   *
   * No reset-on-conversation-change effect is needed: `Thread` is mounted with
   * `key={activeConversation.id}`, so switching threads remounts this component
   * and every one of its `useState`s starts fresh.
   */
  const messages = useQuery(
    (r) => r.listMessages(c.id, { limit: MESSAGE_PAGE_SIZE }),
    [c.id],
  );
  /** Pages of history, oldest fetch last. Never refetched. */
  const [olderPages, setOlderPages] = useState<Message[][]>([]);
  /** True once a page came back adding nothing — the top of the conversation. */
  const [exhausted, setExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [send, state] = useAction((r) =>
    r.sendMessage(
      c.id,
      text,
      pending.length ? pending : undefined,
      replyingTo,
      mentions.mentionIds(),
    ),
  );
  const [saveEdit, editState] = useAction((r) =>
    r.editMessage(c.id, editingId ?? "", text),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Set right before asking for a bigger window, and read (then cleared) by
     the scroll-pinning effect below — together they decide whether a new,
     bigger `list` means "someone typed" (pin to the bottom) or "someone
     scrolled up for history" (hold the reader's place instead). */
  const loadingOlderRef = useRef(false);
  const prevScrollHeightRef = useRef<number | null>(null);
  /** The element whose height the resize observer watches — the messages
   *  themselves, not the scroll port, which never changes size. */
  const contentRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the reader is following the conversation rather than reading back.
   *
   * True on open and while they sit at the bottom; false the moment they scroll
   * up. It is the difference between "keep me on the newest message" and "leave
   * my place alone", and only the reader's own scrolling changes it.
   */
  const pinnedRef = useRef(true);
  /**
   * Whether to offer the "jump to latest" button.
   *
   * Distinct from `pinnedRef` (48px, the auto-follow threshold): the button
   * appears only once the reader is MEANINGFULLY up the history — far enough
   * that the newest message is well off-screen — so it does not flicker in on a
   * stray pixel of scroll. State rather than a ref, because it is rendered.
   */
  const [showJump, setShowJump] = useState(false);

  const others = c.participants.filter((p) => p.id !== viewerId);
  /**
   * The thread as one sequence: history first, the LIVE page last.
   *
   * Order matters — `mergeMessagePages` lets later pages win, and the live page
   * is the one that was just re-read, so its copy carries the edit, the
   * tombstone and the newest `readBy`. History passed last would pin a message
   * to whatever it looked like when that page happened to be fetched.
   */
  /* `messages.data` in the deps, not a `?? []` computed outside: that fallback
     builds a NEW empty array on every render, so the memo would re-merge the
     whole thread every time anything at all changed. */
  const list = useMemo(
    () => mergeMessagePages([...olderPages, messages.data?.messages ?? []]),
    [olderPages, messages.data],
  );
  /* More to fetch while the deepest page we hold still says so, and while no
     page has come back adding nothing. The live page answers for a thread
     nobody has scrolled yet — including a short one, where it says false and
     the "scroll up" hint never appears. */
  const hasMoreHistory =
    !exhausted && (messages.data?.hasMore ?? false);

  /* A mirror of `list` for the async jump loop below, which outlives any one
     render: reading the thread from a closure would hand it the messages as
     they stood when the jump began, and every cursor after the first would be
     stale. */
  const listRef = useRef<Message[]>([]);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  /* One jump at a time — the loop pages history in, and two at once would
     fight over the scroll position. */
  const jumpingRef = useRef(false);

  /* The index is clamped on READ rather than normalised by an effect: a pin
     removed while the banner showed the last one simply shows the previous. */
  const pins = c.pinned ?? [];
  const pinIndex = pins.length ? Math.min(pinAt, pins.length - 1) : 0;
  const pinShown = pins.length ? pins[pinIndex] : null;

  /* Matches in thread order; navigation counts from the NEWEST match, the way
     in-chat search works everywhere. Searching only what is loaded is honest
     — the bar offers "Search earlier" rather than pretending to have read a
     thread it has not. */
  const matches = useMemo(
    () =>
      searchOpen
        ? searchThread(list, {
            query: searchQuery,
            starredOnly: starFilter,
            viewerId,
          })
        : [],
    [searchOpen, list, searchQuery, starFilter, viewerId],
  );
  /* The current match belongs to ONE query: a stored position only counts
     while the query it was reached in still stands, so editing the text drops
     back to "not yet navigated" with no state to reset. */
  const searchKey = `${starFilter ? "*" : ""}\u0000${searchQuery}`;
  const searchAt =
    searchNav && searchNav.key === searchKey ? searchNav.at : -1;

  /**
   * Fetch the next fifty older messages and keep the reader where they are.
   *
   * `loadingOlderRef` rather than the `loadingOlder` state for the guard: the
   * scroll handler runs on every frame of a scroll, and a state flag does not
   * take effect until the next render — so dozens of identical requests would
   * go out before the first one landed. The ref is set synchronously.
   *
   * `prevScrollHeightRef` is what the pinning effect uses afterwards to restore
   * the reader's place by exactly the height the new messages added, so the
   * thread does not jump when history is spliced in above them.
   */
  const loadOlder = useCallback(async () => {
    const el = scrollRef.current;
    if (!el || loadingOlderRef.current || exhausted) return;
    const cursor = oldestLoadedAt(list);
    /* No cursor means nothing is loaded, and asking without one would return
       the newest page again and stack it on top of itself. */
    if (!cursor) return;

    loadingOlderRef.current = true;
    prevScrollHeightRef.current = el.scrollHeight;
    setLoadingOlder(true);
    try {
      const page = await repo.listMessages(c.id, {
        limit: MESSAGE_PAGE_SIZE,
        before: cursor,
      });
      const known = new Set(list.map((m) => m.id));
      const fresh = newMessagesIn(page.messages, known);
      /* **Nothing new is how the top announces itself.** The cursor is
         inclusive, so a page always contains at least one message we already
         hold — "empty" cannot be the signal, and `hasMore` alone would keep
         offering a page that adds nothing for ever. */
      if (fresh.length === 0 || !page.hasMore) setExhausted(true);
      if (fresh.length > 0) setOlderPages((prev) => [fresh, ...prev]);
    } catch {
      /* A failed page is not the end of the conversation — leave `exhausted`
         alone so scrolling up again retries rather than pretending there is
         nothing older. */
    } finally {
      setLoadingOlder(false);
      /* The ref is released by the scroll-restoring effect, which runs after
         the new messages have been laid out. Releasing it here would let a
         second request start before the first one's height was measured. */
    }
  }, [repo, c.id, list, exhausted]);

  function onThreadScroll() {
    const el = scrollRef.current;
    if (!el) return;
    /* Following, or reading back? Answered on every tick from where they
       actually are, so it survives a scroll by any means — wheel, drag,
       keyboard, or the scroll-to-bottom above. The threshold is about one
       bubble: a reader a few pixels off the bottom is still following, and
       demanding an exact zero makes the pin feel like it randomly stops
       working. */
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distFromBottom < 48;
    /* The jump button rides a larger threshold than the pin so it does not
       appear the instant you nudge off the bottom. `setState` to the same value
       is a no-op in React, so this is free while sitting still. */
    setShowJump(distFromBottom > 240);
    if (
      !shouldLoadOlder({
        scrollTop: el.scrollTop,
        loading: loadingOlderRef.current,
        exhausted: !hasMoreHistory,
      })
    )
      return;
    void loadOlder();
  }

  /* Jump to the newest message and resume following it. Re-arms the pin at once
     because a message can land mid-animation, and without it the pin would
     still read "scrolled up" and hold the old place instead of the new bottom. */
  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  const typingNames = typingIds
    .map((id) => c.participants.find((p) => p.id === id)?.firstName)
    .filter((n): n is string => !!n);
  const typingLabel =
    typingNames.length === 0
      ? null
      : typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing…`
          : `${typingNames.length} people are typing…`;

  /* Opening a thread is what marks it read — the list's badge is a fact about
     the reader, so it clears where the reading happens rather than on a query
     somebody might mount twice. `onRead` refreshes the list so the badge goes
     at the same moment the messages appear.

     **Only while the tab is actually visible.** This fired on any change to
     `unreadCount`, and a thread stays mounted when the tab is in the
     background — so a message arriving while somebody was in another tab, or
     had the window minimised, marked itself read on arrival. The badge
     appeared and vanished on its own, and the message was never seen. A thread
     being open is not the same as a person looking at it.

     The listener is what makes the deferred case work: the badge survives
     until they come back, and clears the moment they do. */
  /* The live unread count, read at FIRE time rather than captured.
     The effect below depends on `c.id` alone, so anything closed over is the
     value from when the thread opened — which for a count that changes as
     messages arrive is the one value guaranteed to be wrong by the time it is
     used. */
  const unreadRef = useRef(c.unreadCount);
  useEffect(() => {
    unreadRef.current = c.unreadCount;
  });

  useEffect(() => {
    let cancelled = false;

    /**
     * **A thread the layout chose is not a thread anybody read.**
     *
     * `active` falls back to `all[0]` — the most recently active conversation —
     * so the wide layout never shows an empty right pane. Two consequences, and
     * between them they are the whole of "the badge clears itself":
     *
     *  · On `/messages` with nothing selected, the newest conversation is
     *    mounted by default. It marked itself read on mount, so a message that
     *    had just arrived was read before it was looked at.
     *  · A message arriving from somebody else re-sorts them to the top of the
     *    list, which changes `all[0]`, which changes this component's `key`.
     *    The thread REMOUNTS as a different conversation and marks that one
     *    read too — for nothing more than having received a message while the
     *    reader had the messages page open.
     *
     * On a narrow screen it is worse and completely invisible: the thread pane
     * is hidden with `display:none` rather than unmounted, so the conversation
     * being marked read is not on screen at all. `visibilityState` cannot see
     * that — it answers for the TAB, and the tab is perfectly visible.
     *
     * So reading requires an act. The route naming the conversation is that
     * act: it is set by clicking a row and by nothing else.
     */
    if (!opened) return;

    const markIfVisible = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible")
        return;
      /* Nothing unread means nothing to write. Checked here so a focus event on
         an already-read thread costs no round trip. */
      if (unreadRef.current === 0) return;
      repo.markConversationRead(c.id).then((r) => {
        if (!cancelled && r.ok) onRead();
      });
    };

    markIfVisible();
    document.addEventListener("visibilitychange", markIfVisible);
    window.addEventListener("focus", markIfVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", markIfVisible);
      window.removeEventListener("focus", markIfVisible);
    };
    /* **`c.unreadCount` is deliberately NOT a dependency.**
     *
     * With it here, the effect re-ran every time a message ARRIVED — so a
     * message landing in an already-open thread marked itself read the instant
     * it appeared. The badge showed 1 and cleared itself a moment later,
     * whether or not anybody had looked. That is the reported fault.
     *
     * Depending on the conversation id alone means read is a consequence of
     * OPENING the thread — the WhatsApp rule. A message that arrives while the
     * thread sits open in a background tab, or while you are reading a
     * different one, keeps its badge until you come back to it, which is what
     * the two listeners above are for.
     *
     * `onRead` and `repo` are omitted for the same reason: including them would
     * re-run this on every parent render and restore the behaviour being fixed.
     *
     * `opened` IS a dependency, and safely so: it changes only on navigation —
     * clicking a row while the same thread was already showing as the layout's
     * default flips it once, from false to true, and that is exactly the moment
     * the reader asked for it. No message arriving can move it.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, opened]);

  /* Live: new, edited, or deleted messages in THIS thread stream in without a
     refresh. Optional on the repository, so a backend with no live channel leaves
     the thread working from its own read. */
  useEffect(() => repo.watchConversationMessages?.(c.id), [repo, c.id]);

  /* Live typing + presence — both browser-direct on Firestore, both optional so
     the prototype simply shows neither. */
  useEffect(() => {
    setTypingIds([]);
    return repo.watchTyping?.(c.id, setTypingIds);
  }, [repo, c.id]);
  useEffect(() => {
    const ids = c.participants.filter((p) => p.id !== viewerId).map((p) => p.id);
    if (!ids.length) return;
    return repo.watchPresence?.(ids, setOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, c.id]);
  /* Stop signalling typing when the thread changes or unmounts. */
  useEffect(() => () => void repo.setTyping?.(c.id, false), [repo, c.id]);

  /* Pinned to the newest message, the way every thread in every messaging
     product opens. Without this a long conversation opens at its oldest line
     and the composer sits below content nobody asked to re-read.
     Keyed on `messages.data` rather than `list.length`: a settled query
     result changes identity exactly once per fetch, whether or not the
     count changed, so `loadingOlderRef` can never be left stuck `true` by a
     fetch that happened to land the same length.

     The one exception is `onThreadScroll` asking for more history — that
     grows `list` from the TOP, and pinning to the bottom on every one of
     those would fling the reader back to "now" the moment they tried to look
     at anything older. It restores their place instead, by exactly the
     height the newly-prepended messages added. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (loadingOlderRef.current) {
      if (prevScrollHeightRef.current !== null) {
        el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
      }
      loadingOlderRef.current = false;
      prevScrollHeightRef.current = null;
      return;
    }
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    /* `olderPages` as well as the live page, because those are now two separate
       events. A page of history landing is exactly the case the branch above
       exists for — it grows the thread from the TOP — and without it in the
       deps this effect would not run at all, leaving the reader's position
       unrestored and `loadingOlderRef` stuck true so no further page could ever
       be requested. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data, olderPages, c.id]);

  /**
   * **Stay at the bottom while the content is still settling.**
   *
   * The effect above pins once, the moment the messages arrive — and at that
   * moment the thread is not yet its final height. Attachments have not
   * loaded, so every image in the last screenful still occupies nothing. Each
   * one that decodes afterwards inserts its own height ABOVE the point we
   * scrolled to, and the newest messages walk down off the bottom of the pane.
   *
   * The symptom is the reported one: you open a conversation and land somewhere
   * in the middle of it, looking at older messages, with no way to tell that
   * anything moved. It is worst on exactly the threads where it matters most —
   * the ones with photographs in them.
   *
   * A `ResizeObserver` on the scrolling content is what closes it: any growth
   * from any cause — an image, a font swapping in, a bubble rewrapping when the
   * window narrows — re-pins, for as long as the reader has not deliberately
   * gone looking at something older.
   *
   * `pinnedRef` is what makes that "for as long as". Scrolling up clears it and
   * the observer stops touching the scroll position; coming back to within a
   * bubble's height of the bottom sets it again. Without that gate this would
   * be the bug it exists to fix, inverted — a reader dragged back to the newest
   * message every time an image somewhere above them finished loading.
   */
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      /* Never while older history is being spliced in at the top — that pass
         owns the scroll position and is restoring the reader's place. */
      if (!pinnedRef.current || loadingOlderRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
    /* `messages.data` as well as the thread, because on the first render there
       is no content element to observe — the pane is still showing its
       skeleton. Without it the observer would attach to nothing on exactly the
       load it exists for. Re-observing per fetch is one disconnect and one
       observe; the alternative is a callback ref threaded through a branch. */
  }, [c.id, messages.data]);

  async function submit() {
    if (uploading || state.isPending || editState.isPending) return;
    /* Editing reuses the composer: the same box, the same Enter-to-commit, but
       it saves the change to an existing message rather than writing a new one. */
    if (editing) {
      if (!text.trim()) return;
      const r = await saveEdit();
      if (r.ok) {
        setEditingId(null);
        setText("");
        messages.refetch();
      }
      return;
    }
    if (!text.trim() && pending.length === 0) return;
    const r = await send();
    if (r.ok) {
      /* **Only on success**, and only here. A send that fails leaves the text
         and the files exactly where they were, on screen and on disk, so the
         retry is pressing the button again rather than typing it out a second
         time. Clearing before the result came back would lose a message to a
         dropped connection. */
      clearDraft(c.id);
      setText("");
      setPending([]);
      setReplyingTo(null);
      setUploadError(null);
      mentions.reset();
      /* The message has gone. Files that never uploaded were never part of it,
         so holding a retry offer for them beside an empty composer would invite
         somebody to attach them to nothing. */
      setFailedUploads([]);
      typingSentRef.current = 0;
      void repo.setTyping?.(c.id, false);
      messages.refetch();
      onSent();
    }
  }

  function startReply(m: Message) {
    setEditingId(null);
    setReplyingTo({ messageId: m.id, senderName: m.senderName, text: m.text });
  }
  function startEdit(m: Message) {
    setReplyingTo(null);
    setEditingId(m.id);
    setText(m.text);
  }
  async function removeMessage(m: Message) {
    if (typeof window !== "undefined" && !window.confirm("Delete this message?"))
      return;
    const r = await repo.deleteMessage(c.id, m.id);
    if (r.ok) messages.refetch();
    /* The repository's own sentence — "You can only delete your own messages."
       A refusal that produced no visible change was indistinguishable from a
       button that did nothing. */
    else setMessageNotice(r.message ?? "That message could not be deleted.");
  }

  /**
   * Copy a message — its text AND its picture.
   *
   * The menu still greys the item out when there is neither: `writeText` on an
   * empty string succeeds and silently replaces whatever the person had on
   * their clipboard, which is worse than the action being unavailable.
   *
   * **What changed, and what did not.** A picture now goes on the clipboard
   * beside the caption, as one `ClipboardItem` carrying both — paste into a
   * document and the image lands, paste into a plain-text box and the words do.
   * A message that is only a screenshot used to be refused outright with "no
   * text to copy", which is the ordinary case for a screenshot and the reason
   * this was reported. Other attachments are still not copied: a PDF or a video
   * has no clipboard representation that survives a paste, and a filename put
   * where somebody expected a file is the outcome that comment warned about.
   *
   * The decision lives in `copyPlan` and the bytes in `runCopyPlan`, both
   * shared with `ChatPanel` — the two menus had already grown a duplicate of
   * this rule, written out twice with the same sentence.
   */
  async function copyMessage(m: Message) {
    const out = await runCopyPlan(copyPlan(m), MEDIA_BASE);
    setMessageNotice(out.ok ? COPIED_NOTICE[out.copied] : out.message);
  }

  /** Scroll a message into view and flash it — if it is on the page. */
  function flashMessage(id: string): boolean {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      el.animate(
        [
          { backgroundColor: "var(--control-active)" },
          { backgroundColor: "transparent" },
        ],
        { duration: 1600, easing: "ease-out" },
      );
    } catch {
      /* No Web Animations API — the scroll alone still answers. */
    }
    return true;
  }

  /**
   * Jump to one message — paging history in until it is loaded, if need be.
   *
   * A reply quote, a pinned banner and a search hit all point at a message
   * that may be older than anything fetched yet. Walking back reuses the same
   * machinery as scrolling up — `loadingOlderRef` and `prevScrollHeightRef`
   * around each page, so the pin effect restores the reader's place instead
   * of flinging them to the bottom — and it is BOUNDED: eight pages, not the
   * whole archive, with an honest sentence when the target is further still.
   */
  async function jumpToMessage(id: string) {
    if (flashMessage(id)) return;
    if (jumpingRef.current) return;
    jumpingRef.current = true;
    setLoadingOlder(true);
    try {
      for (let hop = 0; hop < 8; hop++) {
        const cursor = oldestLoadedAt(listRef.current);
        if (!cursor) break;
        const page = await repo.listMessages(c.id, {
          limit: MESSAGE_PAGE_SIZE,
          before: cursor,
        });
        const known = new Set(listRef.current.map((m) => m.id));
        const fresh = newMessagesIn(page.messages, known);
        if (fresh.length === 0 || !page.hasMore) setExhausted(true);
        if (fresh.length === 0) break;
        const el = scrollRef.current;
        if (el) {
          prevScrollHeightRef.current = el.scrollHeight;
          loadingOlderRef.current = true;
        }
        setOlderPages((prev) => [fresh, ...prev]);
        /* Let the page render, so the element — and the next cursor in
           `listRef` — exist before looking again. */
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (fresh.some((m) => m.id === id)) break;
        if (!page.hasMore) break;
      }
    } finally {
      jumpingRef.current = false;
      setLoadingOlder(false);
    }
    if (!flashMessage(id))
      setMessageNotice(
        "The original message is further back in this conversation.",
      );
  }

  /* Arrived from a global-search result (`?m=`): once the first page is in,
     scroll to that message — paging history in if it is older — exactly once
     per target, so a re-render does not yank the reader back to it. */
  const jumpedToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!jumpTo || jumpedToRef.current === jumpTo || !messages.data) return;
    jumpedToRef.current = jumpTo;
    void jumpToMessage(jumpTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, messages.data]);

  /** Go to match `i`, counted from the NEWEST. Wraps at either end. */
  function jumpToMatch(i: number) {
    if (matches.length === 0) return;
    const idx = ((i % matches.length) + matches.length) % matches.length;
    setSearchNav({ key: searchKey, at: idx });
    void jumpToMessage(matches[matches.length - 1 - idx]);
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setStarFilter(false);
    setSearchNav(null);
  }

  /**
   * Escape backs out of one thing at a time, innermost first.
   *
   * **The order is the whole feature.** Escape already meant something here —
   * it closes the search bar — and it means something in the image and video
   * lightboxes, which listen on `document` exactly as this does. A handler that
   * simply left the conversation would fire alongside those: pressing Escape to
   * dismiss a photo would dismiss the photo AND the thread behind it, and the
   * reader would be looking at their conversation list wondering what happened.
   *
   * So the rungs, in order:
   *
   *  1. **A modal is open** — do nothing at all. The lightboxes and dialogs mark
   *     themselves `aria-modal="true"` and run their own Escape; asking the DOM
   *     rather than tracking them here means one added later is covered without
   *     anybody remembering to come back to this list.
   *  2. **A menu, a forward dialog, group settings, a reply being composed, a
   *     message being edited** — cancel that. Each is a thing the reader
   *     deliberately started and would expect Escape to undo first.
   *  3. **The search bar** — close it. Its own handler only fires while the
   *     input has focus, so this is what makes Escape work after clicking away.
   *  4. **Otherwise** — leave the conversation.
   *
   * Text typed into the composer is deliberately NOT a rung. Escape does not
   * discard it, and closing the thread does not lose it: the draft is kept per
   * conversation, so coming back finds it exactly as it was.
   *
   * The ordering itself is `escapeAction`, so it can be asserted rather than
   * merely written down — see `lib/rules/messages/escapeLadder.ts`.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;

      const action = escapeAction({
        /* Asked of the DOM, not tracked here: the lightboxes mark themselves
           and so does any dialog added later. */
        modalOpen: document.querySelector('[aria-modal="true"]') !== null,
        menuOpen: menu !== null,
        forwarding: forwarding !== null,
        groupSettingsOpen: showGroupSettings,
        editing: editingId !== null,
        replying: replyingTo !== null,
        searchOpen,
        canClose: typeof onClose === "function",
      });

      switch (action) {
        case "close-menu":
          return setMenu(null);
        case "close-forward":
          return setForwarding(null);
        case "close-group-settings":
          return setShowGroupSettings(false);
        case "cancel-edit":
          return setEditingId(null);
        case "cancel-reply":
          return setReplyingTo(null);
        case "close-search":
          return closeSearch();
        case "close-thread":
          return onClose?.();
        case "none":
          return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  async function react(m: Message, emoji: string) {
    if (!repo.toggleMessageReaction) return;
    const r = await repo.toggleMessageReaction(c.id, m.id, emoji);
    if (r.ok) messages.refetch();
    else setMessageNotice(r.message ?? "The reaction could not be saved.");
  }

  /** Send a shared location, contact or poll — the card is the message, so it
   *  goes with no text and no attachments through the ordinary send path. */
  async function sendCard(card: MessageCard) {
    const r = await repo.sendMessage(c.id, "", undefined, null, [], card);
    if (r.ok) messages.refetch();
    else setMessageNotice(r.message ?? "That could not be sent.");
  }

  /** Toggle the viewer's vote on a poll shared in this conversation. */
  async function votePoll(messageId: string, optionId: string) {
    if (!repo.voteMessagePoll) return;
    const r = await repo.voteMessagePoll(c.id, messageId, optionId);
    if (r.ok) messages.refetch();
    else setMessageNotice(r.message ?? "Your vote could not be saved.");
  }

  async function toggleStar(m: Message) {
    if (!repo.toggleMessageStar) return;
    const had = Boolean(viewerId && (m.starredBy ?? []).includes(viewerId));
    const r = await repo.toggleMessageStar(c.id, m.id);
    if (r.ok) {
      /* Feedback matters here: a star is only visible as a small glyph, and
         un-starring removes even that. */
      setMessageNotice(had ? "Star removed." : "Message starred.");
      messages.refetch();
    } else setMessageNotice(r.message ?? "The star could not be saved.");
  }

  async function pinThis(m: Message) {
    if (!repo.pinMessage) return;
    const r = await repo.pinMessage(c.id, {
      messageId: m.id,
      senderName: m.senderName,
      text: m.text || "📎 Attachment",
    });
    if (r.ok) {
      setMessageNotice("Pinned to the top of this conversation.");
      /* The banner reads from the conversation record, which the list query
         owns — so the refresh that shows it is the list's, not the thread's. */
      onSent();
    } else setMessageNotice(r.message ?? "The message could not be pinned.");
  }

  async function unpinThis(messageId: string) {
    if (!repo.unpinMessage) return;
    const r = await repo.unpinMessage(c.id, messageId);
    if (r.ok) {
      setMessageNotice("Unpinned.");
      onSent();
    } else setMessageNotice(r.message ?? "The message could not be unpinned.");
  }

  /**
   * What the right-click menu offers for ONE message.
   *
   * Built here rather than in the list because these are the thread's own
   * actions — the composer it replies into, the repository it deletes through,
   * the dialog it forwards from — and a list that owned them would need all
   * three passed down anyway.
   *
   * **Both sides get the same menu.** Reply, Forward and Copy are the same act
   * whoever wrote the message. Delete is the one that differs, and it is shown
   * on both sides rather than hidden on one: an item missing from someone else's
   * message reads as a bug, where the greyed item and its sentence state the
   * rule the engine actually enforces.
   */
  function menuFor(m: Message): MessageMenuItem[] {
    const mine = m.senderId === viewerId;
    const deleted = m.isDeleted === true;
    const starredByViewer = Boolean(
      viewerId && (m.starredBy ?? []).includes(viewerId),
    );
    const pinnedHere = isPinned(c.pinned, m.id);
    const copy = copyPlan(m);
    return [
      {
        id: "reply",
        label: "Reply",
        disabled: deleted,
        reason: deleted ? "This message was deleted." : undefined,
        run: () => startReply(m),
      },
      {
        id: "forward",
        label: "Forward",
        disabled: deleted,
        reason: deleted ? "This message was deleted." : undefined,
        run: () => setForwarding(m),
      },
      /* Label, availability and reason from the one rule — see `copyMessage`.
         "Copy image" appears on a screenshot with no caption, where this used
         to read "Copy text" and be greyed out. */
      {
        id: "copy",
        label: copy.label,
        disabled: copy.disabled,
        reason: copy.reason ?? undefined,
        run: () => void copyMessage(m),
      },
      ...(repo.toggleMessageStar
        ? [
            {
              id: "star",
              label: starredByViewer ? "Unstar" : "Star",
              disabled: deleted && !starredByViewer,
              reason:
                deleted && !starredByViewer
                  ? "This message was deleted."
                  : undefined,
              run: () => void toggleStar(m),
            },
          ]
        : []),
      ...(repo.pinMessage
        ? [
            {
              id: "pin",
              label: pinnedHere ? "Unpin" : "Pin",
              disabled: deleted && !pinnedHere,
              reason:
                deleted && !pinnedHere
                  ? "This message was deleted."
                  : undefined,
              run: () => {
                if (pinnedHere) void unpinThis(m.id);
                else void pinThis(m);
              },
            },
          ]
        : []),
      ...(mine
        ? [
            {
              id: "edit",
              label: "Edit",
              disabled: deleted,
              reason: deleted ? "This message was deleted." : undefined,
              run: () => startEdit(m),
            },
          ]
        : []),
      {
        id: "delete",
        label: "Delete",
        danger: true,
        disabled: !mine || deleted,
        reason: deleted
          ? "This message was already deleted."
          : !mine
            ? "You can only delete your own messages."
            : undefined,
        run: () => void removeMessage(m),
      },
    ];
  }

  /* Typing is signalled at most once every few seconds while the box has content,
     and cleared the moment a message is sent — enough for a live ellipsis on the
     other side without a Firestore write per keystroke. */
  function onType(v: string) {
    setText(v);
    if (editing) return;
    const now = Date.now();
    if (v && now - typingSentRef.current > 3500) {
      typingSentRef.current = now;
      void repo.setTyping?.(c.id, true);
    }
  }

  /* Upload is its own step: the file lands on the backend first, then the send
     writes ONE message document carrying the returned attachment — so a failed
     upload never leaves a half-sent message, and the composer keeps the file
     staged until you actually send. */
  async function handleFiles(picked: File[]) {
    if (!repo.uploadMessageAttachment) return;
    const list = picked.slice(0, MAX_ATTACHMENTS);
    setUploadError(null);
    setUploading(true);
    /* One id per file, stable for the life of this batch — the progress
       callback closes over it rather than an index, since the batch's own
       order never changes but a re-render could otherwise recompute one. */
    const batch = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
    }));
    setUploadProgress(
      batch.map((b) => ({
        id: b.id,
        name: b.file.name,
        sizeBytes: b.file.size,
        fraction: 0,
      })),
    );
    /* Upload the batch in parallel; each result is independent, so a single bad
       file only drops itself and the rest still stage. */
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

    /* Paired with the batch by INDEX rather than filtered, because a failure
       has to be traced back to the File that produced it — that file is what
       the retry re-sends, and dropping it is what used to send somebody back
       to the file picker. `Promise.all` preserves order, so the index holds. */
    const ready: MessageAttachment[] = [];
    const failures: { id: string; file: File; message: string }[] = [];
    results.forEach((r, i) => {
      if (r.ok) ready.push(r.data);
      else
        failures.push({
          id: batch[i].id,
          file: batch[i].file,
          message: r.message,
        });
    });

    if (ready.length)
      setPending((prev) => [...prev, ...ready].slice(0, MAX_ATTACHMENTS));
    /* Appended, not replaced: a retry of two files where one fails again must
       not discard the other one still waiting. */
    if (failures.length) setFailedUploads((prev) => [...prev, ...failures]);
    setUploadError(failures.length ? failures[0].message : null);
  }

  /**
   * Send the failed files again — and only those.
   *
   * **The list is cleared BEFORE the retry, not after.** `handleFiles` appends
   * whatever fails to it, so clearing afterwards would wipe the fresh failures
   * it had just recorded and the retry button would vanish from files that are
   * still broken.
   *
   * Nothing already in `pending` is touched, which is what stops a retry
   * duplicating: a file that uploaded is a `MessageAttachment` in `pending` and
   * is not in this list at all, so it is never sent to Drive twice.
   */
  async function retryFailedUploads() {
    if (uploading || failedUploads.length === 0) return;
    const again = failedUploads.map((f) => f.file);
    setFailedUploads([]);
    setUploadError(null);
    await handleFiles(again);
  }

  return (
    /* The whole conversation is the drop target — see `FileDropZone`.
       Merged in from the incoming branch, which built the same feature as a
       shared component rather than as handlers on this one panel. Its version
       won on structure: the task discussion needs the identical behaviour, and
       two copies of it is two places for the depth counting to drift. */
    <FileDropZone
      canUpload={canUpload}
      onFiles={(files: File[]) => void handleFiles(files)}
      hint="Drop files to attach them to this conversation"
      className="flex h-full flex-col"
    >
    <Panel padded={false} label="Conversation" className="flex h-full flex-col">
      {/* Tighter on a phone at every edge: the header carries an avatar, two
          lines of text and up to three controls, and desktop gutters spent 32
          of the ~336px a 360px screen has on nothing. */}
      <header className="flex items-center gap-2 border-b border-hairline px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <Link
          href="/messages"
          aria-label="All conversations"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink deck:hidden"
        >
          <Icon.chevronRight className="h-4 w-4 rotate-180" />
        </Link>

        {c.kind === "group" ? (
          <AvatarStack
            people={others.slice(0, 3).map((p) => ({
              initials: p.initials,
              hue: p.hue,
              name: p.displayName,
              src: p.profilePictureUrl,
            }))}
            overflow={Math.max(0, others.length - 3)}
          />
        ) : (
          others[0] && (
            /* Clickable, so the person you are talking to can be seen properly
               rather than as a 40px disc. Falls back to a plain avatar by
               itself where they have set no picture — see `ZoomableAvatar`. */
            <ZoomableAvatar
              initials={others[0].initials}
              hue={others[0].hue}
              src={others[0].profilePictureUrl}
              name={others[0].displayName}
              zoomLabel={others[0].displayName}
              size="md"
            />
          )
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] leading-tight font-medium tracking-[-0.012em] text-ink">
            {conversationTitle(c, viewerId)}
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-ink-faint">
            {c.kind === "group"
              ? `${c.participants.length} people · ${others
                  .slice(0, 3)
                  .map((p) => p.firstName)
                  .join(", ")}${others.length > 3 ? " and others" : ""}`
              : online[others[0]?.id ?? ""]
                ? "Online"
                : (others[0]?.designation ?? "Direct message")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          aria-label="Search in this conversation"
          aria-pressed={searchOpen}
          title="Search in this conversation"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--control)] hover:text-ink ${
            searchOpen ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
          }`}
        >
          <Icon.search className="h-4 w-4" />
        </button>

        {c.kind === "direct" && others[0] && (
          <Link
            href={`/team/${others[0].id}`}
            className="hidden shrink-0 rounded-full bg-[var(--control)] px-3 py-1.5 text-xs text-ink transition-colors hover:bg-[var(--control-hover)] sm:inline-flex"
          >
            View profile
          </Link>
        )}
        {c.kind === "group" && (
          <button
            type="button"
            onClick={() => setShowGroupSettings(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--control)] px-3 py-1.5 text-xs text-ink transition-colors hover:bg-[var(--control-hover)]"
          >
            <Icon.settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Group info</span>
          </button>
        )}
      </header>

      {showGroupSettings && (
        <GroupSettings
          conversation={c}
          viewerId={viewerId}
          onClose={() => setShowGroupSettings(false)}
          onChanged={onSent}
        />
      )}

      {/**
        * The two conversations this pane can hold.
        *
        * Rendered only where there is a second one to switch to — a DM with
        * somebody you have never exchanged work with looks exactly as it did
        * before this existed, rather than carrying a control that leads
        * nowhere.
        *
        * A tab bar rather than a segmented control: these are two threads, not
        * two views of one, and the pane below changes entirely.
        */}
      {/**
        * A full-width segmented control, on the design system's own tokens.
        *
        * **The Capsule Is The Control Rule** (`.impeccable/surfaces` §Radius):
        * if a person can click it, it is fully rounded. An earlier pass drew
        * these as browser tabs with square top corners, which read well on its
        * own and was the one shape this system does not have.
        *
        * So the treatment is the `Segmented` primitive's, to the token: a
        * `--surface-sunken` track — the brief names that colour "segmented
        * track" — holding a `3px` gutter, with the selected option raised on
        * `bg-ink` and the unselected one carrying no fill at all. That is what
        * makes a track-and-pill legible without a hue: the whole product says
        * "selected" this way, and per The Four Channels Rule a saturated colour
        * here would claim to be a score component.
        *
        * **Hand-rolled rather than `<Segmented>`, for one structural reason.**
        * The task picker is a `<select>` and it has to be a SIBLING of the
        * option's button — a `<select>` nested inside a `<button>` is invalid
        * HTML and browsers do not open it. `Segmented` takes options as
        * strings, so expressing this through it would mean teaching a shared
        * primitive about trailing interactive content for one caller. The
        * classes below are copied from it deliberately; `segmentedParity`
        * in the test beside this file is what keeps them honest.
        */}
      {hasTaskChats && (
        <div className="border-b border-hairline px-2.5 py-2 sm:px-4">
        <div
          role="radiogroup"
          aria-label="Conversations with this person"
          onKeyDown={(e) => {
            /* The same roving arrow keys the primitive gives its options, so
               this control is not the one segmented thing in the product that
               a keyboard cannot move through. */
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            setPane(showingTask ? "normal" : "task");
          }}
          className="flex w-full gap-0.5 rounded-full bg-[var(--surface-sunken)] p-[3px]"
        >
          {/* Wrapped in a div it does not strictly need, so that the two
              segments are STRUCTURALLY identical.

              They are both `flex-1 basis-0 min-w-0` and should therefore split
              the track evenly whatever they contain — and they did not: a bare
              `<button>` beside a `<div>` wrapper measured 268 / 244, a 24px
              lean, because the two resolve their flex base size differently.
              Making both a wrapper holding a button measures 256 / 256. The
              chevron was never the cause; it lives inside the second wrapper
              and takes its room from that segment's own label. */}
          <div
            className={`relative flex min-w-0 flex-1 items-center rounded-full transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              !showingTask
                ? "bg-ink text-[var(--body-bg)]"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={!showingTask}
              tabIndex={!showingTask ? 0 : -1}
              onClick={() => setPane("normal")}
              className="min-w-0 flex-1 truncate rounded-full px-3 py-1.5 text-sm font-medium tracking-[-0.012em]"
            >
              Normal chat
            </button>
          </div>

          {/* The tab and its task picker are ONE control: choosing a task is
              choosing which task chat to be in, so a separate dropdown beside
              the tab would be two controls for one decision. Selecting from it
              switches to this tab, which is what somebody means by picking a
              task while reading the normal thread. */}
          <div
            className={`relative flex min-w-0 flex-1 items-center rounded-full transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              showingTask
                ? "bg-ink text-[var(--body-bg)]"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={showingTask}
              tabIndex={showingTask ? 0 : -1}
              onClick={() => setPane("task")}
              /**
               * **The task's own name, not the word "Task chat".**
               *
               * The segment used to say what KIND of thread it was, which the
               * reader learns once and then never needs again — and the thing
               * they do need, which task, was spent on a row underneath. So the
               * rank and the subject take the label: `P1 · Redesign the deck`.
               * `taskChatLabel` builds it, the same function the picker uses, so
               * the tab and the menu row for one task can never read differently.
               *
               * The accessible name keeps "Task chat" in front, because out of
               * context "P1 · Redesign the deck" does not say it is a
               * conversation, and this is a radio in a pair.
               */
              aria-label={
                openTask
                  ? `Task chat — ${taskChatLabel(openTask)}`
                  : "Task chat"
              }
              className={`min-w-0 flex-1 truncate rounded-full py-1.5 text-sm font-medium tracking-[-0.012em] ${
                taskChats.length > 1 ? "ps-3 pe-1" : "px-3"
              }`}
            >
              {openTask ? taskChatLabel(openTask) : "Task chat"}
            </button>

            {/**
              * A SPLIT control, and the split is load-bearing: the picker owns
              * the chevron alone, never the label, so clicking the segment
              * still switches to it while the chevron opens the list.
              *
              * Absent entirely on a single shared task — a menu whose only
              * option is what is already open is a control with nothing to
              * decide, and the label takes its padding back.
              */}
            {taskChats.length > 1 && (
              <TaskChatPicker
                chats={taskChats}
                openTaskId={openTask?.taskId ?? null}
                onPick={(id) => {
                  setOpenTaskId(id);
                  setPane("task");
                }}
              />
            )}
          </div>

        </div>

          {/* What the task actually asks for.

              This row used to repeat the rank and the title, which the segment
              above now carries itself — so it holds the thing that was missing
              instead: the brief and the deliverables, behind a disclosure.
              Only while the task pane is open, because it describes that task
              and would be noise over the direct conversation. */}
          {showingTask && openTask && <TaskChatBrief chat={openTask} />}
        </div>
      )}

      {/**
        * The task discussion, in place of the direct one.
        *
        * `key` on the task id so switching tasks remounts rather than
        * reconciling: the panel holds a draft, a reply quote and a staged
        * upload batch per task, and carrying any of those across a switch
        * would put one task's half-written message in another task's composer.
        */}
      {showingTask && openTask ? (
        <ChatPanel
          key={openTask.taskId}
          taskId={openTask.taskId}
          status={openTask.status}
          embedded
        />
      ) : (
        <>

      {/* In-conversation search. It reads what is LOADED — the live page plus
          fetched history — and says so: "Search earlier" pulls another page in
          rather than the bar pretending to have read the whole archive. */}
      {searchOpen && (
        <div className="flex items-center gap-1.5 border-b border-hairline px-4 py-2">
          <Icon.search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <input
            autoFocus
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              /* Enter walks to the next older match, the way in-chat search
                 works everywhere; Escape closes the bar. */
              if (e.key === "Enter") {
                e.preventDefault();
                jumpToMatch(searchAt + 1);
              }
              if (e.key === "Escape") closeSearch();
            }}
            placeholder={
              starFilter ? "Search starred messages" : "Search in this conversation"
            }
            aria-label="Search in this conversation"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          {(searchQuery.trim() || starFilter) && (
            <span
              data-figure
              className="shrink-0 text-[11px] text-ink-faint"
              aria-live="polite"
            >
              {matches.length === 0
                ? "No matches"
                : searchAt >= 0
                  ? `${searchAt + 1} of ${matches.length}`
                  : `${matches.length} ${matches.length === 1 ? "match" : "matches"}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => jumpToMatch(searchAt + 1)}
            disabled={matches.length === 0}
            aria-label="Older match"
            title="Older match"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
          >
            <Icon.chevronDown className="h-3.5 w-3.5 rotate-180" />
          </button>
          <button
            type="button"
            onClick={() =>
              jumpToMatch(searchAt <= 0 ? matches.length - 1 : searchAt - 1)
            }
            disabled={matches.length === 0}
            aria-label="Newer match"
            title="Newer match"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
          >
            <Icon.chevronDown className="h-3.5 w-3.5" />
          </button>
          {repo.toggleMessageStar && (
            <button
              type="button"
              onClick={() => setStarFilter((v) => !v)}
              aria-pressed={starFilter}
              aria-label="Only starred messages"
              title="Only starred messages"
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--control)] ${
                starFilter ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
              }`}
            >
              <Icon.star className="h-3.5 w-3.5" />
            </button>
          )}
          {hasMoreHistory && (
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="shrink-0 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-[var(--control-hover)] disabled:opacity-50"
            >
              {loadingOlder ? "Loading…" : "Search earlier"}
            </button>
          )}
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="shrink-0 rounded-full px-1.5 text-base leading-none text-ink-muted hover:text-ink"
          >
            ×
          </button>
        </div>
      )}

      {/* The pinned banner — the THREAD's bookmark, shown to everyone in it.
          Clicking jumps to the message and, with several pins, cycles to the
          next so each click reads a different one. */}
      {pinShown && (
        <div className="flex items-center gap-2 border-b border-hairline bg-[var(--surface-sunken)] px-4 py-2">
          <Icon.pin className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <button
            type="button"
            onClick={() => {
              void jumpToMessage(pinShown.messageId);
              if (pins.length > 1) setPinAt((pinIndex + 1) % pins.length);
            }}
            title="Go to the pinned message"
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-xs text-ink">
              <span className="font-medium">
                {pinShown.senderName || "Pinned"}
              </span>
              {pinShown.text ? (
                <span className="text-ink-muted">{` · ${pinShown.text}`}</span>
              ) : null}
            </span>
          </button>
          {pins.length > 1 && (
            <span data-figure className="shrink-0 text-[11px] text-ink-faint">
              {pinIndex + 1}/{pins.length}
            </span>
          )}
          {repo.unpinMessage && (
            <button
              type="button"
              onClick={() => void unpinThis(pinShown.messageId)}
              aria-label="Unpin this message"
              title="Unpin"
              className="shrink-0 rounded-full px-1.5 text-base leading-none text-ink-muted hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onThreadScroll}
        /**
         * **`overflow-x-hidden` is not belt-and-braces — without it the
         * horizontal axis is `auto`, whatever it looks like here.**
         *
         * A box with `overflow-y: auto` and no `overflow-x` does NOT get
         * `visible` on the other axis: the specification computes a `visible`
         * paired with a non-`visible` value to `auto`. So this container has
         * always been horizontally scrollable, and every oversized child got a
         * scrollbar rather than being clipped or being made to wrap.
         *
         * A thread has nothing to see sideways — the bubbles wrap, the
         * attachments are width-capped — so the axis is closed rather than left
         * to answer for the next child that forgets.
         */
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-3 scroll-slim sm:px-4 sm:py-4"
      >
        {messages.error ? (
          <QueryError
            compact
            queries={[messages]}
            message="These messages could not be loaded."
          />
        ) : messages.isLoading ? (
          <SkeletonRows rows={4} />
        ) : list.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-[38ch]">
              <p className="text-sm font-medium text-ink">No messages yet</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                Say something to{" "}
                {c.kind === "group"
                  ? "the group"
                  : (others[0]?.firstName ?? "them")}
                . Nobody is notified until you send.
              </p>
            </div>
          </div>
        ) : (
          /* The observed element. It wraps only this branch — the messages —
             because the empty state uses `h-full` against the scroll port and
             would stop centring inside a wrapper, and neither it nor the
             skeleton has anything that loads late to re-pin for. */
          <div ref={contentRef}>
            {/* Loading takes precedence over the invitation: telling somebody
                to scroll up while the page they asked for is already on its way
                reads as the scroll having done nothing. */}
            {loadingOlder ? (
              <div className="pb-3 text-center text-[11px] text-ink-faint">
                Loading earlier messages…
              </div>
            ) : hasMoreHistory ? (
              <div className="pb-3 text-center text-[11px] text-ink-faint">
                Scroll up for earlier messages
              </div>
            ) : null}
            <MessageList
              messages={list}
              participants={c.participants}
              viewerId={viewerId}
              group={c.kind === "group"}
              deliveredAt={c.deliveredAt}
              onReply={startReply}
              onEdit={startEdit}
              onDelete={removeMessage}
              onForward={setForwarding}
              onContextMenu={(m, x, y) => setMenu({ message: m, x, y })}
              onJumpTo={(id) => void jumpToMessage(id)}
              onReact={(m, emoji) => void react(m, emoji)}
              onStar={(m) => void toggleStar(m)}
              onVote={(messageId, optionId) => void votePoll(messageId, optionId)}
              canReact={typeof repo.toggleMessageReaction === "function"}
              canVote={typeof repo.voteMessagePoll === "function"}
            />
          </div>
        )}
      </div>

      {/* The composer keeps clear of a phone's gesture bar. `env()` is zero on
          every device without one, so the desktop padding is unchanged — and
          without it the send button sits under the home indicator on exactly
          the phones that have no hardware buttons to fall back on. */}
      <div className="relative border-t border-hairline px-2.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-3 sm:pb-3">
        {/* Jump to the newest message. Anchored to the composer's top edge with
            `bottom-full`, so it floats just above the box whatever the composer's
            height (a reply preview, attachment chips), over the bottom of the
            thread — where every chat app puts it. Shown only once the reader is
            well up the history (`showJump`). */}
        {showJump && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Scroll to latest messages"
            title="Jump to latest"
            className="absolute right-3 bottom-full z-10 mb-2 grid h-9 w-9 place-items-center rounded-full border border-hairline bg-[var(--surface-raised)] text-ink-muted shadow-lg transition-colors hover:text-ink sm:right-4"
          >
            <Icon.chevronDown className="h-5 w-5" />
          </button>
        )}
        {typingLabel && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint [animation-delay:-200ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint [animation-delay:-100ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint" />
            </span>
            {typingLabel}
          </div>
        )}
        {(state.error || editState.error) && (
          <div className="mb-2">
            <InlineError
              compact
              message={(state.error ?? editState.error) as string}
              code={state.errorCode ?? editState.errorCode}
            />
          </div>
        )}
        {uploadError && (
          <div className="mb-2">
            <InlineError compact message={uploadError} />
          </div>
        )}
        {/**
         * **A failed upload keeps its file, so retrying is a button rather than
         * a trip back to the file picker.**
         *
         * The file was dropped on failure and only a message was left behind,
         * which meant a dropped connection cost the person the file they had
         * chosen — the thing they are least able to reproduce, since by then the
         * picker has closed and they may not remember where it came from.
         *
         * These are held apart from `pending` on purpose: `pending` is what will
         * be SENT, and a file with no URL cannot be. Keeping them in one list
         * would either send a broken attachment or block the send of the ones
         * that worked.
         */}
        {failedUploads.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
              {failedUploads.length === 1
                ? `“${failedUploads[0].file.name}” did not upload.`
                : `${failedUploads.length} files did not upload.`}
            </span>
            <button
              type="button"
              onClick={retryFailedUploads}
              disabled={uploading}
              className="shrink-0 rounded-full bg-ink px-2.5 py-1 text-[11px] text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {uploading ? "Retrying…" : "Retry"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFailedUploads([]);
                setUploadError(null);
              }}
              className="shrink-0 text-[11px] text-ink-faint hover:text-ink"
            >
              Discard
            </button>
          </div>
        )}
        {replyingTo && !editing && (
          <div className="mb-2 flex items-start gap-2 rounded-[10px] border-s-2 border-ink-faint/50 bg-[var(--control)] px-2.5 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">
                Replying to {replyingTo.senderName}
              </div>
              <div className="truncate text-ink-muted">{replyingTo.text}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
              className="shrink-0 rounded-full px-1.5 text-base leading-none text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
        )}
        {editing && (
          <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-[var(--control)] px-2.5 py-1.5 text-xs">
            <Icon.history className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="flex-1 font-medium text-ink">Editing message</span>
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setText("");
              }}
              aria-label="Cancel edit"
              className="shrink-0 rounded-full px-1.5 text-base leading-none text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
        )}
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-[10px] bg-[var(--control)] p-1.5 pe-2 text-xs"
              >
                {a.kind === "image" ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={mediaUrl(a)}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-[6px] object-cover"
                  />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-raised)] text-ink-muted">
                    <Icon.attach className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0 max-w-[150px]">
                  <span className="block truncate text-ink">
                    {a.name ?? a.kind}
                  </span>
                  {a.sizeBytes ? (
                    <span className="block text-[11px] text-ink-faint">
                      {formatBytes(a.sizeBytes)}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPending((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label="Remove attachment"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-base leading-none text-ink-muted hover:bg-[var(--surface-raised)] hover:text-ink"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/* The bar while bytes are moving, then a spinner reading “Processing…”
            for the finalize round trip — which reports no progress of its own
            and used to leave the bar sitting at 100% looking finished. Send
            stays disabled across both stages: `uploading` clears only when the
            batch actually resolves. */}
        {uploading && (
          <div className="mb-2 flex flex-col gap-1.5">
            {uploadProgress.map((p) => (
              <UploadProgressRow key={p.id} name={p.name} fraction={p.fraction} />
            ))}
          </div>
        )}
        <div className="relative flex items-end gap-2">
          {/* @-mention autocomplete floats above the composer row. */}
          {mentions.menu}
          <input
            ref={fileRef}
            type="file"
            /* No `accept`, deliberately. It was
               `image/*,application/pdf,audio/*`, which hid every video, every
               document and every archive behind "All files" in the picker — and
               on some platforms made them unselectable outright. Nothing
               downstream ever cared: the upload goes straight to Drive, and
               `attachmentKind` files whatever arrives. A filter that refuses
               work people legitimately need to send is not a safeguard. */
            multiple
            hidden
            onChange={(e) => {
              /* Snapshot into a STATIC array before clearing the input.
                 `e.target.files` is a LIVE FileList — clearing `value` empties it
                 out from under us, so capturing the reference and then clearing
                 left `handleFiles` with zero files and the upload silently never
                 started. `Array.from` copies the File objects, which survive. */
              const list = e.target.files ? Array.from(e.target.files) : [];
              e.currentTarget.value = "";
              if (list.length) void handleFiles(list);
            }}
          />
          {/* The "+" share sheet — Poll, Location, Contact (and Photos & files
              where uploads are supported). Available even where attachments are
              not, because a card is a message, not an upload. */}
          <CardComposer
            people={directory.data ?? []}
            onCard={(card) => void sendCard(card)}
            onPickFiles={() => fileRef.current?.click()}
            canPickFiles={canUpload}
            disabled={uploading || state.isPending || editing}
          />
          {/* **The separate paperclip is gone.** It opened the file picker,
              which is the first row of the menu beside it — two buttons a pixel
              apart, one a shortcut into the other, and no rule to tell them
              apart because there was not one. `CardComposer` now wears the
              paperclip itself and is the single way in. */}
          {/* Record a voice note — staged through the SAME upload path a picked
              file takes, so it sends and plays like any audio attachment. */}
          {canUpload && (
            <VoiceRecorder
              onRecorded={(f) => void handleFiles([f])}
              disabled={uploading || state.isPending || editing}
            />
          )}

          <Textarea
            ref={composerRef}
            rows={1}
            value={text}
            onChange={(e) => {
              onType(e.target.value);
              mentions.sync();
            }}
            onKeyUp={() => mentions.sync()}
            onClick={() => mentions.sync()}
            onSelect={() => mentions.sync()}
            onKeyDown={(e) => {
              /* The mention popup gets first refusal on arrows/Enter/Tab/Esc
                 while open, so picking a name never sends. */
              if (mentions.onKeyDown(e)) return;
              /* Enter sends, Shift+Enter breaks the line — the convention every
                 messaging product shares, and the reason the field is one row
                 tall rather than a form control. */
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            onPaste={(e) => {
              /* A pasted screenshot or copied file uploads the same as one
                 picked from the dialog — but only when the paste actually
                 carries files. A plain-text paste falls through untouched, so
                 pasting a URL or a snippet still types into the box. */
              if (!canUpload) return;
              const pasted = filesFromClipboard(e.clipboardData);
              if (pasted.length) {
                e.preventDefault();
                void handleFiles(pasted);
              }
            }}
            placeholder={
              editing
                ? "Edit your message"
                : `Message ${
                    c.kind === "group"
                      ? conversationTitle(c, viewerId)
                      : (others[0]?.firstName ?? "")
                  }`.trim()
            }
            aria-label="Write a message"
            /* `Textarea`'s base sets `resize-y`, and which of two Tailwind
               utilities wins depends on their order in the emitted stylesheet
               rather than on the order here — so the drag handle is removed in
               the one place that cannot lose. A composer that can be dragged
               taller than its own panel is a scrollbar waiting to happen. */
            style={{ resize: "none" }}
            className="max-h-32 min-h-[38px] py-2"
          />

          <button
            type="button"
            onClick={submit}
            disabled={
              state.isPending ||
              editState.isPending ||
              uploading ||
              (editing
                ? !text.trim()
                : !text.trim() && pending.length === 0)
            }
            aria-label={editing ? "Save edit" : "Send"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-[var(--body-bg)] transition-opacity duration-[180ms] ease-[var(--ease-deck)] hover:opacity-90 disabled:opacity-30"
          >
            <Icon.send className="h-4 w-4" />
          </button>
        </div>
      </div>
        </>
      )}

      {/* The right-click menu, the forward destination picker, and the one line
          of feedback for actions that leave the thread looking unchanged. All
          three are portals or fixed, so none of them affects the layout of the
          conversation behind them. */}
      {menu && (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          items={menuFor(menu.message)}
          reactions={
            repo.toggleMessageReaction && menu.message.isDeleted !== true
              ? {
                  emojis: MESSAGE_QUICK_REACTIONS,
                  selected: viewerId
                    ? myReaction(menu.message.reactions, viewerId)
                    : null,
                  onPick: (emoji) => void react(menu.message, emoji),
                }
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      )}

      {forwarding && (
        <ForwardDialog
          message={forwarding}
          fromConversationId={c.id}
          onClose={() => setForwarding(null)}
          onForwarded={onForwarded}
        />
      )}

      {messageNotice && (
        <div
          role="status"
          className="frost-bar pointer-events-none fixed bottom-6 left-1/2 z-[75] -translate-x-1/2 rounded-full border border-hairline px-3.5 py-2 text-xs text-ink shadow-[var(--deck-seat)]"
        >
          {messageNotice}
        </div>
      )}
    </Panel>
    </FileDropZone>
  );
}

/**
 * The exchange.
 *
 * Runs of messages from one person collapse: the avatar and the name appear on
 * the first of a run and the rest are bare bubbles, which is what makes a long
 * back-and-forth read as two voices rather than as a log. Day separators come
 * from the message dates rather than from a fixed window, so a quiet week does
 * not produce empty headings.
 */
/**
 * How far one of your own messages has got, as one or two ticks.
 *
 * Drawn rather than iconified because the whole meaning is in the SHAPE — one
 * mark or two — and a single glyph scaled to 11px loses that distinction at
 * exactly the size it is read at. Two overlapping strokes stay legible.
 *
 * Only the read state takes colour. A grey double tick against a grey single
 * tick is a difference of quantity, which the eye counts; adding a second
 * colour for "delivered" would make the reader learn a palette instead.
 */
function MessageTicks({ status }: { status: MessageStatus }) {
  const read = status === "read";
  const double = status !== "sent";
  const label =
    status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="ms-1 inline-flex shrink-0 align-[-1px]"
      style={{ color: read ? "var(--state-read)" : undefined }}
    >
      <svg
        width={double ? 15 : 10}
        height="10"
        viewBox={double ? "0 0 15 10" : "0 0 10 10"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M1 5.5 L3.6 8.2 L8.8 1.8" />
        {/* The second tick, set behind and to the right so the two read as a
            pair rather than as one thick mark. */}
        {double && <path d="M6.2 5.5 L8.8 8.2 L14 1.8" />}
      </svg>
    </span>
  );
}

function MessageList({
  messages,
  participants,
  viewerId,
  group,
  deliveredAt,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onContextMenu,
  onJumpTo,
  onReact,
  onStar,
  onVote,
  canReact,
  canVote,
}: {
  messages: Message[];
  participants: Employee[];
  viewerId: string | null;
  group: boolean;
  /** Each participant's delivery stamp, for the ticks. See `messageStatus`. */
  deliveredAt: Record<string, string> | undefined;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onForward: (m: Message) => void;
  /** Where the pointer was, so the menu opens under it. */
  onContextMenu: (m: Message, x: number, y: number) => void;
  /** Jump to one message by id. The THREAD owns this — it can page history in
   *  when the target is older than anything loaded — so the list only asks. */
  onJumpTo: (id: string) => void;
  /** Toggle one emoji on one message — what a reaction chip does on click. */
  onReact: (m: Message, emoji: string) => void;
  /** Toggle a personal star on one message — for the image viewer's toolbar. */
  onStar: (m: Message) => void;
  /** Toggle the viewer's vote on a poll option. */
  onVote: (messageId: string, optionId: string) => void;
  /** Whether the backend supports reactions at all. Chips still RENDER without
   *  it (the data may exist), they just stop being buttons that lie. */
  canReact: boolean;
  /** Whether the backend can persist a poll vote. A poll still renders without
   *  it — read-only, showing results — rather than offering a dead button. */
  canVote: boolean;
}) {
  /* Everyone a message of mine is FOR — the participants without me. Computed
     once for the list rather than per bubble: it is the same set for every
     message in the thread, and `messageStatus` reads it on each one. */
  const recipientIds = participants
    .map((p) => p.id)
    .filter((id) => id !== viewerId);

  /* Every image in the whole thread, in order — so opening one opens the strip
     of all of them, not just its own message's. Assembled from the loaded
     message list, since a message only knows its own attachments. */
  const galleryItems = useMemo(
    () => collectConversationImages(messages),
    [messages],
  );
  const galleryImages = useMemo(
    () =>
      galleryItems.map((it) => ({
        fileId: it.attachment.fileId,
        url: it.attachment.url,
        alt: it.attachment.name ?? "Image",
        downloadUrl: mediaUrl(it.attachment),
        downloadName: it.attachment.name ?? "image.jpg",
        proxyUrl: mediaProxyUrl(it.attachment),
        title: it.senderName,
        subtitle: formatDateTime(it.createdAt),
      })),
    [galleryItems],
  );
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const openImage = (messageId: string, imageIndex: number) =>
    setGalleryIndex(galleryIndexOf(galleryItems, messageId, imageIndex));

  /* The viewer's per-image actions, bound to each image's message. Messages
     chat offers the full set — reply, react, star and forward — the same the
     message menu does. Reply and Forward close the viewer so the composer or
     the forward picker is seen; react and star act in place. */
  const galleryActions = galleryItems.map((it) => {
    const m = messages.find((x) => x.id === it.messageId);
    if (!m) return {};
    return {
      onReply: () => {
        onReply(m);
        setGalleryIndex(null);
      },
      onForward: () => {
        onForward(m);
        setGalleryIndex(null);
      },
      onStar: () => onStar(m),
      starred: (m.starredBy ?? []).includes(viewerId ?? ""),
      reactions:
        canReact && !m.isDeleted
          ? {
              emojis: MESSAGE_QUICK_REACTIONS,
              selected: myReaction(m.reactions, viewerId ?? ""),
              onPick: (emoji: string) => onReact(m, emoji),
            }
          : undefined,
    };
  });

  /**
   * Touch gestures on a message row: swipe LEFT to reply, hold to open the
   * message menu — the two ways every phone chat offers its actions.
   *
   * One ref, no state: `touchmove` fires every frame of a drag, and a
   * re-render per frame is exactly the cost this avoids. The drag is drawn by
   * writing `transform` on the row directly and clearing it on release.
   *
   * The vertical axis stays the browser's: nothing here calls
   * `preventDefault` on a move, and `touch-action: pan-y` on the row tells
   * the browser scrolling is untouched. A drag only counts as a swipe once it
   * is decisively horizontal, so a wobbly scroll never replies to anything.
   *
   * Long-press cooperates with the platforms rather than fighting them:
   * Android fires a real `contextmenu` on hold — the existing right-click
   * handler answers it — while iOS fires nothing, which is what the timer is
   * for. Both roads end at the same `onContextMenu`, and opening twice is a
   * reposition, not a second menu. When the timer fires, the `touchend` that
   * follows is prevented so its synthetic click cannot land on the thread and
   * close the menu it just opened.
   */
  const touchRef = useRef<{
    id: string;
    x: number;
    y: number;
    el: HTMLElement;
    dx: number;
    horizontal: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    longPressed: boolean;
  } | null>(null);

  function settleRow(el: HTMLElement) {
    el.style.transition = "transform 160ms ease-out";
    el.style.transform = "";
    setTimeout(() => {
      el.style.transition = "";
    }, 180);
  }

  function onRowTouchStart(e: React.TouchEvent<HTMLDivElement>, m: Message) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    const t = {
      id: m.id,
      x: touch.clientX,
      y: touch.clientY,
      el,
      dx: 0,
      horizontal: false,
      timer: null as ReturnType<typeof setTimeout> | null,
      longPressed: false,
    };
    t.timer = setTimeout(() => {
      t.longPressed = true;
      try {
        navigator.vibrate?.(12);
      } catch {
        /* Not every browser exposes it, and it is only a nicety. */
      }
      /* iOS starts selecting the text under a held finger; the menu is what
         was asked for, so the selection is cleared rather than left glowing
         behind it. */
      window.getSelection()?.removeAllRanges();
      onContextMenu(m, t.x, t.y);
    }, 480);
    touchRef.current = t;
  }

  function onRowTouchMove(e: React.TouchEvent<HTMLDivElement>, m: Message) {
    const t = touchRef.current;
    if (!t || t.id !== m.id) return;
    const touch = e.touches[0];
    const dx = touch.clientX - t.x;
    const dy = touch.clientY - t.y;
    /* Any real movement is not a hold. */
    if (t.timer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearTimeout(t.timer);
      t.timer = null;
    }
    if (!t.horizontal) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4)
        t.horizontal = true;
      else return;
    }
    /* Only the reply direction drags, and only so far — the row follows the
       finger enough to promise something, not enough to leave the pane. */
    const pull = Math.max(-72, Math.min(0, dx));
    t.dx = pull;
    t.el.style.transform = pull ? `translateX(${pull}px)` : "";
  }

  function onRowTouchEnd(e: React.TouchEvent<HTMLDivElement>, m: Message) {
    const t = touchRef.current;
    if (!t || t.id !== m.id) return;
    touchRef.current = null;
    if (t.timer) clearTimeout(t.timer);
    if (t.longPressed) {
      e.preventDefault();
      settleRow(t.el);
      return;
    }
    const swiped = t.horizontal && t.dx <= -56;
    settleRow(t.el);
    if (swiped && m.isDeleted !== true) onReply(m);
  }

  function onRowTouchCancel(m: Message) {
    const t = touchRef.current;
    if (!t || t.id !== m.id) return;
    touchRef.current = null;
    if (t.timer) clearTimeout(t.timer);
    settleRow(t.el);
  }

  return (
    <>
    <ol className="flex flex-col gap-0.5">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const mine = m.senderId === viewerId;
        const sameRun = continues(prev, m);
        /* The time goes on the LAST message of a run, not on every line. A
           stamp against each bubble turns a fast exchange into a column of
           near-identical numbers, and the one people actually look for is when
           the other person stopped talking. */
        const endsRun = !continues(m, next);
        const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
        const sender = participants.find((p) => p.id === m.senderId);
        const deleted = m.isDeleted === true;
        const starredByViewer = Boolean(
          viewerId && (m.starredBy ?? []).includes(viewerId),
        );
        const chips = reactionSummary(
          m.reactions,
          viewerId ?? "",
          MESSAGE_QUICK_REACTIONS,
        );

        return (
          <li key={m.id} id={`msg-${m.id}`}>
            {newDay && (
              <div className="flex items-center gap-3 py-3">
                <span className="h-px flex-1 bg-hairline" />
                <span
                  data-figure
                  className="shrink-0 text-[11px] tracking-[0.02em] text-ink-faint"
                >
                  {formatDate(m.createdAt)}
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
            )}

            {/* Three stacked parts — name, bubble row, time — rather than one
                flex row. The avatar has to align to the bottom of the BUBBLE,
                and with the timestamp inside the same aligned box it lined up
                against the timestamp instead, leaving the picture floating
                below the message it belongs to. The 36px inset on the name and
                the time is the avatar column plus its gap, so all three parts
                share one edge. */}
            <div
              className={`flex flex-col ${mine ? "items-end" : "items-start"} ${
                sameRun ? "mt-0.5" : "mt-3 first:mt-0"
              }`}
            >
              {group && !mine && !sameRun && (
                <span className="mb-1 ps-9 text-[11px] text-ink-faint">
                  {sender?.displayName ?? m.senderName}
                </span>
              )}

              {/* `group` so the actions reveal on hovering this one message. */}
              <div
                /**
                 * **Right-click anywhere on the message — either side of the
                 * thread.** The handler sits on the row rather than on the
                 * bubble so the avatar and the gap answer to it too: a menu that
                 * only opens on the coloured rectangle is a menu people think is
                 * broken when they aim slightly wide.
                 *
                 * A deleted message keeps its menu, and every item in it is
                 * greyed with the reason. Suppressing the gesture entirely would
                 * be the same silence the hover row had.
                 */
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu(m, e.clientX, e.clientY);
                }}
                onTouchStart={(e) => onRowTouchStart(e, m)}
                onTouchMove={(e) => onRowTouchMove(e, m)}
                onTouchEnd={(e) => onRowTouchEnd(e, m)}
                onTouchCancel={() => onRowTouchCancel(m)}
                /* `pan-y`: vertical scrolling stays the browser's; the
                   horizontal axis is ours, for the swipe-to-reply drag. */
                style={{ touchAction: "pan-y" }}
                /* 88% on a phone, 78% from `sm` up. The desktop figure is a
                   line-length decision and a phone has no length to spare:
                   at 360px it left a 74px margin beside every bubble and
                   broke short sentences over two lines. */
                className={`group flex max-w-[min(88%,60ch)] items-end gap-2 sm:max-w-[min(78%,60ch)] ${mine ? "flex-row-reverse" : ""}`}
              >
                {/* Always present, so every bubble in a run keeps one edge;
                    only the picture is conditional. Empty it has no height, so
                    `items-end` seats the avatar against the bubble's baseline. */}
                <span className="w-7 shrink-0">
                  {!mine && !sameRun && sender && (
                    <Avatar
                      initials={sender.initials}
                      hue={sender.hue}
                      src={sender.profilePictureUrl}
                      name={sender.displayName}
                      size="sm"
                    />
                  )}
                </span>
                {/* A column, not the bubble itself: the reaction pills sit
                    BELOW the bubble and overlap its bottom edge, floating on
                    the thread background the way every chat draws them —
                    which needs a sibling under the bubble, not a row inside
                    it stretching the bubble taller. Aligned to the tail side:
                    the right edge of your own messages, the left of theirs. */}
                <span
                  className={`flex min-w-0 flex-col ${
                    mine ? "items-end" : "items-start"
                  }`}
                >
                <span
                  className={`flex min-w-0 flex-col gap-1.5 rounded-inset px-3.5 py-2 text-sm leading-relaxed ${
                    mine
                      ? "bg-ink text-[var(--body-bg)]"
                      : "bg-[var(--surface-raised)] text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)]"
                  }`}
                >
                  {m.replyTo && (
                    <button
                      type="button"
                      onClick={() => onJumpTo(m.replyTo!.messageId)}
                      className={`block rounded-[8px] border-s-2 px-2 py-1 text-left ${
                        mine
                          ? "border-white/50 bg-white/10"
                          : "border-ink-faint/50 bg-black/[0.04]"
                      }`}
                    >
                      <span className="block text-[11px] font-medium opacity-80">
                        {m.replyTo.senderName}
                      </span>
                      <span className="block truncate text-xs opacity-70">
                        {m.replyTo.text}
                      </span>
                    </button>
                  )}
                  {!deleted && m.attachments && m.attachments.length > 0 && (
                    <MessageAttachments
                      items={m.attachments}
                      mine={mine}
                      onOpenImage={(li) => openImage(m.id, li)}
                    />
                  )}
                  {!deleted && m.card && (
                    <MessageCardView
                      card={m.card}
                      mine={mine}
                      viewerId={viewerId ?? undefined}
                      onVote={
                        m.card.kind === "poll" && canVote
                          ? (optionId) => onVote(m.id, optionId)
                          : undefined
                      }
                    />
                  )}
                  {m.text && (
                    <span
                      /**
                       * **`overflow-wrap: anywhere`, and it has to be `anywhere`
                       * rather than `break-word`.**
                       *
                       * `whitespace-pre-wrap` keeps the newlines somebody typed
                       * and wraps at ordinary break opportunities — spaces. A
                       * pasted API key, a refresh token or a long URL has none,
                       * so it is one indivisible word: the bubble's min-content
                       * width becomes the length of that word, `max-w` cannot
                       * shrink it below its minimum, and the thread grows a
                       * HORIZONTAL scrollbar. Every message in the conversation
                       * then sits on a canvas wider than the pane because one of
                       * them was a credential somebody pasted.
                       *
                       * `break-word` is not enough: it breaks the word when it
                       * would overflow its line box, but leaves min-content
                       * measured on the unbroken word, so the flex item is still
                       * sized to it. `anywhere` is the value that also shrinks
                       * the intrinsic minimum, which is the measurement the
                       * layout above is actually made from.
                       */
                      className={`[overflow-wrap:anywhere] whitespace-pre-wrap ${deleted ? "italic opacity-60" : ""}`}
                    >
                      {deleted
                        ? m.text
                        : /* Split the text into @-mention runs and the rest, so
                             mentions HIGHLIGHT and everything else still linkifies
                             its URLs. A link needs its own shade on each bubble
                             colour (deep ink for mine, raised surface for theirs)
                             so it never washes out. */
                          mentionSegments(
                            m.text,
                            mentionTokensFor(
                              m.mentionIds,
                              (id) =>
                                participants.find((p) => p.id === id)?.displayName,
                            ),
                          ).map((seg, i) =>
                            seg.mention ? (
                              <span
                                key={i}
                                className="rounded-[3px] bg-[color-mix(in_srgb,var(--accent,#1a73e8)_16%,transparent)] px-0.5 font-medium"
                              >
                                {seg.text}
                              </span>
                            ) : (
                              <span key={i}>
                                {linkifyMessage(
                                  seg.text,
                                  mine
                                    ? "text-[#8ab4ff] underline decoration-[#8ab4ff]/40 underline-offset-2 hover:decoration-[#8ab4ff]"
                                    : "text-[#2563eb] underline decoration-[#2563eb]/40 underline-offset-2 hover:decoration-[#2563eb]",
                                )}
                              </span>
                            ),
                          )}
                    </span>
                  )}
                </span>

                {/* Reactions and the viewer's star, floating half over the
                    bubble's bottom edge. Clicking a chip toggles that emoji
                    for YOU — the shortest road to "me too" and to taking one
                    back; who reacted is in the tooltip. The star is only ever
                    the viewer's own — a personal bookmark, so nobody else's
                    stars are drawn. */}
                {!deleted && (chips.length > 0 || starredByViewer) && (
                  <span
                    className={`relative z-[1] -mt-2 flex flex-wrap items-center gap-1 px-1 ${
                      mine ? "justify-end" : ""
                    }`}
                  >
                    {chips.map((chip) => {
                      const names = (m.reactions?.[chip.emoji] ?? [])
                        .map(
                          (id) =>
                            participants.find((p) => p.id === id)?.firstName ??
                            "Someone",
                        )
                        .join(", ");
                      return (
                        <button
                          key={chip.emoji}
                          type="button"
                          disabled={!canReact}
                          onClick={() => onReact(m, chip.emoji)}
                          aria-pressed={chip.mine}
                          aria-label={`${chip.emoji} ${chip.count}, ${
                            chip.mine
                              ? "including you — press to remove yours"
                              : "press to react too"
                          }`}
                          title={names}
                          className={`flex items-center gap-1 rounded-full border border-hairline bg-[var(--surface-raised)] px-1.5 py-[3px] text-[12px] leading-none text-ink shadow-sm ${
                            chip.mine ? "ring-1 ring-ink/30" : ""
                          } ${canReact ? "" : "cursor-default"}`}
                        >
                          <span aria-hidden>{chip.emoji}</span>
                          {chip.count > 1 && (
                            <span
                              data-figure
                              aria-hidden
                              className="text-[11px] text-ink-muted"
                            >
                              {chip.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {starredByViewer && (
                      <span
                        role="img"
                        aria-label="You starred this message"
                        title="Starred"
                        className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-hairline bg-[var(--surface-raised)] text-ink-muted shadow-sm"
                      >
                        <Icon.star className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                )}
                </span>

                {!deleted && (
                  <span className="flex shrink-0 items-center gap-1.5 self-center text-[11px] text-ink-faint opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {/* The keyboard path to the same actions the right-click
                        menu offers — `focus-within` reveals this row, and a
                        context menu cannot be reached by tabbing. Delete stays
                        conditional here: an item that only ever refuses is
                        noise in a row this small, and the menu is where the
                        rule is explained. */}
                    <button
                      type="button"
                      onClick={() => onReply(m)}
                      className="hover:text-ink"
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => onForward(m)}
                      className="hover:text-ink"
                    >
                      Forward
                    </button>
                    {mine && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEdit(m)}
                          className="hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(m)}
                          className="hover:text-ink"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>

              {/* **The time ends a run; the ticks belong to every message.**
                  The time is grouped deliberately — one stamp under a run of
                  messages sent together, rather than the same minute repeated
                  down the thread. A DELIVERY STATE is not like that: it is a
                  fact about one message, and three sent in a row can genuinely
                  be in three different states. Tying the ticks to the run's end
                  left the first two with no status at all, which is not what
                  the convention everybody reads promises — every bubble carries
                  its own. So the row now appears for either reason, and each
                  part decides for itself whether it is shown. */}
              {(endsRun || (mine && !deleted)) && (
                <span
                  data-figure
                  className={`mt-1 flex items-center text-[11px] text-ink-faint ${mine ? "pe-9" : "ps-9"}`}
                >
                  {endsRun && clock(m.createdAt)}
                  {endsRun && m.editedAt ? " · edited" : ""}
                  {/* Only on your OWN messages. Ticks on somebody else's bubble
                      would be telling them whether THEY have read it, which
                      they plainly have — and a deleted message has no delivery
                      worth reporting. */}
                  {mine && !deleted && (
                    <MessageTicks
                      status={messageStatus({
                        createdAt: m.createdAt,
                        readBy: m.readBy,
                        recipientIds,
                        deliveredAt,
                      })}
                    />
                  )}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>

      {/* One viewer for the whole thread's images — opened at the clicked
          thumbnail, Previous/Next and the filmstrip walk the rest. */}
      {galleryIndex !== null && (
        <GalleryLightbox
          images={galleryImages}
          startIndex={galleryIndex}
          apiBase={MEDIA_BASE}
          actions={galleryActions}
          onClose={() => setGalleryIndex(null)}
        />
      )}
    </>
  );
}

/** How many files one message may carry — a sane ceiling on a single send. */
const MAX_ATTACHMENTS = 10;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * What to call a conversation.
 *
 * A group uses its title. A direct message is named for the other person, never
 * for the pair — you do not think of it as "Maya and Tobias", you think of it
 * as "Tobias". The degenerate case of a conversation with nobody else in it is
 * named rather than left blank, because a blank row looks like a render bug.
 */
function conversationTitle(
  c: ConversationView,
  viewerId: string | null,
): string {
  if (c.title) return c.title;
  const others = c.participants.filter((p) => p.id !== viewerId);
  if (others.length === 0) return "Just you";
  return others.map((p) => p.displayName).join(", ");
}

/** Newest first, and a brand-new thread with no messages sorts to the top. */
function sortByRecency(list: ConversationView[]): ConversationView[] {
  return [...list].sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return a.id < b.id ? 1 : -1;
    if (!a.lastMessageAt) return -1;
    if (!b.lastMessageAt) return 1;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
}

/**
 * Every timestamp in the thread is read in IST, via `lib/utils/format.ts`'s
 * shared offset — the same zone the task list, deadlines and everything else
 * in the product already renders in.
 *
 * This file used to read `getUTCHours()` etc. straight off the instant with
 * no offset applied at all, which is genuinely UTC rather than IST despite a
 * comment here once claiming the two were "consistent" — every message
 * showed five and a half hours early. `formatClock`/`istDayKey` are the fix.
 */
const clock = formatClock;
const dayKey = istDayKey;

function sameDay(a: string, b: string): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * Whether `b` continues `a`'s run: same person, same day, within ten minutes.
 *
 * One predicate rather than two inline conditions, because the run's start and
 * its end are the same question asked from either side — and when they were
 * written separately the avatar and the timestamp disagreed about where a run
 * ended.
 */
function continues(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.senderId === b.senderId &&
    sameDay(a.createdAt, b.createdAt) &&
    minutesBetween(a.createdAt, b.createdAt) < 10
  );
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

/**
 * How long ago, against the PROTOTYPE clock rather than the wall clock.
 *
 * This matters more than it looks. The mock store stamps records from
 * `seed.NOW` plus however far the session has advanced, so measuring against
 * the real `Date.now()` labelled a message sent one second ago as "2d" —
 * the gap between the fixture's today and the reader's. `formatRelative` and
 * the shared `NOW` are the product's existing answer to exactly this, and the
 * task table already reads it the same way.
 *
 * Past a week the interval stops helping, so it becomes a date.
 */
function relativeTime(iso: string, now: Date | null): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  /* No clock yet (server render). The absolute day is always true, so it is the
     honest fallback — a relative interval needs a "now" to be relative to. */
  if (!now) return formatDate(iso);
  if (Math.abs(now.getTime() - then) > 7 * 86400000) return formatDate(iso);
  return formatRelative(iso, now).replace(/ ago$/, "");
}
