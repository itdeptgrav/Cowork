"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  Input,
  Panel,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { getRepository } from "@/lib/repositories";
import { formatRelative } from "@/lib/utils/format";
import { useNow } from "@/lib/hooks/useNow";
import { MailCompose } from "./MailCompose";
import { MailThreadView } from "./MailThreadView";
import type {
  MailFolder,
  MailMessage,
  MailThread,
  MailTransport,
} from "@/lib/domain";

/**
 * One mailbox.
 *
 * **The product decision this page exists to make.** Legacy ran two: `/mail`
 * for employee-to-employee and `/mail/gmail` for everything else, each with its
 * own inbox, sent folder and search. A person had to know which system a
 * message lived in before they could look for it.
 *
 * Here the folders are views over one list. Internal and External are the ONLY
 * places transport appears as a filter, and they exist because "did this leave
 * the company" is occasionally a real question — not because the mailbox is
 * secretly two mailboxes.
 *
 * The transport badge on a row is deliberately quiet: a small "Gmail" chip and
 * nothing on internal mail. Where a message travelled matters far less than who
 * it is from, and the design language here is Cowork's — frosted panels, the
 * same avatars as everywhere else — rather than anything resembling Gmail.
 */

const FOLDERS: { id: MailFolder; label: string; icon: keyof typeof Icon }[] = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "sent", label: "Sent", icon: "send" },
  { id: "drafts", label: "Drafts", icon: "draft" },
  { id: "spam", label: "Spam", icon: "blocked" },
  { id: "trash", label: "Trash", icon: "trash" },
];

