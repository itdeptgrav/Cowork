"use client";

import { useState } from "react";
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

const FOLDERS: { id: MailFolder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "trash", label: "Trash" },
];

export function MailArea() {
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [transport, setTransport] = useState<MailTransport | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const threads = useQuery(
    (r) =>
      r.listMailThreads({
        folder,
        ...(transport ? { transport } : {}),
        ...(search.trim() ? { search } : {}),
      }),
    [folder, transport, search],
  );
  const unread = useQuery((r) => r.getMailUnreadCount(), [folder]);

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
          <Button tone="primary" size="sm" onClick={() => setComposing(true)}>
            <span className="flex items-center gap-1.5">
              <Icon.plus />
              Compose
            </span>
          </Button>
          </span>
        }
      />

      <div className="grid gap-4 deck:grid-cols-[190px_minmax(0,1fr)]">
        {/* Sidebar. Folders are views; Internal/External are the only transport
            filters, and they sit apart from the folders so they do not read as
            two more mailboxes. */}
        {/* On a PANEL, not bare on the field. The Field Is Not A Text Surface
            Rule: the backdrop under any run changes as the page scrolls, and
            under the cream and gold blobs `ink-muted` measures ~3.4:1 and
            `ink-faint` ~3.0:1 — which is why these labels were unreadable.
            `ink-faint` is a panel-only token, so the "Source" heading needs a
            surface before it is allowed at all. Geometry, not colour. */}
        <Panel padded={false}>
          <nav
            aria-label="Mail folders"
            className="flex flex-col gap-1 px-2.5 py-2.5"
          >
          {FOLDERS.map((f) => (
            <SideItem
              key={f.id}
              label={f.label}
              active={folder === f.id && !starredOnly}
              onClick={() => {
                setFolder(f.id);
                setStarredOnly(false);
                setOpenThread(null);
              }}
            />
          ))}
          <SideItem
            label="Starred"
            active={starredOnly}
            onClick={() => {
              setStarredOnly(true);
              setFolder("inbox");
              setOpenThread(null);
            }}
          />

            <p className="mt-3 px-2.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
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
        </Panel>

        <div className="min-w-0">
          {openThread ? (
            <MailThreadView
              threadId={openThread}
              onBack={() => setOpenThread(null)}
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
                    {threads.data.map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        onOpen={() => setOpenThread(t.id)}
                      />
                    ))}
                  </ul>
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
          }}
        />
      )}
    </>
  );
}

function SideItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`rounded-inset px-2.5 py-1.5 text-left text-sm transition-colors ${
        active
          ? "bg-[var(--control-active)] text-ink"
          : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      {label}
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

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--control)]"
      >
        <Avatar
          initials={initials}
          hue={2}
          name={other?.displayName ?? "Unknown"}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm text-ink">
              {other?.displayName ?? other?.address ?? "Unknown"}
            </span>
            {/* Quiet on purpose. Internal mail carries no badge at all —
                marking the normal case is how a unified inbox stops feeling
                unified. */}
            {thread.transport === "gmail" && (
              <Chip tone="neutral">Gmail</Chip>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-ink-muted">
            {thread.subject || "(no subject)"}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
            {thread.lastMessagePreview}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {now && formatRelative(thread.lastMessageAt, now)}
        </span>
      </button>
    </li>
  );
}
