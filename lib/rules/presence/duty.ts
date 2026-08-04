/**
 * Duty presence — the one model both halves of Cowork agree on.
 *
 * **There were two presence systems and they did not know about each other.**
 * The new workspace derived presence from a live LiveKit screen-share and kept
 * it in an in-memory store: correct, immediate, and invisible to everybody else
 * the moment the tab closed. Legacy kept `cowork_duty_status/{employeeId}` in
 * Firestore: shared, durable, and the thing that actually gated work — the
 * timer, the task actions, the deadline credits.
 *
 * This module is the merge. The **share decides** the mode, exactly as
 * `lib/status/employeeStatus.ts` says it must — Online is not a choice — and
 * the **legacy document carries** it, so a colleague, a manager and the old app
 * all read one answer. No second collection: `cowork_duty_status` is the
 * presence store, as it already was.
 *
 * Pure by construction. Every function here is arithmetic over a document and a
 * clock, so the rules can be tested without Firestore, a room, or a browser —
 * which matters because the interesting cases (a crashed tab, two tabs, a
 * refresh mid-session) are the ones hardest to stage by hand.
 */

/**
 * The four modes, matching legacy's `mode` field exactly.
 *
 * The same four values as `EmployeeStatus` in the presence store, deliberately:
 * a translation table between two spellings of one concept would be a place for
 * them to drift apart. Legacy writes these strings; we write these strings.
 */
export type DutyMode = "online" | "break" | "emergency" | "offline";

/**
 * How often a live tab restamps its claim.
 *
 * Chosen against the staleness window below, not for its own sake: the window
 * has to survive a missed beat, so it is comfortably more than twice this. A
 * backgrounded tab is throttled — `setInterval` in an inactive tab is clamped,
 * and this application is sometimes deliberately backgrounded (the automation
 * browser runs it that way) — so the margin is what stops a throttled tab
 * reporting its own user offline.
 */
export const HEARTBEAT_INTERVAL_MS = 45_000;

/**
 * How old a heartbeat may be before "online" stops being believed.
 *
 * This is what makes a closed browser, a crashed tab, a force-quit and a
 * sleeping laptop all resolve on their own. Nothing has to run at shutdown for
 * presence to become correct — which is the only way it can be correct, because
 * a process that has been killed does not get to write a farewell.
 *
 * Two and a half missed beats. Tighter would make an ordinary throttle look
 * like a disconnection; looser would leave a manager watching a green dot for
 * somebody who left.
 */
export const STALE_AFTER_MS = 120_000;

/**
 * The presence document, as legacy stores it.
 *
 * Field names are legacy's and are not up for tidying — the old app reads and
 * writes this same document, and a renamed field is a field the other side
 * silently stops seeing. `heartbeatAt` is the one addition, and it is additive
 * on purpose: legacy ignores unknown fields, so an old client is unaffected.
 */
export interface DutyDocument {
  mode?: string | null;
  /** Legacy's older spelling, still written by the old app. */
  isOnline?: boolean | null;
  breakStartedAtMs?: number | null;
  emergencyStartedAtMs?: number | null;
  emergencyReason?: string | null;
  /**
   * When the person went offline, stamped so the lost time is measurable on
   * return — the same shape as `breakStartedAtMs`. Offline is the third state
   * that credits time back to a deadline, and until now it was the one with no
   * span recorded, so the working time it consumed was silently uncompensated.
   */
  offlineStartedAtMs?: number | null;
  /** Epoch ms of the last proof-of-life from a live tab. Our addition. */
  heartbeatAt?: number | null;
  /** Which connection claimed `online`. Our addition — see `ownsClaim`. */
  presenceConnectionId?: string | null;
  /**
   * Epoch ms of the last MODE CHANGE — written by `dutyTransition`'s patch and,
   * deliberately, by nothing else: a heartbeat restates the claim through
   * `heartbeatPatch`, which omits it. So while a person stays online this holds
   * the moment their session began, which is what `queueAnchorMs` freezes the
   * completion projection against.
   */
  updatedAt?: number | null;
}

