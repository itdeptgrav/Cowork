"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { getRepository } from "@/lib/repositories";
import { notifyRepositoryChanged } from "@/lib/repositories/events";
import { useQuery } from "@/lib/hooks/useRepository";
import {
  PROFILE_STORAGE_KEY,
  PROFILE_SWITCHER_ENABLED,
} from "@/lib/config/profileSwitcher";

/**
 * Act as a different employee, in development only.
 *
 * The whole component is behind a build-time constant, so in a production build
 * `PROFILE_SWITCHER_ENABLED` folds to `false` and everything below is dropped
 * by dead-code elimination rather than merely hidden.
 *
 * It switches **people, not roles.** The earlier version listed six archetypes,
 * which was the wrong shape: a role label tells you nothing about whose tasks
 * you would see, whose manager approves your work, or what your score is.
 * Switching the acting employee changes all of it at once, because department,
 * reporting line, roles, permissions, tasks, score, dashboard, approvals and
 * visibility already resolve from that one identity. Nothing here grants
 * anything — becoming an individual contributor genuinely loses admin access,
 * because that person's roles genuinely lack it.
 *
 * The list comes from the employee directory rather than a hard-coded array, so
 * it can never offer somebody the fixture no longer contains.
 */
export function ProfileSwitcher() {
  const [open, setOpen] = useState(false);
  const [actingId, setActingIdState] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const people = useQuery((r) => r.listEmployees(), []);
  const roles = useQuery((r) => r.listRoles(), []);
  const me = useQuery((r) => r.getCurrentEmployee(), []);

  /* The saved profile is NO LONGER restored on load.

     It was, and it had to stop the moment sessions became real. `SessionProvider`
     points the repository at the signed-in employee on mount; this effect used
     to point it somewhere else a microtask later, and which of the two won was a
     race. Losing that race means the workspace answers as the wrong person after
     a refresh — the exact failure authentication exists to prevent.

     Switching within a session still works, and is still development-only. It
     cannot escalate: the session cookie is untouched, so every server-side gate
     — `/admin`, and anything else that reads `currentSession` — continues to
     answer for whoever actually signed in. What it changes is which fixture the
     client-side workspace reads, which is what it was always for. */
  useEffect(() => {
    if (!PROFILE_SWITCHER_ENABLED) return;
    /* Clear any value left by the previous behaviour, so an old key cannot
       reassert itself the next time somebody opens the menu. */
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!PROFILE_SWITCHER_ENABLED) return null;

  function choose(id: string | null) {
    getRepository().setActingEmployee?.(id);
    if (id) window.localStorage.setItem(PROFILE_STORAGE_KEY, id);
    else window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    setActingIdState(id);
    setOpen(false);
    /* Every mounted query refetches, so navigation, dashboards, permissions and
       available actions all re-resolve against the new identity at once. */
    notifyRepositoryChanged();
  }

  const staff = people.data ?? [];
  const allRoles = roles.data ?? [];
  const current = me.data;

  const levelOf = (roleIds: string[]) =>
    Math.max(
      0,
      ...allRoles
        .filter((r) => roleIds.includes(r.id))
        .map((r) => r.administrativeLevel),
    );

  /** The person's highest-level role — the one worth naming beside them. */
  const roleLabel = (roleIds: string[]) =>
    allRoles
      .filter((r) => roleIds.includes(r.id))
      .sort((a, b) => b.administrativeLevel - a.administrativeLevel)[0]
      ?.displayName ?? "No role";

  /* Highest level first, so the owner heads the list and the switcher reads as
     an org chart rather than an arbitrary directory. */
  const ordered = [...staff].sort(
    (a, b) =>
      levelOf(b.roleIds) - levelOf(a.roleIds) ||
      a.displayName.localeCompare(b.displayName),
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Development only — act as another employee"
        className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--state-extension)_22%,transparent)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--state-extension-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--state-extension)_32%,transparent)]"
      >
        <span aria-hidden="true">⚑</span>
        {current?.firstName ?? "Switch user"}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Act as another employee"
          className="frost-bar absolute top-[calc(100%+8px)] right-0 z-50 max-h-[70vh] w-[300px] overflow-y-auto rounded-panel border border-hairline p-1.5 shadow-[var(--deck-seat)] scroll-slim"
        >
          <p className="px-2.5 pt-1.5 pb-2 text-[11px] leading-relaxed text-ink-faint">
            Development only. This changes which employee the app acts as — it
            grants nothing, so each person has exactly the access their own
            roles carry.
          </p>

          {ordered.map((p) => {
            const isCurrent = p.id === (actingId ?? current?.id);
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => choose(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors ${
                  isCurrent
                    ? "bg-[var(--control-active)]"
                    : "hover:bg-[var(--control)]"
                }`}
              >
                <Avatar initials={p.initials} hue={p.hue} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">
                    {p.displayName}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                    {roleLabel(p.roleIds)}
                    {p.departmentName ? ` · ${p.departmentName}` : ""}
                  </span>
                </span>
                {isCurrent && (
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    Now
                  </span>
                )}
              </button>
            );
          })}

          {actingId && (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(null)}
              className="mt-0.5 flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left text-xs text-ink transition-colors hover:bg-[var(--control)]"
            >
              Back to the seeded user
            </button>
          )}
        </div>
      )}
    </div>
  );
}
