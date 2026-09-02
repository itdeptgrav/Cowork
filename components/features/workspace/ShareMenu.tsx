"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Button, InlineError, Input, Panel } from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import type {
  ActionResult,
  ExternalShareInvite,
  ExternalShareRole,
} from "@/lib/repositories";
import {
  SHARE_ROLES,
  SHARE_ROLE_LABEL,
  shareRoleHints,
  sortByRole,
  type ShareRole,
} from "@/lib/rules/workspace/sharing";

/** The three roles minus `"owner"` — the only ones an external invite may
    ever carry. Filtered from `SHARE_ROLES` rather than declared separately,
    so a role added there is not silently missing here. */
const EXTERNAL_SHARE_ROLES = SHARE_ROLES.filter(
  (r): r is ExternalShareRole => r !== "owner",
);

/**
 * Who has access, and as what. Documents, sheets and mindmaps.
 *
 * Owners only — the button that opens this is not rendered for anybody else, and
 * every change is authorised again in the repository, because a hidden control
 * is courtesy and the refusal is the permission.
 *
 * **The last owner cannot be demoted or removed here**, and the rule says so
 * rather than the control silently doing nothing: a record with no owner cannot
 * be shared, renamed or deleted by anybody, and there is no screen anywhere in
 * the product that could repair it.
 *
 * ## Why this takes a target rather than a document
 *
 * It used to take a `CoworkDocument` and call `setDocumentMember`. Mindmaps
 * grant the same three roles through the same panel, and the alternative was a
 * second copy of this file — which is the version where one of them grows a fix
 * the other never gets. What differs between the two is a collection and a verb,
 * so those are the parameters and everything else is shared.
 *
 * The repository call still happens HERE rather than being passed in, so
 * `useAction` keeps owning the pending state and a caller cannot forget to
 * disable the controls mid-write.
 */
export type ShareTarget =
  | { kind: "document"; id: string; noun: "document" }
  | { kind: "mindmap"; id: string; noun: "mindmap" };