/**
 * The mode as written, before the clock is consulted.
 *
 * `mode` first, then legacy's older `isOnline` boolean — the same precedence
 * `useDutyStatus` already uses, so both apps read an old document identically. An
 * absent document is offline, which is a fact rather than a default: nobody has
 * ever gone on duty.
 */
export function storedMode(doc: DutyDocument | null): DutyMode {
  if (!doc) return "offline";
  const raw = typeof doc.mode === "string" ? doc.mode : null;
  if (raw === "online" || raw === "break" || raw === "emergency" || raw === "offline")
    return raw;
  if (raw) {
    /* An unrecognised mode is not a licence to work. Legacy has exactly four
       and a fifth would mean the old app grew one we have not ported; treating
       it as offline withholds actions rather than granting them on a guess. */
    return "offline";
  }
  return doc.isOnline ? "online" : "offline";
}

/**
 * Is this claim still alive?
 *
 * Only `online` expires. A break and an emergency are **claims about a person,
 * not about a connection** — somebody who shuts their laptop while on a break
 * is still on a break, and expiring it would quietly resume their deadlines and
 * credit them nothing. Legacy agrees: it clears both only when the person
 * leaves the state, and it carries an unfinished one across sessions in
 * `pendingBreakGapMs` / `pendingEmergencyGapMs` precisely so nothing is lost.
 *
 * A document with no heartbeat at all is treated as fresh when it claims
 * something other than online, and as **stale** when it claims online — that is
 * the old app's manual toggle, which has no heartbeat and can leave "online"
 * behind indefinitely. Believing it is how a manager ends up watching a green
 * dot for somebody who went home three days ago.
 */
export function isStale(doc: DutyDocument | null, nowMs: number): boolean {
  if (!doc) return false;
  if (storedMode(doc) !== "online") return false;
  const beat = typeof doc.heartbeatAt === "number" ? doc.heartbeatAt : null;
  if (beat === null) return true;
  return nowMs - beat > STALE_AFTER_MS;
}

/**
 * What this person's presence actually is, right now.
 *
 * **The only function anything outside this module should ask.** Reading
 * `doc.mode` directly is what would put a stale claim on screen, and it is the
 * single mistake this whole heartbeat design exists to prevent.
 */
export function readDutyMode(
  doc: DutyDocument | null,
  nowMs: number,
): DutyMode {
  const mode = storedMode(doc);
  if (mode === "online" && isStale(doc, nowMs)) return "offline";
  return mode;
}

/**
 * May this tab downgrade the claim it is looking at?
 *
 * The multi-tab rule, and the reason it is not simply "write what I see". Two
 * tabs are open; one holds the share. The other has no room, so its view of the
 * world is "not sharing" — and if it wrote that, it would put its own user
 * offline while their screen was still being shared to a manager.
 *
 * So a tab may clear `online` only when it owns the claim, or when the claim
 * has gone stale and belongs to nobody. Claiming is unconditional: a tab that
 * starts sharing is, by that act, the live one.
 */
export function ownsClaim(
  doc: DutyDocument | null,
  connectionId: string | null,
  nowMs: number,
): boolean {
  if (!doc || connectionId === null) return false;
  if (storedMode(doc) !== "online") return true;
  if (isStale(doc, nowMs)) return true;
  const holder =
    typeof doc.presenceConnectionId === "string" ? doc.presenceConnectionId : null;
  /* An online claim with no owner predates this field — the old app's manual
     toggle. Ours to correct, because nothing else will. */
  if (holder === null) return true;
  return holder === connectionId;
}

/* ── Transitions ──────────────────────────────────────────────────────────── */

