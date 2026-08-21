"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Primitives";
import { useQuery, useRepo } from "@/lib/hooks/useRepository";
import { useNow } from "@/lib/hooks/useNow";
import { STATUS_META } from "@/lib/status/employeeStatus";
import {
  attendanceReport,
  clockLabel,
  dayLabel,
  dayLabelFor,
  durationLabel,
  istDayWindow,
  sessionLabel,
  stampLabel,
  type AttendanceRow,
} from "@/lib/rules/presence/attendanceDay";
import type { DutyFacts } from "@/lib/rules/presence/roster";
import type { DutyHistoryEntry } from "@/lib/rules/presence/duty";
import type { EmployeeId } from "@/lib/domain";

/**
 * Today's attendance, in a panel that slides in from the right.
 *
 * ## Why a drawer rather than a card
 *
 * The first version put the whole roster on the dashboard as a large card, and
 * it was the wrong shape for the page: eighteen people is a list somebody reads
 * deliberately, not a figure they glance at, and it pushed the work surfaces
 * down the page every single day for one question asked once a morning. A
 * button that carries the ANSWER — "15 of 18 online" — and opens the detail on
 * demand keeps the glance and gives the list the room it needs.
 *
 * ## What it can do
 *
 * · **Close** — the ×, Escape, or the backdrop.
 * · **Move** — the left edge is a drag handle, so the panel can be widened
 *   over the page or narrowed out of the way, and the width is remembered for
 *   the session. On a touch screen it is dragged to the right to dismiss.
 * · **Respond** — full width below 640px, a resizable panel above it. Nothing
 *   inside is horizontally scrollable: the times wrap onto their own line
 *   before the panel ever grows a sideways scrollbar.
 *
 * Focus is moved into the panel on open and returned to the button on close,
 * and the page behind it does not scroll while it is up.
 */

const MIN_WIDTH = 340;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 460;
const WIDTH_KEY = "cowork.attendance.width";