export function MailArea() {
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [transport, setTransport] = useState<MailTransport | null>(null);
  /* Starred and Important are cross-folder VIEWS, mutually exclusive with each
     other and turned off by picking a real folder. One piece of state, so they
     can never both be on. */
  const [flagView, setFlagView] = useState<null | "starred" | "important">(null);
  const [search, setSearch] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  /* A draft is opened INTO the composer to be finished, not into the read
     view — so clicking a Drafts row loads the draft message and edits it. */
  const [editingDraft, setEditingDraft] = useState<MailMessage | null>(null);

  const threads = useQuery(
    (r) =>
      r.listMailThreads({
        folder,
        ...(transport ? { transport } : {}),
        ...(search.trim() ? { search } : {}),
        ...(flagView === "starred" ? { starred: true } : {}),
        ...(flagView === "important" ? { important: true } : {}),
      }),
    [folder, transport, search, flagView],
  );

  /* Opening a row: a Draft goes to the composer to be finished; anything else
     opens the conversation. Loads the draft's message so the composer prefills
     from a fully-formed record rather than a second async round in the modal. */
  async function openRow(t: MailThread) {
    if (folder !== "drafts") {
      setOpenThread(t.id);
      return;
    }
    const msgs = await getRepository().listMailMessages(t.id);
    const draft = msgs.find((m) => m.sentAt === null) ?? msgs[msgs.length - 1];
    if (draft) setEditingDraft(draft);
  }
  const unread = useQuery((r) => r.getMailUnreadCount(), [folder]);

  /* Client-side windowing: draw the first page of rows and reveal more on
     demand, so a large inbox never renders hundreds of rows at once. The window
     resets whenever the folder, search or view changes — derived from a signature
     so no effect is needed. (Full message bodies are already fetched only on
     open, in `MailThreadView`.) */
  const PAGE = 25;
  const listSig = `${folder}|${transport ?? ""}|${search}|${flagView ?? ""}`;
  const [page, setPage] = useState({ sig: listSig, shown: PAGE });
  const shown = page.sig === listSig ? page.shown : PAGE;

  /* Live updates: an onSnapshot on the mailbox refetches the list and the unread
     count the moment a message someone sends reaches this person — no polling.
     A ref holds the latest refetchers so the subscription is opened once. */
  const refetchRef = useRef(() => {});
  refetchRef.current = () => {
    threads.refetch();
    unread.refetch();
  };
  useEffect(() => {
    const repo = getRepository();
    if (!repo.watchMail) return;
    return repo.watchMail(() => refetchRef.current());
  }, []);

  /* New-mail alert: when the unread count RISES, something arrived — fire the
     app's own notification event, which the toast layer (and push, where the
     user has enabled it) already listens for. Sets only a ref, so this is not a
     state write in an effect. */
  const prevUnreadRef = useRef<number | null>(null);
  useEffect(() => {
    const u = unread.data;
    if (u === null || u === undefined) return;
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = u;
    if (prev !== null && u > prev && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cowork:notification", {
          detail: {
            title: "New mail",
            body: `You have ${u} unread ${u === 1 ? "message" : "messages"}.`,
            type: "mail",
            tag: "mail-unread",
          },
        }),
      );
    }
  }, [unread.data]);

  /**
   * Pull Gmail in.
   *
   * External mail does not arrive on its own: Gmail holds it, and nothing here
   * knows about it until it is fetched. `/api/mail/sync` is the only place the
   * connection is readable, and what comes back is folded in through the
   * repository — idempotent, so pressing this twice does not duplicate a thread.
   *
   * A button rather than a poll, deliberately: the same route serves a
   * scheduled worker later without either needing the other.
   */
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  async function syncGmail() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch("/api/mail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await res.json().catch(() => null)) as {
        inbox?: MailMessage[];
        sent?: MailMessage[];
        mailboxAddress?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setSyncNote(payload?.error ?? "Gmail could not be reached.");
        return;
      }
      const incoming = [...(payload?.inbox ?? []), ...(payload?.sent ?? [])];
      const result = await getRepository().importGmailMessages(
        incoming,
        payload?.mailboxAddress ?? "",
      );
      setSyncNote(
        result.ok
          ? result.data.added === 0
            ? "Nothing new."
            : `${result.data.added} new ${result.data.added === 1 ? "message" : "messages"}.`
          : result.message,
      );
      threads.refetch();
      unread.refetch();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <WorkspaceHead
        title="Mail"
        count={
          unread.data !== null && unread.data !== undefined ? (
            <>
              <span data-figure>{unread.data}</span> unread
            </>
          ) : undefined
        }
        action={
          <span className="flex items-center gap-2">
            {syncNote && (
              /* In the header, which sits on the field. The rule: on the field,
                 secondary text takes `ink-muted` at Body size or larger — an
                 11px `ink-faint` note there is exactly the defect it names. */
              <span className="text-sm text-ink-muted">{syncNote}</span>
            )}
            <Button
              tone="secondary"
              size="sm"
              disabled={syncing}
              onClick={() => void syncGmail()}
            >
              {syncing ? "Syncing…" : "Sync Gmail"}
            </Button>
          </span>
        }
      />

      <div className="grid gap-4 deck:grid-cols-[216px_minmax(0,1fr)]">
        {/* Sidebar. Compose leads it — the one thing you come here to do that a
            row cannot start. Folders are views; Internal/External are the only
            transport filters, and they sit under a rule so they do not read as
            two more mailboxes.
            On a PANEL, not bare on the field: `ink-faint` is a panel-only token
            (the backdrop under a bare run changes as the page scrolls), so the
            "Source" heading needs a surface before it is allowed. */}
        <Panel padded={false}>
          <div className="flex flex-col px-2.5 py-3">
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="mb-3 flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-[var(--body-bg)] shadow-[0_1px_3px_rgba(0,0,0,0.18)] transition-opacity hover:opacity-90"
            >
              <Icon.plus className="h-4 w-4" />
              Compose
            </button>

            <nav aria-label="Mail folders" className="flex flex-col gap-0.5">
              {FOLDERS.map((f) => (
                <SideItem
                  key={f.id}
                  label={f.label}
                  icon={f.icon}
                  count={f.id === "inbox" ? (unread.data ?? undefined) : undefined}
                  active={folder === f.id && !flagView}
                  onClick={() => {
                    setFolder(f.id);
                    setFlagView(null);
                    setOpenThread(null);
                  }}
                />
              ))}
              <SideItem
                label="Starred"
                icon="star"
                active={flagView === "starred"}
                onClick={() => {
                  setFlagView("starred");
                  setFolder("inbox");
                  setOpenThread(null);
                }}
              />
              <SideItem
                label="Important"
                icon="flag"
                active={flagView === "important"}
                onClick={() => {
                  setFlagView("important");
                  setFolder("inbox");
                  setOpenThread(null);
                }}
              />

              <div className="my-2 h-px bg-[var(--color-hairline)]" />
              <p className="px-3 pb-1 text-[10px] font-medium tracking-[0.08em] text-ink-faint uppercase">
                Source
              </p>
              {[
                { id: null, label: "All" },
                { id: "internal" as const, label: "Internal" },
                { id: "gmail" as const, label: "External" },
              ].map((t) => (
                <SideItem
                  key={t.label}
                  label={t.label}
                  active={transport === t.id}
                  onClick={() => {
                    setTransport(t.id);
                    setOpenThread(null);
                  }}
                />
              ))}
            </nav>
          </div>
        </Panel>

        <div className="min-w-0">
          {openThread ? (
            <MailThreadView
              threadId={openThread}
              folder={folder}
              onBack={() => setOpenThread(null)}
              onChanged={() => {
                threads.refetch();
                unread.refetch();
              }}
            />
          ) : (
            <>
              <div className="mb-3">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search subject, sender or message…"
                  aria-label="Search mail"
                />
              </div>

              {threads.error ? (
                <QueryError
                  queries={[threads]}
                  message="Your mail could not be loaded."
                />
              ) : threads.isLoading ? (
                <SkeletonRows rows={6} />
              ) : !threads.data?.length ? (
                <Panel>
                  <EmptyState
                    title={search.trim() ? "Nothing matches" : "Nothing here"}
                    body={
                      search.trim()
                        ? "No message in this folder matches that."
                        : "Messages you send and receive appear here, whether they came from Cowork or Gmail."
                    }
                  />
                </Panel>
              ) : (
                <Panel padded={false}>
                  <ul className="divide-y divide-hairline">
                    {threads.data.slice(0, shown).map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        onOpen={() => void openRow(t)}
                      />
                    ))}
                  </ul>
                  {threads.data.length > shown && (
                    <button
                      type="button"
                      onClick={() =>
                        setPage({ sig: listSig, shown: shown + PAGE })
                      }
                      className="w-full border-t border-hairline px-5 py-2.5 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                    >
                      Show {Math.min(PAGE, threads.data.length - shown)} more ·{" "}
                      {threads.data.length - shown} not shown
                    </button>
                  )}
                </Panel>
              )}
            </>
          )}
        </div>
      </div>

      {composing && (
        <MailCompose
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            threads.refetch();
            unread.refetch();
          }}
          onSaved={() => {
            setComposing(false);
            threads.refetch();
          }}
        />
      )}

      {/* Finishing a saved draft: the composer prefilled from it, overwriting
          the same draft on Save and replacing it with a sent message on Send. */}
      {editingDraft && (
        <MailCompose
          editingDraft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSent={() => {
            setEditingDraft(null);
            threads.refetch();
            unread.refetch();
          }}
          onSaved={() => {
            setEditingDraft(null);
            threads.refetch();
          }}
        />
      )}
    </>
  );
}

