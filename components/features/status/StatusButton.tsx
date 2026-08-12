"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useEmployeeStatus } from "./useEmployeeStatus";
import {
  STATUS_META,
  clearManual,
  declareEmergency,
  declareOnline,
  endSession,
  goOffline,
  holdSeat,
  reportProblem,
  reportShare,
  sessionFailed,
  sessionLive,
  shareInterrupted,
  startBreak,
  takeBreakStart,
  type EmployeeStatus,
} from "@/lib/status/employeeStatus";
import {
  ENTIRE_SCREEN_REQUIREMENT,
  SURFACE_LABEL,
  isIOS,
} from "@/lib/integrations/livekit/screenShare";
import {
  fetchShareSeat,
  heldSeatNow,
  prefetchShareSeat,
  releaseShareSeat,
} from "@/lib/integrations/grav/credentials";
import {
  loadPublisherSdk,
  publisherReady,
  shareRefusal,
  startPublishing,
  wasCancelled,
} from "@/lib/integrations/grav/publisher";
import { fetchRoomPresence } from "@/lib/integrations/grav/credentials";
import {
  isNativeShell,
  setNativeResumeHandler,
} from "@/lib/integrations/livekit/nativeBridge";
import { EmergencyEndDialog } from "./EmergencyEndDialog";
import { ShareLostDialog } from "./ShareLostDialog";
import { DailyReportModal } from "./DailyReportModal";
import { StatusHistoryModal } from "./StatusHistoryModal";
import { useQuery } from "@/lib/hooks/useRepository";
import { useMyDutyMode } from "@/lib/hooks/useDutyMode";
import { breakBudgetWarning } from "@/lib/rules/tasks/breakMode";
import { formatDuration } from "@/lib/utils/format";
import type { BreakSession } from "@/lib/domain";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { useScreenShareRequired } from "@/lib/hooks/useScreenSharePolicy";
import {
  shareLostHere,
  type ShareLostCause,
} from "@/lib/rules/presence/shareLost";
import { cancelShareLostSound, soundShareLost } from "@/lib/status/shareAlarm";
import { claimedOnlineHere } from "@/lib/status/connectionId";

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
  /* The hints describe what each choice DOES. This one states the requirement
     rather than the outcome, because the outcome is not in the person's gift:
     the browser's picker decides, and a menu promising "available and working"
     beside a button that opens a capture prompt is the fault people report as
     "it did nothing". */
  {
    id: "online",
    label: "Go online",
    hint: "Share your entire screen — that is what being online is",
  },
  { id: "break", label: "Break", hint: "Step away — your deadlines are credited" },
  {
    id: "emergency",
    label: "Emergency",
    hint: "Flag this to your team immediately",
  },
  {
    id: "offline",
    label: "Go offline",
    hint: "Done for now — write up the day",
  },
];

/* The menu's own footprint, used to keep it on screen — see the clamp effect
   in `StatusButton`. */
const MENU_WIDTH = 290;
const MENU_MARGIN = 12;

/* How long the service is given to notice a new producer — see `confirmSharing`.
   Six seconds of asking, then a sentence. Long enough that a slow room is not
   reported as a fault, short enough that a real one is not left unsaid. */
const CONFIRM_ATTEMPTS = 6;
const CONFIRM_INTERVAL_MS = 1000;

/* Stable identities for `useSyncExternalStore` — a new function per render
   would resubscribe on every one. Nothing else writes the claim flag while the
   pill is mounted, and the writer re-renders it anyway. */