export function AttendanceDrawer({
  open,
  onClose,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  /** The control that opened it — focus goes back there on close. */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const repo = useRepo();
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  /* Width is a session preference, restored in a lazy initialiser so the panel
     never opens at the default and then jumps to the chosen size. */
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
      ? stored
      : DEFAULT_WIDTH;
  });
  /** How far the panel has been dragged aside by a finger, in px. */
  const [dragX, setDragX] = useState(0);
  /** False for one frame after mount, so the panel animates IN rather than
   *  appearing already in place. */
  const [shown, setShown] = useState(false);

  const people = useQuery((r) => r.listEmployees(), []);
  const roster = useMemo(
    () => (people.data ?? []).filter((e) => !e.exitedAt),
    [people.data],
  );
  const ids = useMemo(() => roster.map((e) => e.id), [roster]);
  const idKey = ids.join(",");

  const [facts, setFacts] = useState<Map<EmployeeId, DutyFacts>>(new Map());
  const [history, setHistory] = useState<Map<EmployeeId, DutyHistoryEntry[]>>(
    new Map(),
  );
  const [loadingDay, setLoadingDay] = useState(false);

  /* Live presence, only while the panel is open: a listener per person is not
     worth holding for a drawer nobody has opened. */
  useEffect(() => {
    if (!open || ids.length === 0) return;
    return repo.watchDutyRoster?.(ids, setFacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, open, idKey]);

  /**
   * The day's transitions — read once per open, not watched.
   *
   * A transition is an event that has already happened, so re-reading it on a
   * timer would spend a query to learn nothing. What DOES change while the
   * panel is up is the running session, and that comes from the live facts
   * above plus the clock.
   */
  /* Bumped by the Refresh control. A nonce rather than a callback the effect
     depends on: the read belongs to the effect, so every state write it makes
     happens inside the async closure rather than in the effect body, where a
     synchronous write would cascade a second render before the first paints. */
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    const listDutyDay = repo.listDutyDay;
    if (!listDutyDay || ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      setLoadingDay(true);
      try {
        const day = istDayWindow(Date.now());
        const result = await listDutyDay.call(repo, ids, day);
        if (!cancelled) setHistory(result);
      } catch {
        /* An unreadable day is an empty one — the live states above still
           answer, and the rows say "No sessions today" rather than lying. */
      } finally {
        if (!cancelled) setLoadingDay(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    /* `idKey`, not `ids` — see the subscription above. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repo, idKey, reloadNonce]);

  /* Escape, the scroll lock, and the entrance — all three belong to "the panel
     is open" and are torn down together. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const restore = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    /* The entrance: mounted off-screen, moved in on the next frame so the
       transition has two states to run between. */
    const raf = requestAnimationFrame(() => setShown(true));
    panelRef.current?.focus();
    /* Captured now rather than read in the cleanup — by then the ref may point
       at a different element, or at nothing. */
    const opener = returnFocusTo?.current ?? null;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = restore;
      cancelAnimationFrame(raf);
      setShown(false);
      setDragX(0);
      opener?.focus();
    };
  }, [open, onClose, returnFocusTo]);

  /* Resizing by the left edge. Listeners live on the window for the duration of
     the drag, so the pointer may leave the 6px handle without dropping it. */
  const startResize = (startX: number) => {
    const startWidth = width;
    const move = (clientX: number) => {
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + (startX - clientX)),
      );
      setWidth(next);
    };
    const onMove = (e: MouseEvent) => move(e.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      setWidth((w) => {
        try {
          window.localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          /* Private mode, or storage full. The width simply is not remembered. */
        }
        return w;
      });
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* Swipe the panel away, on a touch screen. Horizontal only, and only to the
     right — a vertical drag is the list scrolling and must be left alone. */
  const touch = useRef<{ x: number; y: number; axis: "" | "x" | "y" } | null>(
    null,
  );

  const now = useNow();
  const nowMs = now?.getTime() ?? 0;
  const rows = useMemo(
    () =>
      attendanceReport({
        people: roster,
        facts,
        history,
        nowMs,
      }),
    [roster, facts, history, nowMs],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(needle) ||
        (r.designation ?? "").toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const onlineCount = rows.filter((r) => r.mode === "online").length;
  const workedCount = rows.filter((r) => r.onlineSecs > 0).length;

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex justify-end"
      /* The backdrop closes, but only when the press STARTS on it — a drag
         that began inside the panel and ended over the backdrop is a resize
         finishing, not a dismissal. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/45 transition-opacity duration-300 ease-[var(--ease-deck)]"
        style={{ opacity: shown ? 1 : 0 }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Today's attendance"
        tabIndex={-1}
        /* `--drawer-w` is set inline just below, per instance, because the
           width is draggable — but it carries the default as a fallback: an
           undefined custom property invalidates the whole declaration, so a
           panel rendered before the style lands would have no width at all. */
        className="frost-bar relative flex h-full w-full max-w-full flex-col border-s border-hairline shadow-[var(--deck-seat)] outline-none transition-transform duration-300 ease-[var(--ease-deck)] sm:w-[var(--drawer-w,460px)]"
        style={
          {
            "--drawer-w": `${width}px`,
            transform: shown
              ? `translateX(${dragX}px)`
              : "translateX(100%)",
            transition: dragX ? "none" : undefined,
          } as React.CSSProperties
        }
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = { x: t.clientX, y: t.clientY, axis: "" };
        }}
        onTouchMove={(e) => {
          const t = touch.current;
          if (!t) return;
          const dx = e.touches[0].clientX - t.x;
          const dy = e.touches[0].clientY - t.y;
          if (!t.axis) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            t.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
          }
          if (t.axis !== "x") return;
          setDragX(Math.max(0, dx));
        }}
        onTouchEnd={() => {
          const t = touch.current;
          touch.current = null;
          if (t?.axis === "x" && dragX > 96) onClose();
          else setDragX(0);
        }}
      >
        {/* The move handle. A real control rather than a bare edge: it is
            focusable, it says what it does, and the arrow keys resize it for
            anybody not using a pointer. Hidden below `sm`, where the panel is
            the full width and there is nothing to resize. */}
        <div
          role="separator"
          aria-label="Resize this panel"
          aria-orientation="vertical"
          tabIndex={0}
          onMouseDown={(e) => {
            e.preventDefault();
            startResize(e.clientX);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setWidth((w) =>
              Math.min(
                MAX_WIDTH,
                Math.max(MIN_WIDTH, w + (e.key === "ArrowLeft" ? 24 : -24)),
              ),
            );
          }}
          className="group absolute inset-y-0 -start-1 z-10 hidden w-2 cursor-col-resize sm:block"
        >
          <span className="absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ink-faint/40 group-focus-visible:bg-ink" />
        </div>

        <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] leading-tight font-medium tracking-[-0.015em] text-ink">
              Today&rsquo;s attendance
            </h2>
            <p className="mt-1 truncate text-[11px] text-ink-faint">
              {nowMs ? dayLabel(nowMs) : ""}
              {" · "}
              <span data-figure className="text-ink-muted">
                {onlineCount}
              </span>{" "}
              on duty now
              {" · "}
              <span data-figure className="text-ink-muted">
                {workedCount}
              </span>{" "}
              of <span data-figure>{rows.length}</span> worked today
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            disabled={loadingDay}
            aria-label="Refresh"
            title="Refresh"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
          >
            <Icon.sync className={`h-4 w-4 ${loadingDay ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.close className="h-4 w-4" />
          </button>
        </header>

        <div className="shrink-0 border-b border-hairline px-4 py-2.5 sm:px-5">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-ink-faint">
              <Icon.search className="h-3.5 w-3.5" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              className="h-9 w-full rounded-full bg-[var(--surface-sunken)] pe-3 ps-9 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
          {people.isLoading ? (
            <div className="px-4 py-3 sm:px-5">
              <SkeletonRows rows={6} />
            </div>
          ) : !repo.listDutyDay ? (
            <p className="px-5 py-10 text-center text-xs leading-relaxed text-ink-faint">
              Attendance is not connected in this build.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs leading-relaxed text-ink-faint">
              {query
                ? `Nobody matches “${query}”.`
                : "Nobody is in the directory yet."}
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {filtered.map((row) => (
                <PersonRow
                  key={row.id}
                  row={row}
                  nowMs={nowMs}
                  open={expanded === row.id}
                  onToggle={() =>
                    setExpanded((id) => (id === row.id ? null : row.id))
                  }
                />
              ))}
            </ul>
          )}
        </div>

        {/* Said once, at the foot. Presence is never revoked by a clock — a
            person who closes their laptop without going offline stays on duty
            — so a very long session is a claim nobody ended rather than a
            shift somebody worked, and the reader should know that before they
            act on a figure. */}
        <p className="shrink-0 border-t border-hairline px-4 py-2.5 text-[10px] leading-relaxed text-ink-faint sm:px-5">
          Times are IST, counted from each person&rsquo;s own status changes. A
          session stays open until the person ends it, so somebody who never
          went offline still reads as on duty.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One person's line.
 *
 * Collapsed it answers the question — when they came on, when they went off,
 * and how long that is. Expanded it shows every stretch of the day, which is
 * what somebody asks for the moment the total does not match their expectation.
 */
function PersonRow({
  row,
  nowMs,
  open,
  onToggle,
}: {
  row: AttendanceRow;
  /** The shared clock, passed down — a component may not read `Date.now()`
   *  during render, and a running session has to be measured against
   *  something the whole panel agrees on. */
  nowMs: number;
  open: boolean;
  onToggle: () => void;
}) {
  const many = row.sessions.length > 1;
  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--row-hover)] sm:px-5">
        <span className="relative shrink-0">
          <Avatar
            initials={row.initials}
            hue={row.hue}
            src={row.profilePictureUrl ?? undefined}
            name={row.displayName}
            size="md"
          />
          <span
            aria-hidden
            className="absolute -end-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--surface-raised)]"
            style={{ backgroundColor: STATUS_META[row.mode].dot }}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              href={`/team/${row.id}`}
              className="min-w-0 truncate text-sm text-ink hover:underline hover:underline-offset-2"
            >
              {row.displayName}
            </Link>
            <span className="shrink-0 text-[11px] text-ink-faint">
              {STATUS_META[row.mode].label}
            </span>
          </div>

          {/* The answer, in the words it was asked for: 9:30 AM → 6:30 PM.
              Wrapping rather than truncating — a time cut in half is worse
              than a second line. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span
              data-figure
              className={row.live ? "text-ink" : "text-ink-muted"}
            >
              {dayLabelFor(row)}
            </span>
            <span
              data-figure
              className="rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[10px] leading-none text-ink"
            >
              {durationLabel(row.onlineSecs)}
            </span>
          </p>

          {many && !open && (
            <button
              type="button"
              onClick={onToggle}
              className="mt-1 text-[11px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
            >
              {row.sessions.length} sessions today
            </button>
          )}

          {open && (
            <ul className="mt-2 space-y-1 border-s border-hairline ps-2.5">
              {row.sessions.map((s, i) => (
                <li
                  key={`${s.fromMs}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]"
                >
                  <span data-figure className="text-ink-muted">
                    {sessionLabel(s)}
                  </span>
                  <span data-figure className="shrink-0 text-ink-faint">
                    {durationLabel(
                      Math.max(
                        0,
                        Math.round(((s.toMs ?? nowMs) - s.fromMs) / 1000),
                      ),
                    )}
                  </span>
                </li>
              ))}
              {/* The exact stamps, once, at the foot of the detail — the date
                  matters when a session was carried in from yesterday. */}
              <li className="pt-1 text-[10px] text-ink-faint">
                First on {stampLabel(row.firstOnMs)}
                {row.lastOffMs !== null && ` · last off ${clockLabel(row.lastOffMs)}`}
              </li>
            </ul>
          )}
        </div>

        {many && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Hide sessions" : "Show sessions"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.chevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
    </li>
  );
}
