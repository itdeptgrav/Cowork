"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useEmployeeStatus } from "./useEmployeeStatus";
import {
  STATUS_META,
  clearManual,
  declareEmergency,
  goOffline,
  goOnline,
  startBreak,
  takeBreakStart,
  type EmployeeStatus,
} from "@/lib/status/employeeStatus";
import {
  ENTIRE_SCREEN_REQUIREMENT,
  SURFACE_LABEL,
  isIOS,
} from "@/lib/integrations/livekit/screenShare";
import { fetchRoomCredentials } from "@/lib/integrations/livekit/credentials";
import {
  isNativeShell,
  setNativeResumeHandler,
} from "@/lib/integrations/livekit/nativeBridge";
import { EmergencyEndDialog } from "./EmergencyEndDialog";
import { DailyReportModal } from "./DailyReportModal";
import { StatusHistoryModal } from "./StatusHistoryModal";
import { useQuery } from "@/lib/hooks/useRepository";
import { useMyDutyMode } from "@/lib/hooks/useDutyMode";
import { breakBudgetWarning } from "@/lib/rules/tasks/breakMode";
import { formatDuration } from "@/lib/utils/format";
import type { BreakSession } from "@/lib/domain";
import { useViewerId } from "@/lib/hooks/usePermissions";

/**
 * The presence pill.
 *
 * Built from the deck's own parts — the frosted surface, the pill radius, the
 * state palette, the 11px label — so it reads as part of the top bar rather
 * than as a widget dropped into it. The only new device is the glow behind the
 * dot, which is a soft ring in the state's own colour and is absent when the
 * state is Offline, because nothing is happening and nothing should pulse.
 *
 * Going online is a two-step deliberately. The browser's screen picker gives no
 * warning that a window or a tab will be rejected, and a picker that opens the
 * instant you click leaves someone to discover the rule by failing it. So the
 * menu states the requirement first, and the second click — still a user
 * gesture, which is what `getDisplayMedia` needs — opens the picker.
 *
 * The menu is also where the state of the world is stated: what is being
 * shared, whether it qualifies, and if not, why not. Nothing about presence is
 * left to be inferred from the colour of a dot.
 */

const CHOICES: {
  id: EmployeeStatus;
  label: string;
  hint: string;
}[] = [
  {
    id: "online",
    label: "Go online",
    hint: "Requires sharing your entire screen",
  },
  { id: "break", label: "Break", hint: "Step away, sharing stops" },
  {
    id: "emergency",
    label: "Emergency",
    hint: "Flag this to your team immediately",
  },
  {
    id: "offline",
    label: "Go offline",
    hint: "Stop sharing and leave the room",
  },
];

/* The menu's own footprint, used to keep it on screen — see the clamp effect
   in `StatusButton`. */
const MENU_WIDTH = 290;
const MENU_MARGIN = 12;