export function ShareMenu({
  target,
  members: memberList,
  onChanged,
}: {
  target: ShareTarget;
  /** Who is on it now. Read from the record the caller already holds. */
  members: readonly { employeeId: string; role: ShareRole }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = useQuery((r) => r.listEmployees(), []);
  const hints = shareRoleHints(target.noun);

  /* External shares — invited by email, no Cowork account required. A
     separate query and a separate action pair from the internal member list
     above: they read/write `cowork_share_invites`, never `members`. Only
     fetched while the menu is open — there is nothing for it to back while
     closed. */
  const externalShares = useQuery(
    (r) => (open ? r.listExternalShares(target.kind, target.id) : Promise.resolve([])),
    [open, target.kind, target.id],
  );
  const invites = externalShares.data ?? [];

  const [inviteExternal, inviteState] = useAction(
    (r, email: string, role: ExternalShareRole) =>
      r.inviteExternal(target.kind, target.id, email, role),
  );
  const [revokeExternal, revokeState] = useAction((r, inviteId: string) =>
    r.revokeExternal(target.kind, target.id, inviteId),
  );

  const [externalEmail, setExternalEmail] = useState("");
  const [externalRole, setExternalRole] = useState<ExternalShareRole>("editor");
  const [externalError, setExternalError] = useState<string | null>(null);

  const sendExternalInvite = async () => {
    const email = externalEmail.trim();
    if (!email) return;
    setExternalError(null);
    const result = await inviteExternal(email, externalRole);
    if (result.ok) setExternalEmail("");
    else setExternalError(result.message);
  };

  const revoke = async (inviteId: string) => {
    setExternalError(null);
    const result = await revokeExternal(inviteId);
    if (!result.ok) setExternalError(result.message);
  };

  const [setMember, state] = useAction(
    /* `ActionResult<unknown>` because the two calls return different records —
       a `MindMapRecord` and a `CoworkDocument` — and this panel reads neither.
       It uses `ok` and `message`, which every result carries. Without the
       annotation `useAction` infers its type from whichever branch it sees
       first and rejects the other. */
    (
      r,
      employeeId: string,
      role: ShareRole | null,
    ): Promise<ActionResult<unknown>> =>
      target.kind === "mindmap"
        ? r.setMindMapMember(target.id, employeeId, role)
        : r.setDocumentMember(target.id, employeeId, role),
  );

  const apply = async (employeeId: string, role: ShareRole | null) => {
    setError(null);
    const result = await setMember(employeeId, role);
    if (result.ok) onChanged();
    else setError(result.message);
  };

  const directory = people.data ?? [];
  const members = sortByRole(memberList).map((m) => ({
    ...m,
    person: directory.find((p) => p.id === m.employeeId) ?? null,
  }));

  const candidates = directory.filter(
    (p) => !memberList.some((m) => m.employeeId === p.id),
  );

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink"
      >
        <Icon.team className="h-3 w-3" />
        Share
        <span data-figure>{memberList.length}</span>
      </button>

      {open && (
        <>
          {/* Click-away. A menu that only closes via its own button is one
              people leave open over the thing they were reading. */}
          <button
            type="button"
            aria-label="Close sharing"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[80] cursor-default"
          />
          <div className="absolute end-0 z-[81] mt-2 w-[320px]">
            <Panel>
              {/* Title type, not a tracked eyebrow, over the member list — the
                 same fix already made in DocsSidebar and NodeInspector. */}
              <p className="text-[12.5px] font-medium text-ink">Who has access</p>

              <ul className="mt-2 flex flex-col gap-1">
                {members.map((m) => (
                  <li key={m.employeeId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {m.person?.displayName ?? m.employeeId}
                    </span>
                    <select
                      aria-label={`Access for ${m.person?.displayName ?? m.employeeId}`}
                      value={m.role}
                      disabled={state.isPending}
                      onChange={(e) =>
                        void apply(m.employeeId, e.target.value as ShareRole)
                      }
                      className="h-6 rounded-inset bg-[var(--control)] px-1 text-[11px] text-ink-muted"
                    >
                      {SHARE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {SHARE_ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${m.person?.displayName ?? m.employeeId}`}
                      disabled={state.isPending}
                      onClick={() => void apply(m.employeeId, null)}
                      className="text-ink-faint hover:text-ink"
                    >
                      <Icon.close className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>

              {error && (
                <div className="mt-2">
                  <InlineError compact message={error} />
                </div>
              )}

              {candidates.length > 0 && (
                <div className="mt-3 border-t border-hairline pt-3">
                  <p className="text-[11px] text-ink-faint">Add somebody</p>
                  <select
                    aria-label={`Add somebody to this ${target.noun}`}
                    value=""
                    disabled={state.isPending}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      /* New people arrive as EDITORS, matching what Google does
                         and what people expect from "share" — a viewer by
                         default means every share is followed by a second step
                         nobody remembers to take. */
                      void apply(e.target.value, "editor");
                      e.target.value = "";
                    }}
                    className="mt-1.5 h-7 w-full rounded-inset bg-[var(--control)] px-2 text-[12px] text-ink"
                  >
                    <option value="">Choose a colleague…</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* External invites — by email, no Cowork account required. A
                  system parallel to the member list above, not an extension
                  of it: these rows never appear in `members`. */}
              <div className="mt-3 border-t border-hairline pt-3">
                <p className="text-[11px] text-ink-faint">
                  Share with somebody outside Cowork
                </p>

                {invites.filter((i) => i.status !== "revoked").length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {invites
                      .filter((i) => i.status !== "revoked")
                      .map((invite) => (
                        <ExternalInviteRow
                          key={invite.id}
                          invite={invite}
                          disabled={revokeState.isPending}
                          onRevoke={() => void revoke(invite.id)}
                        />
                      ))}
                  </ul>
                )}

                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    type="email"
                    aria-label="Email address to invite"
                    placeholder="name@company.com"
                    value={externalEmail}
                    disabled={inviteState.isPending}
                    onChange={(e) => setExternalEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void sendExternalInvite();
                      }
                    }}
                    className="h-7 flex-1 !py-1 !text-[12px]"
                  />
                  <select
                    aria-label="Role for the invited email"
                    value={externalRole}
                    disabled={inviteState.isPending}
                    onChange={(e) =>
                      setExternalRole(e.target.value as ExternalShareRole)
                    }
                    className="h-7 shrink-0 rounded-inset bg-[var(--control)] px-1 text-[11px] text-ink-muted"
                  >
                    {EXTERNAL_SHARE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {SHARE_ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button loading={inviteState.isPending}
                  size="sm"
                  tone="secondary"
                  className="mt-1.5 w-full"
                  disabled={inviteState.isPending || !externalEmail.trim()}
                  onClick={() => void sendExternalInvite()}
                >
                  {inviteState.isPending ? "Sending…" : "Send invite"}
                </Button>

                {externalError && (
                  <div className="mt-1.5">
                    <InlineError compact message={externalError} />
                  </div>
                )}
              </div>

              <dl className="mt-3 border-t border-hairline pt-2">
                {SHARE_ROLES.map((r) => (
                  <div key={r} className="flex gap-2 py-0.5">
                    <dt className="w-14 shrink-0 text-[10px] text-ink">
                      {SHARE_ROLE_LABEL[r]}
                    </dt>
                    <dd className="text-[10px] leading-relaxed text-ink-faint">
                      {hints[r]}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-3 flex justify-end">
                <Button size="sm" tone="ghost" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One external invite, in the share panel's list.
 *
 * Visually distinguished from a colleague's row rather than folded into it:
 * there is no `displayName` to look up for an email that never had a
 * directory entry, and an "External" badge says plainly that this access
 * did not come from `members`.
 */
function ExternalInviteRow({
  invite,
  disabled,
  onRevoke,
}: {
  invite: ExternalShareInvite;
  disabled: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        title="Invited by email, no Cowork account"
        className="shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-ink-faint uppercase"
      >
        External
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
        {invite.email}
      </span>
      <span className="shrink-0 text-[11px] text-ink-faint">
        {SHARE_ROLE_LABEL[invite.role]}
        {invite.status === "pending" ? " · pending" : ""}
      </span>
      <button
        type="button"
        aria-label={`Revoke access for ${invite.email}`}
        disabled={disabled}
        onClick={onRevoke}
        className="text-ink-faint hover:text-ink"
      >
        <Icon.close className="h-3 w-3" />
      </button>
    </li>
  );
}
