"use client";

/**
 * Group administration — rename, membership, and who runs it.
 *
 * A modal over the thread. Everyone in the group can open it and see who is in
 * it and who administers it; only an admin sees the controls (rename, add,
 * remove, promote/demote). The repository enforces the same rule server-side, so
 * the hidden controls are a courtesy, not the guard. "Leave group" is the one
 * action anyone may take on themselves.
 */

import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Button, InlineError, Input } from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import type { Conversation, Employee } from "@/lib/domain";

type ConversationView = Conversation & { participants: Employee[] };

export function GroupSettings({
  conversation: c,
  viewerId,
  onClose,
  onChanged,
}: {
  conversation: ConversationView;
  viewerId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const repo = useRepo();
  const admins = useMemo(() => new Set(c.adminIds ?? []), [c.adminIds]);
  const isAdmin = viewerId ? admins.has(viewerId) : false;
  /* The controls appear only where the backend actually accepts the write — an
     admin on a repository that implements it. */
  const canManage = isAdmin && typeof repo.updateGroup === "function";

  const [name, setName] = useState(c.title ?? "");
  const [saveName, nameState] = useAction((r) =>
    r.updateGroup!(c.id, { title: name }),
  );
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const dirty = name.trim().length > 0 && name.trim() !== (c.title ?? "");

  async function rename() {
    if (!dirty) return;
    const r = await saveName();
    if (r.ok) onChanged();
  }
  async function toggleAdmin(id: string, makeAdmin: boolean) {
    setError(null);
    const r = await repo.setGroupAdmin?.(c.id, id, makeAdmin);
    if (r?.ok) onChanged();
    else if (r) setError(r.message);
  }
  async function remove(id: string) {
    setError(null);
    const r = await repo.removeGroupMember?.(c.id, id);
    if (r?.ok) {
      onChanged();
      if (id === viewerId) onClose();
    } else if (r) setError(r.message);
  }

  /* Admins first, then everyone else, each group alphabetical — the shape a
     member list is read in. */
  const members = useMemo(() => {
    const rank = (p: Employee) => (admins.has(p.id) ? 0 : 1);
    return [...c.participants].sort(
      (a, b) =>
        rank(a) - rank(b) || a.displayName.localeCompare(b.displayName),
    );
  }, [c.participants, admins]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Group settings"
      className="fixed inset-0 z-[90] grid place-items-center p-4"
    >
      {/* A real, opaque backdrop as its own element — dim + blur — so the panel
          reads over the thread instead of letting it bleed through. */}
      <button
        type="button"
        aria-label="Close group settings"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />
      <div className="frost-panel relative flex max-h-[85vh] w-[min(460px,96vw)] flex-col overflow-hidden rounded-panel">
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-medium text-ink">Group settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.close className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 scroll-slim">
          {error && <InlineError compact message={error} />}

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Name
            </label>
            {canManage ? (
              <div className="flex items-center gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename();
                  }}
                  aria-label="Group name"
                  className="flex-1"
                />
                <Button
                  tone="primary"
                  size="sm"
                  onClick={rename}
                  disabled={!dirty || nameState.isPending}
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-sm text-ink">{c.title ?? "Group"}</p>
            )}
            {nameState.error && (
              <p className="mt-1 text-xs text-[var(--negative,#dc2626)]">
                {nameState.error}
              </p>
            )}
          </div>

          {/* Members */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                {members.length} member{members.length === 1 ? "" : "s"}
              </label>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                >
                  <Icon.plus className="h-3.5 w-3.5" /> Add people
                </button>
              )}
            </div>

            {adding && canManage && (
              <AddMemberPicker
                conversation={c}
                onAdded={onChanged}
                onDone={() => setAdding(false)}
              />
            )}

            <ul className="space-y-0.5">
              {members.map((p) => {
                const memberIsAdmin = admins.has(p.id);
                const isSelf = p.id === viewerId;
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-[var(--control)]"
                  >
                    <Avatar
                      initials={p.initials}
                      hue={p.hue}
                      name={p.displayName}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {p.displayName}
                        {isSelf && (
                          <span className="text-ink-faint"> (you)</span>
                        )}
                      </span>
                      {p.designation && (
                        <span className="block truncate text-[11px] text-ink-faint">
                          {p.designation}
                        </span>
                      )}
                    </span>
                    {memberIsAdmin && (
                      <span className="shrink-0 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] font-medium tracking-wide text-ink-muted uppercase">
                        Admin
                      </span>
                    )}
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                        <button
                          type="button"
                          onClick={() => toggleAdmin(p.id, !memberIsAdmin)}
                          className="rounded px-1 hover:text-ink"
                        >
                          {memberIsAdmin ? "Unadmin" : "Make admin"}
                        </button>
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => remove(p.id)}
                            className="rounded px-1 hover:text-ink"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Leave */}
          <div className="border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => viewerId && remove(viewerId)}
              className="text-sm text-[var(--negative,#dc2626)] hover:underline"
            >
              Leave group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Search the directory for people not already in the group, and add them. */
function AddMemberPicker({
  conversation: c,
  onAdded,
  onDone,
}: {
  conversation: ConversationView;
  onAdded: () => void;
  onDone: () => void;
}) {
  const repo = useRepo();
  const employees = useQuery((r) => r.listEmployees(), []);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const inGroup = useMemo(
    () => new Set(c.participantIds),
    [c.participantIds],
  );
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employees.data ?? [])
      .filter((e) => !inGroup.has(e.id) && !e.exitedAt)
      .filter((e) => !q || e.displayName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [employees.data, inGroup, search]);

  async function add(id: string) {
    setBusy(id);
    const r = await repo.addGroupMember?.(c.id, id);
    setBusy(null);
    if (r?.ok) onAdded();
  }

  return (
    <div className="mb-2 rounded-[12px] border border-hairline p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people to add"
          aria-label="Search people to add"
          className="flex-1"
        />
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-ink-muted hover:text-ink"
        >
          Done
        </button>
      </div>
      {candidates.length === 0 ? (
        <p className="px-1 py-2 text-xs text-ink-faint">
          {employees.isLoading ? "Loading…" : "Nobody to add."}
        </p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim">
          {candidates.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => add(e.id)}
                disabled={busy === e.id}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left hover:bg-[var(--control)] disabled:opacity-50"
              >
                <Avatar
                  initials={e.initials}
                  hue={e.hue}
                  name={e.displayName}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {e.displayName}
                </span>
                <Icon.plus className="h-4 w-4 shrink-0 text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