function elapsed(since: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StatusButton() {
  const {
    status,
    manual,
    share,
    session,
    breakStartedAt,
    emergencyStartedAt,
    notice,
    reconnecting,
  } = useEmployeeStatus();
  /* WHO is publishing. The room identity is derived from this, so a manager
     watching this person's profile matches this person's track and nobody
     else's. Going online before the viewer has resolved would publish under
     the wrong name, so the control refuses until it is known. */
  const viewerId = useViewerId();
  /* Non-null between leaving Emergency Mode and the request being raised or
     dismissed. */
  const [endedEmergency, setEndedEmergency] = useState<{
    startedAt: string;
    endedAt: string;
  } | null>(null);
  /**
   * The status the person is trying to switch to, held back while they are in
   * Emergency Mode until they account for it.
   *
   * **You cannot leave an emergency without a reason and proof.** The transition
   * is DEFERRED here rather than performed the moment the button is pressed — the
   * end-emergency dialog runs it only once the approval is sent, so "Not now"
   * keeps the person in the emergency rather than dropping them out of it with no
   * record. It was the reverse before: the status changed first and the dialog
   * was an optional afterthought.
   */
  const [pendingExit, setPendingExit] = useState<EmployeeStatus | null>(null);
  /**
   * The just-closed break, so the pill can report what actually counted.
   *
   * Read back rather than returned: the credit is applied by `setDutyMode`, one
   * layer away from this component, and asking the store what it recorded is
   * more honest than this component remembering what it asked for. On a backend
   * where the credit is banked rather than applied — the legacy engine has no
   * wired `endBreak` — there is no session to read and the line is absent,
   * which is correct: nothing was credited yet.
   */
  const [justEndedBreak, setJustEndedBreak] = useState(false);
  const sessions = useQuery(
    (r) => r.listBreakSessions(),
    [justEndedBreak],
  );
  const credited: BreakSession | null = justEndedBreak
    ? ([...(sessions.data ?? [])].sort((a, b) =>
        b.endedAt.localeCompare(a.endedAt),
      )[0] ?? null)
    : null;
  const budget = useQuery((r) => r.getBreakBudget(), [justEndedBreak]);
  /**
   * Presence as PUBLISHED, live from `cowork_duty_status`.
   *
   * Distinct from `status` above, which is this tab's own derivation from the
   * share. Both are shown, and the difference between them is worth seeing:
   * `status` is what this browser believes, `legacyMode` is what everybody else
   * — a colleague, a manager, the old app — can actually read about this
   * person. They agree within a heartbeat, and a persistent disagreement means
   * the publish is failing, which is exactly the fault a diagnostic line should
   * make visible rather than hide.
   *
   * `null` while the first read is in flight, which is distinct from "offline".
   */
  const legacyMode = useMyDutyMode();
  /* `endBreak` and the auto-pause used to be issued from here. Both now belong
     to `setDutyMode`, which performs them from the stored document as part of
     the transition — see `choose`. Two callers for one consequence is how the
     same minutes get credited twice. */
  /**
   * The daily-report screen, and WHY it is open.
   *
   * `offline` means it is standing in front of a presence change — completing
   * it goes offline. `standalone` means somebody asked for it from the menu,
   * and completing it just closes. Null is closed. A boolean could not tell
   * the two apart, and the difference is the whole behaviour of the button.
   */
  const [reportOpen, setReportOpen] = useState<"offline" | "standalone" | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [open, setOpen] = useState(false);
  /* The requirement step. Separate from `open` so dismissing the menu also
     abandons a half-started attempt rather than remembering it. */
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /* The menu is anchored `right: 0` to the pill, which is correct on a wide
     screen where the pill sits far from the left edge. On a narrow phone the
     pill is nowhere near that far right, and a 290px-wide panel hung off its
     right edge runs straight past the left edge of the viewport — the "ork
     has you offline" cut off where "Cowork has you offline" belongs. `right`
     is shifted negative by exactly the overflow so the panel's LEFT edge
     never passes the margin, and its width shrinks first on a screen too
     narrow to hold 290px at all. */
  const [menuWidth, setMenuWidth] = useState(MENU_WIDTH);
  const [menuShift, setMenuShift] = useState(0);

  /**
   * What the pill actually shows.
   *
   * `status` is only ever what THIS device can prove about itself — a live
   * share, or a manual state restored from the duty document. A device that
   * is not the one sharing has nothing of its own to prove and sits at
   * `offline` regardless of what is really happening elsewhere, so showing
   * `status` alone is how a phone ends up displaying "Offline" — or, before
   * this, wrongly offering to reconnect — while a laptop across the room is
   * plainly Online. `legacyMode` is the same document everybody else reads,
   * live via `watchDutyModes`, so falling back to it here is what makes this
   * device's pill agree with every other screen watching the same person.
   * Only a fallback: this device's own proof always wins when it has one.
   */
  const displayStatus: EmployeeStatus =
    status !== "offline" ? status : (legacyMode ?? "offline");
  const meta = STATUS_META[displayStatus];
  const busy = session === "requesting" || session === "connecting";
  /* After a refresh the share is gone and cannot be reasserted without a click,
     so presence is honestly offline — but rather than a cold "Offline" we show a
     "Reconnecting" prompt whose one purpose is a one-click resume of sharing.
     Gated upstream (DutySync's claimedOnlineHere check) so only the device that
     was actually sharing ever reaches this state. */
  const reconnectingShare = reconnecting && status === "offline";
  const pillLabel = reconnectingShare ? "Reconnecting" : meta.label;
  const pillDot = reconnectingShare ? "var(--state-risk)" : meta.dot;
  const pillGlow = reconnectingShare
    ? "color-mix(in srgb, var(--state-risk) 55%, transparent)"
    : meta.glow;

  /* A stopwatch for the break, and only for the break. It runs when there is a
     break to measure and stops when there is not — it never decides anything. */
  useEffect(() => {
    if (breakStartedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [breakStartedAt]);

  /* Keeps the menu on screen. Runs once on open (before paint, so there is no
     flash at the wrong position) and again on resize/rotate, since the same
     pill can end up in a different spot relative to the viewport. */
  useLayoutEffect(() => {
    if (!open) return;
    function clamp() {
      const el = rootRef.current;
      if (!el) return;
      const width = Math.min(MENU_WIDTH, window.innerWidth - MENU_MARGIN * 2);
      const rect = el.getBoundingClientRect();
      const naturalLeft = rect.right - width;
      setMenuWidth(width);
      setMenuShift(Math.max(0, MENU_MARGIN - naturalLeft));
    }
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open]);

  /* Escape closes and returns focus; a click outside closes. */
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      setConfirming(false);
      buttonRef.current?.focus();
    }
    function onDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setConfirming(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  /* Leaving Emergency Mode is the one transition that owes an account of
     itself. The elapsed duration is read BEFORE the state is cleared — clearing
     it is what makes the start timestamp unrecoverable — and held for the
     dialog, which raises the request. Nothing about the presence change waits
     on the manager: the person is back online immediately, and only their
     deadlines are pending a decision. */
  function captureEmergencyEnd(): { startedAt: string; endedAt: string } | null {
    if (manual !== "emergency" || emergencyStartedAt === null) return null;
    return {
      startedAt: new Date(emergencyStartedAt).toISOString(),
      endedAt: new Date().toISOString(),
    };
  }

  /** Perform a presence transition. The single place the four states are set,
      so the deferred emergency exit and an ordinary switch run identical code. */
  function applyTransition(id: EmployeeStatus) {
    if (id === "online") {
      /* Already compliant: no picker, nothing to explain — this is only
         lifting a manual state that was suppressing an existing share. */
      if (share.sharing && share.connected) {
        if (viewerId) void goOnline(() => fetchRoomCredentials(viewerId));
        setOpen(false);
        return;
      }
      /**
       * **The popover has to be open for this to be reachable.**
       *
       * `confirming` renders INSIDE `{open && …}`, and the two callers of this
       * function disagree about whether the popover is up. An ordinary switch
       * runs from the open menu, so setting the flag was enough. The deferred
       * emergency exit does not: `choose` closes the popover before showing the
       * modal, so on the way back this set a flag on a panel that was not
       * mounted — the request was sent, the dialog closed, and going online
       * silently did nothing.
       *
       * Coming back to an open picker is also the correct behaviour on its own
       * terms: leaving an emergency for `online` still owes a screen share, and
       * that is the step being reopened.
       */
      setOpen(true);
      setConfirming(true);
      return;
    }
    if (id === "break") startBreak();
    if (id === "emergency") declareEmergency();
    /* Offline is gated on the day being written up. The transition is NOT
       performed here — the modal's completion callback performs it, so
       dismissing the modal leaves the person online rather than dropping them
       out with the account still owed. */
    if (id === "offline") {
      setOpen(false);
      setConfirming(false);
      setReportOpen("offline");
      return;
    }
    setOpen(false);
    setConfirming(false);
  }

  function choose(id: EmployeeStatus) {
    console.info("[presence] STATUS CHANGE REQUEST:", {
      oldStatus: status,
      newStatus: id,
      employeeId: viewerId,
      timestamp: new Date().toISOString(),
    });

    /**
     * **Leaving an emergency is gated, not immediate.** If the person is in
     * Emergency Mode and switching out of it, the transition is HELD until the
     * end-emergency dialog's approval is sent — you cannot exit without a reason
     * and proof. The old code changed the status here and popped the dialog as an
     * afterthought, so "Not now" left. Now the target waits in `pendingExit`.
     */
    const ending = id !== "emergency" ? captureEmergencyEnd() : null;
    if (ending) {
      setPendingExit(id);
      setEndedEmergency(ending);
      setOpen(false);
      return;
    }

    /**
     * `takeBreakStart()` clears the local store's copy of the break start —
     * leaving it set would credit the same break again on the next attempt. Its
     * VALUE is only used to know a break just ended, so the panel can report what
     * came of it. Crediting and stopping the clock are `setDutyMode`'s job, from
     * the stored document, so they are idempotent.
     */
    const breakStart = id !== "break" ? takeBreakStart() : null;
    if (breakStart !== null) setJustEndedBreak(true);

    applyTransition(id);
  }

  /* The native shell cannot restart a broadcast by itself — ReplayKit only
     starts from a user tap — so after the phone is unlocked it shows its own
     "resume" prompt and calls back here. Going through `startSharing` means
     the resume path is the same path as going online: fresh credentials, same
     publish, no second implementation to drift. */
  useEffect(() => {
    if (!isNativeShell()) return;
    setNativeResumeHandler(() => {
      void startSharing();
    });
    return () => setNativeResumeHandler(null);
  });

  async function startSharing() {
    /* The picker opens inside this click. Nothing is awaited before it, or the
       browser withdraws the gesture and refuses the prompt. */
    if (!viewerId) return;
    const started = await goOnline(() => fetchRoomCredentials(viewerId));
    setConfirming(false);
    if (started) setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          /* One-click resume: straight from this gesture, so the browser will
             honour the screen-capture prompt (it refuses one not tied to a
             click). Everything else just toggles the menu. */
          if (reconnectingShare && viewerId) {
            void startSharing();
            return;
          }
          setOpen((v) => !v);
          setConfirming(false);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={reconnectingShare ? notice ?? "Resume your screen share" : meta.help}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--control)] py-1.5 pr-3 pl-2.5 transition-colors duration-[180ms] hover:bg-[var(--control-hover)] focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
      >
        <span className="relative grid h-2.5 w-2.5 place-items-center">
          {(displayStatus !== "offline" || reconnectingShare) && (
            <span
              aria-hidden="true"
              className={`absolute h-2.5 w-2.5 rounded-full ${
                displayStatus === "emergency" || reconnectingShare
                  ? "animate-ping"
                  : ""
              }`}
              style={{ backgroundColor: pillGlow, opacity: 0.9 }}
            />
          )}
          <span
            aria-hidden="true"
            className="relative h-2 w-2 rounded-full"
            style={{
              backgroundColor: pillDot,
              boxShadow:
                displayStatus === "offline" && !reconnectingShare
                  ? "none"
                  : `0 0 8px 1px ${pillGlow}`,
            }}
          />
        </span>

        <span className="text-xs font-medium text-ink">{pillLabel}</span>

        {breakStartedAt !== null && (
          <span data-figure className="text-[11px] text-ink-muted">
            {elapsed(breakStartedAt, now)}
          </span>
        )}

        <span className="sr-only">
          {meta.help} {notice ?? ""}
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Set your status"
          style={{ width: menuWidth, right: -menuShift }}
          className="frost-bar absolute top-[calc(100%+8px)] z-50 rounded-panel border border-hairline p-1.5 shadow-[var(--deck-seat)]"
        >
          {confirming ? (
            <div className="px-2.5 py-2">
              <p className="text-xs font-medium text-ink">
                Share your entire screen
              </p>
              {isIOS() ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                  To go online you must share your entire screen. Tap the
                  button below — your device will capture your full screen.
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                  {ENTIRE_SCREEN_REQUIREMENT} Your browser will ask next —
                  choose <span className="text-ink">Entire Screen</span>.
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startSharing()}
                  className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-45"
                >
                  {session === "requesting"
                    ? "Waiting for your screen…"
                    : session === "connecting"
                      ? "Connecting…"
                      : "Choose screen"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-full px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* The allowance, stated wherever a break can be started. It
                  bounds what a break gives back to a deadline — it is not
                  permission to step away, and the copy says so rather than
                  letting a number read as a limit on rest. */}
              {/* Not connected in this build: the allowance lives in Firestore,
                  which needs the server-side proxy. Said plainly rather than
                  omitted — a missing allowance line reads as "no limit", which
                  is a claim about somebody's entitlement that nothing here
                  measured. */}
              {budget.isUnavailable && (
                <p className="mb-1 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-2 text-[11px] text-ink-faint">
                  {/* The allowance itself has no endpoint, but presence does —
                      live from `cowork_duty_status`, with the staleness window
                      applied. Read through `useMyDutyMode` rather than the
                      ported listener: that one returns the document's `mode`
                      verbatim, so a claim left behind by a closed browser reads
                      as online — the one answer this line must not give about
                      somebody's own duty state. */}
                  {legacyMode === null
                    ? "Checking your duty status\u2026"
                    : `Cowork has you ${legacyMode}. Break allowance is not available yet.`}
                </p>
              )}
              {budget.data && (
                <div className="mb-1 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-2">
                  <p className="flex items-baseline justify-between gap-2 text-[11px] text-ink-faint">
                    <span>Break allowance today</span>
                    <span data-figure className="text-ink">
                      {formatDuration(budget.data.remainingSecs)} left
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">
                    {formatDuration(budget.data.usedSecs)} of{" "}
                    {formatDuration(budget.data.maxSecs)} used. Break time up to
                    the allowance moves your deadlines forward.
                  </p>
                  {breakBudgetWarning(budget.data) && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--state-risk-ink)]">
                      {breakBudgetWarning(budget.data)}
                    </p>
                  )}
                  {credited && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                      Last break: {formatDuration(credited.durationSecs)} —{" "}
                      {credited.appliedSecs > 0
                        ? `${formatDuration(credited.appliedSecs)} added to ${credited.shiftedTaskIds.length} ${credited.shiftedTaskIds.length === 1 ? "deadline" : "deadlines"}`
                        : "nothing added"}
                      {credited.wasCapped && " (allowance reached)"}.
                    </p>
                  )}
                </div>
              )}

              {CHOICES.map((c) => {
                const cm = STATUS_META[c.id];
                const current =
                  c.id === "online"
                    ? displayStatus === "online"
                    : c.id === "offline"
                      ? displayStatus === "offline"
                      : manual === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={c.id === "online" && busy}
                    onClick={() => choose(c.id)}
                    className={`flex w-full items-start gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors disabled:opacity-60 ${
                      current
                        ? "bg-[var(--control-active)]"
                        : "hover:bg-[var(--control)]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: cm.dot }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-ink">
                        {c.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        {c.hint}
                      </span>
                    </span>
                    {current && (
                      <span className="mt-0.5 text-[11px] text-ink-muted">
                        Now
                      </span>
                    )}
                  </button>
                );
              })}

              {/* The report is not the property of the going-offline flow.
                  Somebody who wants to write their day up at four o'clock and
                  keep working should not have to go offline to do it. */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                  setReportOpen("standalone");
                }}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors hover:bg-[var(--control)]"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--ink-faint)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-ink">
                    Daily report
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    Write up today&rsquo;s work without going offline
                  </span>
                </span>
              </button>

              {/* Today's log — when each status began, and for how long. Its
                  own entry point rather than folded into the menu items above:
                  it is a look BACK at the day, not a way to change it now. */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                  setHistoryOpen(true);
                }}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors hover:bg-[var(--control)]"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--ink-faint)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-ink">
                    History
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    See today&rsquo;s status changes
                  </span>
                </span>
              </button>

              {manual !== null && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    /* Ending an emergency is GATED, exactly as switching away
                       from it through `choose` is: the transition is held in
                       `pendingExit` and the dialog performs it only once the
                       reason and proof are sent. Ending a break is not gated — it
                       needs no approval — so it clears immediately. */
                    if (manual === "emergency") {
                      const ending = captureEmergencyEnd();
                      if (ending) {
                        setPendingExit("offline");
                        setEndedEmergency(ending);
                        setOpen(false);
                      }
                      return;
                    }
                    const breakStart =
                      manual === "break" ? takeBreakStart() : null;
                    if (breakStart !== null) setJustEndedBreak(true);
                    clearManual();
                    setOpen(false);
                  }}
                  className="mt-0.5 flex w-full items-center gap-2.5 rounded-inset px-2.5 py-2 text-left transition-colors hover:bg-[var(--control)]"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full bg-[var(--ink-faint)]"
                  />
                  <span className="text-xs text-ink">
                    End {manual === "break" ? "break" : "emergency"}
                  </span>
                </button>
              )}
            </>
          )}

          {/* The state of the world, stated. Three facts, in the order someone
              needs them: what is being shared, whether that qualifies, and the
              most recent thing that went wrong. Offline is never left to be
              inferred — the reason for it is written underneath it. */}
          <div className="mt-1 border-t border-hairline px-2.5 pt-2 pb-1">
            <p className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-ink-faint">Sharing</span>
              <span className="text-ink-muted">
                {share.surface ? SURFACE_LABEL[share.surface] : "Nothing"}
              </span>
            </p>
            <p className="mt-1 flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-ink-faint">Eligible for Online</span>
              <span
                className={
                  share.sharing && share.connected
                    ? "text-[var(--state-positive-ink)]"
                    : "text-ink-muted"
                }
              >
                {share.sharing && share.connected ? "Yes" : "No"}
              </span>
            </p>
            <p
              role={notice ? "alert" : undefined}
              className={`mt-1.5 text-[11px] leading-relaxed ${
                notice ? "text-[var(--state-overdue-ink)]" : "text-ink-faint"
              }`}
            >
              {notice ?? share.detail}
            </p>
          </div>
        </div>
      )}

      {/* The gate out of Emergency Mode. Sending the request (reason + proof) is
          the ONLY way to leave — `onRaised` then performs the held transition.
          Dismissing keeps the person in the emergency, because the exit was never
          applied; `pendingExit` is dropped and the status is unchanged. */}
      {reportOpen && (
        <DailyReportModal
          mode={reportOpen}
          onComplete={() => {
            const wasOffline = reportOpen === "offline";
            setReportOpen(null);
            if (wasOffline) goOffline();
          }}
        />
      )}

      {historyOpen && (
        <StatusHistoryModal onClose={() => setHistoryOpen(false)} />
      )}

      {endedEmergency && (
        <EmergencyEndDialog
          startedAt={endedEmergency.startedAt}
          endedAt={endedEmergency.endedAt}
          onClose={() => {
            setEndedEmergency(null);
            setPendingExit(null);
          }}
          onRaised={() => {
            const target = pendingExit;
            setEndedEmergency(null);
            setPendingExit(null);
            if (target) applyTransition(target);
          }}
        />
      )}
    </div>
  );
}
