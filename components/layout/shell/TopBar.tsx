"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./Mark";
import { useLens } from "./LensContext";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { ActiveWorkPill } from "@/components/features/tasks/TimerControl";
import { useQuery } from "@/lib/hooks/useRepository";
import { useCoworkNotifications } from "@/lib/legacy-ui/useCoworkNotifications";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { isActive, visibleNavItems } from "@/lib/utils/nav";
import { useSession } from "@/components/features/auth/SessionProvider";
import { canAccessAdminConsole } from "@/lib/rules/admin/access";
import { useMusic } from "@/components/features/music/MusicContext";
import { StatusButton } from "@/components/features/status/StatusButton";
import { SignOutButton } from "@/components/features/auth/SignOutButton";
import type { Lens } from "@/lib/utils/types";

/**
 * The floating frosted navigation pill. It never docks to the viewport top —
 * the gutter above it is what makes it read as a deck laid over the field.
 *
 * Height is 52px rather than the original 60px: the `dashboard` reference gives
 * navigation about 6.5% of the frame, and 60px was reading as chrome outranking
 * the work. The pill, the centred links and the filled active state are the
 * reference's own grammar and Cowork's, so they stay.
 */

function InboxIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 11.5h3.2l1.1 2h6.4l1.1-2h3.2M2.5 11.5 4.4 4.2A1.6 1.6 0 0 1 6 3h8a1.6 1.6 0 0 1 1.6 1.2l1.9 7.3v3.9A1.6 1.6 0 0 1 15.9 17H4.1a1.6 1.6 0 0 1-1.6-1.6z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 2.6a4.9 4.9 0 0 0-4.9 4.9c0 3.4-1.3 4.6-1.3 4.6h12.4s-1.3-1.2-1.3-4.6A4.9 4.9 0 0 0 10 2.6ZM8.2 15.3a2 2 0 0 0 3.6 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={open ? "M5.5 5.5l9 9M14.5 5.5l-9 9" : "M3.5 6.5h13M3.5 13.5h13"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The ambient score. docs/architecture/PRODUCT.md: the score is ambient and persistently present
 * — an employee sees it and its trajectory *as they work*, rather than visiting
 * a separate destination. So it lives in the shell, on every route, and links
 * to the decomposition rather than replacing it.
 */
function ScorePill() {
  const me = useViewerId();
  const { data } = useQuery(
    (r) => (me ? r.getScoreOverview(me) : Promise.resolve(null)),
    [me],
  );

  if (!data) {
    return (
      <span className="block h-8 w-[84px] rounded-full bg-[var(--surface-sunken)]" />
    );
  }

  const rising = data.delta >= 0;
  return (
    <Link
      href="/score"
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-3 py-1.5 transition-colors duration-[180ms] hover:bg-[var(--control-hover)]"
      title="Your performance score. Visible only to you and your reporting chain."
    >
      <span
        data-figure
        className="text-sm leading-none tracking-[-0.02em] text-ink"
      >
        {Math.round(data.overallPercentage)}%
      </span>
      <span
        data-figure
        className="text-xs leading-none text-ink-muted"
        aria-label={`${rising ? "up" : "down"} ${Math.abs(data.delta)} points since the previous period`}
      >
        {rising ? "↑" : "↓"}
        {Math.abs(Math.round(data.delta))}
      </span>
    </Link>
  );
}

/**
 * Private / Team. A radiogroup, not a checkbox: the two lenses are named
 * alternatives and the control must announce which is active. It always carries
 * visible labels — an icon toggle would hide a privacy boundary behind a glyph.
 */
function LensToggle() {
  const { lens, setLens } = useLens();
  const options: { id: Lens; label: string; hint: string }[] = [
    { id: "private", label: "Private", hint: "Only your own score" },
    { id: "team", label: "Team", hint: "Scores of people reporting to you" },
  ];

  function onKeyDown(e: React.KeyboardEvent) {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === lens);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? options.length - 1
          : (i + (forward ? 1 : -1) + options.length) % options.length;
    setLens(options[next].id);
    (e.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>("[role=radio]")
      [next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Score lens"
      onKeyDown={onKeyDown}
      className="inline-flex gap-0.5 rounded-full bg-[var(--surface-sunken)] p-[3px]"
    >
      {options.map((o) => {
        const active = lens === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.hint}
            onClick={() => setLens(o.id)}
            className={`rounded-full px-3.5 py-1 text-sm font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              active
                ? "bg-ink text-[var(--body-bg)]"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NotificationBell() {
  /**
   * Live from Firestore, via the hook copied from `cowork-old-frontend`.
   *
   * An `onSnapshot` subscription on this employee's notifications, so the badge
   * updates the moment one arrives — which is what the running product does.
   * `listNotifications()` fetched once and only refreshed when something else
   * happened to invalidate the query, so a notification arriving while the page
   * sat open went unseen.
   *
   * The hook also owns `unread` rather than the component counting it. Legacy
   * treats a direct message differently from a task notification, and
   * recomputing the count here would eventually disagree with the badge the old
   * app shows.
   */
  const viewerId = useViewerId();
  const { unread } = useCoworkNotifications(viewerId ?? null);

  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors duration-[180ms] hover:bg-[var(--surface-sunken)] hover:text-ink"
    >
      <BellIcon />
      {unread > 0 && (
        <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--state-overdue)]" />
      )}
    </Link>
  );
}

export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const sheetId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const { data: me } = useQuery((r) => r.getCurrentEmployee(), []);
  /* The archetype the session resolved, not a role string and not a capability
     list. `canAccessAdminConsole` is the single definition of "administrator" in
     the codebase, and the navigation asks it the same question the server-side
     route guard asks — so the bar cannot offer a link the guard will refuse. */
  const items = visibleNavItems(
    useMusic().enabled,
    canAccessAdminConsole(useSession()),
  );

  // Escape closes the sheet and returns focus to the control that opened it.
  useEffect(() => {
    if (!menuOpen) return;
    sheetRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuBtnRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // The sheet closes from the links themselves (see `closeMenu` below) rather
  // than from an effect on `pathname`. Resetting state in an effect when a prop
  // changes cascades an extra render, and the event that caused the navigation
  // is the honest place to handle it.
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 px-[clamp(12px,3vw,32px)] pt-[clamp(10px,1.6vw,16px)]">
      <div className="mx-auto max-w-[1360px]">
        <nav
          className={`frost-bar ${menuOpen ? "rounded-[30px]" : "rounded-full"}`}
          aria-label="Main"
        >
          <div className="flex h-[52px] items-center gap-2 pr-2 pl-4">
            <Link
              href="/"
              className="mr-3 flex shrink-0 items-center gap-2.5 rounded-full py-1.5"
            >
              <Mark className="h-5 w-5 text-ink" />
              <span className="text-[17px] leading-none font-medium tracking-[-0.03em] text-ink">
                cowork
              </span>
            </Link>

            {/* `min-w-0` is the fix. A flex item defaults to `min-width: auto`,
                which means this list refuses to shrink below the intrinsic width
                of nine tabs — so once the logo, the tabs and the right-hand
                controls exceed the row, something has to leave the container.
                With `min-w-0` it may shrink, and `rail`+`overflow-x-auto` let it
                scroll inside itself instead of pushing its neighbours out.
                Identical at any width where it already fitted. */}
            <ul className="rail mx-auto hidden min-w-0 items-center gap-1 overflow-x-auto deck:flex">
              {items.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-full px-3.5 py-1.5 text-[15px] font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
                        active
                          ? "bg-ink text-[var(--body-bg)]"
                          : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* `shrink-0`: the right-hand controls are fixed-content pills and
                must keep their size, so the tab list is what yields. Without it
                both groups shrink and the pills deform before anything scrolls. */}
            <div className="ml-auto flex shrink-0 items-center gap-2 deck:ml-0">
              {/* Presence, everywhere. It belongs to the person rather than to
                  a route: someone reading the dashboard is as online as someone
                  on a task page, and going online should not require finding a
                  particular screen first. The manager side is untouched. */}
              <StatusButton />
              {/* Present only while a session is running, so "what am I working
                  on" is answerable from any route without a dead slot when the
                  answer is nothing. */}
              <span className="hidden deck:block">
                <ActiveWorkPill />
              </span>
              <ScorePill />
              <div className="hidden sm:block">
                <LensToggle />
              </div>
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>

              <Link
                href="/messages"
                aria-label="Messages"
                className="hidden h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors duration-[180ms] hover:bg-[var(--surface-sunken)] hover:text-ink sm:grid"
              >
                <InboxIcon />
              </Link>

              <NotificationBell />

              <span className="ml-0.5 hidden sm:block">
                {me && (
                  <Link href="/profile">
                    <Avatar
                      initials={me.initials}
                      hue={me.hue}
                      name={me.displayName}
                      size="md"
                    />
                  </Link>
                )}
              </span>

              <SignOutButton />

              <button
                ref={menuBtnRef}
                type="button"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                aria-controls={sheetId}
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-8 w-8 place-items-center rounded-full text-ink transition-colors duration-[180ms] hover:bg-[var(--surface-sunken)] deck:hidden"
              >
                <MenuIcon open={menuOpen} />
              </button>
            </div>
          </div>

          {menuOpen && (
            <div
              id={sheetId}
              ref={sheetRef}
              className="border-t border-hairline px-3 pt-3 pb-4 deck:hidden"
            >
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = isActive(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={closeMenu}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-full px-4 py-2.5 text-[15px] font-medium tracking-[-0.012em] ${
                          active
                            ? "bg-[var(--control)] text-ink"
                            : "text-ink-muted"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href="/settings"
                    onClick={closeMenu}
                    className="block rounded-full px-4 py-2.5 text-[15px] font-medium tracking-[-0.012em] text-ink-muted"
                  >
                    Settings
                  </Link>
                </li>
              </ul>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
                <div className="sm:hidden">
                  <LensToggle />
                </div>
                <ThemeToggle />
              </div>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