/**
 * What one mode change writes.
 *
 * Transcribed from `DutyStatusToggle.jsx:99-175`, which is the only place the
 * rules have ever existed. The parts that carry an unfinished period across the
 * change are the ones worth naming, because losing one silently loses somebody
 * time they are owed:
 *
 * · Leaving **emergency** for anything that is not online stores the elapsed
 *   span in `pendingEmergencyGapMs`, to be raised for approval when they next
 *   come online. Going straight to online raises it immediately.
 * · Leaving **break** banks the elapsed seconds the same way, in
 *   `pendingBreakGapMs`, capped by the daily allowance at the moment it is
 *   applied rather than the moment it is measured.
 * · Entering either stamps its start, which is what makes the duration
 *   measurable later. Re-entering an emergency keeps the ORIGINAL start —
 *   the episode under review is the whole of it, not the last press.
 *
 * Returns the patch and, separately, the spans that the caller has to act on
 * rather than merely store. Keeping those out of the patch is deliberate:
 * writing a document is idempotent, raising an approval request is not.
 */
export interface DutyTransition {
  /** Merged into the document. */
  patch: DutyDocument & Record<string, unknown>;
  /** Emergency span to raise for approval NOW, in ms, or 0. */
  emergencyToRaiseMs: number;
  /** The reason that emergency was declared with, if there is a span. */
  emergencyReason: string | null;
  /** Break span to credit NOW, in ms, or 0. */
  breakToCreditMs: number;
  /**
   * Offline span to credit NOW, in ms, or 0.
   *
   * The RAW wall-clock span of the absence. The caller bounds it to office hours
   * before applying it — going offline overnight lost no WORKING time, so it must
   * shift no deadline (`workingSecsInSpan` in `deadlineCompensation.ts`). Kept raw
   * here because this rule owns transitions, not the office calendar.
   */
  offlineToCreditMs: number;
}

