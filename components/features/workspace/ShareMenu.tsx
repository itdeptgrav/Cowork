"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Button, InlineError, Panel } from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/rules/documents/access";
import type { CoworkDocument, DocumentRole } from "@/lib/domain";

/**
 * Who has access, and as what.
 *
 * Owners only — the button that opens this is not rendered for anybody else, and
 * every change is authorised again in the repository, because a hidden control
 * is courtesy and the refusal is the permission.
 *
 * **The last owner cannot be demoted or removed here**, and the rule says so
 * rather than the control silently doing nothing: a document with no owner
 * cannot be shared, renamed or deleted by anybody, and there is no screen
 * anywhere in the product that could repair it.
 */
const ROLES: DocumentRole[] = ["owner", "editor", "viewer"];

export function ShareMenu({
  document,
  onChanged,
}: {
  document: CoworkDocument;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = useQuery((r) => r.listEmployees(), []);

  const [setMember, state] = useAction(
    (r, employeeId: string, role: DocumentRole | null) =>
      r.setDocumentMember(document.id, employeeId, role),
  );

  const apply = async (employeeId: string, role: DocumentRole | null) => {
    setError(null);
    const result = await setMember(employeeId, role);
    if (result.ok) onChanged();
    else setError(result.message);
  };

  const directory = people.data ?? [];
  const members = document.members
    .map((m) => ({
      ...m,
      person: directory.find((p) => p.id === m.employeeId) ?? null,
    }))
    /* Owners first, then editors, then viewers — the order people scan for. */
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));

  const candidates = directory.filter(
    (p) => !document.members.some((m) => m.employeeId === p.id),
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
        <span data-figure>{document.members.length}</span>
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
              <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                Who has access
              </p>

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
                        void apply(m.employeeId, e.target.value as DocumentRole)
                      }
                      className="h-6 rounded-inset bg-[var(--control)] px-1 text-[11px] text-ink-muted"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
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
                    aria-label="Add somebody to this document"
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

              <dl className="mt-3 border-t border-hairline pt-2">
                {ROLES.map((r) => (
                  <div key={r} className="flex gap-2 py-0.5">
                    <dt className="w-14 shrink-0 text-[10px] text-ink">
                      {ROLE_LABEL[r]}
                    </dt>
                    <dd className="text-[10px] leading-relaxed text-ink-faint">
                      {ROLE_HINT[r]}
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