function SideItem({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon?: keyof typeof Icon;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  const I = icon ? Icon[icon] : null;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-full px-3 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-[var(--control-active)] font-medium text-ink"
          : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      {/* A fixed leading slot so iconned folders and the source filters align. */}
      {I ? (
        <I className="h-4 w-4 shrink-0" />
      ) : (
        <span aria-hidden className="w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && count > 0 && (
        <span
          className={`shrink-0 text-[12px] tabular-nums ${active ? "text-ink" : "text-ink-faint"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ThreadRow({
  thread,
  onOpen,
}: {
  thread: MailThread;
  onOpen: () => void;
}) {
  /* Real clock, resolved after mount — see `useNow`. */
  const now = useNow();
  /* The other party, not everybody: a row that lists yourself first tells you
     nothing you did not already know. */
  const other = thread.participants[thread.participants.length - 1];
  const initials =
    other?.displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() ?? "??";

  /* Unread is the viewer's own state, stamped on the row by the repository so
     no second read is needed — see `listMailThreads`. It drives the weight and a
     lifted row; the design language stays quiet — no accent bars. */
  const unread = thread.unread === true;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${unread ? "Unread. " : ""}${other?.displayName ?? "Conversation"}: ${thread.subject || "(no subject)"}`}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--control)] ${
          unread ? "bg-[var(--surface-raised)]" : ""
        }`}
      >
        {/* A star only when starred — a fixed slot keeps every row aligned. */}
        <span aria-hidden className="grid w-4 shrink-0 place-items-center">
          {thread.starred && (
            <Icon.star className="h-4 w-4 fill-[var(--state-warning,#e0a11b)] text-[var(--state-warning,#e0a11b)]" />
          )}
        </span>
        <Avatar
          initials={initials}
          hue={2}
          name={other?.displayName ?? "Unknown"}
          size="sm"
        />
        {/* Sender — a fixed column, so subjects line up down the list. */}
        <span
          className={`w-32 shrink-0 truncate text-[13px] sm:w-40 ${
            unread ? "font-semibold text-ink" : "text-ink-muted"
          }`}
        >
          {other?.displayName ?? other?.address ?? "Unknown"}
        </span>
        {/* Subject then a dimmed snippet, on one line — the Gmail read. */}
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span className={unread ? "font-semibold text-ink" : "text-ink"}>
            {thread.subject || "(no subject)"}
          </span>
          {thread.lastMessagePreview && (
            <span className="text-ink-faint"> — {thread.lastMessagePreview}</span>
          )}
        </span>
        {thread.important && (
          <Icon.flag className="h-3.5 w-3.5 shrink-0 fill-[var(--state-overdue,#d1495b)] text-[var(--state-overdue,#d1495b)]" />
        )}
        {/* Quiet on purpose: internal mail carries no badge at all. */}
        {thread.transport === "gmail" && <Chip tone="neutral">Gmail</Chip>}
        {thread.hasAttachments && (
          <Icon.attach className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        )}
        <span
          className={`w-14 shrink-0 text-right text-[11px] tabular-nums sm:w-16 ${
            unread ? "font-medium text-ink" : "text-ink-faint"
          }`}
        >
          {now && formatRelative(thread.lastMessageAt, now)}
        </span>
      </button>
    </li>
  );
}
