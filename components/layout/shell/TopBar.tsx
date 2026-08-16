"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./Mark";
import { useLens } from "./LensContext";
import { ThemeToggle } from "./ThemeToggle";
import { useQuery } from "@/lib/hooks/useRepository";
import { getRepository } from "@/lib/repositories";
import { useWheelPan } from "@/lib/hooks/useWheelPan";
import { useCoworkNotifications } from "@/lib/legacy-ui/useCoworkNotifications";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { isActive, visibleNavItems } from "@/lib/utils/nav";
import {
  SECTION_TYPES,
  MESSAGE_COUNT_IS_READ_BASED,
  badgeLabel,
  unreadForSection,
  type NotificationSection,
} from "@/lib/rules/notifications/sections";
import { managesAnyone } from "@/lib/rules/team/visibility";
import { useSession } from "@/components/features/auth/SessionProvider";
import { canAccessAdminConsole } from "@/lib/rules/admin/access";
import { useMusic } from "@/components/features/music/MusicContext";
import { StatusButton } from "@/components/features/status/StatusButton";
import { ProfileMenu } from "@/components/features/auth/ProfileMenu";
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
 *
 * It is ALSO the score section's navigation entry — "Score (100%)" — which is
 * why there is no separate Score tab in `navItems`: one button named the section
 * and one showed the number, both going to `/score`. Styled as a nav tab, with
 * the same active fill, so it reads as one of the sections it replaces.
 */
