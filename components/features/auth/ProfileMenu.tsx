"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "./SessionProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { ThemeToggle } from "@/components/layout/shell/ThemeToggle";
import type { Employee } from "@/lib/domain";

/**
 * The profile control: the person's avatar, and the three things that used to
 * sit loose beside it — Profile, Settings, Sign out — gathered under it. It
 * reveals the menu on hover, and on focus for anyone using the keyboard.
 *
 * **No logic changed here.** Sign out is still `session.signOut()`, which
 * revokes the server-side session record and hard-navigates (see
 * `SessionProvider`); Profile and Settings are the same two routes they always
 * were. This only moves where those controls live, replacing the standalone
 * `SignOutButton` and the bare avatar link in the top bar.
 */
export function ProfileMenu({ me }: { me: Employee }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /* A short grace period on close, so crossing the 8px gap between the avatar
     and the panel below it — where the pointer is briefly over neither — does
     not shut the menu mid-reach. The next mouseenter cancels it. */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  /* Escape closes and returns focus to the avatar; a click outside closes. The
     same pattern the status menu next to it uses, so the two behave alike. */
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    function onDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const items = [
    { key: "profile", href: "/profile", label: "Profile", icon: Icon.user },
    { key: "settings", href: "/settings", label: "Settings", icon: Icon.settings },
  ] as const;

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={(e) => {
        /* Tabbing out of the whole control closes it; moving between the
           trigger and its own items does not. */
        if (!rootRef.current?.contains(e.relatedTarget as Node)) closeSoon();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account — ${me.displayName}`}
        className="grid rounded-full transition-shadow duration-[180ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <Avatar
          initials={me.initials}
          hue={me.hue}
          src={me.profilePictureUrl}
          name={me.displayName}
          size="md"
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="frost-bar absolute top-[calc(100%+8px)] right-0 z-50 min-w-[210px] rounded-panel border border-hairline p-1.5 shadow-[var(--deck-seat)]"
        >
          {/* Who you are signed in as. Non-interactive — it names the account
              the three actions below act on. */}
          <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-2">
            <Avatar
              initials={me.initials}
              hue={me.hue}
              src={me.profilePictureUrl}
              name={me.displayName}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-ink">
                {me.displayName}
              </span>
              {session.email && (
                <span className="block truncate text-[11px] text-ink-faint">
                  {session.email}
                </span>
              )}
            </span>
          </div>

          <div className="my-1 border-t border-hairline" />

          {/* Appearance — the theme switch, moved off the top bar and under the
              profile section. Its own radiogroup handles the keyboard; Escape
              still bubbles past it to close the menu. */}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="text-[11px] text-ink-faint">Appearance</span>
            <ThemeToggle />
          </div>

          <div className="my-1 border-t border-hairline" />

          {items.map((item) => {
            const Glyph = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left text-xs font-medium text-ink transition-colors hover:bg-[var(--control)]"
              >
                <Glyph className="h-4 w-4 text-ink-muted" />
                {item.label}
              </Link>
            );
          })}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void session.signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left text-xs font-medium text-ink transition-colors hover:bg-[var(--control)]"
          >
            <Icon.external className="h-4 w-4 text-ink-muted" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