function subscribeNever(): () => void {
  return () => {};
}
function claimedFalse(): boolean {
  return false;
}

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
    hydrated,
    /* The seat, fetched when this menu opened. Held here so the press that
       shares does not have to wait for it — see `openPicker`. */
    token,
    url,
  } = useEmployeeStatus();
  /* WHO is publishing. The room identity is derived from this, so a manager
     watching this person's profile matches this person's track and nobody
     else's. Going online before the viewer has resolved would publish under
     the wrong name, so the control refuses until it is known. */
  const viewerId = useViewerId();
  /**
   * Whether Online means a shared screen here — the office-policy switch.
   *
   * The whole sharing apparatus hangs off it: the warm-up, the picker, the
   * hints, and the alert that says a share has stopped. With it off none of that
   * runs at all, rather than running and being hidden.
   */
  const screenRequired = useScreenShareRequired();
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
  /**
   * Which confirmation the menu is showing, if any.
   *
   * `"share"` is the resume-sharing prompt. `"offline"` is new: going offline
   * used to happen on the single click that chose it, and that row sits in a
   * menu one stray press away from the pill — so an accidental brush ended
   * somebody's day, published it to their team, and opened the end-of-day
   * report on the way out. It asks first now.
   */
  const [confirming, setConfirming] = useState<"share" | "offline" | null>(null);
  /* The picker is open and nothing has been chosen yet — see `openPicker`. */
  const [starting, setStarting] = useState(false);
  /* Whether a seat is in hand. A label, never a gate — see `warming`. */
  const [seatReady, setSeatReady] = useState(false);
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
  /**
   * The room is coming up.
   *
   * **Nothing is disabled by it, and that is the point.** It used to gate Go
   * online — and then the seat began being fetched the moment this menu opens,
   * so the one control the menu exists for was greyed out for everybody who
   * opened it, with no explanation. It is a LABEL now: the button still works,
   * and pressing it early opens the confirmation step instead of the picker.
   *
   * Read from whether the SEAT is in hand rather than from the session, because
   * warming no longer moves the session at all — see the effect that does it.
   */
  const warming = !seatReady && session !== "live";
  /* After a refresh the share is gone and cannot be reasserted without a click,
     so presence is honestly offline — but rather than a cold "Offline" we show a
     "Reconnecting" prompt whose one purpose is a one-click resume of sharing.
     Gated upstream (DutySync's claimedOnlineHere check) so only the device that
     was actually sharing ever reaches this state. */
  /* And there is nothing to resume where nothing is shared — the prompt, the
     pill's "Reconnecting" label and the auto-opened panel all hang off this. */
  const reconnectingShare = screenRequired && reconnecting && status === "offline";
  /**
   * Before the account's own presence has been heard from, this device knows
   * nothing — and "Offline" is a claim, not a blank.
   *
   * That is the reported flash: open Cowork on a second device while on a
   * break and it announced Offline, then corrected itself to Break a moment
   * later. Both the store and `legacyMode` arrive asynchronously, so the pill
   * was reading its own initial value out loud. It now says nothing until it
   * has been told something.
   */
  const settling = !hydrated && status === "offline" && !legacyMode;
  /* The pill says it too, because the menu can be scrolled away from or covered
     by the browser's own prompt — and the one thing always on screen should not
     read "Offline" while somebody is halfway into going online. */
  const pillLabel = starting
    ? "Connecting…"
    : settling
      ? "…"
      : reconnectingShare
        ? "Reconnecting"
        : meta.label;
  const pillDot = settling
    ? "var(--ink-faint)"
    : reconnectingShare
      ? "var(--state-risk)"
      : meta.dot;
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

  /**
   * Open straight to "resume sharing" the moment a reconnect is offered,
   * rather than waiting for someone to notice a small pill in the top bar.
   *
   * **Why this exists.** A browser refresh always drops the screen-share
   * track — nothing can reassert `getDisplayMedia()` without a fresh click,
   * that is the browser's own security rule, not a choice this app makes. So
   * a refresh can never look fully "still online" the way signing back in
   * does. What it CAN do is make the one remaining step unmissable, rather
   * than leaving somebody looking at a pill reading "Reconnecting" with no
   * idea that it is waiting on them — which is the "refreshed and got logged
   * out" report this answers. Their status is not at risk while they take
   * their time over it (nothing expires it any more); the share is simply not
   * running until they say so. Firing the picker immediately turns a state
   * somebody has to notice into one they cannot avoid seeing.
   *
   * Once per mount: a person who dismisses it with Cancel gets their pill
   * back, not a dialog that keeps reopening under them.
   */
  const autoPrompted = useRef(false);
  useEffect(() => {
    if (!reconnectingShare || autoPrompted.current) return;
    autoPrompted.current = true;
    setOpen(true);
    setConfirming("share");
  }, [reconnectingShare]);

  /**
   * **Online, with nothing going out — say so, once, out loud.**
   *
   * A browser always drops a screen share on reload. The durable claim survives
   * it, correctly: nothing takes a status away from the person who chose it, so
   * the pill still reads Online and their team still sees them online. What
   * cannot be allowed to survive it is the BELIEF that a manager can see
   * something, when the panel they would open is blank.
   *
   * So this device — and only this device, the one that claimed the session —
   * plays a tone and raises a dialog. No status changes: the person stays
   * Online until they act, which is the whole point.
   *
   * Once per page load. The condition holds until they actually share, and a
   * dialog that reopened every render would be a wall rather than a warning;
   * the menu keeps saying "Screen shared: No" for anybody who dismisses it.
   */
  const [shareLostDismissed, setShareLostDismissed] = useState(false);
  /* A reload is the ordinary cause; a dropped session says so for itself. */
  const [shareLostCause, setShareLostCause] =
    useState<ShareLostCause>("reload");
  /**
   * Whether THIS browser is the one that claimed the session.
   *
   * Read through `useSyncExternalStore` rather than in an effect: it lives in
   * `localStorage`, which is exactly the "external mutable source" that hook
   * exists for, and it gives an SSR snapshot (`false`) so the server never
   * renders a dialog the client would then have to take back. The subscribe is
   * a no-op because nothing else writes it while this component is mounted —
   * `DutySync` sets it on a publish, and that publish re-renders this anyway.
   */
  const claimedHere = useSyncExternalStore(
    subscribeNever,
    claimedOnlineHere,
    claimedFalse,
  );
  const shareLost =
    /* Nothing to have lost where nothing was ever required. A workspace with
       sharing switched off would otherwise be told its screen is not being
       shared, with a tone, every time somebody was online — which is true and
       completely beside the point. */
    screenRequired &&
    !shareLostDismissed &&
    shareLostHere({
      hydrated,
      /* This device's own derivation, or what everybody else can read about
         this person — either counts as the account claiming online. */
      accountOnline: status === "online" || legacyMode === "online",
      sharingHere: share.sharing && share.connected,
      /* Survives the reload, which is what makes this answerable at all. */
      claimedHere,
      starting,
    });

  /* The tone, once. A dialog somebody has to notice is not much better than a
     pill somebody has to notice, and a person who reloaded is looking at the
     page they were reading rather than at the top bar. */
  const sounded = useRef(false);
  useEffect(() => {
    if (!shareLost || sounded.current) return;
    sounded.current = true;
    soundShareLost();
  }, [shareLost]);

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
    /* Neither dismissal applies while a share is being started. The panel is
       reporting a step somebody is in the middle of — the browser's own prompt
       takes the keystrokes and the clicks anyway, and closing underneath it
       would leave them with no idea whether anything was still happening. */
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || starting) return;
      setOpen(false);
      setConfirming(null);
      buttonRef.current?.focus();
    }
    function onDown(e: MouseEvent) {
      if (starting) return;
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setConfirming(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, starting]);

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
      /**
       * **Going online is sharing your screen — OWNER DECISION, restored.**
       *
       * For a period this set the status directly and asked for nothing. It
       * asks again: the panel states the requirement first, and the second
       * click — still inside a user gesture, which is what `getDisplayMedia`
       * needs — opens the browser's picker. Only a live ENTIRE-screen share
       * turns the pill green.
       *
       * **The picker opens from THIS press.** There is no meeting to create, no
       * room to join and no confirmation step: the room was warmed up when the
       * menu opened, so the only thing this does is ask for the screen. The
       * panel below is the fallback for the one case that remains — a press that
       * lands before the room is up — and it says so rather than pretending to
       * be a step.
       */
      /**
       * **Unless this workspace has switched screen sharing off.**
       *
       * Then Online means what it says on every other product: at work,
       * available, nothing captured and nobody watching. There is no picker to
       * open, no seat to hold and nothing to confirm — the press IS the
       * transition, and `declareOnline` refuses unless the policy really says
       * so, so this cannot become a way to skip the requirement.
       */
      if (!screenRequired) {
        const wasOnBreak = takeBreakStart();
        if (wasOnBreak !== null) setJustEndedBreak(true);
        declareOnline({ requireScreenShare: false });
        setOpen(false);
        setConfirming(null);
        return;
      }
      if (openPicker()) return;
      setOpen(true);
      setConfirming("share");
      return;
    }
    if (id === "break") startBreak();
    if (id === "emergency") declareEmergency();
    /* Offline is gated on the day being written up. The transition is NOT
       performed here — the modal's completion callback performs it, so
       dismissing the modal leaves the person online rather than dropping them
       out with the account still owed. */
    if (id === "offline") {
      /* Ask first. The report modal used to open straight from this click, and
         leaving it — however you left it — went offline. */
      setOpen(true);
      setConfirming("offline");
      return;
    }
    setOpen(false);
    setConfirming(null);
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
     *
     * **Only where the transition happens on this press.** It used to run for
     * every target, and two of them do not finish here: online waits on the
     * picker, offline waits on the daily report. Cancelling either left somebody
     * still on a break with their stopwatch reset to nothing — the break they
     * were in the middle of, silently uncounted. Those two take it where they
     * complete: `openPicker`'s success path, and the report's `onComplete`.
     */
    if (id === "emergency") {
      const breakStart = takeBreakStart();
      if (breakStart !== null) setJustEndedBreak(true);
    }

    applyTransition(id);
  }

  /* The native shell has no path to a `screen` room — `startScreenShare` refuses
     it with a sentence rather than starting a broadcast that goes nowhere — so
     its resume prompt is left unhandled rather than wired to something that
     cannot work. */
  useEffect(() => {
    if (!isNativeShell()) return;
    setNativeResumeHandler(null);
    return () => setNativeResumeHandler(null);
  });

  /**
   * Open the browser's capture picker. **Synchronous, and it has to be.**
   *
   * A capture prompt only opens inside a user gesture, and a gesture does not
   * survive an `await` — so the seat cannot be fetched and the picker opened on
   * the same press. The room is warmed up when the menu OPENS (the effect below)
   * so that by the time somebody presses Go online there is a frame to ask, and
   * this posts to it without awaiting anything.
   *
   * Returns false when the room is not up yet, which is the only case the
   * confirmation panel exists for now.
   */
  /**
   * Ask the SERVICE whether the screen is really reaching the room.
   *
   * The SDK's own `capture` says what this browser grabbed. This says what Grav
   * Stream can SEE — `participants[].sharing.screen`, the same fact a manager's
   * panel reads — and it is worth asking separately because the two came apart
   * once: a realtime server that accepted the socket and answered nothing left
   * the browser's "sharing your screen" bar up over a room with nothing in it.
   *
   * **It can only confirm, never contradict.** Two rules meet here:
   *
   *  · Nothing takes a status away from somebody who chose it. A check that
   *    could write `sharing: false` would be an auto-offline with extra steps.
   *  · The room takes a moment to register a new producer, so the first read
   *    after a publish is expected to come back empty. Believing it would knock
   *    people offline a second after they went online — which is precisely the
   *    fault this whole area exists to have fixed.
   *
   * So it polls, reports the moment the service agrees, and if it never does,
   * says so in the notice line while leaving the share alone. A screen that is
   * captured but not arriving is worth reading about; it is not worth being
   * silently marked offline for.
   */
  async function confirmSharing(subject: string | null) {
    if (!subject) return;
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      if (attempt > 0)
        await new Promise((r) => setTimeout(r, CONFIRM_INTERVAL_MS));
      try {
        const { sharing, surface } = await fetchRoomPresence({
          subject,
          role: "publish",
        });
        if (!sharing) continue;
        reportShare({
          sharing: true,
          connected: true,
          surface:
            surface === "monitor"
              ? "entire_screen"
              : surface === "window"
                ? "window"
                : surface === "browser"
                  ? "browser_tab"
                  : null,
          detail: "Your screen is going out through Grav Stream.",
        });
        return;
      } catch (error) {
        /* A check that could not be made is not evidence of absence. Keep
           trying; the capture the SDK reported stands either way. */
        console.error("[stream] could not confirm the room:", error);
      }
    }
    reportProblem(
      "Your screen is being captured, but the service has not registered it yet. Your manager may not be able to see it — if this stays, stop sharing and go online again.",
    );
  }

  function openPicker(): boolean {
    /**
     * **Nothing is awaited before `startPublishing`.** A capture prompt needs
     * the user activation this press carries, and activation expires in about
     * five seconds — so the token was fetched when the menu opened and the SDK
     * was preloaded there too. Putting a fetch here would spend the gesture and
     * the browser would refuse the prompt with nothing to show for it.
     */
    /**
     * A press that cannot proceed says so. It used to return quietly, and the
     * panel then sat on "Preparing…" or offered a Choose screen button that did
     * nothing when pressed — the two cases below are different problems and
     * neither is visible from the outside.
     */
    /**
     * **The seat is read from the held one, not from the store — and that is
     * what makes Break → Online possible at all.**
     *
     * The store's copy is filled by `startScreenShare`, which refuses to run
     * while a manual state is set. On a break it therefore held nothing, the
     * press had nothing to share with, and Go online did nothing whatsoever —
     * permanently, because the guard that stopped it was also the only thing
     * that would ever have fetched one. `prefetchShareSeat` holds a seat for
     * anybody signed in, whatever their status.
     */
    const seat = viewerId ? heldSeatNow(viewerId) : null;
    const useToken = seat?.token ?? token;
    const useUrl = seat?.url ?? url;

    /**
     * A press that cannot proceed says so. It used to return quietly, and the
     * panel then sat on "Preparing…" or offered a Choose screen button that did
     * nothing when pressed — the two cases below are different problems and
     * neither is visible from the outside.
     */
    if (!useToken || !useUrl) {
      if (viewerId) prefetchShareSeat(viewerId);
      reportProblem(
        session === "error"
          ? notice ??
              "Your room could not be reached, so there is nothing to share into. Close this menu and open it again."
          : "Still getting your room ready — press Go online again in a moment.",
      );
      return false;
    }
    if (!publisherReady()) {
      void loadPublisherSdk().catch(() => {});
      reportProblem(
        "The screen-sharing library is still loading — press Go online again in a moment.",
      );
      return false;
    }
    setConfirming(null);
    /**
     * **The menu STAYS OPEN, showing what is happening.**
     *
     * It used to close on this press, and the person was then looking at an
     * unchanged page while the browser prepared its prompt and — after they
     * chose a screen — while the publish went through. Both take a moment, and
     * a moment with nothing on screen reads as a button that did nothing. The
     * panel below reports each step instead, and the menu closes itself once
     * the screen is actually going out.
     */
    setStarting(true);
    /* Written down AFTER the call above has been decided on and BEFORE it is
       made — a state commit is synchronous, so it costs the gesture nothing. */
    holdSeat({ token: useToken, url: useUrl });
    /**
     * `starting` above is also what stops the room being given back underneath
     * this. The effect that does it fires when the menu closes without a share
     * — correct on its own, and wrong for the seconds somebody spends looking at
     * the picker. It ran `endSession()`: credentials dropped, session `idle`,
     * and `DutySync` — quiet only while the session is `connecting` — published
     * OFFLINE for a person in the middle of coming online.
     */
    void startPublishing({
      token: useToken,
      serverUrl: useUrl,
      /**
       * **The two endings are not the same, and treating them as one was the
       * reported "it takes me offline by itself".**
       *
       * `stopped` is the capture ending — the browser's Stop sharing bar, a
       * display unplugged. That is somebody deciding, and going offline for it
       * is the rule: stopping is stopping.
       *
       * `dropped` is the session going while the capture is still live: a
       * network blip, a server restart, a transport lost. Nobody decided
       * anything, so nothing about their status may change. It keeps the
       * durable claim — `DutySync` publishes nothing while `reconnecting`, so
       * the account stays online — stops the orphaned capture, and lets the
       * "Your screen is not being shared." alert say so, sound, and offer to
       * start again. See `ShareEnd`.
       */
      onEnded: (reason) => {
        if (reason === "stopped") {
          endSession();
          return;
        }
        shareInterrupted();
        /* A new episode deserves a new warning, even if an earlier one this
           page load was dismissed — and it is a different sentence: a dropped
           connection is not a reload. */
        setShareLostCause("dropped");
        setShareLostDismissed(false);
        sounded.current = false;
      },
    })
      .then((capture) => {
        /**
         * **The break, or the emergency, ends HERE — not when the button was
         * pressed.**
         *
         * `derive` puts a manual state above the share, so a screen going out
         * while `manual` still reads "break" leaves the pill on Break: the
         * capture runs, the manager can watch it, and the person is told they
         * are on a break. It is cleared at this point rather than on the press
         * because the press might come to nothing — somebody who opens the
         * picker and closes it again is still on their break, exactly as they
         * were, which is the honest outcome and the one nobody has to undo.
         *
         * Leaving an EMERGENCY is still gated: `choose` holds that transition
         * behind the end-emergency dialog and only runs this once the request
         * has been raised. This clears the state; it does not decide who may.
         */
        const wasOnBreak = takeBreakStart();
        if (wasOnBreak !== null) setJustEndedBreak(true);
        clearManual();
        /**
         * **`sessionLive()` is not decoration.** Nothing else calls it now that
         * the embed is gone, and `DutySync` refuses to publish anything while
         * the session reads `connecting` — deliberately, so a token fetch never
         * announces "offline". Left at `connecting` for the whole share, the
         * pill would read Online on this device and NOBODY else would ever be
         * told: not the manager, not the team, not the old app.
         */
        sessionLive();
        /* The screen is going out, so the panel has nothing left to report. */
        setOpen(false);
        /* Their report of what was actually captured. The status still waits on
           the SERVICE confirming a live screen — `confirmSharing` — because a
           browser's word about itself is not what a manager should be reading. */
        reportShare({
          sharing: true,
          connected: true,
          surface:
            capture.displaySurface === "monitor"
              ? "entire_screen"
              : capture.displaySurface === "window"
                ? "window"
                : capture.displaySurface === "browser"
                  ? "browser_tab"
                  : null,
          detail:
            capture.isEntireScreen === false
              ? "Sharing part of your screen."
              : "Sharing your entire screen.",
        });
        void confirmSharing(viewerId);
      })
      .catch((error: unknown) => {
        if (wasCancelled(error)) {
          reportProblem(
            "You did not pick a screen, so you are not online yet. Choose Go online and pick your entire screen.",
          );
          return;
        }
        /* The held seat goes with it. A publish that failed on an expired or
           refused token would fail the same way on every retry while the same
           seat is being handed back — see `prefetchShareSeat`. */
        releaseShareSeat();
        sessionFailed(shareRefusal(error));
      })
      /* Whichever way it went, the picker is closed and the ordinary rules
         apply again — including giving the room back if nothing came of it. */
      .finally(() => setStarting(false));
    return true;
  }

  /**
   * Warm the room up while the menu is open.
   *
   * This is what removes the old two-step. There is no meeting to create and no
   * join screen to get past — a `screen` room asks for no devices — so the only
   * thing standing between the press and the picker is a token, and that is
   * fetched here rather than on the press.
   *
   * Nothing about presence changes: joining a room is not sharing a screen, and
   * Online is decided by `sharing.screen` at the service. Somebody who opens the
   * menu and closes it again is never online, and the effect below puts the room
   * back.
   */
  /**
   * Before the menu is even opened.
   *
   * **The reported "Preparing… takes too long".** Opening the menu started a
   * four-hop request — our route, the engine's `/cowork/me`, Grav Stream's room
   * listing, the mint — and in development the route's first compile on top of
   * that. Somebody who opened the menu and pressed straight away waited for all
   * of it with a button reading "Preparing…" and no picker.
   *
   * Both halves are made ready as soon as the pill mounts instead: the seat is
   * held by `credentials.ts` for five minutes, and the library is a script tag
   * that parses once. Neither joins a room, neither publishes anything, and
   * neither touches the session — so this cannot make anybody look online,
   * and cannot silence `DutySync` the way holding a `connecting` session does.
   */
  useEffect(() => {
    /* Nothing to warm where nothing will ever be shared: a workspace with the
       requirement switched off should not mint seats or fetch a publisher
       library it will never call. */
    if (!viewerId || !screenRequired) return;
    prefetchShareSeat(viewerId);
    void loadPublisherSdk().catch((error: unknown) => {
      console.error("[stream] the publisher library did not load:", error);
    });
  }, [viewerId, screenRequired]);

  /**
   * And again when the menu opens, in case the pill mounted before the viewer
   * resolved or the held seat has since expired. Calling either is free.
   *
   * **No `manual !== null` guard, and no `startScreenShare`.** There was one of
   * each, and together they were the Break → Online bug: `startScreenShare`
   * refuses while a manual state is set, so on a break no seat was ever fetched,
   * the press had nothing to share with, and the panel said "Still getting your
   * room ready" for ever. Warming is not a status change — nothing here joins a
   * room, publishes anything, or touches the session — so there is no state it
   * needs to be withheld from.
   */
  useEffect(() => {
    if (!open || !viewerId || !screenRequired) return;
    prefetchShareSeat(viewerId);
    void loadPublisherSdk().catch((error: unknown) => {
      console.error("[stream] the publisher library did not load:", error);
    });
    /* Whether the seat has actually landed, for the button's own label. */
    let cancelled = false;
    void fetchShareSeat(viewerId)
      .then(() => !cancelled && setSeatReady(true))
      .catch(() => !cancelled && setSeatReady(false));
    return () => {
      cancelled = true;
    };
  }, [open, viewerId, screenRequired]);

  /**
   * Closing the menu WITHOUT sharing gives the room back. A session held open
   * for somebody who is not online is a participant in a room doing nothing.
   *
   * The two exclusions carry the whole meaning of "without sharing":
   * `starting` is the picker being on screen — the menu has closed and nothing
   * has been chosen yet — and `share.sharing` is a capture that is already
   * running. Ending either is ending a share somebody is in the middle of, and
   * it is what made going online last a few seconds and then stop.
   */
  useEffect(() => {
    if (open || starting || share.sharing) return;
    if (status === "online" || session === "idle") return;
    endSession();
  }, [open, starting, share.sharing, status, session]);

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
            /* The room is already warm in this state, so the picker opens from
               this very click. */
            if (openPicker()) return;
          }
          setOpen((v) => !v);
          setConfirming(null);
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
          {/**
           * **Going online is not instant, so it is not silent.**
           *
           * Between the press and a live screen there are three waits nobody
           * can see from outside: the browser preparing its capture prompt, the
           * person choosing a display, and the publish reaching Grav Stream.
           * Each is a second or two, and together they were a page that did not
           * change — which reads as a button that did nothing. This says which
           * step is running, and clears itself when the screen is going out.
           */}
          {starting ? (
            <div className="px-2.5 py-3" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-xs font-medium text-ink">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--ink-faint)] border-t-ink"
                />
                Processing your request…
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                {share.sharing
                  ? "Your screen is going out. Checking that the service has it."
                  : "Choose "}
                {!share.sharing && (
                  <span className="text-ink">Entire Screen</span>
                )}
                {!share.sharing &&
                  " in your browser’s prompt. Connecting can take a few seconds after you do — this panel closes itself when your screen is live."}
              </p>
            </div>
          ) : confirming === "share" ? (
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
                  choose <span className="text-ink">Entire Screen</span>. A
                  window or a tab is refused by the service, not just by us.
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  /* Never disabled while the room comes up: this button IS the
                     retry for that case, and one that greys itself out while
                     the thing it waits for is happening is a dead end. */
                  onClick={() => openPicker()}
                  className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-45"
                >
                  {warming ? "Preparing…" : "Choose screen"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="rounded-full px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : confirming === "offline" ? (
            <div className="px-2.5 py-2">
              <p className="text-xs font-medium text-ink">Go offline?</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                Your team sees you leave, and any running timer stops. You will
                be asked to write up the day next. The time you are away is
                credited back to your deadlines when you return.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(null);
                    setOpen(false);
                    /* The end-of-day report, exactly as before — the change is
                       only that it is no longer reached by a single click. */
                    setReportOpen("offline");
                  }}
                  className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
                >
                  Yes, go offline
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="rounded-full px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                >
                  Stay online
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
                      live from `cowork_duty_status`. Read through
                      `useMyDutyMode` rather than the ported listener, so this
                      line answers with the same machinery every other surface
                      uses rather than its own reading of the document. */}
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
                    /**
                     * **Go online is never disabled by the room warming up.**
                     *
                     * It used to be `c.id === "online" && busy`, and `busy`
                     * covers `session === "connecting"` — which is exactly what
                     * opening this menu now causes, because the seat is fetched
                     * the moment it opens so the picker can be opened by the
                     * press. The result was a greyed-out Go online for anybody
                     * who opened the menu: the one control the menu exists for,
                     * unusable, with no explanation.
                     *
                     * There is nothing to guard against. Pressing it while the
                     * room is still coming up opens the confirmation panel
                     * instead of the picker (`openPicker` answers false), which
                     * is a step rather than a failure. The only real
                     * precondition is knowing WHO is sharing.
                     */
                    disabled={c.id === "online" && !viewerId}
                    title={
                      c.id === "online" && !viewerId
                        ? "Still working out who you are — try again in a moment."
                        : undefined
                    }
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
                        {/* Said rather than shown by disabling it: the control
                            works either way, and this is only why the picker
                            might take a beat. */}
                        {c.id === "online" && !screenRequired
                          ? /* The hint states the requirement, and here there
                               is not one. Promising a screen share that will
                               never be asked for is how a menu teaches somebody
                               to distrust it. */
                            "Available and at work"
                          : c.id === "online" && warming
                            ? "Getting your room ready — you can press this now"
                            : c.hint}
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
                  setConfirming(null);
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
                  setConfirming(null);
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
              inferred — the reason for it is written underneath it.

              Where the workspace does not require a screen, two of the three are
              not facts about anything: reporting "Screen shared: No" to somebody
              who was never asked to share one reads as a fault they should fix.
              It says what is actually true instead. */}
          <div className="mt-1 border-t border-hairline px-2.5 pt-2 pb-1">
            {screenRequired ? (
              <>
                <p className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-ink-faint">Sharing</span>
                  <span className="text-ink-muted">
                    {share.surface ? SURFACE_LABEL[share.surface] : "Nothing"}
                  </span>
                </p>
                <p className="mt-1 flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-ink-faint">Screen shared</span>
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
              </>
            ) : (
              <p className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-ink-faint">Screen sharing</span>
                <span className="text-ink-muted">Off for this workspace</span>
              </p>
            )}
            <p
              role={notice ? "alert" : undefined}
              className={`mt-1.5 text-[11px] leading-relaxed ${
                notice ? "text-[var(--state-overdue-ink)]" : "text-ink-faint"
              }`}
            >
              {notice ??
                (screenRequired
                  ? share.detail
                  : "Your status is what you set it to. No screen is captured and nobody is watching.")}
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
            if (!wasOffline) return;
            /* Read before `goOffline` clears it — the panel reports what the
               break came to, and going offline from one is a way to end it. */
            if (takeBreakStart() !== null) setJustEndedBreak(true);
            goOffline();
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

      {/* "Your screen is not being shared." Raised after a reload ended the
          capture while the account stayed online — see the effect above. It
          changes no status: dismissing leaves the person Online, and sharing
          from it closes the gap. */}
      {shareLost && (
        <ShareLostDialog
          cause={shareLostCause}
          onShare={() => {
            /* Straight from the click, so the browser honours the capture
               prompt. If the seat is not in hand yet the picker cannot open —
               `openPicker` says why in the pill's notice — so the dialog stays
               up rather than closing on a press that achieved nothing. */
            cancelShareLostSound();
            if (openPicker()) setShareLostDismissed(true);
          }}
          onDismiss={() => {
            cancelShareLostSound();
            setShareLostDismissed(true);
          }}
        />
      )}
    </div>
  );
}