export function dutyTransition(input: {
  previous: DutyDocument | null;
  next: DutyMode;
  nowMs: number;
  connectionId: string | null;
  /** Required when entering emergency, matching legacy's own refusal. */
  reason?: string | null;
  /**
   * Bank the span in the document even on the path that would normally act on
   * it immediately.
   *
   * For a caller that **cannot** raise an approval or credit a break right now.
   * The spans are still returned, but the document also carries them, so the
   * time is not lost — and it is not lost to a stopgap either: these are
   * legacy's own `pendingEmergencyGapMs` / `pendingBreakGapMs` fields, and the
   * old app's `applyPendingEmergencyApproval` / `applyPendingBreakGap` pick
   * them up on its next online transition. The mechanism for "measured, not yet
   * applied" already existed; this just uses it on one more path.
   *
   * A caller that acts on the returned spans must leave this false, or the same
   * minutes are credited twice.
   */
  bankEvenWhenRaising?: boolean;
}): DutyTransition {
  const { previous, next, nowMs, connectionId } = input;
  const bank = input.bankEvenWhenRaising === true;
  const prevMode = storedMode(previous);

  const patch: DutyDocument & Record<string, unknown> = {
    mode: next,
    /* Both spellings, because the old app reads `isOnline` when `mode` is
       absent and a half-written document would read differently in each app. */
    isOnline: next === "online",
    updatedAt: nowMs,
  };

  /* The claim. Stamped only while online — a break carries no connection, and
     leaving a stale id behind would let a dead tab look like the owner. */
  if (next === "online") {
    patch.heartbeatAt = nowMs;
    patch.presenceConnectionId = connectionId;
  } else {
    patch.heartbeatAt = null;
    patch.presenceConnectionId = null;
  }

  let emergencyToRaiseMs = 0;
  let emergencyReason: string | null = null;
  let breakToCreditMs = 0;
  let offlineToCreditMs = 0;

  if (prevMode === "emergency") {
    /**
     * **An emergency span is never banked, on any exit.**
     *
     * It used to be held in `pendingEmergencyGapMs` whenever the person left for
     * anything but online — "held, not dropped", so the span could not be lost.
     * That reasoning was sound when nothing else recorded it. It is not now, and
     * the field became a second claim on the same minutes:
     *
     *  · Leaving Emergency Mode is gated by the end-emergency dialog, and the
     *    transition only runs AFTER the approval request has been raised. By the
     *    time this executes, the span is already on a `cowork_emergency_approvals`
     *    record with the reason and the document attached. Nothing is at risk of
     *    being lost.
     *  · The old application's `applyPendingEmergencyApproval` turns whatever it
     *    finds in this field into ANOTHER approval request on its next online
     *    transition. One emergency would then be decided twice, and approved
     *    twice would shift every deadline twice.
     *
     * So it is actively CLEARED rather than merely left alone — a value written
     * by the old app, or by a build before this one, must not survive to be
     * spent. Emergency time reaches a deadline through exactly one door:
     * `decideEmergencyRequest`, on approval by the named manager.
     */
    const started = numberOr(previous?.emergencyStartedAtMs, nowMs);
    const span = Math.max(0, nowMs - started);
    if (next === "online") {
      emergencyToRaiseMs = span;
      emergencyReason = textOr(previous?.emergencyReason, null);
    }
    patch.pendingEmergencyGapMs = null;
    patch.pendingEmergencyReason = null;
    patch.emergencyStartedAtMs = null;
  }

  if (prevMode === "break") {
    /**
     * **A break is credited when it ENDS, not when somebody resumes sharing.**
     *
     * This used to require `next === "online"`, and `derive()` states that
     * online is a live screen share and nothing else — so ending a break
     * without sharing banked the span into `pendingBreakGapMs` and waited for
     * an old app that never runs to apply it. The minutes were measured
     * correctly and then went nowhere, which is why break time never reached
     * any deadline.
     *
     * Unlike an offline span, a break has a definite end the moment it is
     * left. There is nothing to wait for.
     */
    const started = numberOr(previous?.breakStartedAtMs, nowMs);
    const span = Math.max(0, nowMs - started);
    breakToCreditMs = span;
    /* Banked as well ONLY when the caller says it cannot act on the returned
       span — banking one it also applies is how the same minutes move a
       deadline twice. */
    if (bank && span > 0) patch.pendingBreakGapMs = span;
    patch.breakStartedAtMs = null;
  }

  if (prevMode === "offline") {
    /* The same shape as break: measure the span, credit it on return, bank it
       otherwise. The caller bounds it to office hours — an overnight offline
       lost no working time. */
    const started = numberOr(previous?.offlineStartedAtMs, nowMs);
    const span = Math.max(0, nowMs - started);
    if (next === "online") {
      offlineToCreditMs = span;
      if (bank && span > 0) patch.pendingOfflineGapMs = span;
    } else {
      patch.pendingOfflineGapMs = span > 0 ? span : null;
    }
    patch.offlineStartedAtMs = null;
  }

  if (next === "emergency") {
    /* The original start survives a re-declaration. */
    patch.emergencyStartedAtMs =
      prevMode === "emergency"
        ? numberOr(previous?.emergencyStartedAtMs, nowMs)
        : nowMs;
    patch.emergencyReason = textOr(input.reason, null);
  } else if (next === "break") {
    patch.breakStartedAtMs = nowMs;
  } else if (next === "offline") {
    /* The original start survives a re-entry, so a stale-then-explicit offline
       is measured as one absence rather than restarted. */
    patch.offlineStartedAtMs =
      prevMode === "offline"
        ? numberOr(previous?.offlineStartedAtMs, nowMs)
        : nowMs;
  }

  return {
    patch,
    emergencyToRaiseMs,
    emergencyReason,
    breakToCreditMs,
    offlineToCreditMs,
  };
}

