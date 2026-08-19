"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  InlineError,
  Panel,
  QueryError,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { NewChatDialog } from "./NewChatDialog";
import { GroupSettings } from "./GroupSettings";
import { ForwardDialog } from "./ForwardDialog";
import {
  MessageContextMenu,
  type MessageMenuItem,
} from "./MessageContextMenu";
import {
  MessageAttachments,
  filesFromClipboard,
  formatBytes,
  mediaUrl,
} from "./MessageAttachments";
import { formatClock, formatDate, formatRelative, istDayKey } from "@/lib/utils/format";
import { linkify } from "@/lib/utils/linkify";
import { useNow } from "@/lib/hooks/useNow";
import { MESSAGE_PAGE_SIZE } from "@/lib/domain";
import type {
  Conversation,
  Employee,
  Message,
  MessageAttachment,
  MessageReply,
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

export function MessagesPage({ conversationId }: { conversationId?: string }) {
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

  /* The route is the source of truth for what is open; the first conversation
     is only a default for the wide layout, where an empty right pane beside a
     full list reads as a loading failure. */
  const active = conversationId ?? (all.length ? all[0].id : undefined);
  const activeConversation = all.find((c) => c.id === active) ?? null;
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
            />
          </div>

          <div
            className={`min-h-0 deck:col-span-8 ${!conversationId ? "hidden deck:block" : ""}`}
          >
            {activeConversation ? (
              <Thread
                key={activeConversation.id}
                conversation={activeConversation}
                viewerId={viewerId}
                opened={openedDeliberately}
                onRead={() => conversations.refetch()}
                onSent={() => conversations.refetch()}
              />
            ) : (
              <NoThread
                loading={conversations.isLoading}
                empty={all.length === 0}
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
            placeholder="Search conversations"
            aria-label="Search conversations"
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
        ) : conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs leading-relaxed text-ink-faint">
            {total === 0
              ? "Nothing here yet. Start a conversation and it will appear in this list."
              : `No conversation matches “${search}”.`}
          </p>
        ) : (
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
      className={`flex items-center gap-3 rounded-inset px-2.5 py-2.5 transition-colors duration-[180ms] ease-[var(--ease-deck)] ${
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
 */
function NoThread({
  loading,
  empty,
  onDirect,
  onGroup,
}: {
  loading: boolean;
  empty: boolean;
  onDirect: () => void;
  onGroup: () => void;
}) {
  return (
    <Panel label="No conversation open" className="grid h-full place-items-center">
      {loading ? (
        <div className="w-full max-w-[360px]">
          <SkeletonRows rows={3} />
        </div>
      ) : (
        <div className="max-w-[44ch] px-6 py-10 text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-sunken)] text-ink-faint"
          >
            <Icon.chat className="h-6 w-6" />
          </span>
          <p className="text-[17px] leading-tight font-medium tracking-[-0.02em] text-ink">
            {empty ? "No conversations yet" : "Nothing open"}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {empty
              ? "Direct messages and group chats live here. You can reach anyone in the organisation — there is no request to send first."
              : "Choose a conversation from the list, or start a new one."}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button tone="primary" size="sm" onClick={onDirect}>
              <Icon.chat className="h-3.5 w-3.5" />
              Start a conversation
            </Button>
            <Button size="sm" onClick={onGroup}>
              <Icon.team className="h-3.5 w-3.5" />
              Create a group
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Thread({
  conversation: c,
  viewerId,
  opened,
  onRead,
  onSent,
}: {
  conversation: ConversationView;
  viewerId: string | null;
  /**
   * The reader navigated to this thread, rather than the layout defaulting to it.
   *
   * Only a deliberate open marks the conversation read. See the effect below.
   */
  opened: boolean;
  onRead: () => void;
  onSent: () => void;
}) {
  const repo = useRepo();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** One entry per file in the batch currently uploading — see `handleFiles`. */
  const [uploadProgress, setUploadProgress] = useState<
    { id: string; name: string; sizeBytes: number; fraction: number }[]
  >([]);
  const [replyingTo, setReplyingTo] = useState<MessageReply | null>(null);
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
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const typingSentRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  /* The attach control only appears where the backend actually accepts uploads;
     the in-memory prototype omits `uploadMessageAttachment`, so it stays off
     rather than failing silently. */
  const canUpload = typeof repo.uploadMessageAttachment === "function";
  /* The window grows rather than pages: a scroll to the top asks for a
     BIGGER limit on the same query rather than a second, separately-fetched
     page. See `listMessages`'s own note — this is what keeps the thread
     correct for free under `watchConversationMessages`'s live refetch,
     where two independently-merged pages would need reconciling by hand on
     every one of those refreshes. */
  /* No reset-on-conversation-change effect needed: `Thread` is mounted with
     `key={activeConversation.id}` by its caller, so switching threads already
     remounts this component and every one of its `useState`s starts fresh. */
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE_SIZE);
  const messages = useQuery(
    (r) => r.listMessages(c.id, { limit: visibleCount }),
    [c.id, visibleCount],
  );
  const [send, state] = useAction((r) =>
    r.sendMessage(c.id, text, pending.length ? pending : undefined, replyingTo),
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

  const others = c.participants.filter((p) => p.id !== viewerId);
  const list = messages.data?.messages ?? [];
  const hasMoreHistory = messages.data?.hasMore ?? false;

  /* Scrolling within ~80px of the top asks for another window's worth of
     history — the "on scroll up, load the next 50" behaviour. Guarded by
     the ref rather than `messages.isLoading`: a growing-window refetch keeps
     showing the last good answer while it resolves (see `useQuery`), so
     `isLoading` never actually flips true here, and re-entering this on
     every scroll tick before the bump lands would ask for a bigger window
     over and over. */
  function onThreadScroll() {
    const el = scrollRef.current;
    if (!el) return;
    /* Following, or reading back? Answered on every tick from where they
       actually are, so it survives a scroll by any means — wheel, drag,
       keyboard, or the scroll-to-bottom above. The threshold is about one
       bubble: a reader a few pixels off the bottom is still following, and
       demanding an exact zero makes the pin feel like it randomly stops
       working. */
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (loadingOlderRef.current || !hasMoreHistory) return;
    if (el.scrollTop > 80) return;
    loadingOlderRef.current = true;
    prevScrollHeightRef.current = el.scrollHeight;
    setVisibleCount((v) => v + MESSAGE_PAGE_SIZE);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data, c.id]);

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
      setText("");
      setPending([]);
      setReplyingTo(null);
      setUploadError(null);
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
   * Copy the text of a message.
   *
   * Text only, and the menu greys the item out when there is none: `writeText`
   * on an empty string succeeds and silently replaces whatever the person had
   * on their clipboard, which is a worse outcome than the action being
   * unavailable. Attachments are not copied — a file is not a clipboard string,
   * and pretending otherwise would put a filename where people expect a file.
   */
  async function copyMessage(m: Message) {
    try {
      await navigator.clipboard.writeText(m.text);
      setMessageNotice("Message copied.");
    } catch {
      /* Denied permission, or a browser without the API on an insecure origin. */
      setMessageNotice("This browser would not let Cowork use the clipboard.");
    }
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
      {
        id: "copy",
        label: "Copy text",
        disabled: deleted || !m.text,
        reason: deleted
          ? "This message was deleted."
          : !m.text
            ? "This message has no text to copy."
            : undefined,
        run: () => void copyMessage(m),
      },
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
    const ready = results
      .filter((r): r is { ok: true; data: MessageAttachment } => r.ok)
      .map((r) => r.data);
    if (ready.length)
      setPending((prev) => [...prev, ...ready].slice(0, MAX_ATTACHMENTS));
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) setUploadError(failed.message);
  }

  return (
    <Panel padded={false} label="Conversation" className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
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
            <Avatar
              initials={others[0].initials}
              hue={others[0].hue}
              src={others[0].profilePictureUrl}
              name={others[0].displayName}
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
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 scroll-slim"
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
            {hasMoreHistory && (
              <div className="pb-3 text-center text-[11px] text-ink-faint">
                Scroll up for earlier messages
              </div>
            )}
            <MessageList
              messages={list}
              participants={c.participants}
              viewerId={viewerId}
              group={c.kind === "group"}
              onReply={startReply}
              onEdit={startEdit}
              onDelete={removeMessage}
              onForward={setForwarding}
              onContextMenu={(m, x, y) => setMenu({ message: m, x, y })}
            />
          </div>
        )}
      </div>

      <div className="border-t border-hairline px-4 py-3">
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
        {uploading && (
          <div className="mb-2 flex flex-col gap-1.5">
            {uploadProgress.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <div
                  role="progressbar"
                  aria-label={`Uploading ${p.name}`}
                  aria-valuenow={Math.round(p.fraction * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--control)]"
                >
                  <div
                    className="h-full rounded-full bg-ink transition-[width] duration-150 ease-out"
                    style={{ width: `${Math.round(p.fraction * 100)}%` }}
                  />
                </div>
                <span data-figure className="w-8 shrink-0 text-right text-[11px]">
                  {Math.round(p.fraction * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,audio/*"
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
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canUpload || uploading || state.isPending || editing}
            aria-label="Attach a file"
            title={
              canUpload
                ? "Attach an image, PDF, or audio file"
                : "Attachments are not available here"
            }
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
          >
            <Icon.attach className="h-4 w-4" />
          </button>

          <Textarea
            rows={1}
            value={text}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
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

      {/* The right-click menu, the forward destination picker, and the one line
          of feedback for actions that leave the thread looking unchanged. All
          three are portals or fixed, so none of them affects the layout of the
          conversation behind them. */}
      {menu && (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          items={menuFor(menu.message)}
          onClose={() => setMenu(null)}
        />
      )}

      {forwarding && (
        <ForwardDialog
          message={forwarding}
          fromConversationId={c.id}
          onClose={() => setForwarding(null)}
          onForwarded={(where) => setMessageNotice(`Forwarded to ${where}.`)}
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
function MessageList({
  messages,
  participants,
  viewerId,
  group,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onContextMenu,
}: {
  messages: Message[];
  participants: Employee[];
  viewerId: string | null;
  group: boolean;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onForward: (m: Message) => void;
  /** Where the pointer was, so the menu opens under it. */
  onContextMenu: (m: Message, x: number, y: number) => void;
}) {
  /* Clicking a reply quote scrolls its original into view. An imperative read is
     the right tool: the target is a sibling `<li>`, not state this list owns. */
  const jumpTo = (id: string) =>
    document
      .getElementById(`msg-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
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
                className={`group flex max-w-[min(78%,60ch)] items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
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
                      onClick={() => jumpTo(m.replyTo!.messageId)}
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
                    <MessageAttachments items={m.attachments} mine={mine} />
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
                        : linkify(
                            m.text,
                            /* A link needs to read as a link on both bubble
                               colours — the deep ink fill of your own message
                               and the raised surface of everyone else's — so
                               it gets its own shade on each rather than one
                               colour that would wash out against one of them. */
                            mine
                              ? "text-[#8ab4ff] underline decoration-[#8ab4ff]/40 underline-offset-2 hover:decoration-[#8ab4ff]"
                              : "text-[#2563eb] underline decoration-[#2563eb]/40 underline-offset-2 hover:decoration-[#2563eb]",
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

              {endsRun && (
                <span
                  data-figure
                  className={`mt-1 text-[11px] text-ink-faint ${mine ? "pe-9" : "ps-9"}`}
                >
                  {clock(m.createdAt)}
                  {m.editedAt ? " · edited" : ""}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
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