function ScorePill({
  notifications,
  onVisit,
}: {
  /** So the merged Score button carries the score-section badge the old Score
      tab did, and clears it on visit — otherwise a deduction or recheck would
      count against a section nothing on the bar could show or dismiss. */
  notifications: readonly { type: string; read: boolean }[];
  onVisit: (href: string) => void;
}) {
  const me = useViewerId();
  const pathname = usePathname();
  const active = pathname === "/score" || pathname.startsWith("/score/");
  const { data } = useQuery(
    (r) => (me ? r.getScoreOverview(me) : Promise.resolve(null)),
    [me],
  );

  const pct = data ? Math.round(data.overallPercentage) : null;
  const rising = data ? data.delta >= 0 : true;

  return (
    <Link
      href="/score"
      onClick={() => onVisit("/score")}
      aria-current={active ? "page" : undefined}
      title="Your performance score. Visible only to you and your reporting chain."
      className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[15px] font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
      }`}
    >
      <span>Score</span>
      {pct === null ? (
        /* The label is present and clickable while the number loads, rather than
           a bare skeleton that is neither. `bg-current` tints to whichever state
           the tab is in. */
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-3 w-9 animate-pulse rounded-full bg-current opacity-20"
        />
      ) : (
        <span data-figure className="tabular-nums">
          ({pct}%)
        </span>
      )}
      {data && (
        <span
          data-figure
          className={`text-xs ${active ? "opacity-70" : "text-ink-faint"}`}
          aria-label={`${rising ? "up" : "down"} ${Math.abs(Math.round(data.delta))} points since the previous period`}
        >
          {rising ? "↑" : "↓"}
          {Math.abs(Math.round(data.delta))}
        </span>
      )}
      {/* The score section's unread badge — deductions, rechecks — cleared by
          this same visit. */}
      <NavCount href="/score" notifications={notifications} onDark={active} />
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
  const viewer = useQuery((r) => r.getViewer(), []);
  const manages = managesAnyone(viewer.data ?? null);

  /**
   * Nothing at all for somebody who manages nobody.
   *
   * A two-option switch where one option shows the same thing as the other is
   * worse than no switch: it invites people to keep pressing Team wondering
   * why nothing changes. They already only have a private view, so the control
   * has nothing to choose between.
   */
  useEffect(() => {
    if (!viewer.data || manages || lens === "private") return;
    /* Somebody whose reports were removed can be left holding a stored Team
       lens. Put them back rather than leaving a lens nothing can now change. */
    setLens("private");
  }, [viewer.data, manages, lens, setLens]);

  const options: { id: Lens; label: string; hint: string }[] = [
    { id: "private", label: "Private", hint: "Only your own score" },
    { id: "team", label: "Team", hint: "Scores of people reporting to you" },
  ];

  /* Hidden while the viewer resolves too — least privilege, and it avoids the
     control appearing and then vanishing. */
  if (!viewer.data || !manages) return null;

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
            className={`rounded-full px-3.5 py-1 text-sm font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${active
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

/**
 * The count on a nav entry — `1`, `2`, `3`, `9+`, `99+`.
 *
 * Ported from `CoworkingShell.js`'s badge, thresholds included. Which types
 * feed which entry lives in `SECTION_TYPES`, shared with the mark-read on
 * click, so a badge can always be cleared by visiting the section it points at.
 *
 * Rendered inside the link rather than beside it, so the count moves with the
 * label and the whole pill stays one target.
 */
function NavCount({
  href,
  notifications,
  extra = 0,
  onDark = false,
}: {
  href: string;
  notifications: readonly { type: string; read: boolean }[];
  /** Counted alongside the notifications — see MESSAGE_COUNT_IS_READ_BASED. */
  extra?: number;
  onDark?: boolean;
}) {
  const section = SECTION_TYPES[href as NotificationSection]
    ? (href as NotificationSection)
    : null;
  /* Bounded to the badge window. Read from the clock HERE rather than inside
     the rule, so the rule stays pure and testable at a fixed instant — and so
     a badge that has been `9+` since May stops claiming to be news. */
  const fromNotifications = section
    ? unreadForSection(section, notifications, Date.now())
    : 0;
  const label = badgeLabel(fromNotifications + extra);
  if (!label) return null;

  return (
    <span
      /* On the active pill the background is already ink, so a state colour
         would sit on it unreadably. Inverted there and coloured everywhere
         else. */
      className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${onDark
          ? "bg-[var(--body-bg)] text-ink"
          : "bg-[var(--state-overdue)] text-white"
        }`}
    >
      {label}
    </span>
  );
}

function NotificationBell({ unread }: { unread: number }) {
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
  /* Team is withheld from somebody who manages nobody — same question the
     team pages themselves ask, so the bar cannot offer a link onto an empty
     page. */
  const viewerForNav = useQuery((r) => r.getViewer(), []);
  const railRef = useWheelPan<HTMLUListElement>();
  const items = visibleNavItems(
    useMusic().enabled,
    canAccessAdminConsole(useSession()),
    managesAnyone(viewerForNav.data ?? null),
  );

  /* **One subscription for the whole bar.**
     The bell, the Messages icon and every nav count are the same fact about
     the same person, so they read one `onSnapshot` and are handed down. Each
     component calling the hook itself would open a listener per badge and let
     them disagree for a frame.

     Navigating to a section marks that section's types read — `SECTION_TYPES`
     is the same table the counts come from, so a badge can always be cleared
     by visiting the thing it points at. */
  const viewerId = useViewerId();
  const { notifications, unread, markSectionRead } =
    useCoworkNotifications(viewerId ?? null);

  /* **The message count comes from the conversations, not from notifications.**
     Sending a message writes no `cowork_notifications` row — `/direct-message/
     notify` pushes and emails and nothing else — so a notification-based count
     here is permanently zero, which is exactly what the Messages badge showed.
     `unreadDm` from the hook has the same problem and is deliberately unused.

     `#conversationUnread` already computes the old app's rule for each thread
     — sent by somebody else, my id not in `readBy` — so the badge is the sum
     of those. `watchConversations` bumps the repository version when any
     thread changes, which is what refetches this. */
  /* `getRepository()` rather than the `useRepo()` hook.
     The effect wants the module singleton, not a subscription — `useRepo` just
     returns `getRepository()` and gave nothing here except a dependency that
     had to be listed. Calling it directly is one import fewer in the shell's
     hot path and makes the effect genuinely mount-once, which is what watching
     a collection should be. */
  useEffect(() => getRepository().watchConversations?.(), []);
  const conversations = useQuery((r) => r.listConversations(), []);
  const messageUnread = (conversations.data ?? []).reduce(
    (sum, c) => sum + (c.unreadCount || 0),
    0,
  );

  const visitSection = useCallback(
    (href: string) => {
      const types = SECTION_TYPES[href as NotificationSection];
      if (types) void markSectionRead([...types]);
    },
    [markSectionRead],
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
                Identical at any width where it already fitted.

                `useWheelPan` is what makes that scroll reachable with a wheel
                mouse. A trackpad swipe emits `deltaX` and the browser applies
                it; a wheel emits `deltaY` only, which no browser will spend on
                a horizontal box — so the tabs were reachable on a laptop and
                stuck on a desk, with `rail` hiding the scrollbar that would at
                least have said so. It gives the gesture back to the page at
                either end, so this sticky bar never traps a page scroll. */}
            <ul
              ref={railRef}
              className="rail mx-auto hidden min-w-0 items-center gap-1 overflow-x-auto deck:flex"
            >
              {items.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => visitSection(item.href)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[15px] font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${active
                          ? "bg-ink text-[var(--body-bg)]"
                          : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
                        }`}
                    >
                      {item.label}
                      <NavCount
                        href={item.href}
                        notifications={notifications}
                        extra={
                          item.href === MESSAGE_COUNT_IS_READ_BASED
                            ? messageUnread
                            : 0
                        }
                        onDark={active}
                      />
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
              {/* The active-work timer moved out of the top bar and into the
                  Overview's active-work bar (`ActiveTimerBar`). */}
              <ScorePill notifications={notifications} onVisit={visitSection} />
              <div className="hidden sm:block">
                <LensToggle />
              </div>

              <NotificationBell unread={unread} />

              {/* Avatar, and everything that used to sit loose beside it —
                  Profile, Settings, Sign out — now revealed on hover under the
                  one button. */}
              <span className="ml-0.5 hidden sm:block">
                {me && <ProfileMenu me={me} />}
              </span>

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
                        onClick={() => {
                          visitSection(item.href);
                          closeMenu();
                        }}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[15px] font-medium tracking-[-0.012em] ${active
                            ? "bg-[var(--control)] text-ink"
                            : "text-ink-muted"
                          }`}
                      >
                        {item.label}
                        <NavCount
                          href={item.href}
                          notifications={notifications}
                          extra={
                            item.href === MESSAGE_COUNT_IS_READ_BASED
                              ? messageUnread
                              : 0
                          }
                        />
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