/**
 * Which calendar day the duty document files hours under.
 *
 * UTC, matching legacy's own `new Date(now).toISOString().slice(0, 10)` in
 * `DutyStatusToggle.jsx:114`. Its comment there is explicit that this is the
 * `dailyHours` convention, and it deliberately differs from the IST day key the
 * same file uses for deadline shifts. Reading one with the other's key returns
 * nothing on the boundary days, which reads as "worked no hours today".
 */
export function dutyDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Seconds online today, from the engine's own accumulator.
 *
 * `dailyHours` is written in HOURS as a float and incremented when a session
 * ends, so it is behind by however long the current session has been running —
 * legacy has the same property, because the increment happens on transition.
 * Not corrected for here: adding the live session would make this disagree with
 * every other reader of the same field, and a figure that is consistent and
 * slightly stale beats one that is unique to this screen.
 *
 * Absent is 0 rather than null because the field's meaning is cumulative: no
 * entry for today is a true statement that no session has closed today.
 */
export function dailyHoursSecs(
  doc: (DutyDocument & { dailyHours?: unknown }) | null,
  nowMs: number,
): number {
  const table = doc?.dailyHours;
  if (!table || typeof table !== "object") return 0;
  const hours = (table as Record<string, unknown>)[dutyDayKey(nowMs)];
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0)
    return 0;
  return Math.round(hours * 3600);
}

/**
 * One entry in the status history log — a mode this person was in, and when
 * it began.
 *
 * Not the presence document itself, which is overwritten on every transition
 * and so remembers only the current mode. This is the append-only trail
 * behind it: what somebody's day actually looked like — when they came
 * online, when they took a break, when they went offline — the thing the
 * duty document was never designed to answer because it only ever holds one
 * mode at a time. Written once per transition, alongside the document patch,
 * and never edited afterwards.
 */
export interface DutyHistoryEntry {
  id: string;
  mode: DutyMode;
  /** Epoch ms this mode began. */
  at: number;
  /** The reason text, for an emergency entry. */
  reason?: string | null;
}

/** A heartbeat is a claim restated, never a mode change. */
export function heartbeatPatch(nowMs: number, connectionId: string | null) {
  return { heartbeatAt: nowMs, presenceConnectionId: connectionId };
}

/**
 * The clock the queue projection should measure "when will this finish" FROM.
 *
 * The expected-completion date chains a person's remaining work forward from an
 * anchor. Anchoring at the live `now` makes it CREEP: while a person is online
 * but between timer sessions, `now` advances and the remaining work does not, so
 * the projected finish marches away for no reason anyone chose — the same drift
 * the committed deadline was fixed for, and the same rule answers it.
 *
 * Being online is the budget being spent as intended, so it must not push the
 * projection. While online the anchor is FROZEN at the moment the session began
 * — `updatedAt`, which only a mode change writes; a heartbeat restates the claim
 * without touching it, and the timer's own heartbeat writes a different document
 * entirely. It advances only when the person has actually been away, because
 * returning to online stamps a later session start, and that later start is
 * exactly the lost time. An offline or unknown caller gets `now`: there is no
 * live session to freeze against, and their work genuinely slips with the clock.
 *
 * A stale online claim (a tab that went home without saying so) resolves through
 * `readDutyMode` to offline, so it gets `now` too rather than a frozen anchor
 * from whenever they were last really here.
 */
export function queueAnchorMs(doc: DutyDocument | null, nowMs: number): number {
  if (!doc || readDutyMode(doc, nowMs) !== "online") return nowMs;
  const since: unknown = doc.updatedAt;
  /* A number in ms, at or before now. Anything else — a Firestore Timestamp on a
     pre-migration doc, a clock-skewed future value, a missing field — is not a
     trustworthy session start, and `now` is the safe fallback. */
  return typeof since === "number" &&
    Number.isFinite(since) &&
    since > 0 &&
    since <= nowMs
    ? since
    : nowMs;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textOr(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
